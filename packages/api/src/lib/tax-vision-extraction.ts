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
