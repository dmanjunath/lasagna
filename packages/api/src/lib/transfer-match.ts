// Transfer pair detection: opposite-sign equal amounts across two different
// accounts within ±3 days. Catches internal transfers and CC payments that
// Plaid mislabels on one side, so they never double-count in spending.

import { eq, and, sql, transactions } from "@lasagna/core";
import { db } from "./db.js";

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface TxnForMatch {
  id: string;
  accountId: string;
  amount: string;
  date: Date;
  pending: number;
  categorySource: string;
  linkedTransactionId: string | null;
}

export function findTransferPairs(txns: TxnForMatch[]): Array<[string, string]> {
  const eligible = txns
    .filter((t) => t.pending === 0 && t.categorySource !== "manual" && t.linkedTransactionId === null)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));

  const used = new Set<string>();
  const pairs: Array<[string, string]> = [];

  for (const a of eligible) {
    if (used.has(a.id)) continue;
    const amountA = parseFloat(a.amount);
    if (amountA === 0) continue;
    let best: TxnForMatch | null = null;
    let bestDist = Infinity;
    for (const b of eligible) {
      if (b.id === a.id || used.has(b.id)) continue;
      if (b.accountId === a.accountId) continue;
      if (parseFloat(b.amount) !== -amountA) continue;
      const dist = Math.abs(b.date.getTime() - a.date.getTime());
      if (dist > WINDOW_MS) continue;
      if (dist < bestDist || (dist === bestDist && best !== null && b.id.localeCompare(best.id) < 0)) {
        best = b;
        bestDist = dist;
      }
    }
    if (best) {
      used.add(a.id);
      used.add(best.id);
      pairs.push([a.id, best.id]);
    }
  }
  return pairs;
}

// Idempotent full-history pass: linked rows drop out of the candidate pool,
// so re-running after every sync only touches new pairs.
export async function matchTransfersForTenant(tenantId: string): Promise<number> {
  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amount: transactions.amount,
      date: transactions.date,
      pending: transactions.pending,
      categorySource: transactions.categorySource,
      linkedTransactionId: transactions.linkedTransactionId,
    })
    .from(transactions)
    .where(and(
      eq(transactions.tenantId, tenantId),
      eq(transactions.pending, 0),
      sql`${transactions.linkedTransactionId} IS NULL`,
      sql`${transactions.categorySource} != 'manual'`,
    ));

  const pairs = findTransferPairs(rows);
  for (const [idA, idB] of pairs) {
    await db.transaction(async (tx) => {
      await tx.update(transactions)
        .set({ category: "transfer" as any, categorySource: "transfer" as any, linkedTransactionId: idB })
        .where(and(eq(transactions.id, idA), sql`${transactions.linkedTransactionId} IS NULL`));
      await tx.update(transactions)
        .set({ category: "transfer" as any, categorySource: "transfer" as any, linkedTransactionId: idA })
        .where(and(eq(transactions.id, idB), sql`${transactions.linkedTransactionId} IS NULL`));
    });
  }
  return pairs.length;
}
