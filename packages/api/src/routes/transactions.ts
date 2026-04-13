import { Hono } from "hono";
import { eq, and, sql, desc, transactions } from "@lasagna/core";
import { db } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const transactionRoutes = new Hono<AuthEnv>();
transactionRoutes.use("*", requireAuth);

// GET / - List transactions with pagination and filters
transactionRoutes.get("/", async (c) => {
  const session = c.get("session");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));
  const category = c.req.query("category");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  const accountId = c.req.query("accountId");
  const search = c.req.query("search");

  const conditions = [eq(transactions.tenantId, session.tenantId)];

  if (category) {
    conditions.push(sql`${transactions.category} = ${category}`);
  }
  if (startDate) {
    conditions.push(sql`${transactions.date} >= ${new Date(startDate).toISOString()}::timestamptz`);
  }
  if (endDate) {
    conditions.push(sql`${transactions.date} <= ${new Date(endDate).toISOString()}::timestamptz`);
  }
  if (accountId) {
    conditions.push(eq(transactions.accountId, accountId));
  }
  if (search) {
    conditions.push(
      sql`(${transactions.name} ILIKE ${"%" + search + "%"} OR ${transactions.merchantName} ILIKE ${"%" + search + "%"})`,
    );
  }

  const whereClause = and(...conditions);
  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        date: transactions.date,
        name: transactions.name,
        merchantName: transactions.merchantName,
        amount: transactions.amount,
        category: transactions.category,
        pending: transactions.pending,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .where(whereClause)
      .orderBy(desc(transactions.date))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(whereClause),
  ]);

  return c.json({
    transactions: rows,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize: limit,
  });
});

// GET /spending-summary - Spending by category for a date range
transactionRoutes.get("/spending-summary", async (c) => {
  const session = c.get("session");
  const now = new Date();
  const startDate = c.req.query("startDate")
    ? new Date(c.req.query("startDate")!)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1); // Previous month start
  const endDate = c.req.query("endDate")
    ? new Date(c.req.query("endDate")!)
    : new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); // Previous month end

  const conditions = [
    eq(transactions.tenantId, session.tenantId),
    sql`${transactions.date} >= ${startDate.toISOString()}::timestamptz`,
    sql`${transactions.date} <= ${endDate.toISOString()}::timestamptz`,
  ];

  const rows = await db
    .select({
      category: transactions.category,
      total: sql<string>`sum(${transactions.amount})`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.category)
    .orderBy(sql`sum(${transactions.amount}) DESC`);

  // Separate income (negative amounts) from spending (positive amounts)
  let totalSpending = 0;
  let totalIncome = 0;

  const categories = rows.map((row) => {
    const total = parseFloat(row.total || "0");
    const isTransfer = row.category === "transfer";
    if (total < 0 && !isTransfer) {
      totalIncome += Math.abs(total);
    } else if (total > 0 && !isTransfer) {
      totalSpending += total;
    }
    return {
      category: row.category,
      total: Math.round(Math.abs(total) * 100) / 100,
      count: row.count,
      percentage: 0, // calculated below
    };
  });

  // Calculate percentages based on spending only (exclude income)
  for (const cat of categories) {
    if (cat.category !== "income" && totalSpending > 0) {
      cat.percentage = Math.round((cat.total / totalSpending) * 10000) / 100;
    }
  }

  return c.json({
    categories,
    totalSpending: Math.round(totalSpending * 100) / 100,
    totalIncome: Math.round(totalIncome * 100) / 100,
    netCashFlow: Math.round((totalIncome - totalSpending) * 100) / 100,
    period: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
  });
});

// GET /monthly-trend - Monthly income vs expenses for last 6 months
transactionRoutes.get("/monthly-trend", async (c) => {
  const session = c.get("session");
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
      amount: transactions.amount,
      category: transactions.category,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, session.tenantId),
        sql`${transactions.date} >= ${sixMonthsAgo.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(sql`to_char(${transactions.date}, 'YYYY-MM')`);

  // Aggregate by month
  const monthMap = new Map<string, { income: number; expenses: number }>();

  // Pre-populate the last 6 months
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, { income: 0, expenses: 0 });
  }

  for (const row of rows) {
    const month = row.month;
    const amount = parseFloat(row.amount || "0");
    const entry = monthMap.get(month) ?? { income: 0, expenses: 0 };

    if (row.category !== "transfer") {
      if (amount < 0) {
        entry.income += Math.abs(amount);
      } else {
        entry.expenses += amount;
      }
    }

    monthMap.set(month, entry);
  }

  const months = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      income: Math.round(data.income * 100) / 100,
      expenses: Math.round(data.expenses * 100) / 100,
      net: Math.round((data.income - data.expenses) * 100) / 100,
    }));

  return c.json({ months });
});
