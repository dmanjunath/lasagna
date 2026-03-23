export interface FieldRegion {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FieldDefinition {
  line: string;
  label: string;
  region: FieldRegion;
  validate?: (value: number) => boolean;
}

export interface FormTemplate {
  formId: string;
  formName: string;
  detectPatterns: RegExp[];
  fields: Record<string, FieldDefinition>;
}

export interface ExtractedFieldResult {
  value: number;
  line: string;
  confidence: number;
  rawText: string;
}

export interface ExtractionResult {
  formId: string;
  confidence: number;
  fields: Record<string, ExtractedFieldResult>;
  errors: string[];
}

export interface ExtractionProgress {
  stage: "loading" | "detecting" | "extracting" | "complete" | "error";
  progress: number;
  message: string;
}
