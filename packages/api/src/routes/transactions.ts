import { Hono } from "hono";
import { eq, and, sql, desc, asc, notInArray, inArray, transactions, accounts, categories, categoryGroups, type SQL } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { excludedTxnAccountIds } from "../lib/account-balances.js";
import { buildPeriods } from "../lib/trend.js";
import { validateQueryBody, buildKeysetPredicate, encodeCursor, cursorForRow } from "../lib/txn-query.js";
import { loadTaxonomy, UUID_RE } from "../lib/taxonomy.js";

export const transactionRoutes = new Hono<AuthEnv>();

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
    // Category ids only (tenant-scoped existence check keeps the 400 crisp).
    const taxonomy = await loadTaxonomy(session.tenantId);
    const target = UUID_RE.test(category) ? taxonomy.find((t) => t.id === category) : undefined;
    if (!target) return c.json({ error: "Unknown category" }, 400);
    conditions.push(eq(transactions.categoryId, target.id));
  }
  if (startDate) {
    conditions.push(sql`${transactions.date} >= ${new Date(startDate).toISOString()}::timestamptz`);
  }
  if (endDate) {
    conditions.push(sql`${transactions.date} <= ${new Date(endDate).toISOString()}::timestamptz`);
  }
  if (accountId) {
    conditions.push(eq(transactions.accountId, accountId));
  } else {
    // Hide transactions from accounts the user excluded from spending views.
    // Only when not drilling into a specific account on purpose.
    const excludedIds = await excludedTxnAccountIds(session.tenantId);
    if (excludedIds.length > 0) {
      conditions.push(notInArray(transactions.accountId, excludedIds));
    }
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
        accountName: accounts.name,
        date: transactions.date,
        name: transactions.name,
        merchantName: transactions.merchantName,
        amount: transactions.amount,
        categoryId: transactions.categoryId,
        pending: transactions.pending,
        notes: transactions.notes,
        excludedAt: transactions.excludedAt,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
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

// POST /query — dedicated transactions browser endpoint: filter + sort +
// group + keyset-cursor pagination in one place (spec: transactions-page).
transactionRoutes.post("/query", async (c) => {
  const session = c.get("session");
  const parsed = validateQueryBody(await c.req.json().catch(() => ({})));
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const { filters, groupBy, sort, limit, cursor } = parsed.ok;

  const conditions = [eq(transactions.tenantId, session.tenantId)];
  if (filters.search) {
    conditions.push(sql`(${transactions.name} ILIKE ${"%" + filters.search + "%"} OR ${transactions.merchantName} ILIKE ${"%" + filters.search + "%"})`);
  }
  if (filters.categoryIds) conditions.push(inArray(transactions.categoryId, filters.categoryIds));
  if (filters.accountIds) {
    conditions.push(inArray(transactions.accountId, filters.accountIds));
  } else {
    const excludedIds = await excludedTxnAccountIds(session.tenantId);
    if (excludedIds.length > 0) conditions.push(notInArray(transactions.accountId, excludedIds));
  }
  if (filters.startDate) conditions.push(sql`${transactions.date} >= ${filters.startDate.toISOString()}::timestamptz`);
  if (filters.endDate) conditions.push(sql`${transactions.date} <= ${filters.endDate.toISOString()}::timestamptz`);
  if (filters.amountMin != null) conditions.push(sql`abs(${transactions.amount}) >= ${filters.amountMin}`);
  if (filters.amountMax != null) conditions.push(sql`abs(${transactions.amount}) <= ${filters.amountMax}`);
  if (filters.merchant) conditions.push(sql`coalesce(${transactions.merchantName}, ${transactions.name}) = ${filters.merchant}`);
  const where = and(...conditions);

  // Summary over the FULL filter match; transfers and per-transaction
  // excluded rows stay out of the money sums (count still includes them —
  // it mirrors what the list shows).
  const [agg] = await db.select({
    count: sql<number>`count(*)::int`,
    spent: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.amount} > 0 and coalesce(${categoryGroups.type}::text, 'expense') != 'transfer' and ${transactions.excludedAt} is null), 0)`,
    income: sql<string>`coalesce(-sum(${transactions.amount}) filter (where ${transactions.amount} < 0 and coalesce(${categoryGroups.type}::text, 'expense') != 'transfer' and ${transactions.excludedAt} is null), 0)`,
  }).from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(where);
  const summary = {
    count: agg?.count ?? 0,
    totalSpent: Math.round(parseFloat(agg?.spent ?? "0") * 100) / 100,
    totalIncome: Math.round(parseFloat(agg?.income ?? "0") * 100) / 100,
  };

  if (groupBy) {
    // Stable ids-with-fallback keys (decision 4): key = systemKey ?? id so the
    // un-migrated web's getCategoryDisplay renders all legacy keys; label is
    // the tenant's display name.
    let keyExpr: SQL<string>;
    let labelExpr: SQL<string>;
    let groupCols: SQL[] | null = null;
    if (groupBy === "category") {
      keyExpr = sql<string>`coalesce(${categories.systemKey}, ${categories.id}::text, 'other')`;
      labelExpr = sql<string>`coalesce(${categories.name}, 'Other')`;
      groupCols = [sql`${categories.id}`, sql`${categories.systemKey}`, sql`${categories.name}`];
    } else if (groupBy === "group") {
      keyExpr = sql<string>`coalesce(${categoryGroups.systemKey}, ${categoryGroups.id}::text, 'other')`;
      labelExpr = sql<string>`coalesce(${categoryGroups.name}, 'Other')`;
      groupCols = [sql`${categoryGroups.id}`, sql`${categoryGroups.systemKey}`, sql`${categoryGroups.name}`];
    } else {
      keyExpr = sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`;
      labelExpr = keyExpr;
    }
    const rows = await db.select({
      key: keyExpr,
      label: labelExpr,
      count: sql<number>`count(*)::int`,
      total: sql<string>`sum(${transactions.amount})`,
    }).from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(and(where, sql`${transactions.excludedAt} is null`))
      .groupBy(...(groupCols ?? [keyExpr]))
      .orderBy(sql`abs(sum(${transactions.amount})) desc`);
    return c.json({
      mode: "groups",
      groups: rows.map((r) => ({
        key: r.key,
        label: r.label,
        count: r.count,
        total: Math.round(parseFloat(r.total ?? "0") * 100) / 100,
      })),
      summary,
    });
  }

  const listConditions = cursor ? and(where, buildKeysetPredicate(sort, cursor)) : where;
  const sortCol = sort.field === "date" ? transactions.date : transactions.amount;
  const order = sort.dir === "desc"
    ? [desc(sortCol), desc(transactions.id)]
    : [asc(sortCol), asc(transactions.id)];

  const rows = await db.select({
    id: transactions.id,
    accountId: transactions.accountId,
    accountName: accounts.name,
    date: transactions.date,
    name: transactions.name,
    merchantName: transactions.merchantName,
    amount: transactions.amount,
    categoryId: transactions.categoryId,
    pending: transactions.pending,
    notes: transactions.notes,
    excludedAt: transactions.excludedAt,
  }).from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(listConditions)
    .orderBy(...order)
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last
    ? encodeCursor(cursorForRow(sort, last))
    : null;

  return c.json({ mode: "list", transactions: page, nextCursor, summary });
});

// PATCH /:id - Update a transaction's category, merchantName, notes, and/or excluded
transactionRoutes.patch("/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const body = await c.req.json();

  const updates: Record<string, unknown> = {};
  let categoryChanged = false;

  if (body.category !== undefined) {
    // Category ids only. Disabled targets are rejected: pickers hide them,
    // so only stale clients send one.
    if (typeof body.category !== "string" || !UUID_RE.test(body.category)) {
      return c.json({ error: "Invalid category" }, 400);
    }
    const taxonomy = await loadTaxonomy(session.tenantId);
    const target = taxonomy.find((t) => t.id === body.category);
    if (!target) return c.json({ error: "Invalid category" }, 400);
    if (target.disabledAt) return c.json({ error: "Category is disabled" }, 400);
    updates.categoryId = target.id;
    updates.categorySource = "manual";
    updates.linkedTransactionId = null;
    categoryChanged = true;
  }
  if (body.merchantName !== undefined) {
    if (typeof body.merchantName !== 'string') return c.json({ error: "merchantName must be a string" }, 400);
    const m = body.merchantName.trim();
    if (!m || m.length > 255) return c.json({ error: "merchantName must be 1-255 characters" }, 400);
    updates.merchantName = m;
    updates.merchantEditedAt = new Date();
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') return c.json({ error: "notes must be a string" }, 400);
    const n = body.notes;
    if (n.length > 2000) return c.json({ error: "notes must be at most 2000 characters" }, 400);
    updates.notes = n.trim() === "" ? null : n;
  }
  if (body.excluded !== undefined) {
    if (typeof body.excluded !== 'boolean') return c.json({ error: "excluded must be a boolean" }, 400);
    updates.excludedAt = body.excluded ? new Date() : null;
  }

  // No fields provided — no-op
  if (Object.keys(updates).length === 0) return c.json({ success: true });

  const existing = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.tenantId, session.tenantId)),
  });
  if (!existing) return c.json({ error: "Transaction not found" }, 404);

  await db.transaction(async (tx) => {
    await tx.update(transactions)
      .set(updates as any)
      .where(eq(transactions.id, id));

    // Unlink the partner of a transfer pair only when category changed.
    // The partner keeps category=transfer and re-enters the matcher pool.
    if (categoryChanged && existing.linkedTransactionId) {
      await tx.update(transactions)
        .set({ linkedTransactionId: null })
        .where(and(eq(transactions.id, existing.linkedTransactionId), eq(transactions.tenantId, session.tenantId)));
    }
  });

  return c.json({ success: true });
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
    sql`${transactions.excludedAt} is null`,
  ];
  const excludedIds = await excludedTxnAccountIds(session.tenantId);
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

  // Separate income (negative amounts) from spending (positive amounts)
  let totalSpending = 0;
  let totalIncome = 0;

  const categoryRows = rows.map((row) => {
    const total = parseFloat(row.total || "0");
    const isTransfer = row.groupType === "transfer";
    if (total < 0 && !isTransfer) {
      totalIncome += Math.abs(total);
    } else if (total > 0 && !isTransfer) {
      totalSpending += total;
    }
    return {
      id: row.id,
      name: row.name ?? "Other",
      systemKey: row.systemKey,
      groupId: row.groupId,
      groupName: row.groupName ?? "Other",
      groupType: row.groupType ?? "expense",
      total: Math.round(Math.abs(total) * 100) / 100,
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

  return c.json({
    categories: categoryRows,
    totalSpending: Math.round(totalSpending * 100) / 100,
    totalIncome: Math.round(totalIncome * 100) / 100,
    netCashFlow: Math.round((totalIncome - totalSpending) * 100) / 100,
    period: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    },
  });
});

// GET /monthly-trend - income vs expenses per period (month default, or year)
transactionRoutes.get("/monthly-trend", async (c) => {
  const session = c.get("session");
  const granularity = c.req.query("granularity") === "year" ? "year" : "month";
  const now = new Date();

  const parsed = parseInt(c.req.query("limit") ?? "", 10);
  const limit = Number.isFinite(parsed)
    ? Math.min(60, Math.max(1, parsed))
    : (granularity === "month" ? 13 : null);
  const bucket = granularity === "month" ? "YYYY-MM" : "YYYY";

  const conditions = [
    eq(transactions.tenantId, session.tenantId),
    sql`${transactions.excludedAt} is null`,
  ];
  if (granularity === "month" && limit != null) {
    const from = new Date(now.getFullYear(), now.getMonth() - (limit - 1), 1);
    conditions.push(sql`${transactions.date} >= ${from.toISOString()}::timestamptz`);
  }
  const excludedIds = await excludedTxnAccountIds(session.tenantId);
  if (excludedIds.length > 0) conditions.push(notInArray(transactions.accountId, excludedIds));

  const rows = await db.select({
    period: sql<string>`to_char(${transactions.date}, ${bucket})`,
    amount: transactions.amount,
    groupType: categoryGroups.type,
  }).from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(...conditions));

  return c.json({ periods: buildPeriods(rows, { granularity, limit, now }) });
});
