import { randomUUID } from "crypto";
import { generateText } from "ai";
import { z } from "zod";
import { getModel } from "../agent/agent.js";
import { uploadFile, deleteFile } from "./gcs.js";
import { extractFormFields } from "./document-ai.js";
import { redactPii } from "./dlp.js";
import { db } from "./db.js";
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

// ── Phase 1: Extract + Redact (no data leaves your GCP project) ──────────

export interface ExtractedDocument {
  extractionId: string;
  fileName: string;
  fileType: string;
  gcsPath: string;
  redactedFields: { key: string; value: string }[];
  rawFieldCount: number;
  redactedFieldCount: number;
}

export async function extractDocument(
  tenantId: string,
  file: File
): Promise<ExtractedDocument> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}. Accepted: PDF, JPEG, PNG, TIFF`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 20MB`);
  }

  const extractionId = randomUUID();
  const buffer = Buffer.from(await file.arrayBuffer());
  let gcsPath: string | null = null;

  try {
    // Step 1: Upload to GCS (stays in your project)
    gcsPath = await uploadFile(tenantId, extractionId, file.name, buffer, file.type);

    // Step 2: Document AI extraction + cleaning (stays in your project)
    const extracted = await extractFormFields(buffer, file.type);

    // Step 3: DLP redaction (stays in your project)
    const redacted = await redactPii(extracted);

    return {
      extractionId,
      fileName: file.name,
      fileType: file.type,
      gcsPath,
      redactedFields: redacted.map((f) => ({ key: f.key, value: f.value })),
      rawFieldCount: extracted.length,
      redactedFieldCount: redacted.length,
    };
  } catch (error) {
    if (gcsPath) await deleteFile(gcsPath);
    throw error;
  }
}

// ── Phase 2: Confirm (sends approved data to LLM, saves to DB) ──────────

export interface ConfirmResult {
  id: string;
  llmFields: Record<string, unknown>;
  llmSummary: string;
  taxYear: number | null;
}

export async function confirmDocument(
  tenantId: string,
  extraction: ExtractedDocument
): Promise<ConfirmResult> {
  const { extractionId, fileName, fileType, gcsPath, redactedFields } = extraction;

  try {
    // Step 4: LLM mapping (this is what goes to OpenRouter → Anthropic)
    const { text: llmText } = await generateText({
      model: getModel(),
      prompt: `You are a tax document data extraction assistant. Given the following key-value pairs extracted from a tax document, return a JSON object (no markdown fencing) with:

1. "fields": A clean structured object with sensible snake_case key names and numeric values where appropriate. Include all financial data points. Include filing_status if you can determine it.
2. "summary": A concise human-readable summary (2-3 sentences) of what this document contains, including document type, tax year, key financial figures.
3. "tax_year": The tax year as a number, or null if not determinable.

Return ONLY the raw JSON object, no markdown code fences.

Extracted data:
${redactedFields.map((f) => `${f.key}: ${f.value}`).join("\n")}`,
    });

    const jsonStr = llmText.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    const llmResult = llmResponseSchema.parse(JSON.parse(jsonStr));

    // Step 5: Insert into database
    const [row] = await db
      .insert(taxDocuments)
      .values({
        id: extractionId,
        tenantId,
        fileName,
        fileType,
        gcsPath,
        rawExtraction: redactedFields,
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
    await deleteFile(gcsPath);
    throw error;
  }
}
