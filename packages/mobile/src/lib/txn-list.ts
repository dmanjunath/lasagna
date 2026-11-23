// Sort, summary and bulk-edit logic of packages/web/src/pages/transactions.tsx.
import type { TxnQueryRow, TxnQuerySummary } from "@web/lib/api";
import { formatCurrencyExact, formatMoney, formatStoredDay, storedDayKey } from "./format";

export type SortKey = "newest" | "oldest" | "largest" | "smallest";

export const SORT_KEYS: SortKey[] = ["newest", "oldest", "largest", "smallest"];

export const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  largest: "Largest amount",
  smallest: "Smallest amount",
};

export const SORTS: Record<SortKey, { field: "date" | "amount"; dir: "asc" | "desc" }> = {
  newest: { field: "date", dir: "desc" },
  oldest: { field: "date", dir: "asc" },
  largest: { field: "amount", dir: "desc" },
  smallest: { field: "amount", dir: "asc" },
};

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && (SORT_KEYS as string[]).includes(v);
}

/** Day headers only make sense on date-ordered lists. */
export function sortShowsDays(sort: SortKey): boolean {
  return sort === "newest" || sort === "oldest";
}

/** "Aug 11, 2026" for one day, else "Jan 3 to Aug 11, 2026", the year once when both ends share it. */
export function summaryRangeLabel(earliest: string | null, latest: string | null): string {
  if (!earliest || !latest) return "";
  const a = formatStoredDay(earliest, { year: "numeric" });
  const b = formatStoredDay(latest, { year: "numeric" });
  if (a === b) return a;
  if (storedDayKey(earliest).slice(0, 4) === storedDayKey(latest).slice(0, 4)) return `${formatStoredDay(earliest)} to ${b}`;
  return `${a} to ${b}`;
}

/** A dash rather than "NaN" when an older API sends a summary without the money fields. Whole dollars for a total shown in a tile. */
function money(n: number, whole = false): string {
  if (!Number.isFinite(n)) return "—";
  return whole ? formatMoney(n, true) : formatCurrencyExact(n);
}

export type KpiFigures = { count: string; moneyIn: string; moneyOut: string; net: string; netTone: "pos" | "neg" | undefined };

/** `whole`: totals in whole dollars, as tiles and heroes show them (rows keep cents). */
export function kpiFigures(summary: TxnQuerySummary, { whole = false }: { whole?: boolean } = {}): KpiFigures {
  const { totalCredits: credits, totalDebits: debits } = summary;
  const netKnown = Number.isFinite(credits) && Number.isFinite(debits);
  const net = credits - debits;
  return {
    count: Number.isFinite(summary.count) ? new Intl.NumberFormat("en-US").format(summary.count) : "—",
    moneyIn: money(credits, whole),
    moneyOut: money(debits, whole),
    net: netKnown ? `${net < 0 ? "−" : ""}${money(Math.abs(net), whole)}` : "—",
    netTone: netKnown ? (net < 0 ? "neg" : net > 0 ? "pos" : undefined) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Bulk edit
// ---------------------------------------------------------------------------

/** merchantName null clears a rename (only Undo sends it). */
export type BulkEdit = { category?: string; merchantName?: string | null; notes?: string; excluded?: boolean };

/** The row fields one edit changes, as the list holds them. */
export function bulkPatch(edit: BulkEdit, now: Date = new Date()): Partial<TxnQueryRow> {
  const patch: Partial<TxnQueryRow> = {};
  if (edit.category !== undefined) patch.categoryId = edit.category;
  if (edit.merchantName !== undefined) patch.merchantName = edit.merchantName;
  if (edit.notes !== undefined) patch.notes = edit.notes.trim() === "" ? null : edit.notes;
  if (edit.excluded !== undefined) patch.excludedAt = edit.excluded ? now.toISOString() : null;
  return patch;
}

/** The edit that puts one row back the way it was before `edit`. */
export function revertEditFor(tx: TxnQueryRow, edit: BulkEdit): BulkEdit | null {
  if (edit.category !== undefined) return tx.categoryId ? { category: tx.categoryId } : null;
  if (edit.merchantName !== undefined) return { merchantName: tx.merchantName };
  if (edit.notes !== undefined) return { notes: tx.notes ?? "" };
  return { excluded: tx.excludedAt != null };
}

/** Undo groups the rows by their old value, one bulk call per group. */
export function undoGroups(targets: TxnQueryRow[], edit: BulkEdit): Array<{ edit: BulkEdit; ids: string[] }> {
  const groups = new Map<string, { edit: BulkEdit; ids: string[] }>();
  for (const t of targets) {
    const back = revertEditFor(t, edit);
    if (!back) continue;
    const key = JSON.stringify(back);
    if (!groups.has(key)) groups.set(key, { edit: back, ids: [] });
    groups.get(key)!.ids.push(t.id);
  }
  return [...groups.values()];
}

export function bulkToastTitle(n: number, edit: BulkEdit, categoryLabel: (id: string) => string): string {
  const noun = n === 1 ? "transaction" : "transactions";
  if (edit.category !== undefined) return `Moved ${n} ${noun} to ${categoryLabel(edit.category)}`;
  if (edit.merchantName !== undefined) return `Renamed ${n} ${noun} to ${edit.merchantName}`;
  if (edit.notes !== undefined) return edit.notes.trim() === "" ? `Cleared the note on ${n} ${noun}` : `Added a note to ${n} ${noun}`;
  return edit.excluded ? `Excluded ${n} ${noun}` : `Included ${n} ${noun}`;
}
