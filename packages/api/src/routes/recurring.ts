import { Hono } from "hono";
import { and, asc, eq, sql, recurringTransactions } from "@lasagna/core";
import { db } from "../lib/db.js";
import { detectRecurringForTenant } from "../lib/recurring-detector.js";
import { type AuthEnv } from "../middleware/auth.js";

export const recurringRoutes = new Hono<AuthEnv>();

// List active recurring patterns (sorted by next due date, soonest first)
recurringRoutes.get("/", async (c) => {
  const session = c.get("session");
  const rows = await db
    .select()
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.tenantId, session.tenantId),
        eq(recurringTransactions.isActive, true),
        sql`${recurringTransactions.dismissedAt} IS NULL`,
      ),
    )
    .orderBy(asc(recurringTransactions.nextDueDate));

  return c.json({ recurring: rows });
});

// Trigger detection — LLM analyzes recent transactions and upserts rows
recurringRoutes.post("/detect", async (c) => {
  const session = c.get("session");
  try {
    const result = await detectRecurringForTenant(session.tenantId);
    return c.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// Dismiss a recurring pattern (e.g., false positive)
recurringRoutes.post("/:id/dismiss", async (c) => {
  const session = c.get("session");
  const { id } = c.req.param();
  await db
    .update(recurringTransactions)
    .set({ dismissedAt: new Date(), isActive: false })
    .where(
      and(
        eq(recurringTransactions.id, id),
        eq(recurringTransactions.tenantId, session.tenantId),
      ),
    );
  return c.json({ ok: true });
});
