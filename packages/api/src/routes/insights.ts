import { Hono } from "hono";
import { eq, and, desc, insights, sql, financialProfiles } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { generateInsights } from "../lib/insights-engine.js";

export const insightsRoutes = new Hono<AuthEnv>();

// List active insights (not dismissed, not expired)
insightsRoutes.get("/", async (c) => {
  const session = c.get("session");

  const rows = await db
    .select()
    .from(insights)
    .where(
      and(
        eq(insights.tenantId, session.tenantId),
        sql`${insights.dismissed} IS NULL`,
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

  // Get financial profile to retrieve lastActionsGeneratedAt
  const profile = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, session.tenantId),
  });

  return c.json({
    insights: rows.map((r) => ({
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
