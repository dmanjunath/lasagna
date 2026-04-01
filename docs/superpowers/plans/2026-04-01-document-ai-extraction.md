# Document AI Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Python extractor service with Document AI + DLP + LLM processing in the Node.js API.

**Architecture:** Upload endpoint in Hono API receives files, uploads to GCS, extracts via Document AI Form Parser, redacts PII via Cloud DLP, maps to structured data via LLM (OpenRouter/Claude), stores everything in a single `tax_documents` Postgres table.

**Tech Stack:** Hono, Drizzle ORM, `@google-cloud/documentai`, `@google-cloud/dlp`, `@google-cloud/storage`, Vercel AI SDK (existing), OpenRouter (existing)

---

## File Structure

### New Files
- `packages/api/src/lib/gcs.ts` — GCS upload/delete client
- `packages/api/src/lib/document-ai.ts` — Document AI Form Parser client + field cleaning logic
- `packages/api/src/lib/dlp.ts` — Cloud DLP text redaction client
- `packages/api/src/lib/tax-extraction.ts` — Pipeline orchestrator (GCS → DocAI → DLP → LLM → DB)
- `packages/api/src/routes/tax-documents.ts` — New CRUD routes for tax_documents

### Modified Files
- `packages/core/src/schema.ts` — Drop old tax tables/enums, add new `taxDocuments` table
- `packages/api/src/server.ts` — Swap `taxRouter` for new `taxDocumentsRouter`
- `packages/api/src/lib/env.ts` — Add `GCS_BUCKET` env var
- `packages/api/package.json` — Add GCP dependencies
- `packages/web/src/lib/api.ts` — Replace tax API methods
- `packages/web/src/lib/types.ts` — Replace tax type definitions
- `packages/web/src/pages/tax-strategy.tsx` — Simplified upload flow (no redaction preview)
- `packages/web/src/components/tax/PdfUploader.tsx` — Upload directly to API instead of extractor
- `docker-compose.yml` — Remove extractor service
- `.github/workflows/deploy.yml` — Remove extractor build job

### Deleted Files
- `services/extractor/` — Entire directory
- `packages/web/src/lib/ocr/` — Entire directory
- `packages/web/src/components/tax/RedactionPreview.tsx`
- `packages/web/src/components/tax/ExtractionProgress.tsx`
- `packages/web/src/components/tax/ExtractedFields.tsx` — References old `ExtractedData` types
- `packages/web/src/components/tax/ManualEntryForm.tsx` — References old `TaxReturn` types
- `packages/api/src/routes/tax.ts` — Old tax routes

---

## Task 1: Install Dependencies & Add Env Config

**Files:**
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/lib/env.ts`

- [ ] **Step 1: Install GCP packages**

```bash
cd packages/api && pnpm add @google-cloud/documentai @google-cloud/dlp @google-cloud/storage
```

- [ ] **Step 2: Add GCS_BUCKET to env config**

In `packages/api/src/lib/env.ts`, add:

```typescript
get GCS_BUCKET() {
  return optional("GCS_BUCKET", "lasagna-prod-tax-documents");
},
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/package.json packages/api/src/lib/env.ts pnpm-lock.yaml
git commit -m "feat: add GCP dependencies for Document AI pipeline"
```

---

## Task 2: Database Schema Migration

**Files:**
- Modify: `packages/core/src/schema.ts`

- [ ] **Step 1: Replace tax tables and enums**

In `packages/core/src/schema.ts`, remove these declarations:
- `filingStatusEnum` (lines 30-35)
- `taxReturnStatusEnum` (lines 37-40)
- `taxReturns` table (lines 322-337)
- `taxDocuments` table (lines 339-353)

Replace with new `taxDocuments` table. Note: keep `jsonb` import — add it to the drizzle-orm import if not present:

```typescript
// ── Tax Documents ─────────────────────────────────────────────────────────
export const taxDocuments = pgTable("tax_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  gcsPath: text("gcs_path").notNull(),
  rawExtraction: jsonb("raw_extraction").notNull(),
  llmFields: jsonb("llm_fields").notNull(),
  llmSummary: text("llm_summary").notNull(),
  taxYear: integer("tax_year"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

Add `jsonb` to the drizzle-orm import at the top of the file:

```typescript
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  numeric,
  pgEnum,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Push schema changes**

```bash
pnpm db:push
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/schema.ts
git commit -m "feat: replace tax_returns + tax_documents with single tax_documents table"
```

---

## Task 3: GCS Client

**Files:**
- Create: `packages/api/src/lib/gcs.ts`

- [ ] **Step 1: Create GCS client module**

```typescript
import { Storage } from "@google-cloud/storage";
import { env } from "./env.js";

const storage = new Storage();

function getBucket() {
  return storage.bucket(env.GCS_BUCKET);
}

export async function uploadFile(
  tenantId: string,
  documentId: string,
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const gcsPath = `${tenantId}/${documentId}/${fileName}`;
  const file = getBucket().file(gcsPath);
  await file.save(buffer, { contentType });
  return gcsPath;
}

export async function deleteFile(gcsPath: string): Promise<void> {
  try {
    await getBucket().file(gcsPath).delete();
  } catch {
    // Best-effort deletion — orphaned files are acceptable
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/lib/gcs.ts
git commit -m "feat: add GCS upload/delete client"
```

---

## Task 4: Document AI Client + Field Cleaning

**Files:**
- Create: `packages/api/src/lib/document-ai.ts`

- [ ] **Step 1: Create Document AI client with cleaning logic**

```typescript
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

const PROJECT_ID = "lasagna-prod";
const LOCATION = "us";
const PROCESSOR_ID = "2a4ce4b54806000e";

const client = new DocumentProcessorServiceClient({
  apiEndpoint: `${LOCATION}-documentai.googleapis.com`,
});

const PII_KEY_PATTERNS = [
  /social security/i,
  /\bssn\b/i,
  /first name/i,
  /last name/i,
  /middle initial/i,
  /spouse.*name/i,
  /full name/i,
  /\baddress\b/i,
  /city.*town/i,
  /foreign country/i,
  /foreign province/i,
  /foreign postal/i,
  /zip code/i,
  /deceased/i,
  /date of birth/i,
];

const NOISE_VALUES = new Set(["", "\u2610", "\u2611", "\u2713", "\u2717", "\u25A1"]);

interface ExtractedField {
  key: string;
  value: string;
  confidence: number;
}

export async function extractFormFields(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractedField[]> {
  const processorName = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

  const [result] = await client.processDocument({
    name: processorName,
    rawDocument: { content: buffer.toString("base64"), mimeType },
  });

  const document = result.document;
  if (!document?.text || !document.pages) return [];

  const raw: ExtractedField[] = [];
  for (const page of document.pages) {
    for (const field of page.formFields || []) {
      const key = textFromLayout(field.fieldName, document.text);
      const value = textFromLayout(field.fieldValue, document.text);
      const confidence = field.fieldValue?.confidence ?? 0;
      if (key || value) {
        raw.push({ key, value, confidence });
      }
    }
  }

  return cleanFields(raw);
}

function textFromLayout(
  layout: { textAnchor?: { textSegments?: Array<{ startIndex?: string; endIndex?: string }> } } | null | undefined,
  fullText: string
): string {
  if (!layout?.textAnchor?.textSegments) return "";
  return layout.textAnchor.textSegments
    .map((seg) => {
      const start = parseInt(seg.startIndex || "0", 10);
      const end = parseInt(seg.endIndex || "0", 10);
      return fullText.slice(start, end);
    })
    .join("")
    .trim();
}

function cleanFields(fields: ExtractedField[]): ExtractedField[] {
  const cleaned: ExtractedField[] = [];
  const seen = new Set<string>();

  for (const f of fields) {
    const key = cleanKey(f.key);
    const value = cleanValue(f.value);

    if (NOISE_VALUES.has(value)) continue;
    if (isPiiKey(key)) continue;
    if (!key || key.length <= 1) continue;
    if (f.confidence < 0.5) continue;

    const dedup = key.toLowerCase();
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    cleaned.push({ key, value, confidence: f.confidence });
  }

  return cleaned;
}

function cleanKey(key: string): string {
  return key
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d+[a-z]?\s+/, "")
    .replace(/\s+\d+[a-z]?$/, "");
}

function cleanValue(value: string): string {
  let v = value.replace(/\s+/g, " ").trim();
  if (/^[\d ,.\-]+$/.test(v)) {
    v = v.replace(/(?<=\d)\s+(?=\d)/g, "");
  }
  return v;
}

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((p) => p.test(key));
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/lib/document-ai.ts
git commit -m "feat: add Document AI extraction client with field cleaning"
```

---

## Task 5: DLP Client

**Files:**
- Create: `packages/api/src/lib/dlp.ts`

- [ ] **Step 1: Create DLP redaction client**

```typescript
import { DlpServiceClient } from "@google-cloud/dlp";

const PROJECT_ID = "lasagna-prod";
const LOCATION = "us";

const client = new DlpServiceClient();

const INFO_TYPES = [
  "PERSON_NAME",
  "US_SOCIAL_SECURITY_NUMBER",
  "STREET_ADDRESS",
  "PHONE_NUMBER",
  "EMAIL_ADDRESS",
  "DATE_OF_BIRTH",
  "US_INDIVIDUAL_TAXPAYER_IDENTIFICATION_NUMBER",
];

interface Field {
  key: string;
  value: string;
}

export async function redactPii(fields: Field[]): Promise<Field[]> {
  const text = normalizeSsns(
    fields.map((f) => `${f.key}: ${f.value}`).join("\n")
  );

  const [response] = await client.deidentifyContent({
    parent: `projects/${PROJECT_ID}/locations/${LOCATION}`,
    inspectConfig: {
      infoTypes: INFO_TYPES.map((name) => ({ name })),
      minLikelihood: "POSSIBLE",
    },
    deidentifyConfig: {
      infoTypeTransformations: {
        transformations: [
          {
            infoTypes: INFO_TYPES.map((name) => ({ name })),
            primitiveTransformation: {
              replaceConfig: {
                newValue: { stringValue: "[REDACTED]" },
              },
            },
          },
        ],
      },
    },
    item: { value: text },
  });

  const redactedLines = (response.item?.value ?? "").split("\n");
  const result: Field[] = [];

  for (const line of redactedLines) {
    const sepIdx = line.indexOf(": ");
    if (sepIdx === -1) continue;
    const key = line.slice(0, sepIdx).trim();
    const value = line.slice(sepIdx + 2).trim();
    if (!value || value === "[REDACTED]") continue;
    if (/^\[REDACTED\][\s,.\-]*$/.test(value)) continue;
    result.push({ key, value });
  }

  return result;
}

function normalizeSsns(text: string): string {
  // Collapse spaced digit sequences that look like SSNs
  return text.replace(/\b\d(?:\s+\d){2,8}\d*\b/g, (match) => {
    const digits = match.replace(/\s+/g, "");
    if (digits.length === 9) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    }
    return match;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/lib/dlp.ts
git commit -m "feat: add Cloud DLP text redaction client"
```

---

## Task 6: Pipeline Orchestrator

**Files:**
- Create: `packages/api/src/lib/tax-extraction.ts`

This is the main pipeline that ties all steps together.

- [ ] **Step 1: Create orchestrator**

```typescript
import { randomUUID } from "crypto";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../agent/agent.js";
import { uploadFile, deleteFile } from "./gcs.js";
import { extractFormFields } from "./document-ai.js";
import { redactPii } from "./dlp.js";
import { db } from "../lib/db.js";
import { taxDocuments } from "@lasagna/core";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const llmResponseSchema = z.object({
  fields: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  summary: z.string(),
  tax_year: z.number().nullable(),
});

interface ExtractionResult {
  id: string;
  llmFields: Record<string, unknown>;
  llmSummary: string;
  taxYear: number | null;
}

export async function processDocument(
  tenantId: string,
  file: File
): Promise<ExtractionResult> {
  // Validate
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}. Accepted: PDF, JPEG, PNG, TIFF`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 20MB`);
  }

  const documentId = randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  let gcsPath: string | null = null;

  try {
    // Step 1: Upload to GCS
    gcsPath = await uploadFile(tenantId, documentId, file.name, buffer, file.type);

    // Step 2 + 3: Document AI extraction + cleaning
    const extracted = await extractFormFields(buffer, file.type);

    // Step 4: DLP redaction
    const redacted = await redactPii(extracted);

    // Step 5: LLM mapping
    const { object: llmResult } = await generateObject({
      model: getModel(),
      schema: llmResponseSchema,
      prompt: `You are a tax document data extraction assistant. Given the following key-value pairs extracted from a tax document, return:

1. "fields": A clean structured object with sensible snake_case key names and numeric values where appropriate. Include all financial data points. Include filing_status if you can determine it.
2. "summary": A concise human-readable summary (2-3 sentences) of what this document contains, including document type, tax year, key financial figures.
3. "tax_year": The tax year as a number, or null if not determinable.

Extracted data:
${redacted.map((f) => `${f.key}: ${f.value}`).join("\n")}`,
    });

    // Step 6: Insert into database
    const [row] = await db
      .insert(taxDocuments)
      .values({
        id: documentId,
        tenantId,
        fileName: file.name,
        fileType: file.type,
        gcsPath,
        rawExtraction: redacted,
        llmFields: llmResult.fields,
        llmSummary: llmResult.summary,
        taxYear: llmResult.tax_year,
      })
      .returning();

    return {
      id: row.id,
      llmFields: llmResult.fields,
      llmSummary: llmResult.summary,
      taxYear: llmResult.tax_year,
    };
  } catch (error) {
    // Clean up GCS on failure
    if (gcsPath) await deleteFile(gcsPath);
    throw error;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/lib/tax-extraction.ts
git commit -m "feat: add tax document extraction pipeline orchestrator"
```

---

## Task 7: API Routes

**Files:**
- Create: `packages/api/src/routes/tax-documents.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create new tax documents routes**

```typescript
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { taxDocuments, eq, and, desc } from "@lasagna/core";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { processDocument } from "../lib/tax-extraction.js";
import { deleteFile } from "../lib/gcs.js";

export const taxDocumentsRouter = new Hono<AuthEnv>();

taxDocumentsRouter.use("*", requireAuth);

// Upload + process document
taxDocumentsRouter.post("/upload", async (c) => {
  const { tenantId } = c.get("session");
  const body = await c.req.parseBody();
  const file = body.file;

  if (!file || !(file instanceof File)) {
    return c.json({ error: "File is required" }, 400);
  }

  try {
    const result = await processDocument(tenantId, file);
    return c.json(result, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    if (message.includes("Unsupported file type") || message.includes("File too large")) {
      return c.json({ error: message }, 400);
    }
    console.error("Document processing failed:", error);
    return c.json({ error: "Document processing failed" }, 500);
  }
});

// List documents
taxDocumentsRouter.get("/", async (c) => {
  const { tenantId } = c.get("session");

  const docs = await db
    .select({
      id: taxDocuments.id,
      fileName: taxDocuments.fileName,
      llmSummary: taxDocuments.llmSummary,
      taxYear: taxDocuments.taxYear,
      createdAt: taxDocuments.createdAt,
    })
    .from(taxDocuments)
    .where(eq(taxDocuments.tenantId, tenantId))
    .orderBy(desc(taxDocuments.createdAt));

  return c.json({ documents: docs });
});

// Get single document
taxDocumentsRouter.get("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");

  const [doc] = await db
    .select()
    .from(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json({ document: doc });
});

// Update tax year
taxDocumentsRouter.patch("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");
  const body = await c.req.json();

  const schema = z.object({
    taxYear: z.number().int().min(1900).max(2100).nullable().optional(),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues }, 400);
  }

  const [doc] = await db
    .update(taxDocuments)
    .set(parsed.data)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)))
    .returning();

  if (!doc) return c.json({ error: "Document not found" }, 404);
  return c.json({ document: doc });
});

// Delete document
taxDocumentsRouter.delete("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const id = c.req.param("id");

  const [doc] = await db
    .select({ gcsPath: taxDocuments.gcsPath })
    .from(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  if (!doc) return c.json({ error: "Document not found" }, 404);

  await db
    .delete(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  // Best-effort GCS cleanup
  await deleteFile(doc.gcsPath);

  return c.json({ success: true });
});
```

- [ ] **Step 2: Update server.ts to use new router**

In `packages/api/src/server.ts`:

Replace:
```typescript
import { taxRouter } from "./routes/tax.js";
```
With:
```typescript
import { taxDocumentsRouter } from "./routes/tax-documents.js";
```

Replace:
```typescript
app.route("/api/tax", taxRouter);
```
With:
```typescript
app.route("/api/tax/documents", taxDocumentsRouter);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/tax-documents.ts packages/api/src/server.ts
git commit -m "feat: add tax document upload/CRUD routes, replace old tax router"
```

---

## Task 8: Update Frontend Types & API Client

**Files:**
- Modify: `packages/web/src/lib/types.ts`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Update types**

In `packages/web/src/lib/types.ts`, replace the tax-related types (`FilingStatus`, `TaxReturnStatus`, `TaxReturn`, `ExtractedField`, `ExtractedData`, `TaxDocument`) with:

```typescript
export interface TaxDocument {
  id: string;
  tenantId: string;
  fileName: string;
  fileType: string;
  gcsPath: string;
  rawExtraction: Array<{ key: string; value: string }>;
  llmFields: Record<string, unknown>;
  llmSummary: string;
  taxYear: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaxDocumentSummary {
  id: string;
  fileName: string;
  llmSummary: string;
  taxYear: number | null;
  createdAt: string;
}

export interface UploadResult {
  id: string;
  llmFields: Record<string, unknown>;
  llmSummary: string;
  taxYear: number | null;
}
```

- [ ] **Step 2: Update API client**

In `packages/web/src/lib/api.ts`, replace the tax methods with:

```typescript
// Tax Documents
getTaxDocuments: () =>
  request<{ documents: TaxDocumentSummary[] }>("/tax/documents"),

getTaxDocument: (id: string) =>
  request<{ document: TaxDocument }>(`/tax/documents/${id}`),

uploadTaxDocument: async (file: File): Promise<UploadResult> => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/tax/documents/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
},

updateTaxDocument: (id: string, data: { taxYear?: number | null }) =>
  request<{ document: TaxDocument }>(`/tax/documents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }),

deleteTaxDocument: (id: string) =>
  request<{ success: boolean }>(`/tax/documents/${id}`, { method: "DELETE" }),
```

Note: `uploadTaxDocument` uses raw `fetch` instead of the `request` helper because it sends `FormData`, not JSON — the `Content-Type` header must be set by the browser (multipart boundary).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/types.ts packages/web/src/lib/api.ts
git commit -m "feat: update frontend types and API client for tax documents"
```

---

## Task 9: Update Frontend Upload Flow

**Files:**
- Modify: `packages/web/src/pages/tax-strategy.tsx`
- Modify: `packages/web/src/components/tax/PdfUploader.tsx`

- [ ] **Step 1: Simplify PdfUploader to call API directly**

The uploader should accept files and call `api.uploadTaxDocument(file)` for each file in parallel. Remove all references to the extractor service, preview flow, and `VITE_EXTRACTOR_URL`.

The `PdfUploader` component's `onFileSelect` prop changes from accepting a single `File` to accepting `File[]`. It should allow multiple file selection.

- [ ] **Step 2: Simplify tax-strategy.tsx**

Remove:
- `previewImages` state and `RedactionPreview` modal
- `handleConfirmExtraction` and `handleCancelPreview` handlers
- Import of `previewRedactedPdf`, `extractFromImages` from `../lib/ocr`
- Import of `RedactionPreview` and `ExtractionProgress`

Replace `handleFileSelect` with:

```typescript
const handleFilesSelected = async (files: File[]) => {
  setIsProcessing(true);
  setError(null);
  try {
    const results = await Promise.all(
      files.map((file) => api.uploadTaxDocument(file))
    );
    // Refresh document list
    const { documents } = await api.getTaxDocuments();
    setDocuments(documents);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Upload failed");
  } finally {
    setIsProcessing(false);
  }
};
```

Replace the document list to use `TaxDocumentSummary` — show `llmSummary`, `fileName`, `taxYear`.

Remove `TaxReturn` state entirely — there are no more tax returns, just documents.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/tax-strategy.tsx packages/web/src/components/tax/PdfUploader.tsx
git commit -m "feat: simplify upload flow — direct API upload, no redaction preview"
```

---

## Task 10: Delete Old Code

**Files:**
- Delete: `services/extractor/` (entire directory)
- Delete: `packages/web/src/lib/ocr/` (entire directory)
- Delete: `packages/web/src/components/tax/RedactionPreview.tsx`
- Delete: `packages/api/src/routes/tax.ts`
- Modify: `docker-compose.yml` — remove extractor service
- Modify: `.github/workflows/deploy.yml` — remove extractor build job

- [ ] **Step 1: Delete extractor service and old OCR code**

```bash
rm -rf services/extractor
rm -rf packages/web/src/lib/ocr
rm -f packages/web/src/components/tax/RedactionPreview.tsx
rm -f packages/web/src/components/tax/ExtractionProgress.tsx
rm -f packages/web/src/components/tax/ExtractedFields.tsx
rm -f packages/web/src/components/tax/ManualEntryForm.tsx
rm -f packages/api/src/routes/tax.ts
```

- [ ] **Step 2: Remove extractor from docker-compose.yml**

Remove the entire `extractor:` service block from `docker-compose.yml`.

- [ ] **Step 3: Remove extractor from deploy workflow**

In `.github/workflows/deploy.yml`:
- Remove the `EXTRACTOR_IMAGE` env var
- Remove the entire `build-extractor` job

- [ ] **Step 4: Remove VITE_EXTRACTOR_URL references**

```bash
grep -r "VITE_EXTRACTOR_URL" packages/web/ --include="*.ts" --include="*.tsx" -l
```

Remove any remaining references found.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove extractor service, old OCR code, and redaction preview"
```

---

## Task 11: Verify End-to-End

- [ ] **Step 1: Start services**

```bash
docker compose up -d
```

- [ ] **Step 2: Verify schema pushed**

```bash
pnpm db:push
```

- [ ] **Step 3: Test upload via curl**

```bash
curl -X POST http://localhost:3000/api/tax/documents/upload \
  -H "Cookie: <session-cookie>" \
  -F "file=@/path/to/test.pdf"
```

Verify response contains `id`, `llmFields`, `llmSummary`, `taxYear`.

- [ ] **Step 4: Test list endpoint**

```bash
curl http://localhost:3000/api/tax/documents \
  -H "Cookie: <session-cookie>"
```

- [ ] **Step 5: Test frontend upload flow**

Open `http://localhost:5173`, navigate to tax strategy page, upload a PDF. Verify:
- Upload completes without errors
- Document appears in list with summary
- Tax year is shown if extracted

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end testing"
```
