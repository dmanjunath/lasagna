"""
Test script: Document AI Form Parser + Cloud DLP redaction pipeline.

Extracts key-value pairs from tax documents, then strips PII
so the output is safe to send to an LLM for schema mapping.

Usage:
    python scripts/test_extraction.py /path/to/document.pdf
    python scripts/test_extraction.py /path/to/scan.jpg
"""

import json
import mimetypes
import re
import sys
from pathlib import Path

from google.cloud import documentai_v1 as documentai
from google.cloud import dlp_v2

PROJECT_ID = "lasagna-prod"
LOCATION = "us"
FORM_PARSER_ID = "2a4ce4b54806000e"

# DLP info types to redact
PII_INFO_TYPES = [
    "PERSON_NAME",
    "US_SOCIAL_SECURITY_NUMBER",
    "STREET_ADDRESS",
    "PHONE_NUMBER",
    "EMAIL_ADDRESS",
    "DATE_OF_BIRTH",
    "US_INDIVIDUAL_TAXPAYER_IDENTIFICATION_NUMBER",
]

# Keys that inherently indicate PII — drop entirely regardless of value
PII_KEY_PATTERNS = [
    r"social security",
    r"ssn",
    r"first name",
    r"last name",
    r"middle initial",
    r"spouse.*name",
    r"full name",
    r"address",
    r"city.*town",
    r"foreign country",
    r"foreign province",
    r"foreign postal",
    r"zip code",
    r"deceased",
    r"date of birth",
]

# Values that are just UI noise (checkboxes, empty, form artifacts)
NOISE_VALUES = {"", "☐", "☑", "✓", "✗", "□"}


def extract_form_fields(file_path: str) -> list[dict]:
    """Send document to Document AI Form Parser, return key-value pairs."""
    client = documentai.DocumentProcessorServiceClient(
        client_options={"api_endpoint": f"{LOCATION}-documentai.googleapis.com"}
    )

    processor_name = client.processor_path(PROJECT_ID, LOCATION, FORM_PARSER_ID)

    path = Path(file_path)
    mime_type = mimetypes.guess_type(str(path))[0]
    if mime_type is None:
        mime_type = "application/pdf" if path.suffix == ".pdf" else "image/jpeg"

    with open(path, "rb") as f:
        raw_document = documentai.RawDocument(content=f.read(), mime_type=mime_type)

    request = documentai.ProcessRequest(name=processor_name, raw_document=raw_document)
    result = client.process_document(request=request)
    document = result.document

    fields = []
    for page in document.pages:
        for field in page.form_fields:
            key = _text_from_layout(field.field_name, document.text).strip()
            value = _text_from_layout(field.field_value, document.text).strip()
            confidence = field.field_value.confidence if field.field_value else 0
            if key or value:
                fields.append({
                    "key": key,
                    "value": value,
                    "confidence": round(confidence, 3),
                })
    return fields


def _text_from_layout(layout, full_text: str) -> str:
    """Extract text from a document layout element using text anchors."""
    if not layout or not layout.text_anchor or not layout.text_anchor.text_segments:
        return ""
    parts = []
    for segment in layout.text_anchor.text_segments:
        start = int(segment.start_index) if segment.start_index else 0
        end = int(segment.end_index)
        parts.append(full_text[start:end])
    return "".join(parts)


def clean_fields(fields: list[dict]) -> list[dict]:
    """Clean up raw Document AI output into intelligible key-value pairs."""
    cleaned = []
    seen_keys = set()

    for f in fields:
        key = _clean_key(f["key"])
        value = _clean_value(f["value"])
        confidence = f["confidence"]

        # Skip empty/noise values
        if value in NOISE_VALUES:
            continue

        # Skip fields where key indicates PII
        if _is_pii_key(key):
            continue

        # Skip empty keys or very short meaningless keys
        if not key or key in (".", "☐", "☑", "c", "b", "e"):
            continue

        # Skip low confidence fields
        if confidence < 0.5:
            continue

        # Deduplicate — keep the one with a value, or the first seen
        dedup_key = key.lower().strip()
        if dedup_key in seen_keys:
            # Update if this one has a more meaningful value
            for existing in cleaned:
                if existing["key"].lower().strip() == dedup_key:
                    if value and (not existing["value"] or existing["value"] in NOISE_VALUES):
                        existing["value"] = value
                        existing["confidence"] = confidence
                    break
            continue
        seen_keys.add(dedup_key)

        cleaned.append({
            "key": key,
            "value": value,
            "confidence": confidence,
        })

    return cleaned


def _clean_key(key: str) -> str:
    """Normalize a Document AI field key."""
    # Collapse newlines and extra whitespace
    key = re.sub(r"\s+", " ", key).strip()
    # Remove leading line numbers like "1a ", "2b ", "9 "
    key = re.sub(r"^\d+[a-z]?\s+", "", key)
    # Remove trailing line numbers
    key = re.sub(r"\s+\d+[a-z]?$", "", key)
    return key


def _clean_value(value: str) -> str:
    """Normalize a Document AI field value."""
    # Collapse newlines and extra whitespace
    value = re.sub(r"\s+", " ", value).strip()
    # Normalize spaced-out numbers (e.g., "1 6 6 , 0 0 0" -> "166,000")
    # But only if it looks like a spaced number (digits separated by single spaces)
    if re.match(r"^[\d ,.\-]+$", value):
        value = re.sub(r"(?<=\d)\s+(?=\d)", "", value)
    return value


def _is_pii_key(key: str) -> bool:
    """Check if a key name indicates PII content."""
    key_lower = key.lower()
    return any(re.search(p, key_lower) for p in PII_KEY_PATTERNS)


def normalize_for_dlp(text: str) -> str:
    """Normalize text so DLP can better detect PII patterns like SSNs."""
    # Collapse spaced digit sequences that look like SSNs (9 digits with spaces)
    # e.g., "3 5 6 2 3 6 7 5 3" -> "356-23-6753"
    def ssn_collapse(match):
        digits = re.sub(r"\s+", "", match.group(0))
        if len(digits) == 9:
            return f"{digits[:3]}-{digits[3:5]}-{digits[5:]}"
        return match.group(0)

    text = re.sub(r"\b\d(?:\s+\d){8}\b", ssn_collapse, text)
    # Also catch partially grouped SSNs like "4 6 5 3 57545"
    text = re.sub(r"\b\d(?:\s+\d){2,8}\d*\b", ssn_collapse, text)
    return text


def redact_pii(fields: list[dict]) -> list[dict]:
    """Use Cloud DLP to identify and redact PII from extracted field values."""
    dlp_client = dlp_v2.DlpServiceClient()
    parent = f"projects/{PROJECT_ID}/locations/{LOCATION}"

    # Build text from fields, normalizing for better DLP detection
    items = []
    for f in fields:
        items.append(f"{f['key']}: {f['value']}")
    text = normalize_for_dlp("\n".join(items))

    inspect_config = dlp_v2.InspectConfig(
        info_types=[dlp_v2.InfoType(name=t) for t in PII_INFO_TYPES],
        min_likelihood=dlp_v2.Likelihood.POSSIBLE,
        include_quote=True,
    )

    deidentify_config = dlp_v2.DeidentifyConfig(
        info_type_transformations=dlp_v2.InfoTypeTransformations(
            transformations=[
                dlp_v2.InfoTypeTransformations.InfoTypeTransformation(
                    info_types=[dlp_v2.InfoType(name=t) for t in PII_INFO_TYPES],
                    primitive_transformation=dlp_v2.PrimitiveTransformation(
                        replace_config=dlp_v2.ReplaceValueConfig(
                            new_value=dlp_v2.Value(string_value="[REDACTED]")
                        )
                    ),
                )
            ]
        )
    )

    request = dlp_v2.DeidentifyContentRequest(
        parent=parent,
        inspect_config=inspect_config,
        deidentify_config=deidentify_config,
        item=dlp_v2.ContentItem(value=text),
    )

    response = dlp_client.deidentify_content(request=request)

    # Parse redacted text back into fields
    redacted_lines = response.item.value.split("\n")
    redacted_fields = []
    for line in redacted_lines:
        if ": " in line:
            key, _, value = line.partition(": ")
            value = value.strip()
            # Skip fully redacted or empty values
            if not value or value == "[REDACTED]":
                continue
            # Skip if value is just redaction markers mixed with noise
            if re.fullmatch(r"[\[REDACTED\]\s,.\-]*", value):
                continue
            redacted_fields.append({"key": key.strip(), "value": value})

    return redacted_fields, response


def main():
    if len(sys.argv) < 2:
        print("Usage: python test_extraction.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    print(f"\n{'='*60}")
    print(f"Processing: {file_path}")
    print(f"{'='*60}")

    # Step 1: Extract with Document AI
    print("\n--- Step 1: Document AI Form Parser (raw) ---")
    raw_fields = extract_form_fields(file_path)
    print(f"Extracted {len(raw_fields)} raw fields")

    # Step 2: Clean up extracted fields
    print("\n--- Step 2: Cleaned fields (PII keys removed, noise filtered) ---")
    cleaned = clean_fields(raw_fields)
    print(f"Cleaned to {len(cleaned)} meaningful fields:\n")
    for f in cleaned:
        print(f"  {f['key']}: {f['value']} (conf: {f['confidence']})")

    # Step 3: Redact remaining PII with Cloud DLP
    print(f"\n--- Step 3: Cloud DLP Redaction ---")
    redacted_fields, dlp_response = redact_pii(cleaned)

    # Show what DLP found
    print(f"\nDLP transformations applied:")
    for summary in dlp_response.overview.transformation_summaries:
        info_type = summary.info_type.name
        count = summary.results[0].count if summary.results else 0
        print(f"  {info_type}: {count} occurrence(s) redacted")

    print(f"\n--- Final output ({len(redacted_fields)} fields safe for LLM) ---\n")
    for f in redacted_fields:
        print(f"  {f['key']}: {f['value']}")

    # Step 4: Output as JSON (what we'd send to LLM)
    print(f"\n--- JSON for LLM ---")
    print(json.dumps(redacted_fields, indent=2))


if __name__ == "__main__":
    main()
