import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { financialPlans, eq, ne, and, desc } from "@lasagna/core";
import { type AuthEnv } from "../middleware/auth.js";
import { buildFinancialSnapshot } from "../services/financial-snapshot.js";
import { buildPortfolioSection } from "../services/portfolio-section.js";
import { buildRetirementReadiness } from "../services/retirement-readiness.js";
import { buildWhatIfSection } from "../services/what-if-section.js";
import { buildRetirementSchedule } from "../services/retirement-schedule.js";
import { buildStrategySection } from "../services/strategy-section.js";
import { toCompactGrounding, resolvePersonContext, parseAssumptions } from "../services/plan-grounding.js";
import { regeneratePlan, type PlanAssumptions, type DocumentSections } from "../services/plan-assumptions.js";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
// Type-only here; the implementation is imported lazily inside the handlers.
// A static value import would eagerly drag the agent/tool graph (security
// classifier etc.) into unrelated test suites that partially mock @lasagna/core.
import type { FreeformReport } from "../services/freeform-report.js";

export const financialPlansRouter = new Hono<AuthEnv>();

const uuidSchema = z.string().uuid();

const createSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  // "structured" (default) = the deterministic engine + gated prose sections.
  // "freeform" = the EXPERIMENT: the model authors the whole report as HTML.
  type: z.enum(["structured", "freeform"]).optional(),
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

// How long an in-flight freeform generation may run before a reader treats it
// as dead (server restarted mid-run). Generation normally takes ~10 minutes.
const FREEFORM_STALE_MS = 25 * 60 * 1000;

/** Persist a plan's freeform document, scoped to the owning tenant + user. */
async function saveFreeform(
  tenantId: string,
  userId: string,
  planId: string,
  freeform: FreeformReport,
): Promise<void> {
  await db
    .update(financialPlans)
    .set({ document: JSON.stringify({ freeform }), updatedAt: new Date() })
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
      ),
    );
}

/**
 * Optimistic run token: a background run "owns" the document only while the
 * stored `freeform.startedAt` still equals the startedAt it launched with. A
 * newer run (or a staleness convergence) rewrites startedAt, superseding this
 * one — its result must then be DISCARDED, not written over the newer state.
 */
async function isCurrentRun(
  tenantId: string,
  userId: string,
  planId: string,
  runToken: string | undefined,
): Promise<boolean> {
  const [row] = await db
    .select({ document: financialPlans.document })
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
      ),
    );
  if (!row) return false;
  const stored = safeJsonParse<{ freeform?: FreeformReport } | null>(row.document, null);
  return stored?.freeform?.startedAt === runToken;
}

/**
 * Converge a stale in-flight freeform run (server died mid-generation) so
 * readers never see a run spin forever — or 409 against a ghost. A dead CREATE
 * becomes failed (retryable); a dead REVISION falls back to the previous,
 * still-valid report. Persists the convergence and returns the (possibly
 * converged) document.
 */
async function convergeIfStale(
  tenantId: string,
  userId: string,
  planId: string,
  freeform: FreeformReport,
): Promise<FreeformReport> {
  if (
    (freeform.status === "generating" || freeform.status === "revising") &&
    freeform.startedAt &&
    Date.now() - new Date(freeform.startedAt).getTime() > FREEFORM_STALE_MS
  ) {
    const converged: FreeformReport = {
      ...freeform,
      status: freeform.status === "revising" ? "ready" : "failed",
      startedAt: undefined,
      error: "The advisor could not finish this report. Try again.",
    };
    await saveFreeform(tenantId, userId, planId, converged);
    return converged;
  }
  return freeform;
}

/**
 * Fire-and-forget freeform generation: runs after the HTTP response has been
 * sent, then persists the outcome. Every failure path lands in the document
 * (status "failed" for a create, previous report + error for a revision) so
 * the client's polling always converges. A run that has been SUPERSEDED (its
 * stale state converged and a newer run started) discards its result instead
 * of last-writer-winning over the newer run.
 */
function runFreeformInBackground(
  tenantId: string,
  userId: string,
  planId: string,
  current: FreeformReport,
  opts?: { feedback?: string; previousHtml?: string },
): void {
  const runToken = current.startedAt;
  void (async () => {
    try {
      const { generateFreeformReport } = await import("../services/freeform-report.js");
      const html = await generateFreeformReport(tenantId, userId, opts);
      if (!(await isCurrentRun(tenantId, userId, planId, runToken))) {
        console.warn(`[freeform] run superseded for plan ${planId}; discarding result`);
        return;
      }
      await saveFreeform(tenantId, userId, planId, {
        ...current,
        status: "ready",
        startedAt: undefined,
        error: undefined,
        html,
        generatedAt: new Date().toISOString(),
        history: opts?.feedback
          ? [...(current.history ?? []), { feedback: opts.feedback, at: new Date().toISOString() }]
          : (current.history ?? []),
      });
      console.log(`[freeform] ${opts?.feedback ? "revision" : "generation"} ready for plan ${planId}`);
    } catch (e) {
      console.error(`[freeform] background run failed for plan ${planId}:`, e);
      const msg = "The report could not be updated. Try again.";
      try {
        if (!(await isCurrentRun(tenantId, userId, planId, runToken))) {
          console.warn(`[freeform] run superseded for plan ${planId}; discarding failure`);
          return;
        }
        await saveFreeform(tenantId, userId, planId, {
          ...current,
          // Whenever a previous report EXISTS (revision or refresh), fall back to
          // it with the error noted; only a failed first CREATE has nothing to
          // show and becomes failed/retryable.
          status: current.html ? "ready" : "failed",
          startedAt: undefined,
          error: msg,
        });
      } catch (persistErr) {
        console.error("[freeform] failed to persist failure:", persistErr);
      }
    }
  })();
}

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

  // ── Freeform experiment: the model authors the entire report ────────────────
  // Generation takes minutes, so the plan is created IMMEDIATELY in a
  // "generating" state and the model runs in the background; the client polls
  // the plan until it flips to ready/failed.
  if (parsed.data.type === "freeform") {
    // Don't launch a ~10-minute generation for a tenant with nothing to analyze:
    // the report needs at least one investable account with a real balance.
    const accounts = await fetchAccountsWithBalances(tenantId);
    const hasInvestable = accounts.some(
      (a) => (a.type === "investment" || a.type === "depository") && a.rawBalance > 0,
    );
    if (!hasInvestable) {
      return c.json({ error: "Link an account first — the report needs real balances." }, 400);
    }
    const freeform: FreeformReport = {
      status: "generating",
      startedAt: new Date().toISOString(),
      html: "",
      generatedAt: new Date().toISOString(),
      model: "anthropic/claude-sonnet-5",
      history: [],
    };
    const [plan] = await db
      .insert(financialPlans)
      .values({
        tenantId,
        userId,
        title: parsed.data.title ?? "Financial Insights",
        document: JSON.stringify({ freeform }),
        status: "draft",
      })
      .returning();
    if (!plan) return c.json({ error: "Could not create the plan" }, 500);
    runFreeformInBackground(tenantId, userId, plan.id, freeform);
    return c.json({ plan: { ...plan, document: { freeform } } }, 201);
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

  // Deterministic schedule + the LLM strategy grounded on it. The schedule is a
  // pure, reproducible drawdown table; the strategy is ONE bounded model call
  // grounded on the SAME compact figures the chat agent sees, WITH the curated
  // schedule rows attached. Both run AFTER the deterministic sections and the
  // whole block is wrapped so a model error or timeout can never fail plan
  // creation — on failure the plan simply ships without those sections.
  let schedule = null;
  let strategy = null;
  try {
    const person = await resolvePersonContext(tenantId, userId);
    schedule = await buildRetirementSchedule(tenantId, userId, { person });
    const grounding = toCompactGrounding(
      "pending",
      parsed.data.title ?? "Financial Plan",
      { snapshot, portfolio, retirement },
      person,
      null,
      schedule,
    );
    strategy = await buildStrategySection(tenantId, userId, grounding);
  } catch (e) {
    console.error("[financial-plans] schedule/strategy generation failed:", e);
  }

  const document = { sections: { snapshot, portfolio, retirement, ...(whatIfs ? { whatIfs } : {}), ...(schedule && schedule.computed ? { schedule } : {}), ...(strategy ? { strategy } : {}) } };

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

  // Stale in-flight freeform run (server restarted mid-generation): converge it
  // so the client's polling never spins forever.
  const parsedDoc = safeJsonParse<{ freeform?: FreeformReport } | null>(plan.document, null);
  if (parsedDoc?.freeform) {
    parsedDoc.freeform = await convergeIfStale(tenantId, userId, plan.id, parsedDoc.freeform);
  }

  return c.json({
    ...plan,
    document: parsedDoc,
    assumptions: safeJsonParse(plan.assumptions, null),
  });
});

// Rename a plan.
financialPlansRouter.patch("/:id", async (c) => {
  const { tenantId, userId } = c.get("session");
  const planId = c.req.param("id");
  if (!uuidSchema.safeParse(planId).success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }
  let rawBody: unknown = {};
  try {
    rawBody = await c.req.json();
  } catch {
    // fall through to validation error
  }
  const parsed = z.object({ title: z.string().min(1).max(255) }).safeParse(rawBody ?? {});
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
  }
  const [updated] = await db
    .update(financialPlans)
    .set({ title: parsed.data.title.trim(), updatedAt: new Date() })
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
      ),
    )
    .returning({ id: financialPlans.id, title: financialPlans.title });
  if (!updated) return c.json({ error: "Plan not found" }, 404);
  return c.json({ id: updated.id, title: updated.title });
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

// Freeform experiment: apply client feedback by having the model revise its
// own report. The input box on a freeform plan posts here (feedback, not chat).
financialPlansRouter.post("/:id/feedback", async (c) => {
  const { tenantId, userId } = c.get("session");
  const planId = c.req.param("id");
  if (!uuidSchema.safeParse(planId).success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  let rawBody: unknown = {};
  try {
    rawBody = await c.req.json();
  } catch {
    // fall through to validation error
  }
  const parsed = z.object({ feedback: z.string().min(1).max(4000) }).safeParse(rawBody ?? {});
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", details: parsed.error.issues }, 400);
  }

  const [plan] = await db
    .select({ id: financialPlans.id, document: financialPlans.document })
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
      ),
    );
  if (!plan) return c.json({ error: "Plan not found" }, 404);

  const doc = safeJsonParse<{ freeform?: FreeformReport }>(plan.document, {});
  if (!doc.freeform?.html) {
    return c.json({ error: "This plan does not accept feedback" }, 400);
  }
  // Converge a dead run first so a mid-run process death can't lock the user
  // out behind the in-progress guard until a GET happens to converge it.
  doc.freeform = await convergeIfStale(tenantId, userId, planId, doc.freeform);
  const status = doc.freeform.status ?? "ready";
  if (status === "generating" || status === "revising") {
    return c.json({ error: "A revision is already in progress" }, 409);
  }

  // Mark revising (previous report stays readable), respond immediately, and
  // revise in the background — the client polls until ready.
  const revising: FreeformReport = {
    ...doc.freeform,
    status: "revising",
    startedAt: new Date().toISOString(),
    error: undefined,
  };
  await saveFreeform(tenantId, userId, planId, revising);
  runFreeformInBackground(tenantId, userId, planId, revising, {
    feedback: parsed.data.feedback,
    previousHtml: doc.freeform.html,
  });
  return c.json({ document: { freeform: revising } });
});

// Regenerate a freeform report from CURRENT data: a full fresh build (fresh
// tool calls, no anchoring on the previous HTML) — the "Refresh" button after
// e.g. linking a new account. Also re-kicks a FAILED creation. While a ready
// report refreshes, it stays readable ("revising"); a failed refresh falls
// back to it.
financialPlansRouter.post("/:id/regenerate", async (c) => {
  const { tenantId, userId } = c.get("session");
  const planId = c.req.param("id");
  if (!uuidSchema.safeParse(planId).success) {
    return c.json({ error: "Invalid plan ID format" }, 400);
  }

  const [plan] = await db
    .select({ id: financialPlans.id, document: financialPlans.document })
    .from(financialPlans)
    .where(
      and(
        eq(financialPlans.id, planId),
        eq(financialPlans.tenantId, tenantId),
        eq(financialPlans.userId, userId),
        ne(financialPlans.status, "archived"),
      ),
    );
  if (!plan) return c.json({ error: "Plan not found" }, 404);

  const doc = safeJsonParse<{ freeform?: FreeformReport }>(plan.document, {});
  if (!doc.freeform) {
    return c.json({ error: "This plan is not a Financial Insights report" }, 400);
  }
  // Converge a dead run first so a mid-run process death can't lock the user
  // out behind the in-progress guard until a GET happens to converge it.
  doc.freeform = await convergeIfStale(tenantId, userId, planId, doc.freeform);
  const status = doc.freeform.status ?? "ready";
  if (status === "generating" || status === "revising") {
    return c.json({ error: "An update is already in progress" }, 409);
  }

  const freeform: FreeformReport = {
    ...doc.freeform,
    // A ready report stays readable while the fresh one builds; a failed
    // creation has nothing to show and goes back to the generating state.
    status: doc.freeform.html ? "revising" : "generating",
    startedAt: new Date().toISOString(),
    error: undefined,
  };
  await saveFreeform(tenantId, userId, planId, freeform);
  runFreeformInBackground(tenantId, userId, planId, freeform);
  return c.json({ document: { freeform } });
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

  // Freeform reports have no structured sections: a regen here would spend an
  // LLM run persisting a hybrid {freeform,sections} document that the next
  // saveFreeform silently wipes. Assumptions are a structured-plan concept.
  let document = safeJsonParse<{ sections?: DocumentSections; freeform?: FreeformReport }>(
    plan.document,
    {},
  );
  if (document.freeform) {
    return c.json(
      { error: "Assumptions don't apply to Financial Insights reports — use feedback instead" },
      400,
    );
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
