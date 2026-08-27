import { Hono } from "hono";
import { eq, and, desc, insights, accounts, sql } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { generateInsights } from "../lib/insights-engine.js";
import { readPathSteps } from "../lib/path-generator.js";
import { readHouseholdProfile } from "../lib/profile-resolver.js";

export const insightsRoutes = new Hono<AuthEnv>();

// Cloud Scheduler is the happy path for daily regeneration. If it stalls, the
// next read older than this window regenerates synchronously as a backstop.
const REGEN_STALE_MS = 48 * 60 * 60 * 1000;

function loadActiveInsights(tenantId: string) {
  return db
    .select()
    .from(insights)
    .where(
      and(
        eq(insights.tenantId, tenantId),
        sql`${insights.dismissed} IS NULL`,
        sql`${insights.actedOn} IS NULL`,
        sql`(${insights.snoozedUntil} IS NULL OR ${insights.snoozedUntil} < NOW())`,
        sql`(${insights.expiresAt} IS NULL OR ${insights.expiresAt} > NOW())`
      )
    )
    .orderBy(
      // Critical first, then high, medium, low
      sql`CASE ${insights.urgency}
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END`,
      desc(insights.createdAt)
    );
}

/**
 * The actions, read in the order of the plan they serve.
 *
 * Urgency alone is what this list used to be sorted by, and it is what made the
 * page a feed: a card at step six sat above the step the person is standing on
 * because it happened to be marked critical. So the step comes first, and
 * urgency decides the order WITHIN a step, which is what the SQL above already
 * gives us. The sort is stable, so nothing else has to be re-stated here.
 *
 * An action with no step is shown, after every action that has one. Dropping it
 * would silently lose real advice the path has no rung for, like a fraud alert
 * or a document to file.
 */
function inPathOrder<T extends { pathStepKey: string | null }>(
  rows: T[],
  steps: Awaited<ReturnType<typeof readPathSteps>>,
): T[] {
  if (steps.length === 0) return rows;
  const position = new Map(steps.map((s) => [s.key, s.step]));
  // A key that no longer names a step on the active path is treated exactly as
  // no key at all, which is what keeps a regenerated path from hiding anything.
  const at = (row: T) => position.get(row.pathStepKey ?? "") ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => at(a) - at(b));
}

// Only a tenant with accounts can produce actions. Used to skip the backstop
// lock/regen path for empty (pre-connection) tenants, whose lastActionsGeneratedAt
// is null and would otherwise re-enter generateInsights on every read only for it
// to no-op. Mirrors generateInsights' own 0-account early return.
async function tenantHasAccounts(tenantId: string): Promise<boolean> {
  const rows = await db
    .select({ one: sql`1` })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId))
    .limit(1);
  return rows.length > 0;
}

// List active insights (not dismissed, not snoozed, not expired)
insightsRoutes.get("/", async (c) => {
  const session = c.get("session");

  let rows = await loadActiveInsights(session.tenantId);
  // lastActionsGeneratedAt is household bookkeeping on the tenant profile row.
  let profile = await readHouseholdProfile(session.tenantId);

  const last = profile?.lastActionsGeneratedAt;
  const stale = !last || Date.now() - new Date(last).getTime() > REGEN_STALE_MS;
  if (stale && (await tenantHasAccounts(session.tenantId))) {
    // Advisory xact-lock keyed off the tenant id keeps concurrent stale reads
    // from double-generating. It lives on the transaction's connection and
    // auto-releases on commit/rollback, so it can't leak. If another request
    // holds it we skip and return the (possibly stale) rows we already have.
    let regenerated = false;
    try {
      regenerated = await db.transaction(async (tx) => {
        const locked = await tx.execute(
          sql`select pg_try_advisory_xact_lock(hashtext(${session.tenantId})) as locked`
        );
        if (!(locked as unknown as Array<{ locked: boolean }>)[0]?.locked) return false;
        await generateInsights(session.tenantId);
        return true;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Insights] Backstop regeneration failed: ${msg.slice(0, 300)}`);
    }
    if (regenerated) {
      rows = await loadActiveInsights(session.tenantId);
      profile = await readHouseholdProfile(session.tenantId);
    }
  }

  const pathSteps = await readPathSteps(session.tenantId);
  // A key that names no step on the path AS IT STANDS is not an answer, it is a
  // leftover: the path was reordered, or the step was taken off it, or nothing
  // has attached this action yet. Resolving here rather than in each reader is
  // what makes the payload mean what it says — a consumer that trusted the raw
  // column would file an orphan under a step that is not on the plan.
  const onPath = new Set(pathSteps.map((s) => s.key));

  return c.json({
    insights: inPathOrder(rows, pathSteps).map((r) => ({
      id: r.id,
      category: r.category,
      urgency: r.urgency,
      type: r.insightType,
      title: r.title,
      description: r.description,
      impact: r.impact,
      impactColor: r.impactColor,
      chatPrompt: r.chatPrompt,
      generatedBy: r.generatedBy,
      createdAt: r.createdAt,
      // The step of the path this action serves. Null when it serves none, and
      // null when the key names no step on the path as it stands.
      pathStepKey: r.pathStepKey && onPath.has(r.pathStepKey) ? r.pathStepKey : null,
    })),
    lastActionsGeneratedAt: profile?.lastActionsGeneratedAt ?? null,
  });
});

// Dismiss an insight
insightsRoutes.post("/:id/dismiss", async (c) => {
  const session = c.get("session");
  const { id } = c.req.param();

  await db
    .update(insights)
    .set({ dismissed: new Date() })
    .where(and(eq(insights.id, id), eq(insights.tenantId, session.tenantId)));

  return c.json({ ok: true });
});

// Mark an insight as acted on
insightsRoutes.post("/:id/acted", async (c) => {
  const session = c.get("session");
  const { id } = c.req.param();

  await db
    .update(insights)
    .set({ actedOn: new Date() })
    .where(and(eq(insights.id, id), eq(insights.tenantId, session.tenantId)));

  return c.json({ ok: true });
});

// Snooze an insight for N hours (default 24h)
insightsRoutes.post("/:id/snooze", async (c) => {
  const session = c.get("session");
  const { id } = c.req.param();
  const { hours = 24 } = (await c.req.json().catch(() => ({}))) as { hours?: number };

  const until = new Date(Date.now() + hours * 60 * 60 * 1000);

  await db
    .update(insights)
    .set({ snoozedUntil: until })
    .where(and(eq(insights.id, id), eq(insights.tenantId, session.tenantId)));

  return c.json({ ok: true, snoozedUntil: until.toISOString() });
});

// Get dismissed/historical insights
insightsRoutes.get("/history", async (c) => {
  const session = c.get("session");

  const rows = await db
    .select()
    .from(insights)
    .where(
      and(
        eq(insights.tenantId, session.tenantId),
        sql`${insights.dismissed} IS NOT NULL`
      )
    )
    .orderBy(desc(insights.createdAt))
    .limit(50);

  return c.json({
    insights: rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      description: r.description,
      impact: r.impact,
      dismissedAt: r.dismissed,
      actedOnAt: r.actedOn,
      createdAt: r.createdAt,
    })),
  });
});

// Generate new insights (triggers AI analysis)
insightsRoutes.post("/generate", async (c) => {
  const session = c.get("session");

  try {
    const count = await generateInsights(session.tenantId);
    return c.json({ ok: true, generated: count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Insights] Generation failed: ${msg.slice(0, 300)}`);
    return c.json({ error: "generation_failed" }, 502);
  }
});
