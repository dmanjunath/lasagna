export interface ExtractedField {
  value: number;
  line: string;
  verified: boolean;
}

export interface ExtractionResult {
  formId: string;
  confidence: number;
  fields: Record<string, ExtractedField>;
  errors: string[];
}

export interface ExtractionProgress {
  stage: "loading" | "detecting" | "extracting" | "complete" | "error";
  progress: number;
  message: string;
}
