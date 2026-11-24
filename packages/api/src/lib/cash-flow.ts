import { db } from "./db.js";
import { transactions, categories, categoryGroups, eq, and, sql } from "@lasagna/core";
import { txnFilterConditions, type TxnFilter } from "./txn-filter.js";
import { CATEGORY_BASELINE_MONTHS, median } from "./spend-cut-detector.js";

/**
 * Income, spending and net cash flow for a date window. The one place this
 * math lives: the Spending page (/spending-summary), /api/facts and the chat
 * tool all read it, so the same month reads the same everywhere.
 */

export interface CashFlowCategory {
  id: string | null;
  name: string;
  systemKey: string | null;
  groupId: string | null;
  groupName: string;
  groupType: string;
  /** abs(net) of the category over the window, rounded to cents. */
  total: number;
  count: number;
  /** Share of `spending`, 0 for income and transfer rows and for money back. */
  percentage: number;
  /**
   * An expense category whose refunds exceeded its spending over the window.
   * It counts negative toward `spending` (refunds reduce Spent) and lists at
   * the bottom of the breakdown as money back; `total` is still its absolute net.
   */
  moneyBack: boolean;
}

export interface CashFlow {
  income: number;
  spending: number;
  /** `income - spending`: positive is a surplus, negative a shortfall. */
  net: number;
  categories: CashFlowCategory[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * `filter` narrows the rows with the universal transaction filter
 * (lib/txn-filter.ts), the same predicate /transactions/query applies; its own
 * dates are ignored, the window is `start`..`end`.
 */
export async function computeCashFlow(tenantId: string, start: Date, end: Date, filter: TxnFilter = {}): Promise<CashFlow> {
  return cashFlowForFilter(tenantId, { ...filter, startDate: start, endDate: end });
}

/**
 * The same math for any filter, its dates included (or none). /transactions/query
 * reads its money totals here, so its Money in and Money out equal the Spending
 * page's figures for the same filter.
 */
export async function cashFlowForFilter(tenantId: string, filter: TxnFilter): Promise<CashFlow> {
  const conditions = await txnFilterConditions(tenantId, filter);
  conditions.push(sql`${transactions.excludedAt} is null`);

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      systemKey: categories.systemKey,
      groupId: categories.groupId,
      groupName: categoryGroups.name,
      groupType: categoryGroups.type,
      total: sql<string>`sum(${transactions.amount})`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(...conditions))
    .groupBy(categories.id, categories.name, categories.systemKey, categories.groupId, categoryGroups.name, categoryGroups.type)
    .orderBy(sql`sum(${transactions.amount}) DESC`);

  // Income = income-category totals only. Spending = the NET of every
  // non-income, non-transfer category, a negative one included: a category the
  // window refunded more than it spent reduces Spent, so Spent and Money out
  // equal the sum of the rows listed under them on every screen (owner
  // decision 2026-11-24). Keep lib/spending.ts and lib/trend.ts in lockstep.
  let totalSpending = 0;
  let totalIncome = 0;

  const categoryRows = rows.map((row) => {
    const total = parseFloat(row.total || "0");
    const gt = row.groupType ?? "expense";
    if (gt === "income") {
      totalIncome += Math.abs(total);
    } else if (gt !== "transfer") {
      totalSpending += total;
    }
    return {
      id: row.id,
      name: row.name ?? "Other",
      systemKey: row.systemKey,
      groupId: row.groupId,
      groupName: row.groupName ?? "Other",
      groupType: gt,
      total: cents(Math.abs(total)),
      count: row.count,
      percentage: 0, // calculated below
      moneyBack: gt !== "income" && gt !== "transfer" && total < 0,
    };
  });

  // Percentages are shares of spending, for spending categories only.
  for (const cat of categoryRows) {
    if (cat.groupType !== "income" && cat.groupType !== "transfer" && !cat.moneyBack && totalSpending > 0) {
      cat.percentage = Math.round((cat.total / totalSpending) * 10000) / 100;
    }
  }
  // Money back lists after everything else.
  categoryRows.sort((a, b) => Number(a.moneyBack) - Number(b.moneyBack));

  return {
    income: cents(totalIncome),
    spending: cents(totalSpending),
    net: cents(totalIncome - totalSpending),
    categories: categoryRows,
  };
}

export interface MonthWindow {
  start: Date;
  end: Date;
  /** e.g. "October 2026". */
  label: string;
}

/**
 * The window the Spending page queries for a month: it sends `YYYY-MM-01` and
 * `YYYY-MM-DDT23:59:59`, which /spending-summary parses with `new Date()`.
 * Built from the same strings here so every caller gets the identical bounds.
 * `month` is 0-indexed.
 */
export function monthWindow(year: number, month: number): MonthWindow {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    start: new Date(`${year}-${pad(month + 1)}-01`),
    end: new Date(`${year}-${pad(month + 1)}-${pad(lastDay)}T23:59:59`),
    label: new Date(Date.UTC(year, month, 1)).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
}

/** The last full calendar month. */
export function lastFullMonthWindow(now = new Date()): MonthWindow {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return monthWindow(d.getFullYear(), d.getMonth());
}

/**
 * Each spending category's usual month: the median of its spending in the
 * three complete calendar months before `month` (the same baseline the
 * category-above-trend action uses), under the same filter and the same
 * net-per-category math as the page's figures, so a category is compared with
 * itself on equal terms. Empty when the household has less than three complete
 * months of history before `month`: one or two months is not a usual. A
 * category whose median is zero has no usual.
 */
export async function categoryUsual(tenantId: string, month: Date, filter: TxnFilter = {}): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const y = month.getUTCFullYear();
  const m = month.getUTCMonth();
  const starts = Array.from({ length: CATEGORY_BASELINE_MONTHS }, (_, i) => new Date(Date.UTC(y, m - 1 - i, 1)));
  const oldest = starts[starts.length - 1];
  const [first] = await db
    .select({ earliest: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .where(eq(transactions.tenantId, tenantId));
  // History reaches the oldest baseline month when the first transaction falls in it or before.
  const afterOldest = Date.UTC(oldest.getUTCFullYear(), oldest.getUTCMonth() + 1, 1);
  if (!first?.earliest || new Date(first.earliest).getTime() >= afterOldest) return out;

  const months = await Promise.all(
    starts.map((start) => {
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - 1);
      return cashFlowForFilter(tenantId, { ...filter, startDate: start, endDate: end });
    }),
  );
  const totals = new Map<string, number[]>();
  months.forEach((flow, i) => {
    for (const cat of flow.categories) {
      if (!cat.id || cat.groupType === "income" || cat.groupType === "transfer") continue;
      const list = totals.get(cat.id) ?? new Array(CATEGORY_BASELINE_MONTHS).fill(0);
      // Signed: a money-back month pulls the usual month down, never up.
      list[i] = cat.moneyBack ? -cat.total : cat.total;
      totals.set(cat.id, list);
    }
  });
  for (const [id, list] of totals) {
    const med = cents(median(list));
    if (med > 0) out.set(id, med);
  }
  return out;
}
