import { setAmountsHidden } from "../hide-amounts";
import {
  activeYear,
  returnFieldVerdict,
  ALL_YEARS,
  currentTaxYear,
  docLabel,
  docSubtitle,
  docYears,
  fieldGroups,
  fileProblem,
  formatFieldKey,
  formatFieldValue,
  sortDocs,
  summarySubtitle,
  type TaxDocumentSummary,
} from "../tax";

const doc = (over: Partial<TaxDocumentSummary>): TaxDocumentSummary => ({
  id: "d",
  fileName: "w2.pdf",
  llmFields: {},
  llmSummary: "",
  taxYear: 2025,
  createdAt: "2026-04-01T00:00:00Z",
  ...over,
});

afterEach(() => setAmountsHidden(false));

test("the tax year is last year's until the April deadline (audit W-28)", () => {
  expect(currentTaxYear(new Date(2026, 10, 22))).toBe(2026);
  expect(currentTaxYear(new Date(2027, 1, 10))).toBe(2026);
  expect(currentTaxYear(new Date(2027, 3, 16))).toBe(2027);
});

test("a document is named by its form, its summary, or its file", () => {
  expect(docLabel(doc({ llmFields: { form_type: "W-2" } })).label).toBe("W-2: Wage & Tax Statement");
  expect(docLabel(doc({ llmFields: { document_type: "Schedule A" } }))).toEqual({ label: "Schedule A", isFormName: true });
  expect(docLabel(doc({ llmSummary: "Form 1040 for the 2025 tax year. Shows wages." })).label).toBe("Form 1040");
  // A figure in prose never becomes the title.
  expect(docLabel(doc({ llmSummary: "I paid 1200 for tax prep. Thanks." })).label).toBe("I paid 1200 for tax prep");
  expect(docLabel(doc({ fileName: "manual-entry" })).label).toBe("Typed description");
  expect(docLabel(doc({ fileName: "scan-04.pdf" })).label).toBe("scan-04");
});

test("the row's line drops what the name already says", () => {
  expect(summarySubtitle("Schedule A for 2025 reporting total itemized deductions of $12,000.", "Schedule A", true)).toBe("Total itemized deductions of $12,000.");
  expect(summarySubtitle("W-2 for 2025.", "W-2", true)).toBeNull();
  expect(summarySubtitle("Shows total income of $5.", "Shows total income of $5", false)).toBeNull();
  expect(docSubtitle(doc({ fileName: "employer-w2-final.pdf", llmFields: { form_type: "W-2" } }))).toBe("employer-w2-final.pdf");
  expect(docSubtitle(doc({ fileName: "manual-entry", llmSummary: "" }))).toBeNull();
});

test("fields read as words, money only where the key says money", () => {
  expect(formatFieldKey("federal_income_tax_withheld")).toBe("Federal income tax withheld");
  expect(formatFieldKey("w2Wages")).toBe("W-2 wages");
  expect(formatFieldValue(166000, "w2_wages")).toBe("$166,000");
  expect(formatFieldValue(18234.5, "tax_withheld")).toBe("$18,234.50");
  expect(formatFieldValue(94105, "zip_code")).toBe("94105");
  expect(formatFieldValue(2025, "tax_year")).toBe("2025");
  expect(formatFieldValue(true)).toBe("Yes");
  expect(formatFieldValue(null)).toBe("—");
  setAmountsHidden(true);
  expect(formatFieldValue(100, "interest")).toBe("$•••••");
});

test("fields group as one flat grid and one per nested object, metadata left out", () => {
  const groups = fieldGroups({ form_type: "W-2", wages: 100, empty: "", employer: { name: "Acme", ein: null } });
  expect(groups).toEqual([
    { title: null, entries: [["wages", 100]] },
    { title: "Employer", entries: [["name", "Acme"]] },
  ]);
});

test("years, the year on screen, and the sort", () => {
  const docs = [doc({ id: "a", taxYear: 2024, createdAt: "2026-01-01T00:00:00Z", llmFields: { form_type: "W-2" } }), doc({ id: "b", taxYear: null, createdAt: "2026-03-01T00:00:00Z", llmFields: { form_type: "1099-INT" } }), doc({ id: "c", taxYear: 2025, createdAt: "2026-02-01T00:00:00Z", llmFields: { form_type: "1098" } })];
  expect(docYears(docs).map((y) => y.label)).toEqual(["2025", "2024", "Undated"]);
  expect(activeYear(docYears(docs), null)).toBe(ALL_YEARS);
  expect(activeYear(docYears(docs), "2024")).toBe("2024");
  expect(activeYear(docYears(docs), "1999")).toBe(ALL_YEARS);
  expect(activeYear(docYears([docs[0]]), null)).toBe("2024");
  expect(sortDocs(docs, "added-desc").map((d) => d.id)).toEqual(["b", "c", "a"]);
  expect(sortDocs(docs, "added-asc").map((d) => d.id)).toEqual(["a", "c", "b"]);
  expect(sortDocs(docs, "name-asc").map((d) => d.id)).toEqual(["c", "b", "a"]);
});

test("a picked file is a PDF, PNG or JPG up to 20 MB", () => {
  expect(fileProblem({ name: "w2.pdf", type: "application/pdf", size: 1000 })).toBeNull();
  expect(fileProblem({ name: "scan.JPG", type: null, size: null })).toBeNull();
  expect(fileProblem({ name: "notes.txt", type: "text/plain", size: 10 })).toBe("notes.txt is not a PDF, PNG, or JPG.");
  expect(fileProblem({ name: "big.pdf", type: "application/pdf", size: 21 * 1024 * 1024 })).toBe("big.pdf is over the 20 MB limit.");
});

test("a 1040's stated refund is good and its amount owed bad, nothing else is judged", () => {
  const f1040 = { document_type: "1040", refund_amount: 1200, amount_you_owe: 0, total_tax: 28161 };
  expect(returnFieldVerdict(f1040, "refund_amount", 1200)).toBe("good");
  expect(returnFieldVerdict(f1040, "overpaid", 300)).toBe("good");
  expect(returnFieldVerdict({ form_type: "Form 1040" }, "amount_you_owe", 450)).toBe("bad");
  expect(returnFieldVerdict({ document_type: "1040" }, "balance_due", 90)).toBe("bad");
  expect(returnFieldVerdict(f1040, "amount_you_owe", 0)).toBeNull(); // nothing owed is no verdict
  expect(returnFieldVerdict(f1040, "total_tax", 28161)).toBeNull();
  expect(returnFieldVerdict(f1040, "refund_routing_number", 12345)).toBeNull(); // an identifier, never money
  expect(returnFieldVerdict({ document_type: "W-2" }, "refund_amount", 1200)).toBeNull(); // only a 1040 states a return's result
  expect(returnFieldVerdict({ document_type: "Schedule 3" }, "amount_owed", 1200)).toBeNull();
  expect(returnFieldVerdict(f1040, "refund_amount", "1200")).toBeNull();
});
