import { eq, and, sql, notInArray, transactions, categories, categoryGroups } from "@lasagna/core";
import { db } from "./db.js";
import { excludedTxnAccountIds } from "./account-balances.js";

/**
 * Single source of truth for "how much does this household spend a month".
 *
 * Two windows, one definition each. Anything that prices a target in months of
 * spending (the priorities ladder's emergency-fund layer, an emergency-fund
 * goal) must read `stableMonthlyExpenses` from here — two code paths averaging
 * spend their own way is exactly how the app ends up quoting two different
 * numbers for the same thing.
 */

/** The last 3 full calendar months is the window the stable figure averages. */
export const STABLE_SPEND_MONTHS = 3;

export interface MonthlySpend {
  /** Non-transfer expense over the last 30 days. Null when there is none. */
  monthlyExpenses: number | null;
  /**
   * Non-transfer expense over the last 3 full calendar months, divided by 3, so
   * a target priced from it doesn't drift day to day. Falls back to the 30-day
   * figure when there's no full-month history yet, and is null when there is no
   * categorized spending at all.
   */
  stableMonthlyExpenses: number | null;
}

export async function readMonthlySpend(tenantId: string): Promise<MonthlySpend> {
  const excludedIds = await excludedTxnAccountIds(tenantId);
  const notExcluded = excludedIds.length > 0 ? [notInArray(transactions.accountId, excludedIds)] : [];

  const expenseSum = (extra: ReturnType<typeof sql>[]) =>
    db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.amount} > 0`,
          sql`coalesce(${categoryGroups.type}::text, 'expense') != 'transfer'`,
          ...extra,
          ...notExcluded,
        ),
      );

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth() - STABLE_SPEND_MONTHS, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [[recent], [full]] = await Promise.all([
    expenseSum([sql`${transactions.date} >= ${thirtyDaysAgo.toISOString().split("T")[0]}`]),
    expenseSum([
      sql`${transactions.date} >= ${windowStart.toISOString().split("T")[0]}`,
      sql`${transactions.date} < ${currentMonthStart.toISOString().split("T")[0]}`,
    ]),
  ]);

  const recentTotal = parseFloat(recent?.total ?? "0");
  const monthlyExpenses = recentTotal > 0 ? recentTotal : null;

  const fullTotal = parseFloat(full?.total ?? "0");
  const stableMonthlyExpenses =
    fullTotal > 0 ? fullTotal / STABLE_SPEND_MONTHS : monthlyExpenses;

  return { monthlyExpenses, stableMonthlyExpenses };
}
