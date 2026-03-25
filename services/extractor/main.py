"""
Tax document extractor service.
Uses Presidio Image Redactor for PII removal and Claude Vision for extraction.
"""

import os
import io
import json
import base64
from typing import Any
from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
from PIL import Image
from presidio_image_redactor import ImageRedactorEngine
from openai import OpenAI

app = FastAPI(title="Tax Document Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Presidio Image Redactor
image_redactor = ImageRedactorEngine()

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


def redact_image(image: Image.Image) -> Image.Image:
    """Redact PII from image using Presidio."""
    return image_redactor.redact(image, fill=(0, 0, 0))


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
        redacted_images = [redact_image(img) for img in images]

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
        redacted_images = [redact_image(img) for img in images]

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


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
