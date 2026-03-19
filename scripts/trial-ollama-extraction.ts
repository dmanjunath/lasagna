import { readFileSync, statSync, existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { resolve, extname, join } from "path";
import { execSync } from "child_process";
import { z } from "zod";

const SUPPORTED_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_PDF_PAGES = 10;
const TIMEOUT_MS = 600_000;
const MODEL = process.env.OLLAMA_MODEL ?? "gemma4:31b";
const OLLAMA_BASE_URL = process.env.OLLAMA_HOST ?? "http://localhost:11434";

const resultSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  summary: z.string(),
  tax_year: z.number().nullable(),
});

function pdfToImages(pdfPath: string): { data: string; mimeType: "image/png" }[] {
  const tmpDir = `/tmp/ollama-extraction-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });

  try {
    const infoOut = execSync(
      `pdfinfo "${pdfPath}" 2>/dev/null | grep "^Pages:" | awk '{print $2}'`,
      { encoding: "utf8" }
    ).trim();
    const totalPages = parseInt(infoOut, 10) || 1;

    if (totalPages > MAX_PDF_PAGES) {
      process.stderr.write(
        `Warning: PDF has ${totalPages} pages. Processing first ${MAX_PDF_PAGES} only.\n`
      );
    }

    const pagesToProcess = Math.min(totalPages, MAX_PDF_PAGES);
    execSync(
      `pdftoppm -png -r 150 -f 1 -l ${pagesToProcess} "${pdfPath}" "${tmpDir}/page"`,
      { stdio: "pipe" }
    );

    const pngFiles = readdirSync(tmpDir).filter(f => f.endsWith(".png")).sort();
    return pngFiles.map(f => ({
      data: readFileSync(join(tmpDir, f)).toString("base64"),
      mimeType: "image/png" as const,
    }));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    process.stderr.write(
      `Usage: tsx scripts/trial-ollama-extraction.ts <file-path>\n` +
      `Env: OLLAMA_HOST (default: ${OLLAMA_BASE_URL}), OLLAMA_MODEL (default: ${MODEL})\n` +
      `Setup: run scripts/ollama-start.sh to start the VM and SSH tunnel first.\n`
    );
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

  // Build image content blocks (OpenAI format — Ollama is OpenAI-compatible)
  type ImageBlock = { type: "image_url"; image_url: { url: string } };
  let imageBlocks: ImageBlock[];

  if (mimeType === "application/pdf") {
    const pages = pdfToImages(absolutePath);
    imageBlocks = pages.map(p => ({
      type: "image_url" as const,
      image_url: { url: `data:${p.mimeType};base64,${p.data}` },
    }));
  } else {
    const data = readFileSync(absolutePath).toString("base64");
    imageBlocks = [{
      type: "image_url" as const,
      image_url: { url: `data:${mimeType};base64,${data}` },
    }];
  }

  const prompt = `You are a tax document data extraction assistant. Given the following tax document image(s), return a JSON object (no markdown fencing) with:

1. "fields": A clean structured object with sensible snake_case key names and numeric values where appropriate. Include all financial data points. Include filing_status if you can determine it.
2. "summary": A concise human-readable summary (2-3 sentences) of what this document contains, including document type, tax year, key financial figures.
3. "tax_year": The tax year as a number, or null if not determinable.

Return ONLY the raw JSON object, no markdown code fences.`;

  const timedOut = Symbol("timedOut");
  let llmText: string;
  try {
    // Use Ollama native /api/chat to support think:false (disables reasoning tokens)
    // Ollama native format: images are base64 strings in a separate "images" array
    const images = imageBlocks.map(b => b.image_url.url.replace(/^data:[^;]+;base64,/, ""));
    const fetchPromise = fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        think: false,
        stream: false,
        options: { num_ctx: 8192 },
        messages: [{
          role: "user",
          content: prompt,
          images,
        }],
      }),
    }).then(async res => {
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      const data = await res.json() as { message: { content: string } };
      return { choices: [{ message: data.message }] };
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(timedOut), TIMEOUT_MS).unref()
    );

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    llmText = response.choices[0]?.message?.content ?? "";
    if (!llmText) {
      process.stderr.write("Error: Empty response from Ollama\n");
      process.exit(1);
    }
  } catch (err) {
    if (err === timedOut) {
      process.stderr.write(`Error: Request timed out after ${TIMEOUT_MS / 1000}s\n`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ECONNREFUSED|fetch failed/i.test(msg)) {
        process.stderr.write(
          `Error: Cannot connect to Ollama at ${OLLAMA_BASE_URL}.\nRun scripts/ollama-start.sh to start the VM and SSH tunnel.\n`
        );
      } else {
        process.stderr.write(`Error: API call failed: ${msg}\n`);
      }
    }
    process.exit(1);
  }

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

  process.stdout.write(JSON.stringify(validated.data) + "\n");
}

main().catch(err => {
  process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
