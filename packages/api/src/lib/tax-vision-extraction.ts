import { execSync } from "child_process";
import { mkdirSync, readFileSync, rmSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { z } from "zod";

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
  model?: string;
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
- DO NOT RETURN ANY PII including name, address, SSN in the output. City, State is okay as is all financial information.
- Each distinct tax form or schedule must be its own array element.
- recommendations should be specific and actionable based on the actual numbers in the documents.

Return ONLY the raw JSON object, no markdown code fences.`;

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
  opts: VisionOpts = {}
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

  const model = opts.model || "google/gemma-4-26b-a4b-it";
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

  const data = await res.json() as { choices: { message: { content: string } }[] };
  const rawText = data.choices?.[0]?.message?.content ?? "";

  console.log("[Vision Extraction] LLM response:", rawText);

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
    throw new Error(`LLM response is not valid JSON. Raw: ${rawText.slice(0, 500)}`);
  }

  const validated = llmResponseSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("[Vision Extraction] Schema validation failed:", JSON.stringify(validated.error.issues, null, 2));
    console.error("[Vision Extraction] Parsed response:", JSON.stringify(parsed, null, 2));
    throw new Error(
      `LLM response failed schema validation: ${JSON.stringify(validated.error.issues)}`
    );
  }

  console.log(`[Vision Extraction] Extracted ${validated.data.documents.length} documents from ${validated.data.numberOfPages} pages`);

  return validated.data;
}
