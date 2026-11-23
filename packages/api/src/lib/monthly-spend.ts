import { computeSpendingTotal } from "./spending.js";

/**
 * Single source of truth for "how much does this household spend a month".
 *
 * Two windows, one definition each. Anything that prices a target in months of
 * spending (the priorities ladder's emergency-fund layer, an emergency-fund
 * goal, the retirement plan's starting spend) must read `stableMonthlyExpenses`
 * from here — two code paths averaging spend their own way is exactly how the
 * app ends up quoting two different numbers for the same thing.
 *
 * Both windows count spending exactly as the Spending page does
 * (`computeSpendingTotal`): expense-type categories only, hidden rows and
 * excluded accounts left out, so savings transfers are never spending.
 */

/** The last 3 full calendar months is the window the stable figure averages. */
export const STABLE_SPEND_MONTHS = 3;

export interface MonthlySpend {
  /** Spending over the last 30 days. Null when there is none. */
  monthlyExpenses: number | null;
  /**
   * Spending over the last 3 full calendar months, divided by 3, so a target
   * priced from it doesn't drift day to day. Falls back to the 30-day figure
   * when there's no full-month history yet, and is null when there is no
   * categorized spending at all.
   */
  stableMonthlyExpenses: number | null;
}

export async function readMonthlySpend(tenantId: string, now: Date = new Date()): Promise<MonthlySpend> {
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const windowStart = new Date(now.getFullYear(), now.getMonth() - STABLE_SPEND_MONTHS, 1);
  const windowEnd = new Date(new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1);

  const [recentTotal, fullTotal] = await Promise.all([
    computeSpendingTotal(tenantId, thirtyDaysAgo, now),
    computeSpendingTotal(tenantId, windowStart, windowEnd),
  ]);

  const monthlyExpenses = recentTotal > 0 ? recentTotal : null;
  const stableMonthlyExpenses =
    fullTotal > 0 ? fullTotal / STABLE_SPEND_MONTHS : monthlyExpenses;

  return { monthlyExpenses, stableMonthlyExpenses };
}
