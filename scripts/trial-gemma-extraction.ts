import { readFileSync, statSync, existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { resolve, extname, join } from "path";
import { execSync } from "child_process";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { z } from "zod";

const SUPPORTED_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_PDF_PAGES = 10;
const TIMEOUT_MS = 120_000;

const resultSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  summary: z.string(),
  tax_year: z.number().nullable(),
});

// Render PDF pages to PNG buffers using pdftoppm (poppler)
function pdfToImages(pdfPath: string): { data: Buffer; mimeType: "image/png" }[] {
  const tmpDir = `/tmp/gemma-extraction-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Get page count
    const infoOut = execSync(`pdfinfo "${pdfPath}" 2>/dev/null | grep "^Pages:" | awk '{print $2}'`, { encoding: "utf8" }).trim();
    const totalPages = parseInt(infoOut, 10) || 1;

    if (totalPages > MAX_PDF_PAGES) {
      process.stderr.write(`Warning: PDF has ${totalPages} pages. Processing first ${MAX_PDF_PAGES} only.\n`);
    }

    const pagesToProcess = Math.min(totalPages, MAX_PDF_PAGES);

    // Render pages to PNG at 150 DPI
    execSync(`pdftoppm -png -r 150 -f 1 -l ${pagesToProcess} "${pdfPath}" "${tmpDir}/page"`, { stdio: "pipe" });

    const pngFiles = readdirSync(tmpDir).filter(f => f.endsWith(".png")).sort();
    return pngFiles.map(f => ({ data: readFileSync(join(tmpDir, f)), mimeType: "image/png" as const }));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    process.stderr.write("Usage: tsx scripts/trial-gemma-extraction.ts <file-path>\n");
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    process.stderr.write("Error: OPENROUTER_API_KEY environment variable is required\n");
    process.exit(1);
  }

  const absolutePath = resolve(filePath);
  if (!existsSync(absolutePath)) {
    process.stderr.write(`Error: File not found: ${absolutePath}\n`);
    process.exit(1);
  }

  const ext = extname(absolutePath).toLowerCase();
  const mimeType = SUPPORTED_TYPES[ext];
  if (!mimeType) {
    process.stderr.write(
      `Error: Unsupported file type "${ext}". Supported: ${Object.keys(SUPPORTED_TYPES).join(", ")}\n`
    );
    process.exit(1);
  }

  const stats = statSync(absolutePath);
  if (stats.size > MAX_FILE_SIZE) {
    process.stderr.write(
      `Error: File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Max: 20MB\n`
    );
    process.exit(1);
  }

  // Build image content blocks
  let imageBlocks: { type: "image"; image: Buffer; mimeType: "image/png" | "image/jpeg" }[];

  if (mimeType === "application/pdf") {
    const pages = pdfToImages(absolutePath);
    imageBlocks = pages.map(p => ({ type: "image" as const, image: p.data, mimeType: p.mimeType }));
  } else {
    imageBlocks = [{ type: "image" as const, image: readFileSync(absolutePath), mimeType: mimeType as "image/png" | "image/jpeg" }];
  }

  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter("google/gemma-4-26b-a4b-it");

  let llmText: string;
  try {
    const result = await generateText({
      model,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: `You are a tax document data extraction assistant. Given the following tax document image(s), return a JSON object (no markdown fencing) with:

1. "fields": A clean structured object with sensible snake_case key names and numeric values where appropriate. Include all financial data points. Include filing_status if you can determine it.
2. "summary": A concise human-readable summary (2-3 sentences) of what this document contains, including document type, tax year, key financial figures.
3. "tax_year": The tax year as a number, or null if not determinable.

Return ONLY the raw JSON object, no markdown code fences.`,
            },
          ],
        },
      ],
    });
    llmText = result.text;
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      process.stderr.write(`Error: Request timed out after ${TIMEOUT_MS / 1000}s\n`);
    } else {
      process.stderr.write(`Error: API call failed: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exit(1);
  }

  // Strip markdown fences if model ignores instructions
  const jsonStr = llmText
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    process.stderr.write(`Error: Response is not valid JSON.\nRaw response:\n${llmText}\n`);
    process.exit(1);
  }

  const validated = resultSchema.safeParse(parsed);
  if (!validated.success) {
    process.stderr.write(
      `Error: Response failed schema validation:\n${JSON.stringify(validated.error.issues, null, 2)}\nRaw response:\n${llmText}\n`
    );
    process.exit(1);
  }

  // Compact JSON to stdout — safe to pipe/append to .ndjson
  process.stdout.write(JSON.stringify(validated.data) + "\n");
}

main().catch((err) => {
  process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
