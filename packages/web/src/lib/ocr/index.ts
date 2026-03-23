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
  const scale = dpi / 72;
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
  const cleaned = text
    .replace(/[$,\s]/g, "")
    .replace(/[oO]/g, "0")
    .replace(/[lI]/g, "1")
    .replace(/[()]/g, "-");

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
