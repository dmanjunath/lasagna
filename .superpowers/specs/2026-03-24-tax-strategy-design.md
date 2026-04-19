# Tax Strategy Feature Design

## Overview

Full tax analysis with PDF upload, OCR extraction, and AI-powered recommendations. Differentiator: holistic analysis combining tax returns with linked account data.

## Architecture

```
PDF → Browser OCR → Structured JSON → DB → Anonymize → LLM Analysis
      (pdf.js +       (stored)              (no PII)   (insights)
      tesseract.js)
```

**Privacy principles:**
- PDFs never leave browser
- Only structured numbers stored in DB
- LLM receives anonymized financial data, no PII
- Plaid holdings merged with tax data for holistic analysis

## Data Model

### taxReturns
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| tenantId | uuid | FK to tenants |
| taxYear | integer | 2023, 2024, etc. |
| filingStatus | enum | single, married_joint, married_separate, head_of_household |
| status | enum | draft, complete |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### taxDocuments
| Field | Type | Description |
|-------|------|-------------|
| id | uuid | Primary key |
| taxReturnId | uuid | FK to taxReturns |
| documentType | string | 1040, schedule_d, w2, 1099_div, etc. |
| extractedData | jsonb | See structure below |
| extractedAt | timestamp | |
| createdAt | timestamp | |

**extractedData structure:**
```json
{
  "confidence": 87,
  "fields": {
    "wages": { "value": 185000, "line": "1a", "verified": true },
    "interest_income": { "value": 2400, "line": "2b", "verified": false }
  }
}
```

### Plan type addition
Add `tax_strategy` to existing `planType` enum.

## UI Components

### Tax History Tab (renamed from Tax Strategy)

Data input hub with:
- Tax year selector
- PDF drag/drop upload zone
- Document list with type detection + confidence scores
- Edit modal for OCR corrections
- Extracted summary with verification checkmarks
- CTA to create Tax Strategy Plan (prompts for data if none exists)

### Tax Strategy Plan

New plan type following existing plan patterns:
- **Tax Snapshot**: Effective rate, taxes paid, bracket
- **Narrative Summary**: LLM-generated plain English analysis
- **Top Opportunities**: Ranked by dollar impact (pulls from holdings + tax data)
- **5-Year Projection**: Chart showing cumulative savings
- **Chat Panel**: What-if scenarios, drill-down questions

## OCR & Template Matching

### Libraries
- `pdf.js` - Render PDF pages to canvas
- `tesseract.js` - WebAssembly OCR (no server needed)

### Template structure
```typescript
const form1040Template = {
  formId: "1040",
  detectPattern: /Form\s*1040/i,
  fields: {
    wages: {
      line: "1a",
      region: { page: 1, x: 420, y: 285, w: 120, h: 20 },
      validate: (v) => v >= 0
    },
    // ... more fields
  }
};
```

### Extraction flow
1. pdf.js renders page to canvas at 300 DPI
2. Full-page OCR to detect form type
3. Extract defined regions for identified form
4. Parse numbers, run validators
5. Return structured JSON with confidence scores

### Supported forms (v1)
- Form 1040 only

### Supported forms (v2+)
- Schedule D (capital gains)
- W-2 (wages)
- 1099-DIV (dividends)
- 1099-INT (interest)

## LLM Analysis

### Input (anonymized)
```json
{
  "taxYear": 2024,
  "filingStatus": "married_joint",
  "income": { "wages": 185000, "interest": 2400, "capitalGains": 12400 },
  "deductions": { "total": 18200, "itemized": true },
  "taxPaid": 42500,
  "effectiveRate": 0.182,
  "holdings": [
    { "ticker": "VXUS", "costBasis": 45000, "currentValue": 42600, "unrealizedGain": -2400 },
    { "ticker": "BND", "accountType": "taxable", "value": 35000 }
  ]
}
```

### Output
1. **Narrative summary** - Plain English analysis
2. **Scored opportunities** - Ranked list with dollar impact
3. **Multi-year projection** - 5-year tax savings if recommendations applied

## Implementation Phases

### v1: Extraction Proof-of-Concept (priority)
- PDF upload UI on Tax History tab
- Browser-based OCR with pdf.js + tesseract.js
- Form 1040 template only
- Display extracted fields with confidence scores
- Manual edit/verify flow
- Save to DB

**Goal:** Validate "Can we reliably extract numbers from a 1040 in the browser?"

### v2: Full Tax Strategy
- Additional form templates (W-2, 1099s, Schedules)
- Tax Strategy plan type
- LLM analysis integration
- Chat interface for what-if scenarios

### v3: Enhanced Analysis
- Multi-year projections with charts
- Plaid holdings integration for opportunities
- Tax-loss harvesting alerts
- Roth conversion modeling

## Open Questions

1. What's acceptable OCR accuracy threshold? (Propose: 85%+ confidence or flag for manual review)
2. Should we store original PDF blob or discard after extraction? (Propose: discard for privacy)
3. How to handle multi-page 1040s vs single-page? (Need to test)

## Success Criteria

v1 is successful if:
- 1040 form detection works >90% of the time
- Key fields (wages, deductions, tax paid) extracted with >85% accuracy
- Extraction completes in <30 seconds for typical return
- Users can correct errors via edit modal
