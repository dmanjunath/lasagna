# Tax Input Modes Design

## Goal

Replace the existing GCP Document AI + DLP + OpenRouter pipeline with a simpler vision-based LLM extraction flow. Users get three ways to input tax data: file upload to OpenRouter, file upload to a self-hosted LLM, or manual free-form text entry. The choice is made at input time via an editable URL field — no persistent provider settings.

## Architecture

### What changes

- The existing two-step `POST /extract` → `POST /confirm` flow is replaced by a single `POST /` endpoint on `taxDocumentsRouter` (mounts to `POST /api/tax/documents`).
- GCP Document AI, DLP, and GCS storage are removed from the tax document flow.
- The frontend tax input section is redesigned. Existing document list, edit, and delete functionality is unchanged.
- Existing routes (`/extract`, `/confirm`, `/upload`) remain in place until frontend references are removed.

### What stays the same

- Database schema: `llm_fields`, `llm_summary`, `tax_year`, `file_name`, `file_type`, `gcs_path`, `raw_extraction`.
- Document list view, tax year editing, document deletion.
- The extraction prompt (same as the trial scripts).

---

## Backend

### New endpoint: `POST /` on `taxDocumentsRouter`

**Multipart form fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `file` | File (PDF, PNG, JPG, JPEG) | One of `file` or `text` | |
| `text` | string | One of `file` or `text` | |
| `providerUrl` | string | Yes | Full endpoint URL including path, e.g. `https://openrouter.ai/api/v1/chat/completions` |
| `apiKey` | string | No | Sent as `Authorization: Bearer <apiKey>` if present |
| `model` | string | No | Defaults to `google/gemma-4-26b-a4b-it` on the server if absent or empty |

**File path:**
1. Validate file type (`application/pdf`, `image/jpeg`, `image/png`) and size (max 20 MB). Return 400 on invalid.
2. If PDF: convert pages to PNG using `pdftoppm` (max 10 pages). See PDF conversion section.
3. Encode each image as base64.
4. Call vision LLM at `providerUrl` using the OpenAI-compatible chat completions format (JSON body with `model`, `messages`, image content blocks as `{ type: "image_url", image_url: { url: "data:<mime>;base64,<data>" } }`). For Ollama, use its `/v1/chat/completions` OpenAI-compat endpoint — do NOT use `/api/chat`.
5. Parse the response content as JSON. Strip markdown fences if present. Validate with zod: `{ fields: z.record(z.string(), z.unknown()), summary: z.string(), tax_year: z.number().nullable() }`.
6. If JSON parse or zod validation fails, return 422 with `{ error: "Extraction failed: <reason>", raw: "<llm response>" }`. Do not save to DB.
7. Insert into `tax_documents`:
   - `file_name` = original filename from upload
   - `file_type` = MIME type of uploaded file
   - `gcs_path` = `""` (empty string — no GCS storage in this flow)
   - `raw_extraction` = `[]` (empty array — no Document AI step)
   - `llm_fields` = `fields` from LLM response
   - `llm_summary` = `summary` from LLM response
   - `tax_year` = `tax_year` from LLM response (nullable integer)

**Text path:**
1. No LLM call.
2. Insert into `tax_documents`:
   - `file_name` = `"manual-entry"`
   - `file_type` = `"text/plain"`
   - `gcs_path` = `""`
   - `raw_extraction` = `[]`
   - `llm_fields` = `{}`
   - `llm_summary` = user-provided text
   - `tax_year` = `null`

**Response:** `201 Created` with the saved document record (same shape as `GET /:id`).

### Extraction prompt

Same prompt used in the trial scripts:

> You are a tax document data extraction assistant. Given the following tax document image(s), return a JSON object (no markdown fencing) with:
> 1. "fields": structured object with snake_case keys and numeric values where appropriate. Include all financial data points. Include filing_status if you can determine it.
> 2. "summary": 2–3 sentence human-readable description including document type, tax year, key financial figures.
> 3. "tax_year": number or null.
> Return ONLY the raw JSON object, no markdown code fences.

### PDF conversion

`pdftoppm -png -r 150 -f 1 -l <max_pages> "<input>" "<tmpDir>/page"` — same as the trial scripts.

- Create a unique temp directory per request: `os.tmpdir() + "/tax-extraction-" + randomUUID()`.
- Clean up the temp directory in a `finally` block (synchronous `rmSync(tmpDir, { recursive: true, force: true })`).
- Add `poppler-utils` to `Dockerfile.dev` (and production Dockerfile if one exists).

### Provider URL

`providerUrl` is the **full** chat completions endpoint URL including scheme and path. Examples:
- OpenRouter: `https://openrouter.ai/api/v1/chat/completions`
- Ollama (local): `http://localhost:11434/v1/chat/completions`
- Together AI: `https://api.together.xyz/v1/chat/completions`

The frontend default value is `https://openrouter.ai/api/v1/chat/completions`.

---

## Frontend

### Tax page — new input section (`TaxInputPanel.tsx`)

Replaces the current `PdfUploader` + `RedactionReview` flow. Sits above the existing document list.

**Layout:** Two sections side by side (desktop, `md:flex-row`) or stacked (mobile, `flex-col`):

```
┌──────────────────────┬──────────────────────┐
│  Drop files here     │  Or describe your    │
│  PDF, PNG, JPG       │  tax information     │
│  [drag/drop area]    │  [textarea]          │
└──────────────────────┴──────────────────────┘
  URL: [https://openrouter.ai/api/v1/chat/completions]
  Model: [google/gemma-4-26b-a4b-it]   API Key: [optional]
  [Send]
```

**Mutual exclusion:**
- Selecting a file disables and dims the textarea (opacity-50, pointer-events-none).
- Typing in the textarea disables and dims the file drop zone.
- Clearing either re-enables the other.
- The URL/model/key fields are always shown (not hidden for manual text — they're simply unused by the server for text submissions, but kept visible to avoid layout shift).

**State (component-local, not persisted):**
- `file: File | null`
- `text: string`
- `providerUrl: string` — default `https://openrouter.ai/api/v1/chat/completions`
- `model: string` — default `google/gemma-4-26b-a4b-it`
- `apiKey: string` — default `""`
- `loading: boolean`
- `error: string | null`

**Send button:**
- Disabled when `loading` or (`file === null` AND `text.trim() === ""`).
- On click: POST multipart form to `/api/tax/documents`. On success: reset state, call parent `onSuccess()` to refresh list. On error: set `error` message.

### Removed components

- `RedactionReview.tsx` — no longer needed (no DLP step). Delete file.
- `PdfUploader.tsx` — replaced by `TaxInputPanel.tsx`. Delete file.

---

## File map

| Action | Path |
|--------|------|
| Create | `packages/api/src/lib/tax-vision-extraction.ts` |
| Modify | `packages/api/src/routes/tax-documents.ts` |
| Modify | `packages/api/Dockerfile.dev` |
| Create | `packages/web/src/components/tax/TaxInputPanel.tsx` |
| Modify | `packages/web/src/pages/tax-strategy.tsx` |
| Delete | `packages/web/src/components/tax/RedactionReview.tsx` |
| Delete | `packages/web/src/components/tax/PdfUploader.tsx` |

---

## Out of scope

- Storing provider URL/key in settings or DB.
- Server-side validation of `providerUrl` (SSRF protection not required for this internal app).
- Streaming LLM responses.
- Retrying failed extractions.
- Editing extracted fields before saving.
