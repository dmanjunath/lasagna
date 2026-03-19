import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { transactions, eq, and, sql } from "@lasagna/core";

export function createSpendingTools(tenantId: string) {
  return {
    get_spending_summary: tool({
      description:
        "Get a spending summary by category for a given month, including top merchants and totals. Use this to answer questions about spending patterns, budgets, and expenses.",
      inputSchema: z.object({
        month: z
          .string()
          .optional()
          .describe(
            'Month in YYYY-MM format (e.g., "2025-04"). Defaults to current month.'
          ),
      }),
      execute: async ({ month }) => {
        const now = new Date();
        let year: number, mon: number;

        if (month) {
          const [y, m] = month.split("-").map(Number);
          year = y;
          mon = m - 1; // JS months are 0-indexed
        } else {
          year = now.getFullYear();
          mon = now.getMonth();
        }

        const monthStart = new Date(year, mon, 1);
        const monthEnd = new Date(year, mon + 1, 0, 23, 59, 59);

        // Spending by category
        const categoryRows = await db
          .select({
            category: transactions.category,
            total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
            count: sql<string>`count(*)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              sql`${transactions.amount} > 0`,
              sql`${transactions.category} NOT IN ('income', 'transfer')`,
              sql`${transactions.date} >= ${monthStart.toISOString()}`,
              sql`${transactions.date} <= ${monthEnd.toISOString()}`
            )
          )
          .groupBy(transactions.category)
          .orderBy(sql`sum(${transactions.amount}) DESC`);

        // Top merchants
        const merchantRows = await db
          .select({
            merchant: transactions.merchantName,
            total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
            count: sql<string>`count(*)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              sql`${transactions.amount} > 0`,
              sql`${transactions.category} NOT IN ('income', 'transfer')`,
              sql`${transactions.merchantName} IS NOT NULL`,
              sql`${transactions.date} >= ${monthStart.toISOString()}`,
              sql`${transactions.date} <= ${monthEnd.toISOString()}`
            )
          )
          .groupBy(transactions.merchantName)
          .orderBy(sql`sum(${transactions.amount}) DESC`)
          .limit(10);

        // Income for the month
        const [incomeRow] = await db
          .select({
            total: sql<string>`coalesce(sum(abs(${transactions.amount})), 0)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.tenantId, tenantId),
              sql`${transactions.amount} < 0`,
              sql`${transactions.date} >= ${monthStart.toISOString()}`,
              sql`${transactions.date} <= ${monthEnd.toISOString()}`
            )
          );

        const totalSpending = categoryRows.reduce(
          (sum, r) => sum + parseFloat(r.total),
          0
        );
        const totalIncome = parseFloat(incomeRow?.total || "0");

        return {
          month: `${year}-${String(mon + 1).padStart(2, "0")}`,
          totalSpending: Math.round(totalSpending * 100) / 100,
          totalIncome: Math.round(totalIncome * 100) / 100,
          savingsRate:
            totalIncome > 0
              ? Math.round(((totalIncome - totalSpending) / totalIncome) * 1000) / 10
              : null,
          categories: categoryRows.map((r) => ({
            category: r.category,
            total: Math.round(parseFloat(r.total) * 100) / 100,
            transactionCount: parseInt(r.count),
          })),
          topMerchants: merchantRows.map((r) => ({
            merchant: r.merchant || "Unknown",
            total: Math.round(parseFloat(r.total) * 100) / 100,
            transactionCount: parseInt(r.count),
          })),
        };
      },
    }),
  };
}
