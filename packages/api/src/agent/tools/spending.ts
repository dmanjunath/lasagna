import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { transactions, categories, categoryGroups, eq, and, sql, notInArray } from "@lasagna/core";
import { excludedTxnAccountIds } from "../../lib/account-balances.js";
import { computeCashFlow, monthWindow, lastFullMonthWindow } from "../../lib/cash-flow.js";

export function createSpendingTools(tenantId: string) {
  return {
    get_spending_summary: tool({
      description:
        "Get income, spending and net cash flow for one calendar month, with spending by category and top merchants. The same figures the Spending page shows. spending already includes every category listed in categories. Transfers, including moves into the user's own savings or brokerage, are not spending and are not listed. netCashFlow (income minus spending) is the one monthly surplus (positive) or shortfall (negative) figure: quote it as is. Never subtract or add categories to derive another net, surplus or \"cash left over\" figure. Each field is defined in `definitions`. Always name the month (monthLabel) when you quote a figure. Use this to answer questions about spending patterns, budgets, and expenses.",
      inputSchema: z.object({
        month: z
          .string()
          .optional()
          .describe(
            'Month in YYYY-MM format (e.g., "2025-04"). Defaults to the last full month, the month the Spending page opens on.'
          ),
      }),
      execute: async ({ month }) => {
        let win;
        if (month) {
          const [y, m] = month.split("-").map(Number);
          win = monthWindow(y, m - 1); // JS months are 0-indexed
        } else {
          win = lastFullMonthWindow();
        }

        const flow = await computeCashFlow(tenantId, win.start, win.end);

        const excludedIds = await excludedTxnAccountIds(tenantId);

        // Top merchants
        const merchantRows = await db
          .select({
            merchant: transactions.merchantName,
            total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
            count: sql<string>`count(*)`,
          })
          .from(transactions)
          .leftJoin(categories, eq(transactions.categoryId, categories.id))
          .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              sql`${transactions.amount} > 0`,
              sql`coalesce(${categoryGroups.type}::text, 'expense') NOT IN ('income', 'transfer')`,
              sql`${transactions.merchantName} IS NOT NULL`,
              sql`${transactions.excludedAt} is null`,
              sql`${transactions.date} >= ${win.start.toISOString()}::timestamptz`,
              sql`${transactions.date} <= ${win.end.toISOString()}::timestamptz`,
              ...(excludedIds.length > 0
                ? [notInArray(transactions.accountId, excludedIds)]
                : [])
            )
          )
          .groupBy(transactions.merchantName)
          .orderBy(sql`sum(${transactions.amount}) DESC`)
          .limit(10);

        return {
          month: `${win.start.getUTCFullYear()}-${String(win.start.getUTCMonth() + 1).padStart(2, "0")}`,
          monthLabel: win.label,
          income: flow.income,
          spending: flow.spending,
          netCashFlow: flow.net,
          savingsRate:
            flow.income > 0
              ? Math.round((flow.net / flow.income) * 1000) / 10
              : null,
          categories: flow.categories
            .filter((c) => c.groupType !== "income" && c.groupType !== "transfer")
            .map((c) => ({
              category: c.name,
              total: c.total,
              transactionCount: c.count,
            })),
          topMerchants: merchantRows.map((r) => ({
            merchant: r.merchant || "Unknown",
            total: Math.round(parseFloat(r.total) * 100) / 100,
            transactionCount: parseInt(r.count),
          })),
          definitions: {
            income: "money received this month",
            spending:
              "everything spent this month. It already includes every entry in categories. Transfers, including savings and investment deposits, are not spending",
            netCashFlow:
              "income minus spending, the one surplus (positive) or shortfall (negative) for the month. Quote it as is. Never subtract or add categories to it",
            categories: "the parts of spending. They sum to spending and are never taken out of it again",
          },
        };
      },
    }),
  };
}
