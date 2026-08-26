import { Hono } from "hono";
import { eq, financialProfiles } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { z } from "zod";
import { readFinancialPath, currentStepKey, pathSummary } from "./financial-path.js";

/**
 * The older shape of the same path.
 *
 * Home and the dashboard still read this, so it stays until they move to
 * /financial-path. It runs off the same context, candidates and sizing, so the
 * two responses can never describe different steps.
 */
export const priorityRoutes = new Hono<AuthEnv>();

/** Situation steps keep their original ids, so skip/complete bookkeeping survives. */
const SITUATION_STEP_IDS = new Set([
  'stabilize',
  'employer-match',
  'emergency-fund',
  'insurance-will',
  'savings-rate',
  'retirement-readiness',
  'tax-advantaged',
  'max-contributions',
  'taxable-brokerage',
  'financial-independence',
  'estate-legacy',
]);

const INSTANCE_STEP_ID = /^(debt|goal):[0-9a-f-]{36}$/i;

function isPathStepId(id: string): boolean {
  return SITUATION_STEP_IDS.has(id) || INSTANCE_STEP_ID.test(id);
}

priorityRoutes.get("/", async (c) => {
  const session = c.get("session");
  const { ctx, steps, readiness } = await readFinancialPath(session.tenantId, session.userId);

  return c.json({
    steps: steps.map((step, index) => ({
      id: step.key,
      order: index + 1,
      kind: step.kind,
      title: step.title,
      subtitle: step.subtitle,
      description: step.description,
      icon: step.icon,
      status: step.status,
      current: step.current,
      target: step.target,
      progress: step.progress,
      action: step.action,
      accounts: step.debt
        ? [{
            id: step.debt.accountId,
            name: step.debt.name,
            mask: step.debt.mask,
            balance: step.debt.balance,
            apr: step.debt.apr,
          }]
        : undefined,
      detail: step.subtitle,
      priority: index < 3 ? 'critical' as const : index < 7 ? 'high' as const : 'medium' as const,
      skipped: step.skipped,
      note: step.note,
    })),
    currentStepId: currentStepKey(steps),
    summary: pathSummary(ctx, steps, readiness),
  });
});

// PATCH /skip — toggle skipped status for a step
const skipSchema = z.object({
  stepId: z.string().min(1).max(100),
  skipped: z.boolean(),
});

priorityRoutes.patch("/skip", async (c) => {
  const session = c.get("session");
  const raw = await c.req.json();
  const parsed = skipSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const { stepId, skipped } = parsed.data;

  if (!isPathStepId(stepId)) {
    return c.json({ error: 'Invalid step ID' }, 400);
  }

  // Get or create profile
  let profile = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, session.tenantId),
  });

  const currentSkipped = new Set<string>(profile?.skippedPrioritySteps ?? []);
  if (skipped) {
    currentSkipped.add(stepId);
  } else {
    currentSkipped.delete(stepId);
  }
  const updatedArray = [...currentSkipped];

  if (profile) {
    await db
      .update(financialProfiles)
      .set({ skippedPrioritySteps: updatedArray })
      .where(eq(financialProfiles.tenantId, session.tenantId));
  } else {
    await db.insert(financialProfiles).values({
      tenantId: session.tenantId,
      skippedPrioritySteps: updatedArray,
    });
  }

  return c.json({ ok: true, skippedSteps: updatedArray });
});

// PATCH /complete — toggle manually-completed status for a step
priorityRoutes.patch("/complete", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();
  const { stepId, completed, note } = z.object({
    stepId: z.string(),
    completed: z.boolean(),
    note: z.string().optional().default(''),
  }).parse(body);

  if (!isPathStepId(stepId)) {
    return c.json({ error: 'Invalid step ID' }, 400);
  }

  const existing = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, session.tenantId),
  });

  const current: Array<{id: string; note: string; completedAt: string}> =
    (existing?.completedPrioritySteps as any) ?? [];

  let updated: Array<{id: string; note: string; completedAt: string}>;
  if (completed) {
    // upsert: replace existing entry if present, otherwise add
    const without = current.filter(e => e.id !== stepId);
    updated = [...without, { id: stepId, note: note ?? '', completedAt: new Date().toISOString() }];
  } else {
    updated = current.filter(e => e.id !== stepId);
  }

  await db
    .insert(financialProfiles)
    .values({ tenantId: session.tenantId, completedPrioritySteps: updated })
    .onConflictDoUpdate({
      target: financialProfiles.tenantId,
      set: { completedPrioritySteps: updated },
    });

  return c.json({ ok: true });
});
