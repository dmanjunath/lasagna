# Tax Input Modes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GCP Document AI + DLP pipeline with direct vision-based LLM extraction, and redesign the tax input UI to support file upload (to any OpenAI-compatible endpoint) or free-form text entry.

**Architecture:** A new `tax-vision-extraction.ts` lib handles PDF→PNG conversion and LLM calls using the OpenAI chat completions format. A new `POST /` route on `taxDocumentsRouter` replaces the two-step extract/confirm flow. A new `TaxInputPanel` React component replaces `PdfUploader` + `RedactionReview` with a dual-section layout (file drop + textarea) and editable provider fields.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Zod, React, Tailwind CSS, pdftoppm (poppler-utils)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `Dockerfile.dev` | Add `poppler-utils` for `pdftoppm` |
| Create | `packages/api/src/lib/tax-vision-extraction.ts` | PDF→PNG conversion + LLM vision call |
| Modify | `packages/api/src/routes/tax-documents.ts` | Add `POST /` handler |
| Modify | `packages/web/src/lib/api.ts` | Add `submitTaxInput` method |
| Modify | `packages/web/src/lib/types.ts` | Add `TaxInputResult` type |
| Create | `packages/web/src/components/tax/TaxInputPanel.tsx` | New dual-section input UI |
| Modify | `packages/web/src/pages/tax-strategy.tsx` | Swap old components for `TaxInputPanel` |
| Delete | `packages/web/src/components/tax/PdfUploader.tsx` | Replaced by TaxInputPanel |
| Delete | `packages/web/src/components/tax/RedactionReview.tsx` | No longer needed |

---

## Task 1: Add poppler-utils to Docker

**Files:**
- Modify: `Dockerfile.dev` (root)

- [ ] **Step 1: Add poppler-utils apt install**

In `Dockerfile.dev`, after `FROM node:20-slim`, add the apt install line:

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y poppler-utils && rm -rf /var/lib/apt/lists/*
RUN corepack enable
```

- [ ] **Step 2: Rebuild and verify pdftoppm exists**

```bash
docker compose build api
docker compose run --rm api which pdftoppm
```

Expected: `/usr/bin/pdftoppm`

- [ ] **Step 3: Commit**

```bash
git add Dockerfile.dev
git commit -m "chore: add poppler-utils to dev Docker image for PDF conversion"
```

---

## Task 2: Create tax-vision-extraction.ts

**Files:**
- Create: `packages/api/src/lib/tax-vision-extraction.ts`

This module exports one function: `extractFromVision(input, providerUrl, opts)`.

- [ ] **Step 1: Create the file**

Create `packages/api/src/lib/tax-vision-extraction.ts`:

```typescript
import { execSync } from "child_process";
import { mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { z } from "zod";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_PDF_PAGES = 10;
const SUPPORTED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];

const llmResultSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  summary: z.string(),
  tax_year: z.number().nullable(),
});

export type VisionExtractionResult = z.infer<typeof llmResultSchema>;

interface VisionOpts {
  apiKey?: string;
  model?: string;
}

const EXTRACTION_PROMPT = `You are a tax document data extraction assistant. Given the following tax document image(s), return a JSON object (no markdown fencing) with:

1. "fields": A clean structured object with sensible snake_case key names and numeric values where appropriate. Include all financial data points. Include filing_status if you can determine it.
2. "summary": A concise human-readable summary (2-3 sentences) of what this document contains, including document type, tax year, key financial figures.
3. "tax_year": The tax year as a number, or null if not determinable.

Return ONLY the raw JSON object, no markdown code fences.`;

function pdfToBase64Images(pdfBuffer: Buffer): string[] {
  const tmpDir = join(tmpdir(), `tax-extraction-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    const pdfPath = join(tmpDir, "input.pdf");
    writeFileSync(pdfPath, pdfBuffer);

    const infoOut = execSync(
      `pdfinfo "${pdfPath}" 2>/dev/null | grep "^Pages:" | awk '{print $2}'`,
      { encoding: "utf8" }
    ).trim();
    const totalPages = parseInt(infoOut, 10) || 1;
    const pagesToProcess = Math.min(totalPages, MAX_PDF_PAGES);

    execSync(
      `pdftoppm -png -r 150 -f 1 -l ${pagesToProcess} "${pdfPath}" "${tmpDir}/page"`,
      { stdio: "pipe" }
    );

    return readdirSync(tmpDir)
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => readFileSync(join(tmpDir, f)).toString("base64"));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function extractFromVision(
  fileBuffer: Buffer,
  fileMimeType: string,
  providerUrl: string,
  opts: VisionOpts = {}
): Promise<VisionExtractionResult> {
  if (!SUPPORTED_MIME_TYPES.includes(fileMimeType)) {
    throw new Error(`Unsupported file type: ${fileMimeType}`);
  }
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`File too large. Maximum size is 20MB.`);
  }

  // Build base64 image list
  let images: Array<{ data: string; mimeType: string }>;
  if (fileMimeType === "application/pdf") {
    const pages = pdfToBase64Images(fileBuffer);
    images = pages.map((data) => ({ data, mimeType: "image/png" }));
  } else {
    images = [{ data: fileBuffer.toString("base64"), mimeType: fileMimeType }];
  }

  const imageBlocks = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mimeType};base64,${img.data}` },
  }));

  const model = opts.model || "google/gemma-4-26b-a4b-it";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  const res = await fetch(providerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { choices: { message: { content: string } }[] };
  const rawText = data.choices?.[0]?.message?.content ?? "";

  if (!rawText) {
    throw new Error("Empty response from LLM");
  }

  // Strip markdown fences if present
  const jsonStr = rawText
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`LLM response is not valid JSON. Raw: ${rawText.slice(0, 300)}`);
  }

  const validated = llmResultSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `LLM response failed schema validation: ${JSON.stringify(validated.error.issues)}`
    );
  }

  return validated.data;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/api
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/lib/tax-vision-extraction.ts
git commit -m "feat: add tax vision extraction lib (PDF->PNG + LLM via OpenAI-compat)"
```

---

## Task 3: Add POST / route to taxDocumentsRouter

**Files:**
- Modify: `packages/api/src/routes/tax-documents.ts`

- [ ] **Step 1: Add import and new route**

At the top of `packages/api/src/routes/tax-documents.ts`, add the import after the existing imports:

```typescript
import { extractFromVision } from "../lib/tax-vision-extraction.js";
```

Then add this new route **before** the existing `taxDocumentsRouter.get("/", ...)` handler (i.e., after the existing `/upload` route, around line 98):

```typescript
// New unified endpoint: vision extraction or manual text entry
taxDocumentsRouter.post("/", async (c) => {
  const { tenantId } = c.get("session");
  const body = await c.req.parseBody();

  const text = typeof body.text === "string" ? body.text.trim() : null;
  const file = body.file instanceof File ? body.file : null;
  const providerUrl = typeof body.providerUrl === "string" ? body.providerUrl : null;
  const apiKey = typeof body.apiKey === "string" && body.apiKey ? body.apiKey : undefined;
  const model = typeof body.model === "string" && body.model ? body.model : undefined;

  if (!text && !file) {
    return c.json({ error: "Either file or text is required" }, 400);
  }
  if (file && !providerUrl) {
    return c.json({ error: "providerUrl is required for file uploads" }, 400);
  }

  try {
    if (file) {
      // Vision extraction path
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      let result;
      try {
        result = await extractFromVision(fileBuffer, file.type, providerUrl!, { apiKey, model });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Extraction failed";
        if (message.startsWith("Unsupported file type") || message.startsWith("File too large")) {
          return c.json({ error: message }, 400);
        }
        return c.json({ error: "Extraction failed", raw: message }, 422);
      }

      const [doc] = await db.insert(taxDocuments).values({
        tenantId,
        fileName: file.name,
        fileType: file.type,
        gcsPath: "",
        rawExtraction: [],
        llmFields: result.fields,
        llmSummary: result.summary,
        taxYear: result.tax_year,
      }).returning();

      return c.json({ document: doc }, 201);
    } else {
      // Manual text path
      const [doc] = await db.insert(taxDocuments).values({
        tenantId,
        fileName: "manual-entry",
        fileType: "text/plain",
        gcsPath: "",
        rawExtraction: [],
        llmFields: {},
        llmSummary: text!,
        taxYear: null,
      }).returning();

      return c.json({ document: doc }, 201);
    }
  } catch (error) {
    console.error("Tax document submission failed:", error);
    return c.json({ error: "Document processing failed" }, 500);
  }
});
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/api
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke-test the text path via curl**

```bash
docker compose up -d
curl -s -X POST http://localhost:3000/api/tax/documents \
  -b "$(cat .cookies 2>/dev/null || echo '')" \
  -F "text=Filed married jointly in 2023. Total income $120000. Tax paid $18000." \
  | python3 -m json.tool
```

Expected: `201` with `document` object containing the text as `llm_summary`.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/tax-documents.ts
git commit -m "feat: add POST / route to taxDocumentsRouter for vision and manual input"
```

---

## Task 4: Add submitTaxInput to API client + types

**Files:**
- Modify: `packages/web/src/lib/types.ts`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add TaxInputResult type to types.ts**

In `packages/web/src/lib/types.ts`, add after the `UploadResult` interface:

```typescript
export interface TaxInputResult {
  id: string;
  fileName: string;
  fileType: string;
  llmFields: Record<string, unknown>;
  llmSummary: string;
  taxYear: number | null;
  createdAt: string;
}
```

- [ ] **Step 2: Add submitTaxInput to api.ts**

In `packages/web/src/lib/api.ts`, add after `uploadTaxDocument`:

```typescript
submitTaxInput: async (params: {
  file?: File;
  text?: string;
  providerUrl: string;
  apiKey?: string;
  model?: string;
}): Promise<TaxInputResult> => {
  const formData = new FormData();
  if (params.file) formData.append("file", params.file);
  if (params.text) formData.append("text", params.text);
  formData.append("providerUrl", params.providerUrl);
  if (params.apiKey) formData.append("apiKey", params.apiKey);
  if (params.model) formData.append("model", params.model);

  const res = await fetch(`${API_BASE}/api/tax/documents`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" })) as { error: string };
    throw new Error(err.error || "Submission failed");
  }

  const data = await res.json() as { document: TaxInputResult };
  return data.document;
},
```

Also add `TaxInputResult` to the import at the top of `api.ts`:
```typescript
import type { Plan, PlanType, PlanStatus, PlanEdit, ChatThread, Message, TaxDocument, TaxDocumentSummary, UploadResult, ExtractionResult, TaxInputResult } from "./types.js";
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/types.ts packages/web/src/lib/api.ts
git commit -m "feat: add submitTaxInput API method and TaxInputResult type"
```

---

## Task 5: Create TaxInputPanel component

**Files:**
- Create: `packages/web/src/components/tax/TaxInputPanel.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/tax/TaxInputPanel.tsx`:

```tsx
import { useCallback, useRef, useState } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { api } from "../../lib/api.js";
import type { TaxInputResult } from "../../lib/types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it";

const ACCEPTED_MIME = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_SIZE = 20 * 1024 * 1024;

interface TaxInputPanelProps {
  onSuccess: (doc: TaxInputResult) => void;
}

export function TaxInputPanel({ onSuccess }: TaxInputPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [providerUrl, setProviderUrl] = useState(OPENROUTER_URL);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasFile = file !== null;
  const hasText = text.trim().length > 0;
  const canSubmit = (hasFile || hasText) && !loading;

  const handleFileChange = useCallback((incoming: File) => {
    setError(null);
    if (!ACCEPTED_MIME.includes(incoming.type)) {
      setError("Unsupported file type. Use PDF, PNG, or JPG.");
      return;
    }
    if (incoming.size > MAX_FILE_SIZE) {
      setError("File too large. Maximum 20MB.");
      return;
    }
    setFile(incoming);
    setText("");
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFileChange(dropped);
    },
    [handleFileChange]
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const doc = await api.submitTaxInput({
        file: file ?? undefined,
        text: hasText ? text : undefined,
        providerUrl,
        apiKey: apiKey || undefined,
        model: model || undefined,
      });
      // Reset form
      setFile(null);
      setText("");
      setApiKey("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      onSuccess(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Dual input sections */}
      <div className="flex flex-col md:flex-row gap-4">
        {/* File drop zone */}
        <div
          className={cn(
            "flex-1 rounded-xl border-2 border-dashed p-6 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors min-h-[160px]",
            isDragging ? "border-accent bg-accent/5" : "border-border hover:border-accent/50",
            hasText && "opacity-40 pointer-events-none select-none"
          )}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !hasText && fileInputRef.current?.click()}
          role="button"
          tabIndex={hasText ? -1 : 0}
          onKeyDown={(e) => e.key === "Enter" && !hasText && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileChange(f);
            }}
          />
          {file ? (
            <>
              <FileText className="w-8 h-8 text-accent" />
              <div className="text-sm font-medium text-center truncate max-w-full px-2">{file.name}</div>
              <button
                type="button"
                className="text-xs text-text-muted hover:text-danger transition-colors"
                onClick={(e) => { e.stopPropagation(); setFile(null); }}
              >
                Remove
              </button>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 text-text-muted" />
              <div className="text-sm text-text-secondary text-center">
                Drop a file or click to browse
                <div className="text-xs text-text-muted mt-1">PDF, PNG, JPG · max 20MB</div>
              </div>
            </>
          )}
        </div>

        {/* Text input */}
        <div className={cn(
          "flex-1 flex flex-col gap-2 transition-opacity",
          hasFile && "opacity-40 pointer-events-none select-none"
        )}>
          <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Or describe your tax info
          </label>
          <textarea
            className="flex-1 min-h-[136px] rounded-xl border border-border bg-bg-elevated px-4 py-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-text-muted"
            placeholder="e.g. Filed married jointly in 2023. W-2 income $120,000. Federal tax withheld $18,000. Standard deduction. No dependents."
            value={text}
            onChange={(e) => { setText(e.target.value); setFile(null); }}
            disabled={hasFile}
          />
        </div>
      </div>

      {/* Provider config (always visible) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-1">
          <label className="block text-xs text-text-muted mb-1">LLM Endpoint URL</label>
          <input
            type="url"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            value={providerUrl}
            onChange={(e) => setProviderUrl(e.target.value)}
            placeholder="https://openrouter.ai/api/v1/chat/completions"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Model</label>
          <input
            type="text"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="google/gemma-4-26b-a4b-it"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">API Key <span className="text-text-muted/60">(optional)</span></label>
          <input
            type="password"
            className="w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-..."
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="button"
        disabled={!canSubmit}
        onClick={handleSubmit}
        className={cn(
          "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors",
          canSubmit
            ? "bg-accent text-white hover:bg-accent/90"
            : "bg-surface-hover text-text-muted cursor-not-allowed"
        )}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {hasFile ? "Extracting…" : "Saving…"}
          </>
        ) : (
          "Send"
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd packages/web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/tax/TaxInputPanel.tsx
git commit -m "feat: add TaxInputPanel component with file drop + textarea + provider config"
```

---

## Task 6: Swap TaxInputPanel into tax-strategy.tsx

**Files:**
- Modify: `packages/web/src/pages/tax-strategy.tsx`

- [ ] **Step 1: Replace imports**

Replace the old import lines:
```typescript
import { PdfUploader, type UploadStep } from "../components/tax/PdfUploader.js";
import { RedactionReview } from "../components/tax/RedactionReview.js";
import type { TaxDocumentSummary, ExtractionResult } from "../lib/types.js";
```

With:
```typescript
import { TaxInputPanel } from "../components/tax/TaxInputPanel.js";
import type { TaxDocumentSummary, TaxInputResult } from "../lib/types.js";
```

- [ ] **Step 2: Replace state**

Remove these state variables:
```typescript
const [uploadStep, setUploadStep] = useState<UploadStep>("idle");
const [pendingExtraction, setPendingExtraction] = useState<ExtractionResult | null>(null);
const [isConfirming, setIsConfirming] = useState(false);
```

Keep `documents`, `error`, `insightStatus`, `profileInfo`.

- [ ] **Step 3: Replace handlers**

Remove `handleFilesSelected`, `handleApprove`, `handleReject`.

Add a single success handler:
```typescript
const handleInputSuccess = useCallback(async (doc: TaxInputResult) => {
  setDocuments((prev) => [
    { id: doc.id, fileName: doc.fileName, llmSummary: doc.llmSummary, taxYear: doc.taxYear, createdAt: doc.createdAt },
    ...prev,
  ]);
  setInsightStatus("generating");
  api.generateInsights()
    .then(() => setInsightStatus("done"))
    .catch(() => setInsightStatus("idle"));
}, []);
```

- [ ] **Step 4: Replace the Tax Documents section JSX**

Find the `{/* Tax Documents */}` section (lines ~352–452) and replace the `<div className="space-y-6 max-w-2xl">` contents:

```tsx
{/* Tax Documents */}
<Section title="Tax Documents">
  <div className="space-y-6 max-w-2xl">
    <TaxInputPanel onSuccess={handleInputSuccess} />

    {insightStatus === "generating" && (
      <div className="flex items-center gap-2 text-text-muted text-xs">
        <RefreshCw className="w-3 h-3 animate-spin" />
        Updating tax insights…
      </div>
    )}
    {insightStatus === "done" && (
      <div className="text-xs text-success">Tax insights updated</div>
    )}

    {error && (
      <div className="p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
        {error}
      </div>
    )}

    {documents.length > 0 ? (
      <div>
        <h4 className="text-xs uppercase tracking-wider text-text-muted font-semibold mb-3">Uploaded Documents</h4>
        <div className="space-y-2">
          {documents.map((doc, i) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card rounded-xl p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <FileText className="w-5 h-5 text-text-muted shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{doc.fileName}</div>
                    {doc.taxYear && (
                      <div className="text-xs text-text-muted mt-0.5">Tax Year {doc.taxYear}</div>
                    )}
                    {doc.llmSummary && (
                      <div className="text-xs text-text-muted mt-1 line-clamp-2">{doc.llmSummary}</div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteDocument(doc.id)}
                  className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    ) : (
      <div className="glass-card rounded-2xl p-8 text-center">
        <Receipt className="w-12 h-12 text-text-muted mx-auto mb-4" />
        <p className="text-text-muted">Upload a document or describe your tax info to get started</p>
      </div>
    )}

    {documents.length > 0 && (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Button className="w-full sm:w-auto">
          <Plus className="w-4 h-4 mr-2" />
          Create Tax Strategy Plan
        </Button>
      </motion.div>
    )}
  </div>
</Section>
```

- [ ] **Step 5: Clean up unused imports**

Remove `UploadStep`, `ExtractionResult`, `Plus` (if unused) from imports. Verify no red underlines remain.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd packages/web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/pages/tax-strategy.tsx
git commit -m "feat: replace PdfUploader+RedactionReview with TaxInputPanel in tax-strategy page"
```

---

## Task 7: Delete old components

**Files:**
- Delete: `packages/web/src/components/tax/PdfUploader.tsx`
- Delete: `packages/web/src/components/tax/RedactionReview.tsx`

- [ ] **Step 1: Delete the files**

```bash
rm packages/web/src/components/tax/PdfUploader.tsx
rm packages/web/src/components/tax/RedactionReview.tsx
```

- [ ] **Step 2: Verify no remaining imports**

```bash
grep -r "PdfUploader\|RedactionReview" packages/web/src --include="*.ts" --include="*.tsx"
```

Expected: no output.

- [ ] **Step 3: Verify TypeScript still compiles**

```bash
cd packages/web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add -A packages/web/src/components/tax/
git commit -m "chore: remove PdfUploader and RedactionReview (replaced by TaxInputPanel)"
```

---

## Task 8: End-to-end smoke test

- [ ] **Step 1: Start the app**

```bash
docker compose up -d
```

Open `http://localhost:3001/tax-strategy` (or wherever the frontend is served).

- [ ] **Step 2: Test manual text entry**

Type a description like "2023 taxes, single filer, income $85,000, tax paid $12,000" in the textarea. Click Send.

Expected: New document appears in the list with the typed text as summary. No console errors.

- [ ] **Step 3: Test file upload**

Upload `tax_docs/f1040.pdf` with:
- URL: `https://openrouter.ai/api/v1/chat/completions`
- API Key: value from `.env` `OPENROUTER_API_KEY`
- Model: `google/gemma-4-26b-a4b-it`

Expected: Document extracted and appears in list with summary and tax year.

- [ ] **Step 4: Test mutual exclusion**

Verify that selecting a file dims the textarea and vice versa. Verify the Remove button on the file clears the file and re-enables the textarea.

- [ ] **Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
