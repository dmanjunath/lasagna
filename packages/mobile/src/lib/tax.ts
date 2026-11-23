import { HIDDEN_AMOUNT, isAmountsHidden } from "./hide-amounts";

// The Tax page's rules, ported from packages/web/src/pages/tax-strategy.tsx:
// how a document is named from its extraction, its row's one line of summary,
// the extracted fields' labels and values, the year groups and the sort.

export interface TaxDocumentSummary {
  id: string;
  fileName: string;
  llmFields: Record<string, unknown> | null;
  llmSummary: string;
  taxYear: number | null;
  createdAt: string;
}

export interface TaxDocument extends TaxDocumentSummary {
  fileType: string;
}

export const FILING_LABELS: Record<string, string> = {
  single: "Single",
  married_joint: "Married filing jointly",
  married_separate: "Married filing separately",
  head_of_household: "Head of household",
};

/**
 * The tax year a person is working on: last year's return until the April
 * deadline, this year's after it. The web said "2025 filing year" in November
 * 2026 (audit W-28).
 */
export function currentTaxYear(now: Date = new Date()): number {
  const y = now.getFullYear();
  const deadline = new Date(y, 3, 16);
  return now < deadline ? y - 1 : y;
}

const FORM_LABELS: Record<string, string> = {
  "1040": "Form 1040: Individual Tax Return",
  "1040-sr": "Form 1040-SR: Senior Tax Return",
  "w-2": "W-2: Wage & Tax Statement",
  w2: "W-2: Wage & Tax Statement",
  "1099-misc": "1099-MISC: Miscellaneous Income",
  "1099-nec": "1099-NEC: Non-Employee Compensation",
  "1099-int": "1099-INT: Interest Income",
  "1099-div": "1099-DIV: Dividend Income",
  "1099-b": "1099-B: Proceeds from Broker",
  "1099-r": "1099-R: Retirement Distributions",
  "1099-g": "1099-G: Government Payments",
  "1099-k": "1099-K: Payment Card Transactions",
  "1099-sa": "1099-SA: HSA Distributions",
  "1098": "1098: Mortgage Interest",
  "1098-t": "1098-T: Tuition Statement",
  "1098-e": "1098-E: Student Loan Interest",
  "1120": "Form 1120: Corporate Tax Return",
  "1120s": "Form 1120S: S-Corp Tax Return",
  "1120-s": "Form 1120S: S-Corp Tax Return",
  "1065": "Form 1065: Partnership Return",
  "k-1": "Schedule K-1: Partner/Shareholder Income",
  "schedule k-1": "Schedule K-1: Partner/Shareholder Income",
  "5498": "5498: IRA Contribution Info",
};

function extractFormType(fields: Record<string, unknown> | null | undefined): string | null {
  if (!fields || typeof fields !== "object") return null;
  for (const k of ["document_type", "form_type", "documentType", "formType", "type", "form"]) {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (typeof fields.fields === "object" && fields.fields !== null) return extractFormType(fields.fields as Record<string, unknown>);
  return null;
}

function extractFormTypeFromSummary(summary: string): string | null {
  if (!summary) return null;
  const patterns = [
    /\b(Form\s+\d{4}[A-Z]?(?:-[A-Z]+)?)\b/i,
    /\b(W-?2)\b/i,
    // Anchored, and never a calendar year, so prose figures never become the title.
    /^\s*(?!19\d{2}|20\d{2})(\d{4}[A-Z]?(?:-[A-Z]+)?)\s+(?:\b(?:for|showing|tax)\b|[—–])/i,
    /\b(Schedule\s+K-1)\b/i,
    /\b(1099-[A-Z]+)\b/i,
    /\b(1098-?[A-Z]?)\b/i,
  ];
  for (const re of patterns) {
    const m = summary.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

/** The API's filename for a typed description. It never reaches the screen. */
const MANUAL_ENTRY = "manual-entry";

export function hasRealFile(doc: { fileName: string }): boolean {
  return Boolean(doc.fileName) && doc.fileName !== MANUAL_ENTRY;
}

/** A document's name: its form, else its summary's first sentence, else its filename. `isFormName`: it names a tax form. */
export function docLabel(doc: Pick<TaxDocumentSummary, "llmFields" | "llmSummary" | "fileName">): { label: string; isFormName: boolean } {
  const raw = extractFormType(doc.llmFields);
  if (raw) {
    const key = raw.toLowerCase().replace(/\s+/g, "").replace("form", "");
    return { label: FORM_LABELS[raw.toLowerCase().trim()] || FORM_LABELS[key] || raw, isFormName: true };
  }
  const fromSummary = extractFormTypeFromSummary(doc.llmSummary);
  if (fromSummary) return { label: FORM_LABELS[fromSummary.toLowerCase().trim()] || fromSummary, isFormName: true };
  if (doc.llmSummary) {
    const first = doc.llmSummary.split(/[.!]\s/)[0];
    if (first && first.length < 80) return { label: first, isFormName: false };
  }
  const noExt = doc.fileName.replace(/\.[^.]+$/, "");
  if (!noExt || noExt === MANUAL_ENTRY) return { label: "Typed description", isFormName: false };
  return { label: noExt, isFormName: false };
}

/** The row's line under the name: the summary without the words the name already says, or null. */
export function summarySubtitle(summary: string, label: string, isFormName: boolean): string | null {
  let s = summary.trim();
  if (!s) return null;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.toLowerCase().startsWith(label.toLowerCase())) s = s.slice(label.length).replace(/^[\s.,:;)\]\-—–]+/, "");
  else if (norm(s).startsWith(norm(label))) return null;
  if (!s) return null;
  if (!isFormName) return s.charAt(0).toUpperCase() + s.slice(1);
  s = s.replace(/^(?:[A-Za-z0-9][\w./()-]*[ ]){0,4}for\s+(?:the\s+)?(?:19|20)\d{2}(?:\s+tax\s+year)?\s*[.,]?\s+(?!and\b|or\b|but\b)/i, "");
  s = s.replace(/^(?:show(?:s|ing)|report(?:s|ing)|claim(?:s|ing)|list(?:s|ing)|calculat(?:es|ing)|detail(?:s|ing))\s+/i, "");
  if (!s || /^(?:for\s+)?(?:the\s+)?(?:19|20)\d{2}[.\s]*$/i.test(s)) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The row's second line: the summary's news, or the filename when it says more than the name. */
export function docSubtitle(doc: TaxDocumentSummary): string | null {
  const { label, isFormName } = docLabel(doc);
  const line = summarySubtitle(doc.llmSummary?.trim() ?? "", label, isFormName);
  if (line) return line;
  return hasRealFile(doc) && doc.fileName.replace(/\.[^.]+$/, "") !== label ? doc.fileName : null;
}

const ACRONYMS: Record<string, string> = {
  agi: "AGI", magi: "MAGI", ein: "EIN", ssn: "SSN", itin: "ITIN", tin: "TIN", w2: "W-2", w4: "W-4", fica: "FICA",
  futa: "FUTA", hsa: "HSA", fsa: "FSA", ira: "IRA", irs: "IRS", amt: "AMT", sdi: "SDI", id: "ID",
};

/** "federal_income_tax_withheld" to "Federal income tax withheld", acronyms kept. */
export function formatFieldKey(key: string): string {
  const words = key.replace(/([a-z\d])([A-Z])/g, "$1 $2").split(/[_\s]+/).filter(Boolean).map((w) => w.toLowerCase());
  return words.map((w, i) => ACRONYMS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

const MONEY_WORDS = new Set([
  "amount", "wage", "wages", "income", "tax", "taxes", "withheld", "withholding", "deduction", "deductions", "credit", "credits",
  "contribution", "contributions", "distribution", "distributions", "interest", "dividend", "dividends", "gain", "gains", "loss",
  "losses", "payment", "payments", "refund", "refunded", "overpaid", "owed", "balance", "basis", "proceeds", "expense", "expenses",
  "compensation", "benefit", "benefits", "premium", "total", "subtotal", "pay", "agi", "overpayment", "subtraction", "subtractions",
  "earnings", "liability",
]);
const NEVER_MONEY_WORDS = new Set([
  "zip", "zipcode", "ssn", "ein", "tin", "year", "code", "codes", "phone", "account", "routing", "number", "id", "count", "percent",
  "percentage", "rate", "age", "quantity", "shares", "box",
]);

const keyWords = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export function isNestedObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A field's value: money by its key's words (an identifier wins), otherwise as it came. */
export function formatFieldValue(value: unknown, key = ""): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    const words = keyWords(key);
    if (words.some((w) => NEVER_MONEY_WORDS.has(w))) return String(value);
    if (words.some((w) => MONEY_WORDS.has(w))) {
      if (isAmountsHidden()) return HIDDEN_AMOUNT;
      const cents = Number.isInteger(value) ? 0 : 2;
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents, maximumFractionDigits: cents }).format(value);
    }
    return value.toLocaleString("en-US");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => (isNestedObject(v) ? Object.entries(v).map(([k, inner]) => `${formatFieldKey(k)} ${formatFieldValue(inner, k)}`).join(", ") : formatFieldValue(v, key)))
      .join(" / ");
  }
  if (isNestedObject(value)) return Object.entries(value).map(([k, inner]) => `${formatFieldKey(k)} ${formatFieldValue(inner, k)}`).join(", ");
  return String(value);
}

/** Whether a document's own extracted fields say it is a Form 1040. */
export function is1040(fields: Record<string, unknown> | null): boolean {
  const kind = `${fields?.document_type ?? ""} ${fields?.form_type ?? ""}`;
  return /\b1040\b/.test(kind);
}

/**
 * Whether a 1040's field is the refund or the amount owed it states, as a
 * verdict: money back is good, money owed is bad (meaningful color, owner
 * 2026-11-23). Only a figure the document states, never an estimate, and
 * nothing for any other form or field.
 */
export function returnFieldVerdict(fields: Record<string, unknown> | null, key: string, value: unknown): "good" | "bad" | null {
  if (!is1040(fields) || typeof value !== "number" || !(value > 0)) return null;
  const words = keyWords(key);
  if (words.some((w) => NEVER_MONEY_WORDS.has(w) && w !== "account")) return null;
  if (words.some((w) => w === "refund" || w === "refunded" || w === "overpaid" || w === "overpayment")) return "good";
  if (words.some((w) => w === "owed" || w === "owe" || w === "due")) return "bad";
  return null;
}

const META_KEYS = new Set(["document_type", "form_type", "tax_year"]);

/** The extracted fields to list: flat ones in one grid, each nested object as its own titled grid. */
export function fieldGroups(fields: Record<string, unknown> | null): Array<{ title: string | null; entries: Array<[string, unknown]> }> {
  const present = Object.entries(fields ?? {}).filter(([k, v]) => !META_KEYS.has(k) && v !== null && v !== undefined && v !== "");
  const flat = present.filter(([, v]) => !isNestedObject(v));
  const nested = present
    .filter(([, v]) => isNestedObject(v))
    .map(([k, v]) => ({ title: formatFieldKey(k), entries: Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && x !== undefined && x !== "") }))
    .filter((g) => g.entries.length > 0);
  return [...(flat.length ? [{ title: null, entries: flat }] : []), ...nested];
}

export type DocSort = "added-desc" | "added-asc" | "name-asc" | "name-desc";

export const DOC_SORTS: Array<{ value: DocSort; label: string }> = [
  { value: "added-desc", label: "Newest" },
  { value: "added-asc", label: "Oldest" },
  { value: "name-asc", label: "A to Z" },
  { value: "name-desc", label: "Z to A" },
];

export function sortDocs<T extends TaxDocumentSummary>(docs: T[], sort: DocSort): T[] {
  const added = (d: T) => (d.createdAt ? new Date(d.createdAt).getTime() : 0);
  const name = (d: T) => docLabel(d).label.toLowerCase();
  const out = [...docs];
  switch (sort) {
    case "added-asc":
      return out.sort((a, b) => added(a) - added(b));
    case "name-asc":
      return out.sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true }));
    case "name-desc":
      return out.sort((a, b) => name(b).localeCompare(name(a), undefined, { numeric: true }));
    default:
      return out.sort((a, b) => added(b) - added(a));
  }
}

export const ALL_YEARS = "all";
export const yearKey = (year: number | null) => (year === null ? "undated" : String(year));
export const yearLabel = (year: number | null) => (year === null ? "Undated" : String(year));

/** The years on file, newest first, undated last, each with its count. */
export function docYears(docs: TaxDocumentSummary[]): Array<{ key: string; label: string; count: number }> {
  const by = new Map<number | null, number>();
  for (const d of docs) by.set(d.taxYear ?? null, (by.get(d.taxYear ?? null) ?? 0) + 1);
  return [...by.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b - a))
    .map(([year, count]) => ({ key: yearKey(year), label: yearLabel(year), count }));
}

/** The year on screen: the chosen one while it still exists, else every year when there are several. */
export function activeYear(years: Array<{ key: string }>, chosen: string | null): string | null {
  if (years.length === 0) return null;
  if (chosen === ALL_YEARS) return ALL_YEARS;
  if (chosen && years.some((y) => y.key === chosen)) return chosen;
  return years.length > 1 ? ALL_YEARS : years[0].key;
}

/** What a picked file may be: a PDF, PNG or JPG up to 20 MB (the web's limits). Null when fine. */
export function fileProblem(file: { name: string; type: string | null; size: number | null }): string | null {
  const ok = ["application/pdf", "image/jpeg", "image/png"];
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typed = file.type ? ok.includes(file.type) : ["pdf", "jpg", "jpeg", "png"].includes(ext);
  if (!typed) return `${file.name} is not a PDF, PNG, or JPG.`;
  if (file.size != null && file.size > 20 * 1024 * 1024) return `${file.name} is over the 20 MB limit.`;
  return null;
}

/** "1.2 MB", "340 KB". */
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A file's MIME type from its name, for a picker that gives none. */
export function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "application/pdf";
}

/** What happens to an uploaded document (the web's "How is my data kept safe?"). */
export const PRIVACY_POINTS = [
  "An AI model reads it automatically. No person at LasagnaFi opens what you upload.",
  "It takes the figures your strategies are built from, like wages, withholding, and deductions.",
  "Names, addresses, Social Security and account numbers are stripped out before the figures are saved.",
  "The document itself is never stored, and deleting it removes the figures too.",
];
