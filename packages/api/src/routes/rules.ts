import { Hono } from "hono";
import { eq, and, sql, inArray, categoryRules, transactions } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { validateRule, ruleMatches, firstMatchingRule } from "../lib/category-rules.js";

export const rulesRoutes = new Hono<AuthEnv>();

function toCriteria(body: Record<string, unknown>) {
  const s = (k: string) => (body[k] === undefined || body[k] === null || body[k] === "" ? null : String(body[k]));
  return {
    merchantContains: s("merchantContains"),
    amountEquals: s("amountEquals"),
    amountMin: s("amountMin"),
    amountMax: s("amountMax"),
    accountId: s("accountId"),
    matchCategory: s("matchCategory"),
    setCategory: String(body.setCategory),
  };
}

// GET / — list rules in priority order
rulesRoutes.get("/", async (c) => {
  const session = c.get("session");
  const rules = await db.select().from(categoryRules)
    .where(eq(categoryRules.tenantId, session.tenantId))
    .orderBy(categoryRules.priority);
  return c.json({ rules });
});

// POST / — create; priority = max+1 (creation order, not editable in v1)
rulesRoutes.post("/", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();
  const err = validateRule(body);
  if (err) return c.json({ error: err }, 400);
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${categoryRules.priority}), 0)::int` })
    .from(categoryRules)
    .where(eq(categoryRules.tenantId, session.tenantId));
  const [rule] = await db.insert(categoryRules)
    .values({ tenantId: session.tenantId, priority: max + 1, ...toCriteria(body) } as any)
    .returning();
  return c.json({ rule });
});

// PATCH /:id — edit criteria/action (priority not editable in v1).
// Replace semantics: the client must send the complete rule body; absent criteria fields are cleared.
rulesRoutes.patch("/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const body = await c.req.json();
  const err = validateRule(body);
  if (err) return c.json({ error: err }, 400);
  const [rule] = await db.update(categoryRules)
    .set(toCriteria(body) as any)
    .where(and(eq(categoryRules.id, id), eq(categoryRules.tenantId, session.tenantId)))
    .returning();
  if (!rule) return c.json({ error: "Rule not found" }, 404);
  return c.json({ rule });
});

// DELETE /:id — categories already written stay as-is
rulesRoutes.delete("/:id", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  await db.delete(categoryRules)
    .where(and(eq(categoryRules.id, id), eq(categoryRules.tenantId, session.tenantId)));
  return c.json({ success: true });
});

// Shared: the existing transactions this rule would change. Excludes manual
// and transfer-sourced rows, rows already in the target category, and rows an
// earlier-priority rule claims first.
async function affectedTransactionIds(tenantId: string, ruleId: string): Promise<string[]> {
  const rule = await db.query.categoryRules.findFirst({
    where: and(eq(categoryRules.id, ruleId), eq(categoryRules.tenantId, tenantId)),
  });
  if (!rule) return [];
  const earlier = await db.select().from(categoryRules)
    .where(and(eq(categoryRules.tenantId, tenantId), sql`${categoryRules.priority} < ${rule.priority}`))
    .orderBy(categoryRules.priority);
  const rows = await db.select({
    id: transactions.id,
    name: transactions.name,
    merchantName: transactions.merchantName,
    amount: transactions.amount,
    category: transactions.category,
    accountId: transactions.accountId,
  }).from(transactions).where(and(
    eq(transactions.tenantId, tenantId),
    sql`${transactions.categorySource} IN ('auto', 'rule')`,
  ));
  return rows
    .filter((t) => t.category !== rule.setCategory)
    .filter((t) => ruleMatches(rule, t))
    .filter((t) => firstMatchingRule(earlier, t) === null)
    .map((t) => t.id);
}

// POST /:id/preview — dry run for the "apply to N existing?" prompt
rulesRoutes.post("/:id/preview", async (c) => {
  const session = c.get("session");
  const ids = await affectedTransactionIds(session.tenantId, c.req.param("id"));
  return c.json({ count: ids.length });
});

// POST /:id/apply — backfill
rulesRoutes.post("/:id/apply", async (c) => {
  const session = c.get("session");
  const id = c.req.param("id");
  const rule = await db.query.categoryRules.findFirst({
    where: and(eq(categoryRules.id, id), eq(categoryRules.tenantId, session.tenantId)),
  });
  if (!rule) return c.json({ error: "Rule not found" }, 404);
  const ids = await affectedTransactionIds(session.tenantId, id);
  if (ids.length > 0) {
    await db.update(transactions)
      .set({ category: rule.setCategory as any, categorySource: "rule" as any })
      .where(inArray(transactions.id, ids));
  }
  return c.json({ updated: ids.length });
});
