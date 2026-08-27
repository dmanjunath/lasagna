import { Hono } from "hono";
import { type AuthEnv } from "../middleware/auth.js";
import { buildPathContext, type PathContext } from "../lib/path-context.js";
import { buildPathCandidates } from "../lib/path-candidates.js";
import { type SizedStep } from "../lib/path-sizing.js";
import { generatePath, readActivePath, storedPath } from "../lib/path-generator.js";
import { buildPathReadiness, type PathReadiness } from "../services/retirement-readiness.js";

export const financialPathRoutes = new Hono<AuthEnv>();

/** The wire shape of one step. Debt steps carry the single account they act on. */
export function serializeStep(step: SizedStep, index: number, reason = '') {
  return {
    id: step.key,
    order: index + 1,
    kind: step.kind,
    title: step.title,
    subtitle: step.subtitle,
    description: step.description,
    why: step.why,
    // Why the step sits at this point of the path rather than another, as the
    // model that ordered it put it. Empty whenever the order was deterministic.
    reason,
    icon: step.icon,
    mandatory: step.mandatory,
    status: step.status,
    progress: step.progress,
    current: step.current,
    target: step.target,
    monthlyFunding: step.monthlyFunding,
    projectedDate: step.projectedDate,
    action: step.action,
    fact: step.fact,
    notes: step.notes,
    skipped: step.skipped,
    note: step.note,
    // One entry, always: a debt step acts on exactly one account.
    accounts: step.debt
      ? [{
          id: step.debt.accountId,
          name: step.debt.name,
          mask: step.debt.mask,
          balance: step.debt.balance,
          apr: step.debt.apr,
        }]
      : undefined,
    goal: step.goal
      ? {
          id: step.goal.goalId,
          name: step.goal.name,
          targetAmount: step.goal.targetAmount,
          currentAmount: step.goal.currentAmount,
          deadline: step.goal.deadline ? step.goal.deadline.toISOString() : null,
        }
      : undefined,
  };
}

export function pathSummary(
  ctx: PathContext,
  steps: SizedStep[],
  readiness: PathReadiness | null = null,
) {
  return {
    monthlyIncome: Math.round(ctx.monthlyIncome),
    monthlyExpenses: ctx.monthlyExpenses !== null ? Math.round(ctx.monthlyExpenses) : null,
    monthlySurplus: ctx.monthlySurplus !== null ? Math.round(ctx.monthlySurplus) : null,
    totalCash: Math.round(ctx.cashTotal),
    totalInvested: Math.round(ctx.rothIraBalance + ctx.trad401kBalance + ctx.brokerageBalance),
    totalDebt: Math.round(ctx.debtAccounts.reduce((sum, a) => sum + a.balance, 0)),
    stepCount: steps.length,
    age: ctx.age,
    retirementAge: ctx.retirementAge,
    // False when the age above is our own default. Nothing should print it as
    // this person's target when they never named one.
    retirementAgeSet: ctx.retirementAgeSet,
    filingStatus: ctx.filingStatus,
    // Null whenever the simulation could not be run on what they have given us.
    // The page then says nothing about retirement rather than guessing at it.
    retirement: readiness
      ? {
          successRate: readiness.successRate,
          targetSuccess: readiness.targetSuccess,
          verdict: readiness.verdict,
          retirementAge: readiness.retirementAge,
        }
      : null,
  };
}

/** The first step that is neither finished nor skipped. */
export function currentStepKey(steps: SizedStep[]): string {
  return (
    steps.find((s) => s.status !== 'complete' && !s.skipped)?.key ??
    steps[steps.length - 1]?.key ??
    ''
  );
}

/**
 * The retirement verdict for this household, or null when we should not state
 * one.
 *
 * A simulation needs a birth date and a retirement age to have a horizon at all,
 * and the service needs something invested to project. Without any of the three
 * we return nothing rather than letting the engine's own defaults (age 40,
 * retire at 65) stand in for figures nobody gave us.
 */
async function readPathReadiness(
  ctx: PathContext,
  tenantId: string,
  userId: string,
): Promise<PathReadiness | null> {
  if (ctx.dateOfBirth === null || !ctx.retirementAgeSet) return null;
  // The ceiling on the solve: nobody saves more in a month than they earn in one.
  return buildPathReadiness(tenantId, userId, ctx.monthlyIncome);
}

/**
 * This person's path: the steps that apply to them, in the order that was
 * stored for them, sized against what they hold today.
 *
 * The ORDER is read back rather than recomputed. It was chosen once, by a model
 * over the validated candidate set, and a plan somebody is standing in the
 * middle of must not reshuffle because the model was asked a second time. A
 * tenant with no path yet gets one generated and stored here, and that is the
 * only model call this endpoint ever makes.
 *
 * The FIGURES are recomputed every read. They have to be: a balance moves, and
 * ticking a step done writes to the profile rather than to the path, so serving
 * the stored numbers would freeze the page against the household behind it.
 */
export async function readFinancialPath(tenantId: string, userId: string) {
  const ctx = await buildPathContext(tenantId, userId);
  const readiness = await readPathReadiness(ctx, tenantId, userId);
  const candidates = buildPathCandidates(ctx, readiness);

  const stored = await readActivePath(tenantId);
  const { steps, reasons } = stored
    ? storedPath(candidates, ctx, stored)
    : await generatePath(tenantId, ctx, candidates, 'no_active_path');

  return { ctx, steps, readiness, reasons };
}

// GET / — this person's path: the steps that apply to them, in order, sized.
financialPathRoutes.get("/", async (c) => {
  const session = c.get("session");
  const { ctx, steps, readiness, reasons } = await readFinancialPath(session.tenantId, session.userId);

  return c.json({
    steps: steps.map((step, index) => serializeStep(step, index, reasons.get(step.key))),
    currentStepId: currentStepKey(steps),
    summary: pathSummary(ctx, steps, readiness),
  });
});
