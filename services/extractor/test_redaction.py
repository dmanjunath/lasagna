#!/usr/bin/env python3
"""
Test script for PII redaction validation.
Creates a test PDF with known PII, uploads to /preview, and validates redaction.
"""

import io
import json
import base64
import requests
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from PIL import Image

# Known PII in the test document
EXPECTED_PII = {
    "names": ["John Smith", "Mary Lamb"],
    "ssns": ["356-23-6753", "465-35-7545"],
    "addresses": ["8847 Little Leaf Ct, Ridgeline, MT 85983"],
}

def create_test_pdf() -> bytes:
    """Create a test PDF with known PII content similar to Form 1040."""
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    # Title
    c.setFont("Helvetica-Bold", 16)
    c.drawString(200, height - 50, "Form 1040 - U.S. Individual Income Tax Return")

    # Tax year
    c.setFont("Helvetica", 12)
    c.drawString(450, height - 50, "2024")

    # Section: Your Information
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, height - 100, "Your first name and middle initial")
    c.drawString(300, height - 100, "Last name")
    c.drawString(500, height - 100, "Your SSN")

    c.setFont("Helvetica", 12)
    c.drawString(50, height - 120, "John")
    c.drawString(300, height - 120, "Smith")
    c.drawString(500, height - 120, "356-23-6753")

    # Spouse info
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, height - 160, "Spouse's first name and middle initial")
    c.drawString(300, height - 160, "Last name")
    c.drawString(500, height - 160, "Spouse's SSN")

    c.setFont("Helvetica", 12)
    c.drawString(50, height - 180, "Mary")
    c.drawString(300, height - 180, "Lamb")
    c.drawString(500, height - 180, "465-35-7545")

    # Address
    c.setFont("Helvetica-Bold", 12)
    c.drawString(50, height - 220, "Home address (number and street)")
    c.drawString(400, height - 220, "City, state, ZIP")

    c.setFont("Helvetica", 12)
    c.drawString(50, height - 240, "8847 Little Leaf Ct")
    c.drawString(400, height - 240, "Ridgeline, MT 85983")

    # Income Section
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, height - 300, "Income")

    c.setFont("Helvetica", 12)
    # Line 1a - Wages
    c.drawString(50, height - 330, "1a")
    c.drawString(80, height - 330, "Wages, salaries, tips, etc.")
    c.drawString(500, height - 330, "85,000")

    # Line 2b - Interest
    c.drawString(50, height - 350, "2b")
    c.drawString(80, height - 350, "Taxable interest")
    c.drawString(500, height - 350, "1,250")

    # Line 3b - Dividends
    c.drawString(50, height - 370, "3b")
    c.drawString(80, height - 370, "Qualified dividends")
    c.drawString(500, height - 370, "2,500")

    # Line 9 - Total income
    c.drawString(50, height - 410, "9")
    c.drawString(80, height - 410, "Total income")
    c.drawString(500, height - 410, "88,750")

    # Line 11 - AGI
    c.drawString(50, height - 450, "11")
    c.drawString(80, height - 450, "Adjusted gross income")
    c.drawString(500, height - 450, "88,750")

    # Line 15 - Taxable income
    c.drawString(50, height - 490, "15")
    c.drawString(80, height - 490, "Taxable income")
    c.drawString(500, height - 490, "74,050")

    # Line 24 - Total tax
    c.drawString(50, height - 530, "24")
    c.drawString(80, height - 530, "Total tax")
    c.drawString(500, height - 530, "11,750")

    # Line 33 - Total payments
    c.drawString(50, height - 570, "33")
    c.drawString(80, height - 570, "Total payments")
    c.drawString(500, height - 570, "14,200")

    # Line 35a - Refund
    c.drawString(50, height - 610, "35a")
    c.drawString(80, height - 610, "Amount you overpaid (refund)")
    c.drawString(500, height - 610, "2,450")

    c.save()
    return buffer.getvalue()


def upload_and_preview(pdf_bytes: bytes) -> dict:
    """Upload PDF to /preview endpoint and get redacted images."""
    files = {"file": ("test_form_1040.pdf", pdf_bytes, "application/pdf")}
    response = requests.post("http://localhost:8000/preview", files=files)
    response.raise_for_status()
    return response.json()


def save_preview_images(preview_result: dict, output_dir: str = "/tmp"):
    """Save base64 images to files for inspection."""
    for i, b64_img in enumerate(preview_result["images"]):
        img_bytes = base64.b64decode(b64_img)
        img = Image.open(io.BytesIO(img_bytes))
        path = f"{output_dir}/redacted_page_{i+1}.png"
        img.save(path)
        print(f"Saved: {path}")
    return [f"{output_dir}/redacted_page_{i+1}.png" for i in range(len(preview_result["images"]))]


def analyze_with_vision(images_b64: list[str]) -> dict:
    """Send redacted images to Claude Vision for analysis."""
    import os
    from openai import OpenAI

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ.get("OPENROUTER_API_KEY"),
    )

    analysis_prompt = f"""Analyze this redacted tax document image. I need to verify that PII redaction is working correctly.

The original document should contain:
- Names: {EXPECTED_PII['names']}
- SSNs: {EXPECTED_PII['ssns']}
- Addresses: {EXPECTED_PII['addresses']}

Please identify:
1. VISIBLE PII (FALSE NEGATIVES): Any names, SSNs, or addresses that are still visible and should have been redacted
2. OVER-REDACTION (FALSE POSITIVES): Any black boxes that appear to be covering non-PII content (like line numbers, amounts, form labels)
3. CORRECT REDACTIONS: Black boxes that appear to be correctly covering PII areas

Return a JSON object:
{{
    "visible_pii": {{
        "names": ["list of any visible names"],
        "ssns": ["list of any visible SSNs"],
        "addresses": ["list of any visible addresses"]
    }},
    "over_redacted": ["description of areas that appear over-redacted"],
    "correct_redactions": ["description of areas correctly redacted"],
    "assessment": "PASS" or "FAIL",
    "issues": ["list of specific issues to fix"]
}}
"""

    content = [{"type": "text", "text": analysis_prompt}]

    for i, b64 in enumerate(images_b64):
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}"}
        })
        content.append({
            "type": "text",
            "text": f"Page {i + 1}"
        })

    response = client.chat.completions.create(
        model="anthropic/claude-sonnet-4",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}],
    )

    response_text = response.choices[0].message.content

    # Parse JSON from response
    try:
        import re
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", response_text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        return json.loads(response_text)
    except json.JSONDecodeError:
        return {"raw_response": response_text, "parse_error": True}


def run_test():
    """Run the full redaction test."""
    print("=" * 60)
    print("PII REDACTION TEST")
    print("=" * 60)

    # Step 1: Create test PDF
    print("\n1. Creating test PDF with known PII...")
    pdf_bytes = create_test_pdf()
    print(f"   Created PDF: {len(pdf_bytes)} bytes")

    # Step 2: Upload to /preview endpoint
    print("\n2. Uploading to /preview endpoint...")
    try:
        preview_result = upload_and_preview(pdf_bytes)
        print(f"   Got {preview_result['pageCount']} pages")
    except requests.exceptions.ConnectionError:
        print("   ERROR: Could not connect to http://localhost:8000")
        print("   Make sure the extractor service is running: docker compose up extractor")
        return
    except Exception as e:
        print(f"   ERROR: {e}")
        return

    # Step 3: Save images for inspection
    print("\n3. Saving redacted images...")
    image_paths = save_preview_images(preview_result)

    # Step 4: Analyze with Vision
    print("\n4. Analyzing redacted images with Claude Vision...")
    analysis = analyze_with_vision(preview_result["images"])

    # Step 5: Report results
    print("\n" + "=" * 60)
    print("ANALYSIS RESULTS")
    print("=" * 60)

    if analysis.get("parse_error"):
        print("\nCould not parse structured response. Raw response:")
        print(analysis.get("raw_response", "No response"))
        return

    print(f"\nAssessment: {analysis.get('assessment', 'UNKNOWN')}")

    visible_pii = analysis.get("visible_pii", {})
    if any(visible_pii.get(k) for k in ["names", "ssns", "addresses"]):
        print("\n❌ FALSE NEGATIVES (PII not redacted):")
        for pii_type, items in visible_pii.items():
            if items:
                print(f"   {pii_type}: {items}")
    else:
        print("\n✅ No false negatives - all PII appears redacted")

    over_redacted = analysis.get("over_redacted", [])
    if over_redacted:
        print("\n⚠️  FALSE POSITIVES (over-redaction):")
        for item in over_redacted:
            print(f"   - {item}")
    else:
        print("\n✅ No false positives - no over-redaction detected")

    correct = analysis.get("correct_redactions", [])
    if correct:
        print("\n✅ CORRECT REDACTIONS:")
        for item in correct:
            print(f"   - {item}")

    issues = analysis.get("issues", [])
    if issues:
        print("\n📋 ISSUES TO ADDRESS:")
        for issue in issues:
            print(f"   - {issue}")

    print("\n" + "=" * 60)
    return analysis


if __name__ == "__main__":
    run_test()
