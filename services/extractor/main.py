"""
Tax document extractor service.
Uses EasyOCR + GLiNER (or Presidio as fallback) for PII removal and Claude Vision for extraction.
"""

import os
import io
import json
import base64
import logging
import re
from typing import Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
from PIL import Image, ImageDraw
from openai import OpenAI

# Redaction engine selection: "easyocr_gliner" or "presidio"
REDACTION_ENGINE = os.environ.get("REDACTION_ENGINE", "easyocr_gliner")

# Lazy-load OCR/NER engines based on selection
_easyocr_reader = None
_gliner_model = None
_presidio_image_redactor = None
_presidio_text_analyzer = None

def get_easyocr_reader():
    """Lazy-load EasyOCR reader."""
    global _easyocr_reader
    if _easyocr_reader is None:
        import easyocr
        logger.info("Initializing EasyOCR reader...")
        _easyocr_reader = easyocr.Reader(['en'], gpu=False)
        logger.info("EasyOCR reader initialized")
    return _easyocr_reader

def get_gliner_model():
    """Lazy-load GLiNER model."""
    global _gliner_model
    if _gliner_model is None:
        from gliner import GLiNER
        logger.info("Initializing GLiNER model...")
        _gliner_model = GLiNER.from_pretrained("urchade/gliner_small-v2.1")
        logger.info("GLiNER model initialized")
    return _gliner_model

def get_presidio_engines():
    """Lazy-load Presidio engines."""
    global _presidio_image_redactor, _presidio_text_analyzer
    if _presidio_image_redactor is None:
        from presidio_image_redactor import ImageRedactorEngine
        from presidio_analyzer import AnalyzerEngine
        import pytesseract  # noqa: F401 - needed for Presidio
        logger.info("Initializing Presidio engines...")
        _presidio_image_redactor = ImageRedactorEngine()
        _presidio_text_analyzer = AnalyzerEngine()
        logger.info("Presidio engines initialized")
    return _presidio_image_redactor, _presidio_text_analyzer

app = FastAPI(title="Tax Document Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# GLiNER entity labels for PII detection
GLINER_LABELS = [
    "person name",
    "social security number",
    "street address",
    "city",
    "state",
    "zip code",
]

# SSN regex patterns for both standard and OCR-mangled formats
SSN_PATTERNS = [
    r'\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b',  # Standard SSN format
    r'\b\d{9}\b',  # 9 digits together
    r'\b\d{7,8}\s+\d{1,2}\b',  # OCR splitting last digits
    r'\b\d{4,5}\s+\d{3,4}\b',  # Split into 2 parts
    r'\b\d{3}\s+\d{2}\s+\d{4}\b',  # Spaces instead of dashes
    r'\b\d{2,3}\s+\d{2,3}\s+\d{3,4}\b',  # Split into 3 parts
]

# Address regex patterns
STREET_SUFFIXES = r'(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Ci|Court|Blvd|Boulevard|Way|Pl|Place|Cir|Circle|Pkwy|Parkway|Ter|Terrace)'
ADDRESS_PATTERN = rf'\b(\d{{1,5}})\s+([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+{STREET_SUFFIXES}\b'
CITY_STATE_ZIP_PATTERN = r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),?\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b'

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


def redact_image_easyocr_gliner(image: Image.Image, page_num: int = 0) -> Image.Image:
    """Redact PII from image using EasyOCR + GLiNER (better for photos/scans)."""
    import numpy as np

    # Ensure image is in RGB mode
    if image.mode not in ('RGB', 'L'):
        image = image.convert('RGB')

    width, height = image.size
    logger.info(f"=== Page {page_num + 1}: EasyOCR+GLiNER redaction, size {width}x{height} ===")

    # Create a copy for redaction
    redacted = image.copy()
    draw = ImageDraw.Draw(redacted)

    # Get OCR and NER models
    reader = get_easyocr_reader()
    gliner = get_gliner_model()

    # Step 1: EasyOCR - get text with bounding boxes
    logger.info(f"  Step 1: Running EasyOCR...")
    img_array = np.array(image)
    ocr_results = reader.readtext(img_array)
    logger.info(f"    EasyOCR found {len(ocr_results)} text regions")

    # Build word list with positions (EasyOCR returns [bbox, text, confidence])
    words = []
    for bbox, text, conf in ocr_results:
        if text.strip():
            # bbox is [[x1,y1], [x2,y1], [x2,y2], [x1,y2]]
            x1 = int(min(p[0] for p in bbox))
            y1 = int(min(p[1] for p in bbox))
            x2 = int(max(p[0] for p in bbox))
            y2 = int(max(p[1] for p in bbox))
            words.append({
                'text': text,
                'bbox': (x1, y1, x2, y2),
                'confidence': conf,
            })

    # Build full text for NER
    full_text = ' '.join(w['text'] for w in words)
    logger.info(f"    Full text length: {len(full_text)} chars")

    # Build char_to_word mapping
    char_to_word = []
    for idx, w in enumerate(words):
        for _ in w['text']:
            char_to_word.append(idx)
        char_to_word.append(idx)  # For the space after word

    # Step 2: GLiNER NER - detect PII entities
    logger.info(f"  Step 2: Running GLiNER NER...")
    if full_text.strip():
        entities = gliner.predict_entities(full_text, GLINER_LABELS, threshold=0.3)
        logger.info(f"    GLiNER found {len(entities)} entities")

        for entity in entities:
            entity_text = entity['text']
            entity_label = entity['label']
            score = entity['score']
            start = entity['start']
            end = entity['end']

            # Filter obvious false positives
            if len(entity_text) < 2:
                continue

            # Find words that overlap with this entity
            if start < len(char_to_word) and end <= len(char_to_word):
                start_word = char_to_word[start]
                end_word = char_to_word[min(end - 1, len(char_to_word) - 1)]

                entity_words = words[start_word:end_word + 1]
                if entity_words:
                    x1 = min(w['bbox'][0] for w in entity_words) - 3
                    y1 = min(w['bbox'][1] for w in entity_words) - 3
                    x2 = max(w['bbox'][2] for w in entity_words) + 3
                    y2 = max(w['bbox'][3] for w in entity_words) + 3

                    # Clamp to image bounds
                    x1 = max(0, x1)
                    y1 = max(0, y1)
                    x2 = min(width, x2)
                    y2 = min(height, y2)

                    draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))
                    logger.info(f"    Redacted [{entity_label}] score={score:.2f}: '{entity_text}' at ({x1},{y1})-({x2},{y2})")

    # Step 3: Regex-based SSN detection (catches OCR-mangled SSNs)
    logger.info(f"  Step 3: SSN regex detection...")
    for pattern in SSN_PATTERNS:
        for match in re.finditer(pattern, full_text):
            matched_text = match.group()
            digits_only = re.sub(r'[^\d]', '', matched_text)
            # SSN should have 7-9 digits (accounting for OCR errors)
            if len(digits_only) < 7 or len(digits_only) > 9:
                continue
            # Skip ZIP codes (5 digits)
            if len(digits_only) == 5:
                continue

            if match.start() < len(char_to_word):
                start_word = char_to_word[match.start()]
                end_word = char_to_word[min(match.end() - 1, len(char_to_word) - 1)]

                entity_words = words[start_word:end_word + 1]
                if entity_words:
                    x1 = min(w['bbox'][0] for w in entity_words) - 3
                    y1 = min(w['bbox'][1] for w in entity_words) - 3
                    x2 = max(w['bbox'][2] for w in entity_words) + 3
                    y2 = max(w['bbox'][3] for w in entity_words) + 3

                    draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))
                    logger.info(f"    Redacted [SSN_REGEX]: '{matched_text}'")

    # Step 4: Address regex detection
    logger.info(f"  Step 4: Address regex detection...")
    for match in re.finditer(ADDRESS_PATTERN, full_text, re.IGNORECASE):
        street_name = match.group(2).lower()
        skip_words = {'line', 'subtract', 'add', 'total', 'amount', 'direct', 'third', 'see', 'form',
                      'standard', 'itemized', 'deduction', 'schedule', 'qualified', 'business', 'income'}
        if len(street_name) >= 2 and not any(skip in street_name for skip in skip_words):
            if match.start() < len(char_to_word):
                start_word = char_to_word[match.start()]
                end_word = char_to_word[min(match.end() - 1, len(char_to_word) - 1)]

                entity_words = words[start_word:end_word + 1]
                if entity_words:
                    x1 = min(w['bbox'][0] for w in entity_words) - 3
                    y1 = min(w['bbox'][1] for w in entity_words) - 3
                    x2 = max(w['bbox'][2] for w in entity_words) + 3
                    y2 = max(w['bbox'][3] for w in entity_words) + 3

                    draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))
                    logger.info(f"    Redacted [ADDRESS]: '{match.group()}'")

    # Step 5: City/State/ZIP regex detection
    for match in re.finditer(CITY_STATE_ZIP_PATTERN, full_text):
        if match.start() < len(char_to_word):
            start_word = char_to_word[match.start()]
            end_word = char_to_word[min(match.end() - 1, len(char_to_word) - 1)]

            entity_words = words[start_word:end_word + 1]
            if entity_words:
                x1 = min(w['bbox'][0] for w in entity_words) - 3
                y1 = min(w['bbox'][1] for w in entity_words) - 3
                x2 = max(w['bbox'][2] for w in entity_words) + 3
                y2 = max(w['bbox'][3] for w in entity_words) + 3

                draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))
                logger.info(f"    Redacted [CITY_STATE_ZIP]: '{match.group()}'")

    return redacted


def redact_image_presidio(image: Image.Image, page_num: int = 0) -> Image.Image:
    """Redact PII from image using Presidio (fallback approach)."""
    import pytesseract

    # Get Presidio engines
    image_redactor, text_analyzer = get_presidio_engines()

    # Ensure image is in RGB mode for OCR and redaction compatibility
    if image.mode not in ('RGB', 'L'):
        image = image.convert('RGB')

    width, height = image.size
    logger.info(f"=== Page {page_num + 1}: Presidio redaction, size {width}x{height} ===")

    # Step 1: Use Presidio image redactor for SSN patterns only
    logger.info(f"  Step 1: Presidio pattern-based redaction (SSN only)")
    redacted = image_redactor.redact(
        image,
        fill=(0, 0, 0),
        entities=["US_SSN", "US_ITIN"],
        score_threshold=0.3,
    )

    # Step 2: OCR + Text NER for names
    logger.info(f"  Step 2: OCR + text NER for names")
    try:
        # Re-encode for OCR compatibility
        ocr_buffer = io.BytesIO()
        redacted.save(ocr_buffer, format='PNG')
        ocr_buffer.seek(0)
        ocr_image = Image.open(ocr_buffer)

        ocr_data = pytesseract.image_to_data(ocr_image, output_type=pytesseract.Output.DICT)

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

        full_text = ' '.join(w['text'] for w in words)
        logger.info(f"    OCR extracted {len(words)} words")

        if full_text.strip():
            results = text_analyzer.analyze(
                text=full_text,
                entities=["PERSON", "US_SSN"],
                language="en",
                score_threshold=0.85,
            )

            draw = ImageDraw.Draw(redacted)
            char_to_word = []
            for idx, w in enumerate(words):
                for _ in w['text']:
                    char_to_word.append(idx)
                char_to_word.append(idx)

            for result in results:
                entity_text = full_text[result.start:result.end]

                # Filter PERSON false positives
                if result.entity_type == "PERSON":
                    if len(entity_text) < 5:
                        continue
                    letters_only = ''.join(c for c in entity_text if c.isalpha())
                    if len(letters_only) < 4:
                        continue

                start_word = char_to_word[min(result.start, len(char_to_word) - 1)]
                end_word = char_to_word[min(result.end - 1, len(char_to_word) - 1)]

                entity_words = words[start_word:end_word + 1]
                if entity_words:
                    x1 = min(w['left'] for w in entity_words) - 3
                    y1 = min(w['top'] for w in entity_words) - 3
                    x2 = max(w['left'] + w['width'] for w in entity_words) + 3
                    y2 = max(w['top'] + w['height'] for w in entity_words) + 3

                    draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))
                    logger.info(f"    Redacted [{result.entity_type}]: '{entity_text}'")

        # Step 3: Regex-based patterns
        draw = ImageDraw.Draw(redacted)

        for pattern in SSN_PATTERNS:
            for match in re.finditer(pattern, full_text):
                digits_only = re.sub(r'[^\d]', '', match.group())
                if len(digits_only) >= 7:
                    start_word = char_to_word[min(match.start(), len(char_to_word) - 1)]
                    end_word = char_to_word[min(match.end() - 1, len(char_to_word) - 1)]
                    entity_words = words[start_word:end_word + 1]
                    if entity_words:
                        x1 = min(w['left'] for w in entity_words) - 3
                        y1 = min(w['top'] for w in entity_words) - 3
                        x2 = max(w['left'] + w['width'] for w in entity_words) + 3
                        y2 = max(w['top'] + w['height'] for w in entity_words) + 3
                        draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))

        for match in re.finditer(ADDRESS_PATTERN, full_text, re.IGNORECASE):
            start_word = char_to_word[min(match.start(), len(char_to_word) - 1)]
            end_word = char_to_word[min(match.end() - 1, len(char_to_word) - 1)]
            entity_words = words[start_word:end_word + 1]
            if entity_words:
                x1 = min(w['left'] for w in entity_words) - 3
                y1 = min(w['top'] for w in entity_words) - 3
                x2 = max(w['left'] + w['width'] for w in entity_words) + 3
                y2 = max(w['top'] + w['height'] for w in entity_words) + 3
                draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))

        for match in re.finditer(CITY_STATE_ZIP_PATTERN, full_text):
            start_word = char_to_word[min(match.start(), len(char_to_word) - 1)]
            end_word = char_to_word[min(match.end() - 1, len(char_to_word) - 1)]
            entity_words = words[start_word:end_word + 1]
            if entity_words:
                x1 = min(w['left'] for w in entity_words) - 3
                y1 = min(w['top'] for w in entity_words) - 3
                x2 = max(w['left'] + w['width'] for w in entity_words) + 3
                y2 = max(w['top'] + w['height'] for w in entity_words) + 3
                draw.rectangle([x1, y1, x2, y2], fill=(0, 0, 0))

    except Exception as e:
        logger.warning(f"  OCR/NER failed: {e}")

    return redacted


def redact_image(image: Image.Image, page_num: int = 0) -> Image.Image:
    """Dispatch to the appropriate redaction engine."""
    if REDACTION_ENGINE == "easyocr_gliner":
        return redact_image_easyocr_gliner(image, page_num)
    else:
        return redact_image_presidio(image, page_num)


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


SUPPORTED_IMAGE_TYPES = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp'}

@app.post("/preview", response_model=PreviewResult)
async def preview_redacted(file: UploadFile):
    """Preview redacted PDF or image before extraction."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    filename_lower = file.filename.lower()
    is_pdf = filename_lower.endswith(".pdf")
    is_image = any(filename_lower.endswith(ext) for ext in SUPPORTED_IMAGE_TYPES)

    if not is_pdf and not is_image:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Please upload a PDF or image ({', '.join(SUPPORTED_IMAGE_TYPES)})"
        )

    try:
        file_bytes = await file.read()

        if is_pdf:
            images = pdf_to_images(file_bytes)
            if not images:
                raise HTTPException(status_code=400, detail="Could not read PDF pages")
        else:
            # Handle image file directly
            try:
                img = Image.open(io.BytesIO(file_bytes))
                # Convert to RGB if necessary (handles RGBA, palette mode, etc.)
                if img.mode not in ('RGB', 'L'):
                    img = img.convert('RGB')
                images = [img]
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not read image: {str(e)}")

        # Redact PII from each page/image
        redacted_images = [redact_image(img, i) for i, img in enumerate(images)]

        # Convert to base64 (limit to first 2 pages for preview)
        b64_images = [image_to_base64(img) for img in redacted_images[:2]]

        return PreviewResult(images=b64_images, pageCount=len(images))

    except HTTPException:
        raise
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
    """Debug endpoint: shows what entities were detected without redacting."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    try:
        pdf_bytes = await file.read()
        images = pdf_to_images(pdf_bytes)

        if not images:
            raise HTTPException(status_code=400, detail="Could not read PDF pages")

        results = []
        for page_num, img in enumerate(images[:2]):  # First 2 pages
            entities = []

            if REDACTION_ENGINE == "easyocr_gliner":
                import numpy as np
                reader = get_easyocr_reader()
                gliner = get_gliner_model()

                img_array = np.array(img)
                ocr_results = reader.readtext(img_array)
                full_text = ' '.join(text for _, text, _ in ocr_results if text.strip())

                if full_text.strip():
                    detected = gliner.predict_entities(full_text, GLINER_LABELS, threshold=0.3)
                    for entity in detected:
                        entities.append(DebugEntity(
                            entity_type=entity['label'],
                            text=entity['text'],
                            score=entity['score'],
                            start=entity['start'],
                            end=entity['end'],
                        ))
            else:
                # Presidio fallback
                image_redactor, _ = get_presidio_engines()
                analyzer_results = image_redactor.analyze(img)

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
