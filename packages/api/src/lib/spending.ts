import { eq, and, sql, notInArray, transactions, categories, categoryGroups } from "@lasagna/core";
import { db } from "./db.js";
import { excludedTxnAccountIds } from "./account-balances.js";

/**
 * Default spending window when no range is given: the previous calendar month —
 * matches the /transactions/spending-summary route (and the dashboard, which
 * calls getSpendingSummary() with no params).
 */
export function defaultSpendingWindow(now: Date = new Date()): {
  startDate: Date;
  endDate: Date;
} {
  return {
    startDate: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    endDate: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
  };
}

/**
 * Total spending over a date range: the sum of positive transaction amounts in
 * non-income, non-transfer categories, excluding hidden transactions and
 * excluded-transaction accounts.
 *
 * This REPLICATES the `totalSpending` computation inlined in the
 * /transactions/spending-summary route (packages/api/src/routes/transactions.ts,
 * which also needs the full per-category breakdown for its response and so keeps
 * its own loop). Keep the two in lockstep — the retirement resolver relies on
 * this returning the same number the dashboard's getSpendingSummary() shows.
 */
export async function computeSpendingTotal(
  tenantId: string,
  startDate: Date,
  endDate: Date,
): Promise<number> {
  const conditions = [
    eq(transactions.tenantId, tenantId),
    sql`${transactions.date} >= ${startDate.toISOString()}::timestamptz`,
    sql`${transactions.date} <= ${endDate.toISOString()}::timestamptz`,
    sql`${transactions.excludedAt} is null`,
  ];
  const excludedIds = await excludedTxnAccountIds(tenantId);
  if (excludedIds.length > 0) {
    conditions.push(notInArray(transactions.accountId, excludedIds));
  }

  // Group per category (not per group) so a refund-heavy category that nets
  // negative counts as neither income nor spending — matching the
  // spending-summary route's per-category `total > 0` test exactly.
  const rows = await db
    .select({
      categoryId: categories.id,
      groupType: categoryGroups.type,
      total: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(...conditions))
    .groupBy(categories.id, categoryGroups.type);

  let totalSpending = 0;
  for (const row of rows) {
    const total = parseFloat(row.total || "0");
    const gt = row.groupType ?? "expense";
    if (gt !== "income" && gt !== "transfer" && total > 0) {
      totalSpending += total;
    }
  }

  return Math.round(totalSpending * 100) / 100;
}
