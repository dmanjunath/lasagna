# Tax Input Modes Design

## Goal

Replace the existing GCP Document AI + DLP + OpenRouter pipeline with a simpler vision-based LLM extraction flow. Users get three ways to input tax data: file upload to OpenRouter, file upload to a self-hosted LLM, or manual free-form text entry. The choice is made at input time via an editable URL field — no persistent provider settings.

## Architecture

### What changes

- The existing two-step `POST /extract` → `POST /confirm` flow is replaced by a single `POST /api/tax/documents` endpoint.
- GCP Document AI, DLP, and GCS storage are removed from the tax document flow. `gcs_path` will be null for new documents.
- The frontend tax input section is redesigned. Existing document list, edit, and delete functionality is unchanged.
- Existing routes (`/extract`, `/confirm`, `/upload`) remain in place until frontend references are removed.

### What stays the same

- Database schema: `llm_fields`, `llm_summary`, `tax_year`, `file_name`, `file_type`, `gcs_path`.
- Document list view, tax year editing, document deletion.
- The extraction prompt (same as the trial scripts).

---

## Backend

### New endpoint: `POST /api/tax/documents`

**Multipart form fields:**

| Field | Type | Required |
|-------|------|----------|
| `file` | File (PDF, PNG, JPG, JPEG) | One of `file` or `text` |
| `text` | string | One of `file` or `text` |
| `providerUrl` | string | Yes |
| `apiKey` | string | No |
| `model` | string | No |

**File path:**
1. Validate file type and size (max 20 MB).
2. If PDF: convert pages to PNG using `pdftoppm` (max 10 pages). Requires `poppler-utils` in Docker image.
3. Encode images as base64.
4. Call vision LLM at `providerUrl` using OpenAI-compatible chat completions format with the extraction prompt.
5. Parse JSON response, validate with zod schema `{ fields, summary, tax_year }`.
6. Insert into `tax_documents`: `llm_fields = fields`, `llm_summary = summary`, `tax_year`.

**Text path:**
1. Store `llm_summary = text`, `llm_fields = {}`, `tax_year = null`.
2. No LLM call.

**Response:** The saved document record.

### Extraction prompt

Same prompt used in the trial scripts:

> You are a tax document data extraction assistant. Given the following tax document image(s), return a JSON object (no markdown fencing) with:
> 1. "fields": structured object with snake_case keys and numeric values where appropriate
> 2. "summary": 2–3 sentence human-readable description
> 3. "tax_year": number or null
> Return ONLY the raw JSON object, no markdown code fences.

### PDF conversion

`pdftoppm -png -r 150 -f 1 -l <max_pages> <input> <output_prefix>` — same as the trial scripts. Add `poppler-utils` to `Dockerfile.dev` and any production Dockerfile.

### Provider URL

The client passes `providerUrl` in the request. No server-side whitelist — the app is single-tenant by deployment. The server uses the passed `apiKey` in the `Authorization: Bearer` header if provided; otherwise omits the header (for local Ollama which needs no auth).

---

## Frontend

### Tax page — new input section

Replaces the current `PdfUploader` + `RedactionReview` flow. Sits above the existing document list.

**Layout:** Two sections side by side (desktop) or stacked (mobile):

```
┌──────────────────────┬──────────────────────┐
│  Drop files here     │  Or describe your    │
│  PDF, PNG, JPG       │  tax information     │
│  [drag/drop area]    │  [textarea]          │
└──────────────────────┴──────────────────────┘
  URL: [openrouter.ai/api/v1 _______________]  [API key (optional)]
  Model: [google/gemma-4-26b-a4b-it ________]
  [Send]
```

**Mutual exclusion:**
- Selecting a file disables and dims the textarea.
- Typing in the textarea disables and dims the file drop zone.
- Either can be cleared to re-enable the other.

**URL/model/key fields:**
- `providerUrl` defaults to the OpenRouter chat completions URL.
- `model` defaults to `google/gemma-4-26b-a4b-it`.
- `apiKey` defaults to empty (user fills in their key, or it's omitted for local Ollama).
- These are not persisted — values live in component state only.

**Send button:**
- Disabled until a file is selected or text is entered.
- Shows a loading spinner during the request.
- On success: clears the form, refreshes the document list.
- On error: shows an inline error message.

### Removed components

- `RedactionReview.tsx` — no longer needed (no DLP step).
- The multi-step upload animation in `PdfUploader.tsx` — replaced by a single loading state.

---

## File map

| Action | Path |
|--------|------|
| Create | `packages/api/src/lib/tax-vision-extraction.ts` |
| Modify | `packages/api/src/routes/tax-documents.ts` |
| Modify | `packages/api/Dockerfile.dev` |
| Create | `packages/web/src/components/tax/TaxInputPanel.tsx` |
| Modify | `packages/web/src/pages/tax-strategy.tsx` |
| Delete | `packages/web/src/components/tax/RedactionReview.tsx` (deferred) |

---

## Out of scope

- Storing provider URL/key in settings or DB.
- Server-side validation of `providerUrl` (SSRF protection not required for this internal app).
- Streaming LLM responses.
- Retrying failed extractions.
- Editing extracted fields before saving.
