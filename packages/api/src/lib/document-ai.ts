import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

const PROJECT_ID = "lasagna-prod";
const LOCATION = "us";
const PROCESSOR_ID = "2a4ce4b54806000e";

let _client: DocumentProcessorServiceClient | null = null;

function getClient() {
  if (!_client) {
    _client = new DocumentProcessorServiceClient({
      apiEndpoint: `${LOCATION}-documentai.googleapis.com`,
    });
  }
  return _client;
}

const PII_KEY_PATTERNS = [
  /social security/i,
  /\bssn\b/i,
  /first name/i,
  /last name/i,
  /middle initial/i,
  /spouse.*name/i,
  /full name/i,
  /\baddress\b/i,
  /city.*town/i,
  /foreign country/i,
  /foreign province/i,
  /foreign postal/i,
  /zip code/i,
  /deceased/i,
  /date of birth/i,
];

const NOISE_VALUES = new Set(["", "\u2610", "\u2611", "\u2713", "\u2717", "\u25A1"]);

interface ExtractedField {
  key: string;
  value: string;
  confidence: number;
}

export async function extractFormFields(
  buffer: Buffer,
  mimeType: string
): Promise<ExtractedField[]> {
  const processorName = `projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;

  const [result] = await getClient().processDocument({
    name: processorName,
    rawDocument: { content: buffer.toString("base64"), mimeType },
  });

  const document = result.document;
  if (!document?.text || !document.pages) return [];

  const raw: ExtractedField[] = [];
  for (const page of document.pages) {
    for (const field of page.formFields || []) {
      const key = textFromLayout(field.fieldName, document.text);
      const value = textFromLayout(field.fieldValue, document.text);
      const confidence = field.fieldValue?.confidence ?? 0;
      if (key || value) {
        raw.push({ key, value, confidence });
      }
    }
  }

  return cleanFields(raw);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textFromLayout(layout: any, fullText: string): string {
  if (!layout?.textAnchor?.textSegments) return "";
  return layout.textAnchor.textSegments
    .map((seg: { startIndex?: string; endIndex?: string }) => {
      const start = parseInt(seg.startIndex || "0", 10);
      const end = parseInt(seg.endIndex || "0", 10);
      return fullText.slice(start, end);
    })
    .join("")
    .trim();
}

function cleanFields(fields: ExtractedField[]): ExtractedField[] {
  const cleaned: ExtractedField[] = [];
  const seen = new Set<string>();

  for (const f of fields) {
    const key = cleanKey(f.key);
    const value = cleanValue(f.value);

    if (NOISE_VALUES.has(value)) continue;
    if (isPiiKey(key)) continue;
    if (!key || key.length <= 1) continue;
    if (f.confidence < 0.5) continue;

    const dedup = key.toLowerCase();
    if (seen.has(dedup)) continue;
    seen.add(dedup);

    cleaned.push({ key, value, confidence: f.confidence });
  }

  return cleaned;
}

function cleanKey(key: string): string {
  return key
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\d+[a-z]?\s+/, "")
    .replace(/\s+\d+[a-z]?$/, "");
}

function cleanValue(value: string): string {
  let v = value.replace(/\s+/g, " ").trim();
  if (/^[\d ,.\-]+$/.test(v)) {
    v = v.replace(/(?<=\d)\s+(?=\d)/g, "");
  }
  return v;
}

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((p) => p.test(key));
}
