# Replace Extractor Service with Google Cloud Document AI

## Problem

The current tax document extraction pipeline is a standalone Python microservice (`services/extractor/`) that uses EasyOCR, GLiNER, Presidio, and Claude Vision (via OpenRouter) to extract financial data from tax forms. It was built with a complex PII redaction pipeline because LLM companies couldn't be trusted not to train on user data. The service only supports Form 1040 and requires heavy ML dependencies.

## Solution

Replace the entire extractor service with Google Cloud Document AI (Form Parser) + Cloud DLP for text-level PII redaction + an LLM for mapping raw extracted data into structured fields and summaries. All processing moves into the existing Node.js API service. Raw documents are stored in GCS. The Python extractor service is deleted entirely.

## Architecture

```
User uploads PDF/image(s)
        |
   (parallel per file)
        |
   POST /tax/documents/upload
        |
   +----------------------------------+
   |  1. Upload raw file -> GCS       |
   |  2. Document AI Form Parser      |
   |  3. Clean extracted key-values   |
   |  4. Cloud DLP text redaction     |
   |  5. LLM mapping + summarization  |
   |  6. Single insert -> Postgres    |
   +----------------------------------+
        |
   Return { id, llmFields, llmSummary, taxYear }
```

Processing is synchronous per request (~6-18 seconds depending on document size and LLM latency). Multiple files upload in parallel (one request per file). If any pipeline step fails, the upload fails — the GCS file is cleaned up and nothing is persisted to the database.

## Storage

### GCS Bucket: `lasagna-prod-tax-documents`

Raw document storage for re-indexing and audit.

Path format: `{tenantId}/{documentId}/{originalFilename}`

### Postgres: `tax_documents` table

Single table replaces both `tax_returns` and `tax_documents`.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | NOT NULL | Primary key |
| `tenant_id` | uuid (FK) | NOT NULL | References tenants |
| `file_name` | text | NOT NULL | Original filename |
| `file_type` | text | NOT NULL | MIME type (application/pdf, image/jpeg, etc.) |
| `gcs_path` | text | NOT NULL | Path to raw document in GCS |
| `raw_extraction` | jsonb | NOT NULL | Document AI + DLP output (redacted key-value pairs) |
| `llm_fields` | jsonb | NOT NULL | Freeform structured data from LLM |
| `llm_summary` | text | NOT NULL | Human-readable summary for dashboard |
| `tax_year` | integer | nullable | From LLM or user override |
| `created_at` | timestamp | NOT NULL | Upload time |
| `updated_at` | timestamp | NOT NULL | Last modified |

The `tax_returns` table is dropped. The `taxReturnStatusEnum` and `filingStatusEnum` are also dropped (no longer used). Filing status lives inside `llm_fields` if the LLM extracts it from the document.

## Migration

This is a destructive migration — existing data in `tax_returns` and `tax_documents` is dropped.

1. Drop `tax_documents` table (depends on `tax_returns`)
2. Drop `tax_returns` table
3. Drop `tax_return_status` enum
4. Drop `filing_status` enum
5. Create new `tax_documents` table with the schema above

This is acceptable for v1 since the product is pre-launch and no production user data exists. If data preservation is needed later, a migration script should map old `tax_documents.extracted_data` into the new `raw_extraction` column.

## Pipeline Details

### Step 1: GCS Upload

Store the raw file at `{tenantId}/{documentId}/{originalFilename}`. The document ID is generated before upload so the GCS path is deterministic.

### Step 2: Document AI Form Parser

- Processor: `2a4ce4b54806000e` (Form Parser, `us` region)
- Project: `lasagna-prod`
- Accepts PDF and image (JPEG, PNG, TIFF) inputs natively
- Returns key-value pairs with confidence scores and bounding box info
- Confidence scores are preserved in `raw_extraction` for debugging

### Step 3: Clean Extracted Data

Before sending to DLP, clean the raw Document AI output:

- **PII key filtering**: Drop fields where the key indicates PII (social security, name, address, zip code, etc.)
- **Noise filtering**: Remove checkbox-only fields, empty values, low confidence (<0.5)
- **Key normalization**: Collapse newlines/whitespace, strip leading/trailing line numbers
- **Value normalization**: Collapse spaced digit sequences (e.g., "1 6 6 , 0 0 0" -> "166,000")
- **Deduplication**: Keep one entry per unique key

### Step 4: Cloud DLP Text Redaction

Send the cleaned key-value pairs as text to Cloud DLP's deidentify API. DLP acts as a safety net for any PII that slipped through key-based filtering.

Info types detected:
- `PERSON_NAME`
- `US_SOCIAL_SECURITY_NUMBER`
- `STREET_ADDRESS`
- `PHONE_NUMBER`
- `EMAIL_ADDRESS`
- `DATE_OF_BIRTH`
- `US_INDIVIDUAL_TAXPAYER_IDENTIFICATION_NUMBER`

SSN normalization: Before sending to DLP, collapse spaced digit sequences into `XXX-XX-XXXX` format so DLP can reliably detect them.

Fields where the entire value is redacted are dropped from the output.

### Step 5: LLM Mapping + Summarization

Send the redacted key-value pairs to an LLM (Claude) with a prompt to return:

```json
{
  "fields": {
    "wages": 166000,
    "qualified_dividends": 100,
    "taxable_interest": 700,
    "total_income": 169686
  },
  "summary": "2025 Form 1040 (Married Filing Jointly). Total income $169,686...",
  "tax_year": 2025
}
```

- **`fields`**: Freeform structured object with sensible key names and numeric values. Schema varies by document type. Used as context in future AI calls. Filing status, if present in the document, is included here (e.g., `"filing_status": "married_filing_jointly"`).
- **`summary`**: Human-readable summary for the dashboard.
- **`tax_year`**: Extracted from the document if present.

The LLM response is validated (must be valid JSON with required properties) before storing.

### Step 6: Database Insert

Single insert with all data populated. No partial writes.

## API Endpoints

### New

- **`POST /tax/documents/upload`** — Multipart form upload. Accepts `file` (required). Max file size: 20MB (Document AI sync limit). Accepted types: `application/pdf`, `image/jpeg`, `image/png`, `image/tiff`. Runs full pipeline. Returns `{ id, llmFields, llmSummary, taxYear }`.

### Modified

- **`GET /tax/documents`** — List all documents for tenant. Returns `id`, `fileName`, `llmSummary`, `taxYear`, `createdAt`.
- **`GET /tax/documents/:id`** — Full document detail including `rawExtraction`, `llmFields`, `llmSummary`.
- **`PATCH /tax/documents/:id`** — Update `taxYear` (user correction).
- **`DELETE /tax/documents/:id`** — Deletes DB row and GCS file (GCS deletion is best-effort; orphaned files are acceptable).

### Removed

- All `/tax/returns` CRUD endpoints
- `POST /tax/returns/:id/documents`

## Frontend Changes

### Removed

- `services/extractor/` — entire Python microservice
- `packages/web/src/lib/ocr/` — OCR client library
- `RedactionPreview` modal and two-step preview/confirm flow
- References to `VITE_EXTRACTOR_URL`

### Modified

- **Upload flow**: Drag/drop files -> parallel `POST /tax/documents/upload` per file -> show per-file progress -> display results
- **Dashboard**: Each document shows `llm_summary`, `tax_year`. User can edit `tax_year` inline.
- **Tax strategy page**: Reads from new `GET /tax/documents` endpoint instead of `/tax/returns`

## Infrastructure Changes

### Removed

- `services/extractor/` directory (Python service, Dockerfile, requirements.txt, tests)
- Extractor service from `docker-compose.yml`
- Extractor build/deploy job from `.github/workflows/deploy.yml`

### Added

- GCS bucket `lasagna-prod-tax-documents`
- Cloud Run service account needs `roles/documentai.apiUser` and `roles/dlp.user` IAM roles
- Node.js dependencies: `@google-cloud/documentai`, `@google-cloud/dlp`, `@google-cloud/storage`

### Environment Variables

- **Remove**: `OPENROUTER_API_KEY`, `VITE_EXTRACTOR_URL`, `REDACTION_ENGINE`
- **Add**: `GCS_BUCKET` (defaults to `lasagna-prod-tax-documents`), `ANTHROPIC_API_KEY` (for LLM calls — or use existing key if already configured)

## GCP Setup

1. Create GCS bucket: `gsutil mb -l us gs://lasagna-prod-tax-documents`
2. Document AI Form Parser processor already exists: `2a4ce4b54806000e`
3. DLP API already enabled on `lasagna-prod`
4. Grant Cloud Run service account:
   - `roles/documentai.apiUser`
   - `roles/dlp.user`
   - `roles/storage.objectAdmin` on the bucket

## Testing

- The test script at `scripts/test_extraction.py` validates Document AI + DLP pipeline on real documents
- Integration tests for the upload endpoint with sample PDFs
- Verify PII is stripped by checking `raw_extraction` contains no names, SSNs, or addresses
