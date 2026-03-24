import type { ExtractionResult, ExtractionProgress } from "./types.js";

export type ProgressCallback = (progress: ExtractionProgress) => void;

const EXTRACTOR_URL = import.meta.env.VITE_EXTRACTOR_URL || "http://localhost:8000";

export async function extractFromPdf(
  file: File,
  onProgress?: ProgressCallback
): Promise<ExtractionResult> {
  onProgress?.({ stage: "loading", progress: 10, message: "Uploading PDF..." });

  const formData = new FormData();
  formData.append("file", file);

  try {
    onProgress?.({ stage: "extracting", progress: 30, message: "Processing with AI..." });

    const response = await fetch(`${EXTRACTOR_URL}/extract`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || "Extraction failed");
    }

    const result = await response.json();

    onProgress?.({ stage: "complete", progress: 100, message: "Extraction complete" });

    return result;
  } catch (error) {
    onProgress?.({ stage: "complete", progress: 100, message: "Extraction failed" });

    return {
      formId: "unknown",
      confidence: 0,
      fields: {},
      errors: [error instanceof Error ? error.message : "Extraction failed"],
    };
  }
}
