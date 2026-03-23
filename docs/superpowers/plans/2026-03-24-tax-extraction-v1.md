# Tax Strategy v1: PDF Extraction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate browser-based OCR extraction from Form 1040 PDFs with >85% accuracy.

**Architecture:** Browser-side extraction using pdf.js + tesseract.js. PDFs never leave the browser. Structured JSON saved to Postgres via API. Form 1040 template matching for field extraction.

**Tech Stack:** pdf.js, tesseract.js, React, Drizzle ORM, Hono API

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `packages/core/src/schema.ts` | Add taxReturns, taxDocuments tables |
| `packages/api/src/routes/tax.ts` | CRUD endpoints for tax returns/documents |
| `packages/web/src/lib/ocr/index.ts` | OCR orchestration (pdf.js + tesseract) |
| `packages/web/src/lib/ocr/templates/form1040.ts` | Form 1040 field definitions |
| `packages/web/src/lib/ocr/types.ts` | OCR type definitions |
| `packages/web/src/components/tax/PdfUploader.tsx` | Drag/drop upload component |
| `packages/web/src/components/tax/ExtractionProgress.tsx` | Progress indicator |
| `packages/web/src/components/tax/ExtractedFields.tsx` | Editable field display |
| `packages/web/src/components/tax/DocumentList.tsx` | List of uploaded docs |

### Modified Files
| File | Changes |
|------|---------|
| `packages/web/src/pages/tax-strategy.tsx` | Rename to tax-history, add upload UI |
| `packages/web/src/lib/api.ts` | Add tax API methods |
| `packages/web/src/lib/types.ts` | Add tax types |
| `packages/web/src/components/layout/sidebar.tsx` | Rename "Tax Strategy" to "Tax History" |

---

## Task 1: Database Schema

**Files:**
- Modify: `packages/core/src/schema.ts`

- [ ] **Step 1.1: Add filing status enum**

```typescript
// Add after syncStatusEnum (around line 28)
export const filingStatusEnum = pgEnum("filing_status", [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
]);

export const taxReturnStatusEnum = pgEnum("tax_return_status", [
  "draft",
  "complete",
]);
```

- [ ] **Step 1.2: Add taxReturns table**

```typescript
// Add after simulationResults table (end of file)

// ── Tax Returns ───────────────────────────────────────────────────────────
export const taxReturns = pgTable("tax_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  taxYear: integer("tax_year").notNull(),
  filingStatus: filingStatusEnum("filing_status"),
  status: taxReturnStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

- [ ] **Step 1.3: Add taxDocuments table**

```typescript
// Add after taxReturns table
export const taxDocuments = pgTable("tax_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  taxReturnId: uuid("tax_return_id")
    .notNull()
    .references(() => taxReturns.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  extractedData: text("extracted_data"), // JSON string
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

- [ ] **Step 1.4: Push schema to database**

Run: `cd /Users/user/Documents/Personal_Projects/lasagna && pnpm db:push`

Expected: Schema updates applied successfully

- [ ] **Step 1.5: Commit**

```bash
git add packages/core/src/schema.ts
git commit -m "feat(schema): add taxReturns and taxDocuments tables"
```

---

## Task 2: API Routes for Tax

**Files:**
- Create: `packages/api/src/routes/tax.ts`
- Modify: `packages/api/src/index.ts` (register route)

- [ ] **Step 2.1: Create tax routes file**

```typescript
// packages/api/src/routes/tax.ts
import { Hono } from "hono";
import { db } from "@lasagna/core/db";
import { taxReturns, taxDocuments } from "@lasagna/core/schema";
import { eq, and, desc } from "drizzle-orm";
import type { AuthEnv } from "../middleware/auth.js";

const app = new Hono<AuthEnv>();

// Get all tax returns for tenant
app.get("/returns", async (c) => {
  const tenantId = c.get("tenantId");
  const returns = await db
    .select()
    .from(taxReturns)
    .where(eq(taxReturns.tenantId, tenantId))
    .orderBy(desc(taxReturns.taxYear));
  return c.json({ returns });
});

// Get single tax return with documents
app.get("/returns/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const id = c.req.param("id");

  const [taxReturn] = await db
    .select()
    .from(taxReturns)
    .where(and(eq(taxReturns.id, id), eq(taxReturns.tenantId, tenantId)));

  if (!taxReturn) {
    return c.json({ error: "Tax return not found" }, 404);
  }

  const documents = await db
    .select()
    .from(taxDocuments)
    .where(eq(taxDocuments.taxReturnId, id));

  return c.json({ taxReturn, documents });
});

// Create tax return
app.post("/returns", async (c) => {
  const tenantId = c.get("tenantId");
  const { taxYear, filingStatus } = await c.req.json();

  const [taxReturn] = await db
    .insert(taxReturns)
    .values({ tenantId, taxYear, filingStatus })
    .returning();

  return c.json({ taxReturn }, 201);
});

// Add document to tax return
app.post("/returns/:id/documents", async (c) => {
  const tenantId = c.get("tenantId");
  const taxReturnId = c.req.param("id");
  const { documentType, extractedData } = await c.req.json();

  const [document] = await db
    .insert(taxDocuments)
    .values({
      taxReturnId,
      tenantId,
      documentType,
      extractedData: JSON.stringify(extractedData),
      extractedAt: new Date(),
    })
    .returning();

  return c.json({ document }, 201);
});

// Update document (for manual edits)
app.patch("/documents/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const id = c.req.param("id");
  const { extractedData } = await c.req.json();

  const [document] = await db
    .update(taxDocuments)
    .set({ extractedData: JSON.stringify(extractedData) })
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)))
    .returning();

  if (!document) {
    return c.json({ error: "Document not found" }, 404);
  }

  return c.json({ document });
});

// Delete document
app.delete("/documents/:id", async (c) => {
  const tenantId = c.get("tenantId");
  const id = c.req.param("id");

  await db
    .delete(taxDocuments)
    .where(and(eq(taxDocuments.id, id), eq(taxDocuments.tenantId, tenantId)));

  return c.json({ success: true });
});

export default app;
```

- [ ] **Step 2.2: Register tax routes in main app**

Find the route registration section in `packages/api/src/index.ts` and add:

```typescript
import taxRoutes from "./routes/tax.js";
// ... after other route imports

app.route("/tax", taxRoutes);
// ... after other app.route() calls
```

- [ ] **Step 2.3: Start API and verify routes exist**

Run: `cd /Users/user/Documents/Personal_Projects/lasagna && pnpm docker:up`

Then test: `curl -X GET http://localhost:3001/api/tax/returns -H "Cookie: <auth_cookie>" -v`

Expected: 200 OK with `{ "returns": [] }`

- [ ] **Step 2.4: Commit**

```bash
git add packages/api/src/routes/tax.ts packages/api/src/index.ts
git commit -m "feat(api): add tax returns and documents endpoints"
```

---

## Task 3: Frontend Types and API Client

**Files:**
- Modify: `packages/web/src/lib/types.ts`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 3.1: Add tax types**

```typescript
// Add to packages/web/src/lib/types.ts

export type FilingStatus = "single" | "married_joint" | "married_separate" | "head_of_household";
export type TaxReturnStatus = "draft" | "complete";

export interface TaxReturn {
  id: string;
  tenantId: string;
  taxYear: number;
  filingStatus: FilingStatus | null;
  status: TaxReturnStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedField {
  value: number;
  line: string;
  verified: boolean;
}

export interface ExtractedData {
  confidence: number;
  fields: Record<string, ExtractedField>;
}

export interface TaxDocument {
  id: string;
  taxReturnId: string;
  documentType: string;
  extractedData: ExtractedData | null;
  extractedAt: string | null;
  createdAt: string;
}
```

- [ ] **Step 3.2: Add tax API methods**

```typescript
// Add to packages/web/src/lib/api.ts (inside the api object)

  // Tax
  getTaxReturns: () =>
    request<{ returns: TaxReturn[] }>("/tax/returns"),

  getTaxReturn: (id: string) =>
    request<{ taxReturn: TaxReturn; documents: TaxDocument[] }>(`/tax/returns/${id}`),

  createTaxReturn: (taxYear: number, filingStatus?: FilingStatus) =>
    request<{ taxReturn: TaxReturn }>("/tax/returns", {
      method: "POST",
      body: JSON.stringify({ taxYear, filingStatus }),
    }),

  addTaxDocument: (taxReturnId: string, documentType: string, extractedData: ExtractedData) =>
    request<{ document: TaxDocument }>(`/tax/returns/${taxReturnId}/documents`, {
      method: "POST",
      body: JSON.stringify({ documentType, extractedData }),
    }),

  updateTaxDocument: (id: string, extractedData: ExtractedData) =>
    request<{ document: TaxDocument }>(`/tax/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ extractedData }),
    }),

  deleteTaxDocument: (id: string) =>
    request<{ success: boolean }>(`/tax/documents/${id}`, { method: "DELETE" }),
```

- [ ] **Step 3.3: Add imports for new types in api.ts**

Update the import at the top of `api.ts`:

```typescript
import type { Plan, PlanType, PlanStatus, PlanEdit, ChatThread, Message, TaxReturn, TaxDocument, ExtractedData, FilingStatus } from "./types.js";
```

- [ ] **Step 3.4: Commit**

```bash
git add packages/web/src/lib/types.ts packages/web/src/lib/api.ts
git commit -m "feat(web): add tax types and API methods"
```

---

## Task 4: Install OCR Dependencies

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 4.1: Add pdf.js and tesseract.js**

Run: `cd packages/web && pnpm add pdfjs-dist tesseract.js`

- [ ] **Step 4.2: Verify installation**

Run: `pnpm list pdfjs-dist tesseract.js`

Expected: Both packages listed with versions

- [ ] **Step 4.3: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml
git commit -m "deps(web): add pdfjs-dist and tesseract.js for OCR"
```

---

## Task 5: OCR Types and Form 1040 Template

**Files:**
- Create: `packages/web/src/lib/ocr/types.ts`
- Create: `packages/web/src/lib/ocr/templates/form1040.ts`

- [ ] **Step 5.1: Create OCR types**

```typescript
// packages/web/src/lib/ocr/types.ts

export interface FieldRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FieldDefinition {
  line: string;
  label: string;
  region: FieldRegion;
  validate?: (value: number) => boolean;
}

export interface FormTemplate {
  formId: string;
  formName: string;
  detectPatterns: RegExp[];
  fields: Record<string, FieldDefinition>;
}

export interface ExtractedFieldResult {
  value: number;
  line: string;
  confidence: number;
  rawText: string;
}

export interface ExtractionResult {
  formId: string;
  confidence: number;
  fields: Record<string, ExtractedFieldResult>;
  errors: string[];
}

export interface ExtractionProgress {
  stage: "loading" | "detecting" | "extracting" | "complete" | "error";
  progress: number; // 0-100
  message: string;
}
```

- [ ] **Step 5.2: Create Form 1040 template**

```typescript
// packages/web/src/lib/ocr/templates/form1040.ts
import type { FormTemplate } from "../types.js";

// Regions based on 2023/2024 Form 1040 layout at 300 DPI
// These will need calibration with real PDFs
export const form1040Template: FormTemplate = {
  formId: "1040",
  formName: "Form 1040 - U.S. Individual Income Tax Return",
  detectPatterns: [
    /Form\s*1040/i,
    /U\.?S\.?\s*Individual\s*Income\s*Tax\s*Return/i,
    /Department\s*of\s*the\s*Treasury/i,
  ],
  fields: {
    // Income section
    wages: {
      line: "1a",
      label: "Wages, salaries, tips",
      region: { page: 1, x: 1650, y: 885, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    taxExemptInterest: {
      line: "2a",
      label: "Tax-exempt interest",
      region: { page: 1, x: 1650, y: 930, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    taxableInterest: {
      line: "2b",
      label: "Taxable interest",
      region: { page: 1, x: 1650, y: 975, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    qualifiedDividends: {
      line: "3a",
      label: "Qualified dividends",
      region: { page: 1, x: 1650, y: 1020, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    ordinaryDividends: {
      line: "3b",
      label: "Ordinary dividends",
      region: { page: 1, x: 1650, y: 1065, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    totalIncome: {
      line: "9",
      label: "Total income",
      region: { page: 1, x: 1650, y: 1380, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    adjustedGrossIncome: {
      line: "11",
      label: "Adjusted gross income",
      region: { page: 1, x: 1650, y: 1470, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    // Deductions
    standardDeduction: {
      line: "12",
      label: "Standard deduction or itemized deductions",
      region: { page: 1, x: 1650, y: 1515, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    taxableIncome: {
      line: "15",
      label: "Taxable income",
      region: { page: 1, x: 1650, y: 1650, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    // Tax and payments
    totalTax: {
      line: "24",
      label: "Total tax",
      region: { page: 2, x: 1650, y: 600, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    totalPayments: {
      line: "33",
      label: "Total payments",
      region: { page: 2, x: 1650, y: 1050, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    refund: {
      line: "35a",
      label: "Refund",
      region: { page: 2, x: 1650, y: 1140, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
    amountOwed: {
      line: "37",
      label: "Amount you owe",
      region: { page: 2, x: 1650, y: 1230, width: 300, height: 45 },
      validate: (v) => v >= 0,
    },
  },
};

export const templates = [form1040Template];
```

- [ ] **Step 5.3: Commit**

```bash
git add packages/web/src/lib/ocr/
git commit -m "feat(ocr): add types and Form 1040 template"
```

---

## Task 6: OCR Extraction Engine

**Files:**
- Create: `packages/web/src/lib/ocr/index.ts`

- [ ] **Step 6.1: Create OCR extraction module**

```typescript
// packages/web/src/lib/ocr/index.ts
import * as pdfjsLib from "pdfjs-dist";
import Tesseract from "tesseract.js";
import { templates } from "./templates/form1040.js";
import type { ExtractionResult, ExtractionProgress, FormTemplate } from "./types.js";

// Configure pdf.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export type ProgressCallback = (progress: ExtractionProgress) => void;

export async function extractFromPdf(
  file: File,
  onProgress?: ProgressCallback
): Promise<ExtractionResult> {
  const errors: string[] = [];

  onProgress?.({ stage: "loading", progress: 5, message: "Loading PDF..." });

  // Load PDF
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  onProgress?.({ stage: "detecting", progress: 15, message: "Detecting form type..." });

  // Render first page for form detection
  const page1 = await pdf.getPage(1);
  const canvas1 = await renderPageToCanvas(page1, 300);

  // Run OCR on full page to detect form type
  const fullPageResult = await Tesseract.recognize(canvas1, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        onProgress?.({
          stage: "detecting",
          progress: 15 + Math.round(m.progress * 20),
          message: "Analyzing document...",
        });
      }
    },
  });

  const fullText = fullPageResult.data.text;

  // Detect which form template matches
  const template = detectFormTemplate(fullText);
  if (!template) {
    return {
      formId: "unknown",
      confidence: 0,
      fields: {},
      errors: ["Could not identify form type. Please upload a Form 1040."],
    };
  }

  onProgress?.({ stage: "extracting", progress: 40, message: `Extracting ${template.formName}...` });

  // Extract fields from regions
  const fields: ExtractionResult["fields"] = {};
  const fieldEntries = Object.entries(template.fields);

  for (let i = 0; i < fieldEntries.length; i++) {
    const [fieldName, fieldDef] = fieldEntries[i];

    onProgress?.({
      stage: "extracting",
      progress: 40 + Math.round((i / fieldEntries.length) * 55),
      message: `Extracting ${fieldDef.label}...`,
    });

    try {
      // Get the correct page
      const pageNum = fieldDef.region.page;
      let canvas: HTMLCanvasElement;

      if (pageNum === 1) {
        canvas = canvas1;
      } else {
        const page = await pdf.getPage(pageNum);
        canvas = await renderPageToCanvas(page, 300);
      }

      // Extract region
      const regionCanvas = extractRegion(canvas, fieldDef.region);

      // OCR the region
      const result = await Tesseract.recognize(regionCanvas, "eng");
      const rawText = result.data.text.trim();
      const numericValue = parseNumericValue(rawText);

      fields[fieldName] = {
        value: numericValue,
        line: fieldDef.line,
        confidence: result.data.confidence,
        rawText,
      };

      // Run validation if defined
      if (fieldDef.validate && !fieldDef.validate(numericValue)) {
        errors.push(`${fieldDef.label} (line ${fieldDef.line}) failed validation`);
      }
    } catch (err) {
      errors.push(`Failed to extract ${fieldDef.label}: ${err}`);
    }
  }

  // Calculate overall confidence
  const confidences = Object.values(fields).map((f) => f.confidence);
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  onProgress?.({ stage: "complete", progress: 100, message: "Extraction complete" });

  return {
    formId: template.formId,
    confidence: Math.round(avgConfidence),
    fields,
    errors,
  };
}

function detectFormTemplate(text: string): FormTemplate | null {
  for (const template of templates) {
    const matchCount = template.detectPatterns.filter((pattern) =>
      pattern.test(text)
    ).length;

    // Require at least 2 pattern matches for confidence
    if (matchCount >= 2) {
      return template;
    }
  }
  return null;
}

async function renderPageToCanvas(
  page: pdfjsLib.PDFPageProxy,
  dpi: number
): Promise<HTMLCanvasElement> {
  const scale = dpi / 72; // PDF default is 72 DPI
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  return canvas;
}

function extractRegion(
  canvas: HTMLCanvasElement,
  region: { x: number; y: number; width: number; height: number }
): HTMLCanvasElement {
  const regionCanvas = document.createElement("canvas");
  regionCanvas.width = region.width;
  regionCanvas.height = region.height;

  const ctx = regionCanvas.getContext("2d")!;
  ctx.drawImage(
    canvas,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height
  );

  return regionCanvas;
}

function parseNumericValue(text: string): number {
  // Remove common OCR artifacts and formatting
  const cleaned = text
    .replace(/[$,\s]/g, "")
    .replace(/[oO]/g, "0") // Common OCR mistake
    .replace(/[lI]/g, "1") // Common OCR mistake
    .replace(/[()]/g, "-"); // Parentheses often mean negative

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
```

- [ ] **Step 6.2: Commit**

```bash
git add packages/web/src/lib/ocr/index.ts
git commit -m "feat(ocr): add PDF extraction engine with tesseract.js"
```

---

## Task 7: Upload UI Components

**Files:**
- Create: `packages/web/src/components/tax/PdfUploader.tsx`
- Create: `packages/web/src/components/tax/ExtractionProgress.tsx`
- Create: `packages/web/src/components/tax/ExtractedFields.tsx`
- Create: `packages/web/src/components/tax/DocumentList.tsx`

- [ ] **Step 7.1: Create PdfUploader component**

```typescript
// packages/web/src/components/tax/PdfUploader.tsx
import { useCallback, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils.js";

interface PdfUploaderProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

export function PdfUploader({ onFileSelect, isProcessing }: PdfUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file?.type === "application/pdf") {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={cn(
        "block w-full py-12 border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-300",
        isDragging
          ? "border-accent bg-accent/5"
          : "border-border hover:border-accent/30 hover:bg-surface-hover",
        isProcessing && "pointer-events-none opacity-50"
      )}
    >
      <input
        type="file"
        accept=".pdf"
        onChange={handleFileInput}
        className="hidden"
        disabled={isProcessing}
      />
      <div className="text-center">
        {isProcessing ? (
          <Loader2 className="w-12 h-12 text-accent mx-auto mb-4 animate-spin" />
        ) : (
          <FileUp className="w-12 h-12 text-text-muted mx-auto mb-4" />
        )}
        <div className="font-medium mb-1">
          {isProcessing ? "Processing..." : "Drop tax documents here"}
        </div>
        <div className="text-sm text-text-muted">
          Supports: Form 1040 (more coming soon)
        </div>
      </div>
    </label>
  );
}
```

- [ ] **Step 7.2: Create ExtractionProgress component**

```typescript
// packages/web/src/components/tax/ExtractionProgress.tsx
import { motion } from "framer-motion";
import type { ExtractionProgress as ProgressType } from "../../lib/ocr/types.js";

interface ExtractionProgressProps {
  progress: ProgressType;
}

export function ExtractionProgress({ progress }: ExtractionProgressProps) {
  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium">{progress.message}</span>
        <span className="text-sm text-text-muted">{progress.progress}%</span>
      </div>
      <div className="h-2 bg-surface-solid rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-accent to-accent-dim"
          initial={{ width: 0 }}
          animate={{ width: `${progress.progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 7.3: Create ExtractedFields component**

```typescript
// packages/web/src/components/tax/ExtractedFields.tsx
import { useState } from "react";
import { Check, AlertTriangle, Pencil } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils.js";
import type { ExtractedData } from "../../lib/types.js";

interface ExtractedFieldsProps {
  data: ExtractedData;
  onUpdate: (data: ExtractedData) => void;
}

export function ExtractedFields({ data, onUpdate }: ExtractedFieldsProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleEdit = (fieldName: string) => {
    setEditingField(fieldName);
    setEditValue(data.fields[fieldName].value.toString());
  };

  const handleSave = (fieldName: string) => {
    const newValue = parseFloat(editValue);
    if (!isNaN(newValue)) {
      onUpdate({
        ...data,
        fields: {
          ...data.fields,
          [fieldName]: {
            ...data.fields[fieldName],
            value: newValue,
            verified: true,
          },
        },
      });
    }
    setEditingField(null);
  };

  const handleVerify = (fieldName: string) => {
    onUpdate({
      ...data,
      fields: {
        ...data.fields,
        [fieldName]: {
          ...data.fields[fieldName],
          verified: true,
        },
      },
    });
  };

  const sortedFields = Object.entries(data.fields).sort((a, b) => {
    // Sort by line number
    const lineA = a[1].line.replace(/[a-z]/g, "");
    const lineB = b[1].line.replace(/[a-z]/g, "");
    return parseInt(lineA) - parseInt(lineB);
  });

  return (
    <div className="glass-card rounded-2xl divide-y divide-border overflow-hidden">
      {sortedFields.map(([fieldName, field], i) => {
        const needsReview = !field.verified && data.confidence < 85;

        return (
          <motion.div
            key={fieldName}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="p-4 flex items-center justify-between hover:bg-surface-hover transition-colors"
          >
            <div className="flex items-center gap-3">
              {field.verified ? (
                <Check className="w-4 h-4 text-success" />
              ) : needsReview ? (
                <AlertTriangle className="w-4 h-4 text-warning" />
              ) : (
                <div className="w-4 h-4" />
              )}
              <div>
                <div className="text-sm font-medium capitalize">
                  {fieldName.replace(/([A-Z])/g, " $1").trim()}
                </div>
                <div className="text-xs text-text-muted">Line {field.line}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {editingField === fieldName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="w-32 px-3 py-1.5 bg-surface-solid border border-border rounded-lg text-sm text-right"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSave(fieldName)}
                    className="px-3 py-1.5 bg-accent text-bg rounded-lg text-sm font-medium"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <>
                  <span className={cn(
                    "font-medium tabular-nums",
                    needsReview && "text-warning"
                  )}>
                    ${field.value.toLocaleString()}
                  </span>
                  <button
                    onClick={() => handleEdit(fieldName)}
                    className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {!field.verified && (
                    <button
                      onClick={() => handleVerify(fieldName)}
                      className="px-2 py-1 text-xs rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors"
                    >
                      Verify
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7.4: Create DocumentList component**

```typescript
// packages/web/src/components/tax/DocumentList.tsx
import { FileText, Check, AlertCircle, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../../lib/utils.js";
import type { TaxDocument } from "../../lib/types.js";

interface DocumentListProps {
  documents: TaxDocument[];
  selectedId: string | null;
  onSelect: (doc: TaxDocument) => void;
  onDelete: (id: string) => void;
}

export function DocumentList({ documents, selectedId, onSelect, onDelete }: DocumentListProps) {
  if (documents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {documents.map((doc, i) => {
        const data = doc.extractedData;
        const confidence = data?.confidence ?? 0;
        const isLowConfidence = confidence < 85;

        return (
          <motion.div
            key={doc.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => onSelect(doc)}
            className={cn(
              "glass-card rounded-xl p-4 cursor-pointer transition-all duration-200",
              selectedId === doc.id
                ? "border-accent bg-accent/5"
                : "hover:bg-surface-hover"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-text-muted" />
                <div>
                  <div className="font-medium text-sm">
                    {formatDocumentType(doc.documentType)}
                  </div>
                  <div className="text-xs text-text-muted">
                    {doc.extractedAt
                      ? new Date(doc.extractedAt).toLocaleDateString()
                      : "Processing..."}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {data && (
                  <div className={cn(
                    "flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full",
                    isLowConfidence
                      ? "bg-warning/10 text-warning"
                      : "bg-success/10 text-success"
                  )}>
                    {isLowConfidence ? (
                      <AlertCircle className="w-3 h-3" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                    {confidence}%
                  </div>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(doc.id);
                  }}
                  className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function formatDocumentType(type: string): string {
  const names: Record<string, string> = {
    "1040": "Form 1040",
    "schedule_d": "Schedule D",
    "w2": "W-2",
    "1099_div": "1099-DIV",
    "1099_int": "1099-INT",
  };
  return names[type] || type;
}
```

- [ ] **Step 7.5: Commit**

```bash
git add packages/web/src/components/tax/
git commit -m "feat(web): add tax document upload UI components"
```

---

## Task 8: Update Tax History Page

**Files:**
- Modify: `packages/web/src/pages/tax-strategy.tsx`
- Modify: `packages/web/src/components/layout/sidebar.tsx`

- [ ] **Step 8.1: Rename sidebar tab**

In `packages/web/src/components/layout/sidebar.tsx`, find and update:

```typescript
// Change this line in fixedTabs array
{ id: 'tax-strategy', name: 'Tax Strategy', icon: Receipt, path: '/tax-strategy' },
// To:
{ id: 'tax-history', name: 'Tax History', icon: Receipt, path: '/tax-history' },
```

- [ ] **Step 8.2: Rewrite tax-strategy.tsx as tax-history**

```typescript
// packages/web/src/pages/tax-strategy.tsx
import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Receipt, Plus } from "lucide-react";
import { Section } from "../components/common/section.js";
import { StatCard } from "../components/common/stat-card.js";
import { Button } from "../components/ui/button.js";
import { PdfUploader } from "../components/tax/PdfUploader.js";
import { ExtractionProgress } from "../components/tax/ExtractionProgress.js";
import { ExtractedFields } from "../components/tax/ExtractedFields.js";
import { DocumentList } from "../components/tax/DocumentList.js";
import { extractFromPdf, type ProgressCallback } from "../lib/ocr/index.js";
import type { ExtractionProgress as ProgressType } from "../lib/ocr/types.js";
import type { TaxReturn, TaxDocument, ExtractedData } from "../lib/types.js";
import { api } from "../lib/api.js";

const CURRENT_TAX_YEAR = new Date().getFullYear() - 1;

export function TaxStrategy() {
  const [taxReturn, setTaxReturn] = useState<TaxReturn | null>(null);
  const [documents, setDocuments] = useState<TaxDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<TaxDocument | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressType | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load or create tax return for current year
  useEffect(() => {
    loadTaxReturn();
  }, []);

  const loadTaxReturn = async () => {
    try {
      const { returns } = await api.getTaxReturns();
      const currentYearReturn = returns.find((r) => r.taxYear === CURRENT_TAX_YEAR);

      if (currentYearReturn) {
        setTaxReturn(currentYearReturn);
        const { documents } = await api.getTaxReturn(currentYearReturn.id);
        setDocuments(documents);
        if (documents.length > 0) {
          setSelectedDoc(documents[0]);
        }
      }
    } catch (err) {
      console.error("Failed to load tax returns:", err);
    }
  };

  const handleFileSelect = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setProgress({ stage: "loading", progress: 0, message: "Starting..." });

    try {
      // Ensure we have a tax return
      let returnId = taxReturn?.id;
      if (!returnId) {
        const { taxReturn: newReturn } = await api.createTaxReturn(CURRENT_TAX_YEAR);
        setTaxReturn(newReturn);
        returnId = newReturn.id;
      }

      // Extract from PDF
      const result = await extractFromPdf(file, setProgress as ProgressCallback);

      if (result.formId === "unknown") {
        setError(result.errors[0] || "Could not identify form type");
        setIsProcessing(false);
        return;
      }

      // Convert to ExtractedData format
      const extractedData: ExtractedData = {
        confidence: result.confidence,
        fields: Object.fromEntries(
          Object.entries(result.fields).map(([key, field]) => [
            key,
            { value: field.value, line: field.line, verified: false },
          ])
        ),
      };

      // Save to API
      const { document } = await api.addTaxDocument(
        returnId,
        result.formId,
        extractedData
      );

      setDocuments((prev) => [...prev, document]);
      setSelectedDoc(document);

      if (result.errors.length > 0) {
        setError(`Extracted with warnings: ${result.errors.join(", ")}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  }, [taxReturn]);

  const handleUpdateDocument = useCallback(async (data: ExtractedData) => {
    if (!selectedDoc) return;

    try {
      const { document } = await api.updateTaxDocument(selectedDoc.id, data);
      setDocuments((prev) =>
        prev.map((d) => (d.id === document.id ? document : d))
      );
      setSelectedDoc(document);
    } catch (err) {
      console.error("Failed to update document:", err);
    }
  }, [selectedDoc]);

  const handleDeleteDocument = useCallback(async (id: string) => {
    try {
      await api.deleteTaxDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (selectedDoc?.id === id) {
        setSelectedDoc(documents.find((d) => d.id !== id) || null);
      }
    } catch (err) {
      console.error("Failed to delete document:", err);
    }
  }, [selectedDoc, documents]);

  // Calculate summary stats from extracted data
  const summaryStats = calculateSummaryStats(documents);

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-medium">
          Tax History
        </h1>
        <p className="text-text-muted mt-2">
          Upload and manage your tax documents
        </p>
      </motion.div>

      {summaryStats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mb-8">
          <StatCard
            label="Adjusted Gross Income"
            value={`$${summaryStats.agi.toLocaleString()}`}
            delay={0}
          />
          <StatCard
            label="Total Tax"
            value={`$${summaryStats.totalTax.toLocaleString()}`}
            delay={0.05}
          />
          <StatCard
            label="Effective Rate"
            value={`${summaryStats.effectiveRate.toFixed(1)}%`}
            status={summaryStats.effectiveRate < 20 ? "success" : "default"}
            delay={0.1}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        {/* Left column: Upload and documents */}
        <div className="space-y-6">
          <Section title={`Tax Year ${CURRENT_TAX_YEAR}`}>
            <PdfUploader
              onFileSelect={handleFileSelect}
              isProcessing={isProcessing}
            />

            {progress && (
              <div className="mt-4">
                <ExtractionProgress progress={progress} />
              </div>
            )}

            {error && (
              <div className="mt-4 p-4 rounded-xl bg-danger/10 border border-danger/20 text-danger text-sm">
                {error}
              </div>
            )}
          </Section>

          {documents.length > 0 && (
            <Section title="Uploaded Documents">
              <DocumentList
                documents={documents}
                selectedId={selectedDoc?.id ?? null}
                onSelect={setSelectedDoc}
                onDelete={handleDeleteDocument}
              />
            </Section>
          )}
        </div>

        {/* Right column: Extracted data */}
        <div>
          {selectedDoc?.extractedData && (
            <Section title="Extracted Data">
              <ExtractedFields
                data={selectedDoc.extractedData}
                onUpdate={handleUpdateDocument}
              />
            </Section>
          )}

          {!selectedDoc && documents.length === 0 && (
            <Section title="Get Started">
              <div className="glass-card rounded-2xl p-8 text-center">
                <Receipt className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <p className="text-text-muted mb-4">
                  Upload your tax return to see extracted data
                </p>
              </div>
            </Section>
          )}
        </div>
      </div>

      {/* CTA for Tax Strategy Plan */}
      {documents.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8"
        >
          <Button className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" />
            Create Tax Strategy Plan
          </Button>
        </motion.div>
      )}
    </div>
  );
}

function calculateSummaryStats(documents: TaxDocument[]) {
  const form1040 = documents.find((d) => d.documentType === "1040");
  if (!form1040?.extractedData) return null;

  const fields = form1040.extractedData.fields;
  const agi = fields.adjustedGrossIncome?.value ?? 0;
  const totalTax = fields.totalTax?.value ?? 0;
  const effectiveRate = agi > 0 ? (totalTax / agi) * 100 : 0;

  return { agi, totalTax, effectiveRate };
}
```

- [ ] **Step 8.3: Update router if path changed**

Check if routing needs to be updated in the main App component. The path `/tax-strategy` may need to stay the same or change to `/tax-history`.

- [ ] **Step 8.4: Commit**

```bash
git add packages/web/src/pages/tax-strategy.tsx packages/web/src/components/layout/sidebar.tsx
git commit -m "feat(web): implement tax history page with PDF upload"
```

---

## Task 9: Integration Test

- [ ] **Step 9.1: Start the application**

Run: `cd /Users/user/Documents/Personal_Projects/lasagna && pnpm dev`

- [ ] **Step 9.2: Test upload flow manually**

1. Navigate to Tax History tab
2. Upload a sample Form 1040 PDF
3. Verify extraction progress displays
4. Verify extracted fields appear
5. Edit a field value
6. Verify changes persist

- [ ] **Step 9.3: Test API endpoints**

```bash
# Create tax return
curl -X POST http://localhost:3001/api/tax/returns \
  -H "Content-Type: application/json" \
  -H "Cookie: <auth_cookie>" \
  -d '{"taxYear": 2024}'

# Get tax returns
curl http://localhost:3001/api/tax/returns \
  -H "Cookie: <auth_cookie>"
```

- [ ] **Step 9.4: Document any calibration needed**

The Form 1040 template regions may need adjustment based on actual PDF testing. Document any coordinate changes needed in a follow-up task.

- [ ] **Step 9.5: Final commit**

```bash
git add -A
git commit -m "test: verify tax extraction end-to-end"
```

---

## Success Criteria Checklist

- [ ] Form 1040 detected from uploaded PDF
- [ ] Key fields extracted: wages, AGI, deductions, total tax
- [ ] Confidence score displayed per document
- [ ] Fields editable with "verify" confirmation
- [ ] Data persists to database
- [ ] Extraction completes in <30 seconds
- [ ] No PDF data sent to server (browser-only extraction)
