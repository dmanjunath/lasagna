import type { TxnQueryRow } from "@web/lib/api";
import { dayLabel, storedDayKey } from "./format";

export type TxnListItem =
  | { type: "header"; key: string; label: string }
  | { type: "row"; key: string; row: TxnQueryRow }
  | { type: "prompt"; key: string; row: TxnQueryRow };

/**
 * Flattens rows into a list with a header before each new day (date sorts
 * only), and the create-rule prompt right after the row it belongs to.
 */
export function toSections(rows: TxnQueryRow[], byDate: boolean, now: Date = new Date(), promptFor?: string | null): TxnListItem[] {
  const out: TxnListItem[] = [];
  let lastDay: string | null = null;
  for (const row of rows) {
    if (byDate) {
      const day = storedDayKey(row.date);
      if (day !== lastDay) {
        out.push({ type: "header", key: `day:${day}`, label: dayLabel(row.date, now) });
        lastDay = day;
      }
    }
    out.push({ type: "row", key: row.id, row });
    if (promptFor && row.id === promptFor) out.push({ type: "prompt", key: `prompt:${row.id}`, row });
  }
  return out;
}

/** The indices of the day headers, for the list's sticky headers. */
export function headerIndices(items: TxnListItem[]): number[] {
  return items.flatMap((it, i) => (it.type === "header" ? [i] : []));
}
