import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { financialPlans, eq, ne, and, desc } from "@lasagna/core";
import { type AuthEnv } from "../middleware/auth.js";
import { buildFinancialSnapshot } from "../services/financial-snapshot.js";
import { buildPortfolioSection } from "../services/portfolio-section.js";
import { buildRetirementReadiness } from "../services/retirement-readiness.js";
import { buildWhatIfSection } from "../services/what-if-section.js";
import { buildSuggestionsSection } from "../services/suggestions-section.js";
import { buildNarrativeSection } from "../services/narrative-section.js";
import { toCompactGrounding, resolvePersonContext, parseAssumptions } from "../services/plan-grounding.js";
import { regeneratePlan, type PlanAssumptions, type DocumentSections } from "../services/plan-assumptions.js";

export const financialPlansRouter = new Hono<AuthEnv>();

const uuidSchema = z.string().uuid();

const createSchema = z.object({
  title: z.string().min(1).max(255).optional(),
});

// Assumptions PATCH — each supplied scalar field is merged; a null clears that
// field (the chip's remove affordance sends null). `unsellPropertyAccountId`
// removes one property from the sold list (the sold-property chip's × affordance),
// reversing a sale.
const assumptionsSchema = z.object({
  includeSocialSecurity: z.boolean().nullable().optional(),
  retirementAge: z.number().int().nullable().optional(),
  expectedReturn: z.number().nullable().optional(),
  monthlySpend: z.number().nullable().optional(),
  unsellPropertyAccountId: z.string().optional(),
});

function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

// List this user's non-archived plans, newest first.
financialPlansRouter.get("/", async (c) => {
  const { tenantId, userId } = c.get("session");

  const results = await db
    .select({
      id: financialPlans.id,
      title: financialPlans.title,
      status: financialPlans.status,
      createdAt: financialPlans.createdAt,
      updatedAt: financialPlans.updatedAt,
    })
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
      ),
    )
    .orderBy(desc(financialPlans.createdAt));

  return c.json({ plans: results });
});

// Create a plan — assemble the Financial Snapshot document up front so the row
// is never empty, then persist and return it.
financialPlansRouter.post("/", async (c) => {
  const { tenantId, userId } = c.get("session");

  let rawBody: unknown = {};
  try {
    rawBody = await c.req.json();
  } catch {
    // no body → default title
  }
  const parsed = createSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
  }

  const [snapshot, portfolio, retirement] = await Promise.all([
    buildFinancialSnapshot(tenantId, userId),
    buildPortfolioSection(tenantId),
    buildRetirementReadiness(tenantId, userId),
  ]);

  // What-if scenarios — re-run the SAME engine with overrides vs the base plan.
  // Pass the retirement section's success rate as the base so the panel's "base"
  // reconciles exactly with the Retirement Readiness verdict. Only worth running
  // when the base projection was actually computable; wrapped so a scenario
  // (or the whole build) can never fail plan creation.
  let whatIfs = null;
  if (retirement.computed) {
    try {
      whatIfs = await buildWhatIfSection(tenantId, userId, retirement.successRate);
    } catch (e) {
      console.error("[financial-plans] what-if generation failed:", e);
    }
  }

  // LLM sections (suggestions + editorial narrative), grounded on the SAME
  // compact figures the chat agent sees. Both run AFTER the deterministic
  // sections and each is wrapped so a model error or timeout can never fail plan
  // creation — on failure the plan simply ships without that section.
  let suggestions = null;
  let narrative = null;
  try {
    const person = await resolvePersonContext(tenantId, userId);
    const grounding = toCompactGrounding(
      "pending",
      parsed.data.title ?? "Financial Plan",
      { snapshot, portfolio, retirement },
      person,
    );
    // Independent calls off the same grounding; either can fail without the other.
    [suggestions, narrative] = await Promise.all([
      buildSuggestionsSection(tenantId, userId, grounding),
      buildNarrativeSection(tenantId, userId, grounding),
    ]);
  } catch (e) {
    console.error("[financial-plans] LLM section generation failed:", e);
  }

  const document = { sections: { snapshot, portfolio, retirement, ...(whatIfs ? { whatIfs } : {}), ...(suggestions ? { suggestions } : {}), ...(narrative ? { narrative } : {}) } };

  const [plan] = await db
    .insert(financialPlans)
    .values({
      tenantId,
      userId,
      title: parsed.data.title ?? "Financial Plan",
      document: JSON.stringify(document),
      status: "draft",
    })
    .returning();

  return c.json({ plan: { ...plan, document } }, 201);
});

// Get a single plan (with parsed document), scoped to this tenant + user.
financialPlansRouter.get("/:id", async (c) => {
  const { tenantId, userId } = c.get("session");
  const planId = c.req.param("id");

  if (!uuidSchema.safeParse(planId).success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const [plan] = await db
    .select()
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
      ),
    );

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  return c.json({
    ...plan,
    document: safeJsonParse(plan.document, null),
    assumptions: safeJsonParse(plan.assumptions, null),
  });
});

// Soft delete → status archived.
financialPlansRouter.delete("/:id", async (c) => {
  const { tenantId, userId } = c.get("session");
  const planId = c.req.param("id");

  if (!uuidSchema.safeParse(planId).success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const [plan] = await db
    .select({ id: financialPlans.id })
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
      ),
    );

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  await db
    .update(financialPlans)
    .set({ status: "archived" })
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
      ),
    );

  return c.json({ success: true });
});

// Update a plan's assumptions and regenerate. Each supplied field is merged;
// null clears that field (the "Assumptions applied" chip's remove affordance).
// Regenerates into a NEW document and swaps it in only on success, so a regen
// failure records the assumptions change without corrupting the stored plan.
financialPlansRouter.patch("/:id/assumptions", async (c) => {
  const { tenantId, userId } = c.get("session");
  const planId = c.req.param("id");

  if (!uuidSchema.safeParse(planId).success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  let rawBody: unknown = {};
  try {
    rawBody = await c.req.json();
  } catch {
    // empty body → no-op merge
  }
  const parsed = assumptionsSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
  }

  const [plan] = await db
    .select({
      id: financialPlans.id,
      title: financialPlans.title,
      document: financialPlans.document,
      assumptions: financialPlans.assumptions,
    })
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
      ),
    );

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  // Merge: a value sets the field, null deletes it, an omitted field is kept.
  const merged: PlanAssumptions = { ...(parseAssumptions(plan.assumptions) ?? {}) };
  const body = parsed.data;
  for (const key of ["includeSocialSecurity", "retirementAge", "expectedReturn", "monthlySpend"] as const) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v === null) delete merged[key];
    else (merged as Record<string, unknown>)[key] = v;
  }
  // Unsell one property (the sold-property chip's × affordance): drop it from the
  // sold list; clearing the last one removes the field entirely.
  if (body.unsellPropertyAccountId) {
    const remaining = (merged.soldPropertyAccountIds ?? []).filter(
      (id) => id !== body.unsellPropertyAccountId,
    );
    if (remaining.length > 0) merged.soldPropertyAccountIds = remaining;
    else delete merged.soldPropertyAccountIds;
  }
  // An empty assumptions set persists as null (nothing applied → chips render nothing).
  const assumptionsJson = Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;

  await db
    .update(financialPlans)
    .set({ assumptions: assumptionsJson })
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
      ),
    );

  const nextAssumptions = assumptionsJson ? merged : null;
  let document = safeJsonParse<{ sections?: DocumentSections }>(plan.document, {});
  let regenerated = false;
  try {
    const next = await regeneratePlan(
      tenantId,
      userId,
      { title: plan.title, sections: document.sections ?? {} },
      nextAssumptions,
    );
    document = { ...document, sections: next.sections };
    await db
      .update(financialPlans)
      .set({ document: JSON.stringify(document) })
      .where(
        and(
          eq(financialPlans.id, planId),
          eq(financialPlans.tenantId, tenantId),
          eq(financialPlans.userId, userId),
          ne(financialPlans.status, "archived"),
        ),
      );
    regenerated = true;
  } catch (e) {
    console.error("[financial-plans] assumptions regeneration failed:", e);
  }

  return c.json({
    success: true,
    assumptions: nextAssumptions,
    regenerated,
    document: document.sections ? document : null,
  });
});
