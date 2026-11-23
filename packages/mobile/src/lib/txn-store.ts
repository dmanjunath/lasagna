import type { TxnQueryRow } from "@web/lib/api";
import { pushInTab } from "./navigation";

// The API has no GET /transactions/:id, so a screen that opens the detail sheet
// hands over the row it already holds.
const rows = new Map<string, TxnQueryRow>();

export function openTransaction(row: TxnQueryRow) {
  rows.set(row.id, row);
  pushInTab(`/transaction/${row.id}`);
}

export function heldTransaction(id: string): TxnQueryRow | undefined {
  return rows.get(id);
}

export function updateHeldTransaction(id: string, patch: Partial<TxnQueryRow>) {
  const row = rows.get(id);
  if (row) rows.set(id, { ...row, ...patch });
}
