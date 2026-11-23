import type { TxnQueryRow, TxnQuerySummary } from "@web/lib/api";
import { setAmountsHidden } from "../hide-amounts";
import {
  bulkPatch,
  bulkToastTitle,
  isSortKey,
  kpiFigures,
  revertEditFor,
  sortShowsDays,
  SORTS,
  summaryRangeLabel,
  undoGroups,
} from "../txn-list";

const row = (id: string, patch: Partial<TxnQueryRow> = {}): TxnQueryRow => ({
  id,
  accountId: "a",
  accountName: "Checking",
  date: "2026-11-01T00:00:00.000Z",
  name: "RAW NAME",
  merchantName: null,
  amount: "10.00",
  categoryId: "c-old",
  pending: 0,
  notes: null,
  excludedAt: null,
  ...patch,
});

const summary = (p: Partial<TxnQuerySummary>): TxnQuerySummary => ({
  count: 3,
  totalSpent: 0,
  totalIncome: 0,
  totalDebits: 120.5,
  totalCredits: 1000,
  earliest: null,
  latest: null,
  ...p,
});

afterEach(() => setAmountsHidden(false));

test("sorts and day headers", () => {
  expect(SORTS.largest).toEqual({ field: "amount", dir: "desc" });
  expect(sortShowsDays("newest")).toBe(true);
  expect(sortShowsDays("oldest")).toBe(true);
  expect(sortShowsDays("smallest")).toBe(false);
  expect(isSortKey("oldest")).toBe(true);
  expect(isSortKey("random")).toBe(false);
  expect(isSortKey(undefined)).toBe(false);
});

test("summary range prints the year once when shared", () => {
  expect(summaryRangeLabel(null, null)).toBe("");
  expect(summaryRangeLabel("2026-01-03T00:00:00Z", "2026-08-11T00:00:00Z")).toBe("Jan 3 to Aug 11, 2026");
  expect(summaryRangeLabel("2025-12-03T00:00:00Z", "2026-08-11T00:00:00Z")).toBe("Dec 3, 2025 to Aug 11, 2026");
  expect(summaryRangeLabel("2026-08-11T00:00:00Z", "2026-08-11T00:00:00Z")).toBe("Aug 11, 2026");
});

describe("kpiFigures", () => {
  test("net carries its sign and tone", () => {
    expect(kpiFigures(summary({}))).toEqual({ count: "3", moneyIn: "$1,000.00", moneyOut: "$120.50", net: "$879.50", netTone: "pos" });
    expect(kpiFigures(summary({ totalCredits: 0, count: 1200 }))).toMatchObject({ count: "1,200", net: "−$120.50", netTone: "neg" });
    expect(kpiFigures(summary({ totalCredits: 120.5 })).netTone).toBeUndefined();
  });

  test("whole dollars for tiles", () => {
    expect(kpiFigures(summary({}), { whole: true })).toMatchObject({ moneyIn: "$1,000", moneyOut: "$121", net: "$880" });
  });

  test("missing money fields print a dash, not NaN", () => {
    const k = kpiFigures(summary({ totalCredits: undefined as unknown as number }));
    expect(k.moneyIn).toBe("—");
    expect(k.net).toBe("—");
    expect(k.netTone).toBeUndefined();
  });

  test("hidden amounts mask every figure", () => {
    setAmountsHidden(true);
    const k = kpiFigures(summary({}));
    expect(k.moneyIn).toBe("$•••••");
    expect(k.net).toBe("$•••••");
  });
});

describe("bulk edit", () => {
  test("bulkPatch maps each edit to row fields", () => {
    const now = new Date("2026-11-21T10:00:00Z");
    expect(bulkPatch({ category: "c-new" })).toEqual({ categoryId: "c-new" });
    expect(bulkPatch({ merchantName: null })).toEqual({ merchantName: null });
    expect(bulkPatch({ notes: "  " })).toEqual({ notes: null });
    expect(bulkPatch({ notes: "hi" })).toEqual({ notes: "hi" });
    expect(bulkPatch({ excluded: true }, now)).toEqual({ excludedAt: "2026-11-21T10:00:00.000Z" });
    expect(bulkPatch({ excluded: false })).toEqual({ excludedAt: null });
  });

  test("revertEditFor restores the field the edit touched", () => {
    expect(revertEditFor(row("1"), { category: "x" })).toEqual({ category: "c-old" });
    expect(revertEditFor(row("1", { categoryId: "" }), { category: "x" })).toBeNull();
    expect(revertEditFor(row("1", { merchantName: "Old" }), { merchantName: "New" })).toEqual({ merchantName: "Old" });
    expect(revertEditFor(row("1"), { merchantName: "New" })).toEqual({ merchantName: null });
    expect(revertEditFor(row("1"), { notes: "n" })).toEqual({ notes: "" });
    expect(revertEditFor(row("1", { excludedAt: "x" }), { excluded: false })).toEqual({ excluded: true });
  });

  test("undoGroups groups rows by their previous value", () => {
    const targets = [row("1", { categoryId: "a" }), row("2", { categoryId: "b" }), row("3", { categoryId: "a" }), row("4", { categoryId: "" })];
    expect(undoGroups(targets, { category: "z" })).toEqual([
      { edit: { category: "a" }, ids: ["1", "3"] },
      { edit: { category: "b" }, ids: ["2"] },
    ]);
  });

  test("toast titles", () => {
    const label = () => "Groceries";
    expect(bulkToastTitle(1, { category: "c" }, label)).toBe("Moved 1 transaction to Groceries");
    expect(bulkToastTitle(3, { merchantName: "Tea Co" }, label)).toBe("Renamed 3 transactions to Tea Co");
    expect(bulkToastTitle(2, { notes: "" }, label)).toBe("Cleared the note on 2 transactions");
    expect(bulkToastTitle(2, { notes: "x" }, label)).toBe("Added a note to 2 transactions");
    expect(bulkToastTitle(2, { excluded: true }, label)).toBe("Excluded 2 transactions");
    expect(bulkToastTitle(2, { excluded: false }, label)).toBe("Included 2 transactions");
  });
});
