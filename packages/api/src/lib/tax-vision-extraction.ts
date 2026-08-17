import { execSync } from "child_process";
import { mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { z } from "zod";
import { logLlmUsage } from "./activity.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const SUPPORTED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];

const documentSchema = z.object({
  type: z.string(),
  year: z.number().nullable(),
  fields: z.record(z.string(), z.unknown()),
  description: z.string(),
});

const llmResponseSchema = z.object({
  numberOfPages: z.number(),
  documents: z.array(documentSchema),
  recommendations: z.array(z.string()),
});

export type ExtractedDocument = z.infer<typeof documentSchema>;
export type VisionExtractionResponse = z.infer<typeof llmResponseSchema>;

// Keep the old type for DB compatibility
export interface VisionExtractionResult {
  fields: Record<string, unknown>;
  summary: string;
  tax_year: number | null;
}

interface VisionOpts {
  apiKey?: string;
  model: string;
  /** For usage metering — the extraction is attributed to this tenant. */
  tenantId?: string | null;
}

const EXTRACTION_PROMPT = `You are a tax document data extraction assistant. Given the following tax document image(s), return a JSON object (no markdown fencing) with this exact structure:

{
  "numberOfPages": <number of pages you received>,
  "documents": [
    {
      "type": "<form type, e.g. '1040', 'Schedule C', 'Schedule D', 'W-2', '1099-MISC', '1120S', 'K-1'>",
      "year": <tax year as number, or null if unknown>,
      "fields": { <snake_case keys, numeric values where appropriate, all financial data points> },
      "description": "<2-3 sentence summary: form type, tax year, key figures. e.g. 'Schedule C for 2024, showing $120k gross receipts, $45k expenses, $75k net profit from consulting business.'>"
    }
  ],
  "recommendations": [
    "<actionable tax optimization suggestion based on the data, e.g. 'Consider maxing out 401(k) contributions to reduce taxable income by $23,500'>"
  ]
}

Each distinct tax form or schedule in the PDF should be its own element in the "documents" array.
A single-form document should have 1 element. A PDF with a 1040, Schedule C, and Schedule D should have 3 elements.

IMPORTANT:
- DO NOT RETURN ANY PII. Never include a name, street address, ZIP or postal code, SSN, EIN, bank or brokerage account number, routing number, phone number, or email. City and State are okay, as is all financial information.
- Each distinct tax form or schedule must be its own array element.
- recommendations should be specific and actionable based on the actual numbers in the documents.

Return ONLY the raw JSON object, no markdown code fences.`;

// Gemini returned a ZIP code even with the prompt forbidding PII, so the
// prompt alone is not a control. Drop any field whose key names an identifier
// rather than a figure. `name` matters most: it is the likeliest thing to come
// back (employee_name, spouse_name) and the thing we promise not to store.
const PII_KEY_RE =
  /(^|_)(name|names|zip|zipcode|postal|postcode|ssn|social|tin|ein|taxpayer_id|dob|birth|street|address|addr|phone|fax|email|account_number|routing)($|_)/i;

/**
 * `fields` is an open record, so the model can nest objects and arrays
 * (`{"payer": {"name": ..., "ein": ...}}`). Filtering only the top level would
 * copy that block through untouched, so this walks the whole value.
 */
function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !PII_KEY_RE.test(key))
        .map(([key, nested]) => [key, scrubValue(nested)])
    );
  }
  return value;
}

export function stripPiiFields(fields: Record<string, unknown>): Record<string, unknown> {
  return scrubValue(fields) as Record<string, unknown>;
}

/**
 * The summary is free prose, so keys cannot be filtered. Government id numbers
 * have fixed shapes, so redact those at least. Names in prose still rely on the
 * prompt, which is why the stored fields are the stronger guarantee.
 */
const ID_NUMBER_RE = /\b(\d{3}-\d{2}-\d{4}|\d{2}-\d{7})\b/g;

export function redactIdNumbers(text: string): string {
  return text.replace(ID_NUMBER_RE, "[redacted]");
}

function pdfToBase64Images(pdfBuffer: Buffer): string[] {
  const tmpDir = join(tmpdir(), `tax-extraction-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    const pdfPath = join(tmpDir, "input.pdf");
    writeFileSync(pdfPath, pdfBuffer);

    execSync(
      `pdftoppm -png -r 150 -f 1 "${pdfPath}" "${tmpDir}/page"`,
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
  opts: VisionOpts
): Promise<VisionExtractionResponse> {
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

  const model = opts.model;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  console.log(`[Vision Extraction] Sending ${images.length} images to ${model} at ${providerUrl}`);

  const res = await fetch(providerUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 16384,
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

  const data = await res.json() as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  logLlmUsage({
    tenantId: opts.tenantId ?? null,
    source: "tax-vision",
    model,
    inputTokens: data.usage?.prompt_tokens,
    outputTokens: data.usage?.completion_tokens,
  });
  const rawText = data.choices?.[0]?.message?.content ?? "";

  console.log(`[Vision Extraction] response received (${rawText.length} chars)`);

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
    throw new Error("LLM response is not valid JSON.");
  }

  const validated = llmResponseSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[Vision Extraction] Schema validation failed:", JSON.stringify(validated.error.issues, null, 2));
    throw new Error(
      `LLM response failed schema validation: ${JSON.stringify(validated.error.issues)}`
    );
  }

  console.log(`[Vision Extraction] Extracted ${validated.data.documents.length} documents from ${validated.data.numberOfPages} pages`);

  return {
    ...validated.data,
    documents: validated.data.documents.map((doc) => ({
      ...doc,
      fields: stripPiiFields(doc.fields),
      description: redactIdNumbers(doc.description),
    })),
    recommendations: validated.data.recommendations.map(redactIdNumbers),
  };
}
