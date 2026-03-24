"""
Tax document extractor service.
Uses Presidio for PII redaction and OpenRouter/Claude for structured extraction.
"""

import os
import json
from typing import Any
from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from openai import OpenAI

app = FastAPI(title="Tax Document Extractor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Presidio
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

# Initialize OpenRouter client (OpenAI-compatible)
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ.get("OPENROUTER_API_KEY"),
)

EXTRACTION_PROMPT = """Extract the following fields from this Form 1040 tax return text.
Return ONLY a JSON object with these fields (use 0 if not found):

{
  "wages": <Line 1a - Wages, salaries, tips>,
  "interestIncome": <Line 2b - Taxable interest>,
  "dividendIncome": <Line 3b - Qualified dividends>,
  "capitalGains": <Line 7 - Capital gain or loss>,
  "otherIncome": <Line 8 - Other income>,
  "totalIncome": <Line 9 - Total income>,
  "adjustments": <Line 10 - Adjustments to income>,
  "adjustedGrossIncome": <Line 11 - Adjusted gross income>,
  "standardDeduction": <Line 12 - Standard or itemized deductions>,
  "taxableIncome": <Line 15 - Taxable income>,
  "totalTax": <Line 24 - Total tax>,
  "totalPayments": <Line 33 - Total payments>,
  "refundOrOwed": <Line 35a or 37 - Refund or amount owed>
}

Tax document text (PII redacted):
"""


class ExtractionResult(BaseModel):
    formId: str
    confidence: int
    fields: dict[str, Any]
    errors: list[str]


def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract text from PDF using PyMuPDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text_parts = []
    for page in doc:
        text_parts.append(page.get_text())
    doc.close()
    return "\n".join(text_parts)


def redact_pii(text: str) -> str:
    """Redact PII using Presidio."""
    # Analyze for PII
    results = analyzer.analyze(
        text=text,
        entities=[
            "PERSON",
            "PHONE_NUMBER",
            "EMAIL_ADDRESS",
            "US_SSN",
            "US_PASSPORT",
            "US_DRIVER_LICENSE",
            "CREDIT_CARD",
            "US_BANK_NUMBER",
            "US_ITIN",
            "IP_ADDRESS",
            "LOCATION",
        ],
        language="en",
    )

    # Anonymize with replacement
    operators = {
        "PERSON": OperatorConfig("replace", {"new_value": "[NAME]"}),
        "US_SSN": OperatorConfig("replace", {"new_value": "[SSN]"}),
        "PHONE_NUMBER": OperatorConfig("replace", {"new_value": "[PHONE]"}),
        "EMAIL_ADDRESS": OperatorConfig("replace", {"new_value": "[EMAIL]"}),
        "LOCATION": OperatorConfig("replace", {"new_value": "[ADDRESS]"}),
        "DEFAULT": OperatorConfig("replace", {"new_value": "[REDACTED]"}),
    }

    anonymized = anonymizer.anonymize(text=text, analyzer_results=results, operators=operators)
    return anonymized.text


def extract_with_llm(redacted_text: str) -> dict[str, Any]:
    """Use Claude via OpenRouter to extract structured data from redacted text."""
    response = client.chat.completions.create(
        model="anthropic/claude-sonnet-4",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": EXTRACTION_PROMPT + redacted_text[:15000],  # Limit text length
            }
        ],
    )

    # Parse JSON from response
    response_text = response.choices[0].message.content

    # Find JSON in response
    try:
        # Try to parse directly
        return json.loads(response_text)
    except json.JSONDecodeError:
        # Try to extract JSON from markdown code block
        import re
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", response_text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        raise ValueError("Could not parse JSON from LLM response")


@app.post("/extract", response_model=ExtractionResult)
async def extract_tax_document(file: UploadFile):
    """Extract tax data from uploaded PDF."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file")

    try:
        # Read PDF
        pdf_bytes = await file.read()

        # Extract text
        text = extract_text_from_pdf(pdf_bytes)

        # Check if it's a 1040
        if "1040" not in text and "Individual Income Tax Return" not in text:
            return ExtractionResult(
                formId="unknown",
                confidence=0,
                fields={},
                errors=["Could not identify as Form 1040"],
            )

        # Redact PII
        redacted_text = redact_pii(text)

        # Extract with LLM
        extracted = extract_with_llm(redacted_text)

        # Format fields with metadata
        fields = {}
        for key, value in extracted.items():
            fields[key] = {
                "value": float(value) if isinstance(value, (int, float)) else 0,
                "line": get_line_for_field(key),
                "verified": False,
            }

        return ExtractionResult(
            formId="1040",
            confidence=90,
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


def get_line_for_field(field: str) -> str:
    """Map field names to 1040 line numbers."""
    mapping = {
        "wages": "1a",
        "interestIncome": "2b",
        "dividendIncome": "3b",
        "capitalGains": "7",
        "otherIncome": "8",
        "totalIncome": "9",
        "adjustments": "10",
        "adjustedGrossIncome": "11",
        "standardDeduction": "12",
        "taxableIncome": "15",
        "totalTax": "24",
        "totalPayments": "33",
        "refundOrOwed": "35a",
    }
    return mapping.get(field, "")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
