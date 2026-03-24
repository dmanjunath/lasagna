import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import { templates } from "./templates/form1040.js";
import type { ExtractionResult, ExtractionProgress, FormTemplate } from "./types.js";

// Configure pdf.js worker
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export type ProgressCallback = (progress: ExtractionProgress) => void;

export async function extractFromPdf(
  file: File,
  onProgress?: ProgressCallback
): Promise<ExtractionResult> {
  const errors: string[] = [];

  onProgress?.({ stage: "loading", progress: 10, message: "Loading PDF..." });

  // Load PDF
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  onProgress?.({ stage: "detecting", progress: 20, message: "Extracting text..." });

  // Extract text from all pages
  const allText: string[] = [];
  const textByPage: Map<number, Array<{ text: string; x: number; y: number }>> = new Map();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageItems: Array<{ text: string; x: number; y: number }> = [];

    for (const item of textContent.items) {
      if ("str" in item) {
        const textItem = item as TextItem;
        allText.push(textItem.str);
        pageItems.push({
          text: textItem.str,
          x: textItem.transform[4],
          y: textItem.transform[5],
        });
      }
    }
    textByPage.set(pageNum, pageItems);

    onProgress?.({
      stage: "detecting",
      progress: 20 + Math.round((pageNum / pdf.numPages) * 20),
      message: `Reading page ${pageNum}...`,
    });
  }

  const fullText = allText.join(" ");

  onProgress?.({ stage: "detecting", progress: 45, message: "Detecting form type..." });

  // Detect form type
  const template = detectFormTemplate(fullText);
  if (!template) {
    return {
      formId: "unknown",
      confidence: 0,
      fields: {},
      errors: ["Could not identify form type. Please upload a Form 1040."],
    };
  }

  onProgress?.({ stage: "extracting", progress: 50, message: `Extracting ${template.formName}...` });

  // Extract fields using text patterns
  const fields: ExtractionResult["fields"] = {};
  const fieldEntries = Object.entries(template.fields);

  for (let i = 0; i < fieldEntries.length; i++) {
    const [fieldName, fieldDef] = fieldEntries[i];

    onProgress?.({
      stage: "extracting",
      progress: 50 + Math.round((i / fieldEntries.length) * 45),
      message: `Extracting ${fieldDef.label}...`,
    });

    try {
      // Use pattern-based extraction from text
      const value = extractFieldValue(fullText, fieldDef.line, fieldDef.label);

      fields[fieldName] = {
        value,
        line: fieldDef.line,
        confidence: value !== 0 ? 90 : 50,
        rawText: value.toString(),
      };
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

    if (matchCount >= 2) {
      return template;
    }
  }
  return null;
}

/**
 * Extract a numeric value for a specific line from the text.
 * Uses multiple strategies to find the value.
 */
function extractFieldValue(text: string, line: string, label: string): number {
  // Normalize text
  const normalized = text.replace(/\s+/g, " ");

  // Strategy 1: Look for "Line X" followed by a number
  const linePatterns = [
    new RegExp(`Line\\s*${line}[^0-9]*([\\d,]+(?:\\.\\d{2})?)`, "i"),
    new RegExp(`${line}[a-z]?[\\s.]+[^0-9]*([\\d,]+(?:\\.\\d{2})?)`, "i"),
  ];

  for (const pattern of linePatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const value = parseNumericValue(match[1]);
      if (value > 0) return value;
    }
  }

  // Strategy 2: Look for the label followed by a number
  const labelWords = label.split(/\s+/).slice(0, 3).join("\\s+");
  const labelPattern = new RegExp(`${labelWords}[^0-9]*([\\d,]+(?:\\.\\d{2})?)`, "i");
  const labelMatch = normalized.match(labelPattern);
  if (labelMatch) {
    const value = parseNumericValue(labelMatch[1]);
    if (value > 0) return value;
  }

  // Strategy 3: For specific common fields, use targeted patterns
  const specificPatterns: Record<string, RegExp[]> = {
    wages: [
      /wages.*?salaries.*?tips.*?([0-9,]+)/i,
      /1a[.\s]+([0-9,]+)/i,
    ],
    totalIncome: [
      /total\s+income.*?([0-9,]+)/i,
      /line\s*9[.\s]+([0-9,]+)/i,
    ],
    adjustedGrossIncome: [
      /adjusted\s+gross\s+income.*?([0-9,]+)/i,
      /AGI.*?([0-9,]+)/i,
      /line\s*11[.\s]+([0-9,]+)/i,
    ],
    totalTax: [
      /total\s+tax[.\s]+([0-9,]+)/i,
      /line\s*24[.\s]+([0-9,]+)/i,
    ],
    taxableIncome: [
      /taxable\s+income[.\s]+([0-9,]+)/i,
      /line\s*15[.\s]+([0-9,]+)/i,
    ],
    standardDeduction: [
      /standard\s+deduction.*?([0-9,]+)/i,
      /itemized\s+deduction.*?([0-9,]+)/i,
      /line\s*12[.\s]+([0-9,]+)/i,
    ],
  };

  const fieldKey = Object.keys(specificPatterns).find(
    (key) => label.toLowerCase().includes(key.toLowerCase().replace(/([A-Z])/g, " $1").trim())
  );

  if (fieldKey && specificPatterns[fieldKey]) {
    for (const pattern of specificPatterns[fieldKey]) {
      const match = normalized.match(pattern);
      if (match) {
        const value = parseNumericValue(match[1]);
        if (value > 0) return value;
      }
    }
  }

  return 0;
}

function parseNumericValue(text: string): number {
  if (!text) return 0;

  const cleaned = text
    .replace(/[$,\s]/g, "")
    .replace(/[oO]/g, "0")
    .replace(/[lI]/g, "1")
    .replace(/[()]/g, "-");

  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}
