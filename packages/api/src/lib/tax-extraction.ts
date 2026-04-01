import { randomUUID } from "crypto";
import { generateObject } from "ai";
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
