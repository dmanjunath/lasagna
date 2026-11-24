// Transfer pair detection: opposite-sign equal amounts across two different
// accounts within ±3 days, or ±5 days when one side is a credit landing on a
// credit card or loan (a payment posts to the card days after it leaves the bank). Catches internal transfers and CC payments that
// Plaid mislabels on one side, so they never double-count in spending.

import { eq, and, sql, transactions } from "@lasagna/core";
import { db } from "./db.js";
import { loadTaxonomy } from "./taxonomy.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 3 * DAY_MS;
const DEBT_PAYMENT_WINDOW_MS = 5 * DAY_MS;

export interface TxnForMatch {
  id: string;
  accountId: string;
  amount: string;
  date: Date;
  pending: number;
  categorySource: string;
  linkedTransactionId: string | null;
  /** The account's type. A card or loan side widens the window for payments. */
  accountType?: string | null;
}

const onDebt = (t: TxnForMatch) => t.accountType === "credit" || t.accountType === "loan";

/** A payment onto a card or loan (its credit side on the debt account) may post up to 5 days after it leaves the bank. */
function windowFor(a: TxnForMatch, b: TxnForMatch): number {
  const credit = parseFloat(a.amount) < 0 ? a : b;
  const debit = credit === a ? b : a;
  return onDebt(credit) && !onDebt(debit) ? DEBT_PAYMENT_WINDOW_MS : WINDOW_MS;
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
      if (dist > windowFor(a, b)) continue;
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
      accountType: sql<string>`(select a.type::text from accounts a where a.id = ${transactions.accountId})`,
    })
    .from(transactions)
    .where(and(
      eq(transactions.tenantId, tenantId),
      eq(transactions.pending, 0),
      sql`${transactions.linkedTransactionId} IS NULL`,
      sql`${transactions.categorySource} != 'manual'`,
    ));

  const pairs = findTransferPairs(rows);
  if (pairs.length === 0) return 0;
  // Direct Transfer lookup, not resolveCategoryId — Transfer is locked and must
  // never fall back to Other (an Other-id matcher would double-count payments).
  const taxonomy = await loadTaxonomy(tenantId);
  const transferCategoryId = taxonomy.find((c) => c.systemKey === "transfer")?.id;
  if (!transferCategoryId) return 0;
  for (const [idA, idB] of pairs) {
    await db.transaction(async (tx) => {
      await tx.update(transactions)
        .set({ categoryId: transferCategoryId, categorySource: "transfer" as any, linkedTransactionId: idB })
        .where(and(eq(transactions.id, idA), sql`${transactions.linkedTransactionId} IS NULL`));
      await tx.update(transactions)
        .set({ categoryId: transferCategoryId, categorySource: "transfer" as any, linkedTransactionId: idA })
        .where(and(eq(transactions.id, idB), sql`${transactions.linkedTransactionId} IS NULL`));
    });
  }
  return pairs.length;
}
