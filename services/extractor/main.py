"""
Tax document extractor service.
Uses Presidio Image Redactor for PII removal and Claude Vision for extraction.
"""

import os
import io
import json
import base64
import logging
from typing import Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
from PIL import Image
from presidio_image_redactor import ImageRedactorEngine, ImageAnalyzerEngine
from presidio_analyzer import AnalyzerEngine
import pytesseract
from openai import OpenAI

app = FastAPI(title="Tax Document Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Presidio engines
image_redactor = ImageRedactorEngine()
image_analyzer = ImageAnalyzerEngine()
text_analyzer = AnalyzerEngine()  # Text-based analyzer (more accurate NER)

# Entity types to redact with their minimum confidence thresholds
# Lower threshold for pattern-based (SSN), higher for NLP-based (names/locations)
ENTITY_THRESHOLDS = {
    "US_SSN": 0.3,      # Pattern-based, reliable even at low scores
    "US_ITIN": 0.3,     # Pattern-based
    "PERSON": 0.90,     # NLP-based, need high confidence to avoid false positives
    "LOCATION": 0.90,   # NLP-based, need high confidence
}

ENTITIES_TO_REDACT = list(ENTITY_THRESHOLDS.keys())

# Use the minimum threshold to catch all potential PII, then let entity-specific thresholds filter
MIN_SCORE_THRESHOLD = min(ENTITY_THRESHOLDS.values())

# Initialize OpenRouter client (OpenAI-compatible)
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ.get("OPENROUTER_API_KEY"),
)

EXTRACTION_PROMPT = """You are extracting data from a Form 1040 U.S. Individual Income Tax Return.

The image shows a tax form with PII (names, SSN, addresses) redacted as black boxes.
Extract ONLY the financial values from the visible line numbers.

Return a JSON object with these exact fields. Use 0 if a line is blank or not visible:

{
  "wages": <Line 1a or 1z value>,
  "interestIncome": <Line 2b value>,
  "dividendIncome": <Line 3b value>,
  "capitalGains": <Line 7a value>,
  "otherIncome": <Line 8 value>,
  "totalIncome": <Line 9 value>,
  "adjustments": <Line 10 value>,
  "adjustedGrossIncome": <Line 11a or 11b value>,
  "standardDeduction": <Line 12e value>,
  "taxableIncome": <Line 15 value>,
  "totalTax": <Line 24 value>,
  "totalPayments": <Line 33 value>,
  "refundOrOwed": <Line 34, 35a, or 37 value - use positive for refund, negative for owed>
}

IMPORTANT:
- Look at the LINE NUMBERS on the left side of the form to identify each value
- The values are on the RIGHT side of each row
- Return ONLY the JSON object, no other text"""


class ExtractionResult(BaseModel):
    formId: str
    confidence: int
    fields: dict[str, Any]
    errors: list[str]


def pdf_to_images(pdf_bytes: bytes, dpi: int = 150) -> list[Image.Image]:
    """Convert PDF pages to PIL Images."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []

    for page in doc:
        # Render page to pixmap
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)

        # Convert to PIL Image
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        images.append(img)

    doc.close()
    return images


def redact_image(image: Image.Image, page_num: int = 0) -> Image.Image:
    """Redact PII from image using OCR + text-based NER (more accurate than image NER)."""
    from PIL import ImageDraw

    width, height = image.size
    logger.info(f"=== Page {page_num + 1}: Image size {width}x{height} ===")

    # Step 1: Use Presidio image redactor for SSN patterns only
    # PHONE_NUMBER causes false positives on financial values like "166,000"
    logger.info(f"  Step 1: Presidio pattern-based redaction (SSN only)")
    redacted = image_redactor.redact(
        image,
        fill=(0, 0, 0),
        entities=["US_SSN", "US_ITIN"],
        score_threshold=0.3,
    )

    # Step 2: OCR + Text NER for names and locations
    # Text-based NER is much more accurate than image-based NER
    logger.info(f"  Step 2: OCR + text NER for names/locations")
    try:
        # Get word-level bounding boxes from Tesseract
        ocr_data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

        # Build full text and track word positions
        words = []
        for i, text in enumerate(ocr_data['text']):
            if text.strip():
                words.append({
                    'text': text,
                    'left': ocr_data['left'][i],
                    'top': ocr_data['top'][i],
                    'width': ocr_data['width'][i],
                    'height': ocr_data['height'][i],
                })

        # Build full text for NER analysis
        full_text = ' '.join(w['text'] for w in words)
        logger.info(f"    OCR extracted {len(words)} words")

        if full_text.strip():
            # Run Presidio text analyzer (uses spaCy NER - much more accurate)
            results = text_analyzer.analyze(
                text=full_text,
                entities=[
                    "PERSON",           # Names
                    "US_SSN",           # Social Security Numbers
                ],
                language="en",
                score_threshold=0.85,  # High threshold to reduce false positives
            )

            # Map detected entities back to word bounding boxes
            draw = ImageDraw.Draw(redacted)
            char_to_word = []  # Map character positions to word indices
            char_pos = 0
            for idx, w in enumerate(words):
                for _ in w['text']:
                    char_to_word.append(idx)
                char_to_word.append(idx)  # For the space after word
                char_pos += len(w['text']) + 1

            entities_redacted = 0
            for result in results:
                entity_text = full_text[result.start:result.end]

                # Filter out false positives for PERSON entities
                if result.entity_type == "PERSON":
                    # Skip if too short (likely OCR noise)
                    if len(entity_text) < 5:
                        continue
                    # Skip if mostly non-letters (punctuation, numbers, spaces)
                    letters_only = ''.join(c for c in entity_text if c.isalpha())
                    if len(letters_only) < 4:
                        continue
                    letter_ratio = len(letters_only) / len(entity_text)
                    if letter_ratio < 0.75:
                        continue
                    # Skip if contains repeated characters (OCR noise like "ee ee ee")
                    if len(set(letters_only.lower())) < 3:
                        continue
                    # Skip common form words that get misdetected
                    lower_text = entity_text.lower()
                    skip_patterns = [
                        'attach', 'schedule', 'form', 'line', 'see', 'instructions',
                        'check', 'box', 'enter', 'amount', 'total', 'income', 'tax',
                        'required', 'dependent', 'credit', 'wages', 'ptin', 'sch',
                        'subtract', 'add', 'include', 'rollover', 'qcd', 'pso',
                        'fyou', 'ifyou', 'youdd', 'ddner', 'cheek', 'sanda', 'coen',
                        'mete', 'ting', 'zer', 'rere', 'leaf',  # Common OCR errors
                    ]
                    if any(pat in lower_text for pat in skip_patterns):
                        continue
                    # Skip if it looks like form field labels (all caps)
                    if entity_text.isupper() and len(entity_text) > 3:
                        continue
                    # Must look like a proper name: First letter capitalized, rest lowercase
                    # or multiple capitalized words (First Last)
                    words_in_entity = entity_text.split()
                    if not all(w[0].isupper() for w in words_in_entity if len(w) > 0):
                        continue

                # Find words that overlap with this entity
                start_word = char_to_word[min(result.start, len(char_to_word) - 1)]
                end_word = char_to_word[min(result.end - 1, len(char_to_word) - 1)]

                # Get bounding box covering all words in this entity
                entity_words = words[start_word:end_word + 1]
                if entity_words:
                    x1 = min(w['left'] for w in entity_words)
                    y1 = min(w['top'] for w in entity_words)
                    x2 = max(w['left'] + w['width'] for w in entity_words)
                    y2 = max(w['top'] + w['height'] for w in entity_words)

                    # Add padding
                    padding = 3
                    x1 = max(0, x1 - padding)
                    y1 = max(0, y1 - padding)
                    x2 = min(width, x2 + padding)
                    y2 = min(height, y2 + padding)

                    draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))
                    logger.info(f"    Redacted [{result.entity_type}] score={result.score:.2f}: '{entity_text}' at ({x1},{y1})-({x2},{y2})")
                    entities_redacted += 1

            logger.info(f"  Text NER: {len(results)} entities detected, {entities_redacted} redacted")

        # Step 3: Regex-based address detection (NER doesn't catch street addresses well)
        import re
        # Pattern for US street addresses: number + street name + suffix
        # Street suffix - include common OCR errors (Ci for Ct, etc.)
        street_suffixes = r'(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Ci|Court|Blvd|Boulevard|Way|Pl|Place|Cir|Circle|Pkwy|Parkway|Ter|Terrace)'
        # Use case-insensitive matching with flexible word patterns
        address_pattern = rf'\b(\d{{1,5}})\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+{street_suffixes}\b'

        address_matches = list(re.finditer(address_pattern, full_text, re.IGNORECASE))
        logger.info(f"  Step 3: Address regex found {len(address_matches)} matches")

        for match in address_matches:
            # Additional validation: street name should be 2+ characters and not common form words
            street_name = match.group(2).lower()
            skip_words = {'line', 'subtract', 'add', 'total', 'amount', 'direct', 'third', 'see', 'form',
                          'standard', 'itemized', 'deduction', 'schedule', 'qualified', 'business', 'income'}
            if len(street_name) >= 2 and not any(skip in street_name for skip in skip_words):
                start_word = char_to_word[min(match.start(), len(char_to_word) - 1)]
                end_word = char_to_word[min(match.end() - 1, len(char_to_word) - 1)]

                entity_words = words[start_word:end_word + 1]
                if entity_words:
                    x1 = min(w['left'] for w in entity_words) - 3
                    y1 = min(w['top'] for w in entity_words) - 3
                    x2 = max(w['left'] + w['width'] for w in entity_words) + 3
                    y2 = max(w['top'] + w['height'] for w in entity_words) + 3

                    draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))
                    logger.info(f"    Redacted [ADDRESS]: '{match.group()}' at ({x1},{y1})-({x2},{y2})")

        # Also look for city/state/zip patterns
        city_state_zip = r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b'
        for match in re.finditer(city_state_zip, full_text):
            start_word = char_to_word[min(match.start(), len(char_to_word) - 1)]
            end_word = char_to_word[min(match.end() - 1, len(char_to_word) - 1)]

            entity_words = words[start_word:end_word + 1]
            if entity_words:
                x1 = min(w['left'] for w in entity_words) - 3
                y1 = min(w['top'] for w in entity_words) - 3
                x2 = max(w['left'] + w['width'] for w in entity_words) + 3
                y2 = max(w['top'] + w['height'] for w in entity_words) + 3

                draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))
                logger.info(f"    Redacted [CITY_STATE_ZIP] regex: '{match.group()}' at ({x1},{y1})-({x2},{y2})")

    except Exception as e:
        logger.warning(f"  OCR/NER failed: {e}")

    return redacted


def image_to_base64(image: Image.Image) -> str:
    """Convert PIL Image to base64 string."""
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def extract_with_vision(images: list[Image.Image]) -> dict[str, Any]:
    """Use Claude Vision via OpenRouter to extract data from redacted images."""

    # Build message content with images
    content = [{"type": "text", "text": EXTRACTION_PROMPT}]

    for i, img in enumerate(images):
        b64 = image_to_base64(img)
        content.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{b64}"
            }
        })
        content.append({
            "type": "text",
            "text": f"Page {i + 1} of the Form 1040"
        })

    response = client.chat.completions.create(
        model="anthropic/claude-sonnet-4",
        max_tokens=1024,
        messages=[{"role": "user", "content": content}],
    )

    response_text = response.choices[0].message.content

    # Parse JSON from response
    try:
        # Try to parse directly
        return json.loads(response_text)
    except json.JSONDecodeError:
        # Try to extract JSON from markdown code block
        import re
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", response_text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        raise ValueError(f"Could not parse JSON from response: {response_text[:200]}")


class PreviewResult(BaseModel):
    images: list[str]  # Base64 encoded redacted images
    pageCount: int


@app.post("/preview", response_model=PreviewResult)
async def preview_redacted(file: UploadFile):
    """Preview redacted PDF images before extraction."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    try:
        pdf_bytes = await file.read()
        images = pdf_to_images(pdf_bytes)

        if not images:
            raise HTTPException(status_code=400, detail="Could not read PDF pages")

        # Redact PII from each page
        redacted_images = [redact_image(img, i) for i, img in enumerate(images)]

        # Convert to base64
        b64_images = [image_to_base64(img) for img in redacted_images[:2]]

        return PreviewResult(images=b64_images, pageCount=len(images))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ExtractFromImagesRequest(BaseModel):
    images: list[str]  # Base64 encoded images


@app.post("/extract-from-images", response_model=ExtractionResult)
async def extract_from_images(request: ExtractFromImagesRequest):
    """Extract tax data from pre-redacted images."""
    try:
        # Convert base64 back to PIL Images
        images = []
        for b64 in request.images:
            img_bytes = base64.b64decode(b64)
            img = Image.open(io.BytesIO(img_bytes))
            images.append(img)

        # Extract with vision
        extracted = extract_with_vision(images)

        # Format fields with metadata
        fields = {}
        line_mapping = {
            "wages": "1a",
            "interestIncome": "2b",
            "dividendIncome": "3b",
            "capitalGains": "7",
            "otherIncome": "8",
            "totalIncome": "9",
            "adjustments": "10",
            "adjustedGrossIncome": "11",
            "standardDeduction": "12e",
            "taxableIncome": "15",
            "totalTax": "24",
            "totalPayments": "33",
            "refundOrOwed": "35a",
        }

        for key, value in extracted.items():
            if key in line_mapping:
                fields[key] = {
                    "value": float(value) if isinstance(value, (int, float)) else 0,
                    "line": line_mapping[key],
                    "verified": False,
                }

        return ExtractionResult(
            formId="1040",
            confidence=95,
            fields=fields,
            errors=[],
        )

    except Exception as e:
        return ExtractionResult(
            formId="1040",
            confidence=0,
            fields={},
            errors=[str(e)],
        )


@app.post("/extract", response_model=ExtractionResult)
async def extract_tax_document(file: UploadFile):
    """Extract tax data from uploaded PDF using vision (single step)."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    try:
        # Read PDF
        pdf_bytes = await file.read()

        # Convert to images
        images = pdf_to_images(pdf_bytes)

        if not images:
            return ExtractionResult(
                formId="unknown",
                confidence=0,
                fields={},
                errors=["Could not read PDF pages"],
            )

        # Redact PII from each page
        redacted_images = [redact_image(img, i) for i, img in enumerate(images)]

        # Extract with vision (send first 2 pages - that's where 1040 data is)
        extracted = extract_with_vision(redacted_images[:2])

        # Format fields with metadata
        fields = {}
        line_mapping = {
            "wages": "1a",
            "interestIncome": "2b",
            "dividendIncome": "3b",
            "capitalGains": "7",
            "otherIncome": "8",
            "totalIncome": "9",
            "adjustments": "10",
            "adjustedGrossIncome": "11",
            "standardDeduction": "12e",
            "taxableIncome": "15",
            "totalTax": "24",
            "totalPayments": "33",
            "refundOrOwed": "35a",
        }

        for key, value in extracted.items():
            if key in line_mapping:
                fields[key] = {
                    "value": float(value) if isinstance(value, (int, float)) else 0,
                    "line": line_mapping[key],
                    "verified": False,
                }

        return ExtractionResult(
            formId="1040",
            confidence=95,
            fields=fields,
            errors=[],
        )

    except Exception as e:
        return ExtractionResult(
            formId="1040",
            confidence=0,
            fields={},
            errors=[str(e)],
        )


class DebugEntity(BaseModel):
    entity_type: str
    text: str
    score: float
    start: int
    end: int


class DebugResult(BaseModel):
    page: int
    entities: list[DebugEntity]


@app.post("/debug", response_model=list[DebugResult])
async def debug_detection(file: UploadFile):
    """Debug endpoint: shows what entities Presidio detected without redacting."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    try:
        pdf_bytes = await file.read()
        images = pdf_to_images(pdf_bytes)

        if not images:
            raise HTTPException(status_code=400, detail="Could not read PDF pages")

        results = []
        for page_num, img in enumerate(images[:2]):  # First 2 pages
            # Use the image analyzer directly to see what's detected
            analyzer_results = image_redactor.analyze(img)

            entities = []
            for bbox_result in analyzer_results.bboxes:
                entities.append(DebugEntity(
                    entity_type=bbox_result.entity_type,
                    text=bbox_result.text if hasattr(bbox_result, 'text') else "(OCR text)",
                    score=bbox_result.score,
                    start=0,
                    end=0,
                ))

            results.append(DebugResult(page=page_num + 1, entities=entities))

        return results

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
