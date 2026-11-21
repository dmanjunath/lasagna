import { db } from "./db.js";
import { transactions, categories, categoryGroups, eq, and, sql, notInArray } from "@lasagna/core";
import { excludedTxnAccountIds } from "./account-balances.js";

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
  /** Share of `spending`, 0 for income and transfer rows. */
  percentage: number;
}

export interface CashFlow {
  income: number;
  spending: number;
  /** `income - spending`: positive is a surplus, negative a shortfall. */
  net: number;
  categories: CashFlowCategory[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

export async function computeCashFlow(tenantId: string, start: Date, end: Date): Promise<CashFlow> {
  const conditions = [
    eq(transactions.tenantId, tenantId),
    sql`${transactions.date} >= ${start.toISOString()}::timestamptz`,
    sql`${transactions.date} <= ${end.toISOString()}::timestamptz`,
    sql`${transactions.excludedAt} is null`,
  ];
  const excludedIds = await excludedTxnAccountIds(tenantId);
  if (excludedIds.length > 0) {
    conditions.push(notInArray(transactions.accountId, excludedIds));
  }

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

  // Income = income-category totals only; spending = positive totals in
  // non-income, non-transfer categories. A refund-heavy expense category (net
  // negative) counts as neither. Matches lib/trend.ts and the insights engine.
  //
  // Such a category also drops out of the BREAKDOWN, not just the total: it
  // would otherwise render its refund as if it were spending, and the rows the
  // page lists under the hero have to add up to the hero.
  const countedRows = rows.filter((row) => {
    const gt = row.groupType ?? "expense";
    return gt === "income" || gt === "transfer" || parseFloat(row.total || "0") > 0;
  });

  let totalSpending = 0;
  let totalIncome = 0;

  const categoryRows = countedRows.map((row) => {
    const total = parseFloat(row.total || "0");
    const gt = row.groupType ?? "expense";
    if (gt === "income") {
      totalIncome += Math.abs(total);
    } else if (gt !== "transfer" && total > 0) {
      totalSpending += total;
    }
    return {
      id: row.id,
      name: row.name ?? "Other",
      systemKey: row.systemKey,
      groupId: row.groupId,
      groupName: row.groupName ?? "Other",
      groupType: row.groupType ?? "expense",
      total: cents(Math.abs(total)),
      count: row.count,
      percentage: 0, // calculated below
    };
  });

  // Calculate percentages based on spending only (exclude income)
  for (const cat of categoryRows) {
    if (cat.groupType !== "income" && totalSpending > 0) {
      cat.percentage = Math.round((cat.total / totalSpending) * 10000) / 100;
    }
  }

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

/** The last full calendar month, the month /spending opens on. */
export function lastFullMonthWindow(now = new Date()): MonthWindow {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return monthWindow(d.getFullYear(), d.getMonth());
}
