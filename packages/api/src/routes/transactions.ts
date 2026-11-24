import { Hono } from "hono";
import { eq, and, sql, desc, asc, inArray, transactions, accounts, categories, categoryGroups, type SQL } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { buildPeriods } from "../lib/trend.js";
import { categoryUsual, computeCashFlow, cashFlowForFilter } from "../lib/cash-flow.js";
import { validateQueryBody, buildKeysetPredicate, encodeCursor, cursorForRow } from "../lib/txn-query.js";
import { loadTaxonomy, UUID_RE } from "../lib/taxonomy.js";
import { isIncome, isTransfer, parseTxnFilterQuery, txnFilterConditions } from "../lib/txn-filter.js";

export const transactionRoutes = new Hono<AuthEnv>();

// The universal filter from a request's query string (lib/txn-filter.ts).
function queryFilter(c: { req: { query: (k: string) => string | undefined; queries: (k: string) => string[] | undefined } }) {
  return parseTxnFilterQuery((k) => c.req.query(k), (k) => c.req.queries(k));
}

// GET / - List transactions with pagination and filters
transactionRoutes.get("/", async (c) => {
  const session = c.get("session");
  const page = Math.max(1, parseInt(c.req.query("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50", 10)));
  const category = c.req.query("category");
  const parsed = queryFilter(c);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);

  const conditions = await txnFilterConditions(session.tenantId, parsed.ok);
  if (category) {
    // Category ids only (tenant-scoped existence check keeps the 400 crisp).
    const taxonomy = await loadTaxonomy(session.tenantId);
    const target = UUID_RE.test(category) ? taxonomy.find((t) => t.id === category) : undefined;
    if (!target) return c.json({ error: "Unknown category" }, 400);
    conditions.push(eq(transactions.categoryId, target.id));
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

  // One predicate builder for every endpoint, so a drill handed over from
  // /spending is filtered identically whichever endpoint reads it.
  const conditions = await txnFilterConditions(session.tenantId, filters);
  const where = and(...conditions);

  // Summary over the FULL filter match. The count and date span mirror what the
  // list shows (excluded rows included). The money figures are the Spending
  // page's own math (lib/cash-flow.ts): net per category, then classify, with
  // transfers and excluded rows out. So Money out here is the same number as
  // Spent on /spending-summary for the same filter, refunds included.
  const notTransfer = sql`coalesce(${categoryGroups.type}::text, 'expense') != 'transfer'`;
  const [[agg], flow] = await Promise.all([
    db.select({
      count: sql<number>`count(*)::int`,
      earliest: sql<string | null>`min(${transactions.date})`,
      latest: sql<string | null>`max(${transactions.date})`,
      // Money moved between the user's own accounts: the outgoing side of
      // each transfer, so a pair counts once.
      transferred: sql<string>`coalesce(sum(case when ${isTransfer} and ${transactions.amount} > 0 and ${transactions.excludedAt} is null then ${transactions.amount} else 0 end), 0)`,
    }).from(transactions).where(where),
    cashFlowForFilter(session.tenantId, filters),
  ]);
  // The single biggest money in and money out, under the money sums'
  // exclusions (transfers included), as whole rows so the page can open them.
  const rowSelect = {
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
  };
  const largest = (side: SQL, order: SQL) =>
    db.select(rowSelect).from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(and(where, side, notTransfer, sql`${transactions.excludedAt} is null`))
      .orderBy(order, desc(transactions.id))
      .limit(1)
      .then((r) => r[0] ?? null);
  const [largestCredit, largestDebit] = cursor
    ? [null, null]
    : await Promise.all([
        // Each side's largest follows the same rule as its total: Money in is income
        // categories (a refund is not income), Money out is everything else.
        largest(sql`${transactions.amount} < 0 and ${isIncome}`, asc(transactions.amount)),
        largest(sql`${transactions.amount} > 0 and not ${isIncome}`, desc(transactions.amount)),
      ]);
  const summary = {
    count: agg?.count ?? 0,
    totalSpent: flow.spending,
    totalIncome: flow.income,
    // Money out and money in: the same figures, under the names the
    // Transactions KPI strips read.
    totalDebits: flow.spending,
    totalCredits: flow.income,
    largestCredit,
    largestDebit,
    totalTransferred: Math.round(parseFloat(agg?.transferred ?? "0") * 100) / 100,
    earliest: agg?.earliest ?? null,
    latest: agg?.latest ?? null,
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

  const rows = await db.select(rowSelect).from(transactions)
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
// GET /merchants - The tenant's merchant names with their counts, most used
// first. Feeds the rename suggestions and the filter sheet's merchant picker:
// `q` narrows by name, and the universal filter params scope the counts
// (a merchant filter itself is ignored here, or the picker could only ever
// list what is already picked).
transactionRoutes.get("/merchants", async (c) => {
  const session = c.get("session");
  const parsed = queryFilter(c);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const { merchants: _picked, ...scope } = parsed.ok;
  const conditions = await txnFilterConditions(session.tenantId, scope);
  const q = c.req.query("q")?.trim();
  const merchant = sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`;
  if (q) conditions.push(sql`${merchant} ILIKE ${"%" + q + "%"}`);
  const rows = await db.select({ name: merchant, count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(merchant)
    .orderBy(sql`count(*) desc`, merchant)
    .limit(1000);
  return c.json({
    merchants: rows.map((r) => r.name),
    counts: rows.map((r) => ({ name: r.name, count: r.count })),
  });
});

// The editable fields of a PATCH body, validated. Shared by the single-row and
// the bulk route so both accept exactly the same fields.
async function parseTxnUpdates(
  body: any,
  tenantId: string,
): Promise<{ updates: Record<string, unknown>; categoryChanged: boolean } | { error: string }> {
  const updates: Record<string, unknown> = {};
  let categoryChanged = false;

  if (body.category !== undefined) {
    // Category ids only. Disabled targets are rejected: pickers hide them,
    // so only stale clients send one.
    if (typeof body.category !== "string" || !UUID_RE.test(body.category)) {
      return { error: "Invalid category" };
    }
    const taxonomy = await loadTaxonomy(tenantId);
    const target = taxonomy.find((t) => t.id === body.category);
    if (!target) return { error: "Invalid category" };
    if (target.disabledAt) return { error: "Category is disabled" };
    updates.categoryId = target.id;
    updates.categorySource = "manual";
    updates.linkedTransactionId = null;
    categoryChanged = true;
  }
  if (body.merchantName === null) {
    // Drops a rename, back to the bank's own description.
    updates.merchantName = null;
    updates.merchantEditedAt = null;
  } else if (body.merchantName !== undefined) {
    if (typeof body.merchantName !== 'string') return { error: "merchantName must be a string" };
    const m = body.merchantName.trim();
    if (!m || m.length > 255) return { error: "merchantName must be 1-255 characters" };
    updates.merchantName = m;
    updates.merchantEditedAt = new Date();
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') return { error: "notes must be a string" };
    const n = body.notes;
    if (n.length > 2000) return { error: "notes must be at most 2000 characters" };
    updates.notes = n.trim() === "" ? null : n;
  }
  if (body.excluded !== undefined) {
    if (typeof body.excluded !== 'boolean') return { error: "excluded must be a boolean" };
    updates.excludedAt = body.excluded ? new Date() : null;
  }
  return { updates, categoryChanged };
}

// PATCH /bulk - Apply the same field edits to many transactions at once.
// Registered before /:id so "bulk" is not read as a transaction id.
transactionRoutes.patch("/bulk", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();

  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((id: unknown) => typeof id === "string" && UUID_RE.test(id))) {
    return c.json({ error: "ids must be 1-500 transaction ids" }, 400);
  }
  const parsed = await parseTxnUpdates(body, session.tenantId);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const { updates, categoryChanged } = parsed;
  if (Object.keys(updates).length === 0) return c.json({ success: true, updated: 0 });

  const existing = await db.select({ id: transactions.id, linkedTransactionId: transactions.linkedTransactionId })
    .from(transactions)
    .where(and(eq(transactions.tenantId, session.tenantId), inArray(transactions.id, ids)));
  if (existing.length !== new Set(ids).size) return c.json({ error: "Transaction not found" }, 404);

  await db.transaction(async (tx) => {
    await tx.update(transactions)
      .set(updates as any)
      .where(and(eq(transactions.tenantId, session.tenantId), inArray(transactions.id, ids)));

    // Same rule as the single-row route: a recategorized transfer frees its
    // partner. A partner that is itself in the selection was just updated.
    const partners = categoryChanged
      ? existing.map((t) => t.linkedTransactionId).filter((p): p is string => p != null && !ids.includes(p))
      : [];
    if (partners.length > 0) {
      await tx.update(transactions)
        .set({ linkedTransactionId: null })
        .where(and(eq(transactions.tenantId, session.tenantId), inArray(transactions.id, partners)));
    }
  });

  return c.json({ success: true, updated: existing.length });
});

transactionRoutes.patch("/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const body = await c.req.json();

  const parsed = await parseTxnUpdates(body, session.tenantId);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const { updates, categoryChanged } = parsed;

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

  const parsed = queryFilter(c);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  // The window comes from startDate/endDate above; the rest of the filter
  // scopes the rows the same way /transactions/query does.
  const { startDate: _s, endDate: _e, ...scope } = parsed.ok;
  // A one-month window also carries each spending category's usual month (the
  // median of the three before it, same filter), for the page's pace marker.
  const oneMonth =
    startDate.getUTCDate() === 1 &&
    endDate.getUTCFullYear() === startDate.getUTCFullYear() &&
    endDate.getUTCMonth() === startDate.getUTCMonth();
  const [flow, usual] = await Promise.all([
    computeCashFlow(session.tenantId, startDate, endDate, scope),
    oneMonth ? categoryUsual(session.tenantId, startDate, scope) : Promise.resolve(new Map<string, number>()),
  ]);

  return c.json({
    categories: flow.categories.map((cat) => ({ ...cat, usual: (cat.id && usual.get(cat.id)) ?? null })),
    totalSpending: flow.spending,
    totalIncome: flow.income,
    netCashFlow: flow.net,
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

  const parsedFilter = queryFilter(c);
  if ("error" in parsedFilter) return c.json({ error: parsedFilter.error }, 400);
  // The same scope the spending page applies to /spending-summary's rows, so
  // the bars and the delta pill describe the same money the hero does. The
  // window is the trend's own (limit), not the filter's dates.
  const { startDate: _s, endDate: _e, ...scope } = parsedFilter.ok;
  const conditions = await txnFilterConditions(session.tenantId, scope);
  conditions.push(sql`${transactions.excludedAt} is null`);
  if (granularity === "month" && limit != null) {
    const from = new Date(now.getFullYear(), now.getMonth() - (limit - 1), 1);
    conditions.push(sql`${transactions.date} >= ${from.toISOString()}::timestamptz`);
  }

  // Net per period PER CATEGORY before classifying, exactly as
  // /spending-summary does for its own window. Summing raw transaction rows
  // here instead meant a refund cancelled against its category on one endpoint
  // and not the other, so the same month reported two different totals.
  const periodExpr = sql<string>`to_char(${transactions.date}, ${bucket})`;
  const rows = await db.select({
    period: periodExpr,
    amount: sql<string>`sum(${transactions.amount})`,
    groupType: categoryGroups.type,
  }).from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(and(...conditions))
    // GROUP BY 1 is the period expression in the select list. Repeating the
    // fragment here would bind the format string a second time, and Postgres
    // does not treat to_char(date, $1) and to_char(date, $2) as the same
    // expression — it rejects the query.
    .groupBy(sql`1`, categories.id, categoryGroups.type);

  return c.json({ periods: buildPeriods(rows, { granularity, limit, now }) });
});
