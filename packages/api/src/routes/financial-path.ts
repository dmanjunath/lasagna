import { Hono } from "hono";
import { z } from "zod";
import { type AuthEnv } from "../middleware/auth.js";
import { buildPathContext, type PathContext } from "../lib/path-context.js";
import { buildPathCandidates, type PathCandidate } from "../lib/path-candidates.js";
import { stepIsMeasured, type SizedStep } from "../lib/path-sizing.js";
import {
  generatePath,
  invalidatePath,
  markPathStep,
  pathFingerprint,
  readActivePath,
  storedPath,
  type PathGenerationReason,
  type PathStepMark,
  type StoredPath,
} from "../lib/path-generator.js";
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

/**
 * "You are here": the first step that is not finished.
 *
 * The one definition, computed once on the server, because home and the path
 * page both render this and two computations of it would eventually disagree.
 * A step taken off the path is not in `steps` at all, so it cannot be it.
 */
export function currentStepKey(steps: SizedStep[]): string {
  return (
    steps.find((s) => s.status !== 'complete')?.key ??
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
 * Whether this stored path still describes this household, and if not, what
 * changed it.
 *
 * Null means keep it. A path that reshuffled on anything less than these would
 * be a plan that moves under the person walking it.
 *
 * The reason is looked for in the most specific place first. A parked reason is
 * an act the user performed, and only whatever performed it could know: a goal
 * edit that leaves the ordering inputs identical, or a step ticked done, are
 * both invisible here. Failing that, a step appearing or disappearing says what
 * happened on its own.
 *
 * `inputs_changed` is the catch-all, and it is honestly named: the digest no
 * longer matches and we cannot say which input moved. Usually it is a figure
 * crossing a band. But a release that changes what the digest is TAKEN OVER
 * lands here too, and then nothing about the household changed at all, so
 * nothing downstream may tell the reader their figures did.
 */
function regenerationReason(
  stored: StoredPath,
  candidates: PathCandidate[],
  fingerprint: string,
): PathGenerationReason | null {
  if (stored.pendingReason) return stored.pendingReason;
  if (stored.inputsFingerprint === fingerprint) return null;

  const before = new Set(stored.steps.map((s) => s.key));
  const now = new Set(candidates.map((c) => c.key));
  const appeared = (prefix: string) => [...now].some((k) => k.startsWith(prefix) && !before.has(k));
  const vanished = (prefix: string) => [...before].some((k) => k.startsWith(prefix) && !now.has(k));

  if (appeared('debt:')) return 'debt_added';
  if (vanished('debt:')) return 'debt_cleared';
  if (appeared('goal:')) return 'goal_added';
  if (vanished('goal:')) return 'goal_removed';
  return 'inputs_changed';
}

/**
 * What a read of the path is computed from, before the stored order is applied:
 * the household, the simulation, the steps that apply, and the digest of the
 * inputs their ORDER turns on.
 *
 * Separate from the read so a request that both marks a step and answers with
 * the path builds this once. None of it is changed by a mark, so the same
 * object is correct on either side of one.
 */
async function pathInputs(tenantId: string, userId: string) {
  const ctx = await buildPathContext(tenantId, userId);
  const readiness = await readPathReadiness(ctx, tenantId, userId);
  const candidates = buildPathCandidates(ctx, readiness);
  return { ctx, readiness, candidates, fingerprint: pathFingerprint(ctx, candidates) };
}

/**
 * This person's path: the steps that apply to them, in the order that was
 * stored for them, sized against what they hold today.
 *
 * The ORDER is read back rather than recomputed. It was chosen once, by a model
 * over the validated candidate set, and a plan somebody is standing in the
 * middle of must not reshuffle because the model was asked a second time. This
 * read regenerates it only when `regenerationReason` names an event that
 * warrants it, and that is the only model call this endpoint ever makes.
 *
 * The FIGURES are recomputed every read. They have to be: a balance moves and a
 * finished step can reopen, so serving the stored numbers would freeze the page
 * against the household behind it.
 */
export async function readFinancialPath(
  tenantId: string,
  userId: string,
  inputs?: Awaited<ReturnType<typeof pathInputs>>,
) {
  const { ctx, readiness, candidates, fingerprint } =
    inputs ?? (await pathInputs(tenantId, userId));

  const stored = await readActivePath(tenantId);
  const stale = stored ? regenerationReason(stored, candidates, fingerprint) : null;

  const path =
    stored && !stale
      ? storedPath(candidates, ctx, stored)
      : await generatePath(tenantId, ctx, candidates, stale ?? 'no_active_path', stored);

  return { ctx, readiness, ...path };
}

/**
 * One step of the path for a reader that renders no pixels: chat, and the report.
 *
 * It carries no candidate key. Neither reader can mark a step, reorder one, or
 * address one by key, so a key here buys nothing and costs something: a model
 * handed `debt:<uuid>` will print it back as a citation, and did.
 */
export interface PathStepView {
  /** 1 based, in the order the path is walked. */
  step: number;
  title: string;
  /** Why this step is on THIS person's path. */
  why: string;
  /** Where it sits relative to the rest, as the order that was stored put it. */
  reason: string;
  status: SizedStep['status'];
  /** Every figure below is `sizePath`'s, recomputed here exactly as the page recomputes it. */
  current: number | null;
  target: number | null;
  monthlyFunding: number;
  projectedDate: string | null;
  action: string;
  fact: string;
}

/** This person's path as it STANDS, for a reader outside the path pages. */
export interface PathView {
  steps: PathStepView[];
  /** Steps this person took off their path. Off it, so they carry no number. */
  notApplicable: { title: string }[];
  /** The number of the step they are on. Null when they have no steps. */
  currentStep: number | null;
  /**
   * True when this order is already due to be rebuilt: the household moved, and
   * the Financial Level page has not chosen the new order yet. The steps are
   * all here and their figures are current, but their POSITIONS are not settled,
   * so nothing may state one as final while this is true.
   */
  rebuildPending: boolean;
  updatedAt: string;
}

/**
 * The path exactly as `/financial-level` shows it, for a reader that must not
 * change it: the chat agent, and the plan report's grounding.
 *
 * The difference from `readFinancialPath` is the whole point. That one
 * GENERATES: no stored path, or a stored path the household has outgrown, and
 * it calls a model to choose an order and writes the result. Correct for the
 * page, where a person asked for their path and can see it change. Wrong
 * everywhere else, because a chat turn would then silently pay for a
 * regeneration and reshuffle the plan behind the page the question came from.
 *
 * So this reads the stored rows FIRST and answers null when there are none,
 * which is `readPathSteps`' bargain: nothing is built for somebody who has no
 * path, and no read of one can ever write. Past that gate the household and its
 * candidates are built and `storedPath` sizes them, because a step without its
 * figures is not the step the page shows, and the point of this is that the two
 * of them say the same thing. Nothing on that route can generate.
 *
 * KNOWN LIMIT, and the price of not writing: between a household changing and
 * the next read of the path page, this answers with the order that is stored
 * rather than the order that page is about to choose. `storedPath` still shows
 * every step that applies, so nothing is hidden, but a step nobody has placed
 * yet sits at the end. The page closes it on its next read, which is the one
 * place a person can watch their path move.
 *
 * So the limit is DECLARED rather than papered over. `rebuildPending` is the
 * same test the page regenerates on, and a reader that cannot rebuild can at
 * least decline to call a position final. Without it the only honest answer
 * available reads as a confident one: chat placed a just-added goal at step 8
 * and the next read of the page placed it at step 4.
 */
export async function readStoredPath(
  tenantId: string,
  userId: string,
): Promise<PathView | null> {
  const stored = await readActivePath(tenantId);
  if (!stored) return null;

  const { ctx, candidates, fingerprint } = await pathInputs(tenantId, userId);
  const { steps, notApplicable, reasons, generatedAt } = storedPath(candidates, ctx, stored);
  const current = currentStepKey(steps);

  return {
    steps: steps.map((step, index) => ({
      step: index + 1,
      title: step.title,
      why: step.why,
      reason: reasons.get(step.key) ?? '',
      status: step.status,
      current: step.current,
      target: step.target,
      monthlyFunding: step.monthlyFunding,
      projectedDate: step.projectedDate,
      action: step.action,
      fact: step.fact,
    })),
    notApplicable: notApplicable.map((c) => ({ title: c.title })),
    currentStep: steps.length > 0 ? steps.findIndex((s) => s.key === current) + 1 : null,
    // The same question `readFinancialPath` asks before it regenerates, asked
    // by the reader that must not.
    rebuildPending: regenerationReason(stored, candidates, fingerprint) !== null,
    updatedAt: generatedAt.toISOString(),
  };
}

/** The wire shape of the whole path. One builder, so every reader agrees. */
function serializePath(
  path: Awaited<ReturnType<typeof readFinancialPath>>,
) {
  const { ctx, steps, notApplicable, readiness, reasons, generatedAt, reason } = path;
  return {
    steps: steps.map((step, index) => serializeStep(step, index, reasons.get(step.key))),
    // Off the path, so they carry no number and no figures. Named only so the
    // page can offer them back, which is the whole of what it does with them.
    notApplicable: notApplicable.map((c) => ({ id: c.key, title: c.title })),
    currentStepId: currentStepKey(steps),
    // When this order was chosen and what chose it, so the page can say why the
    // path it is showing is the one it is.
    updatedAt: generatedAt.toISOString(),
    updatedReason: reason,
    summary: pathSummary(ctx, steps, readiness),
  };
}

// GET / — this person's path: the steps that apply to them, in order, sized.
financialPathRoutes.get("/", async (c) => {
  const session = c.get("session");
  return c.json(serializePath(await readFinancialPath(session.tenantId, session.userId)));
});

// PATCH /steps/:key — where this person stands on one step of their path.
//
// `done` is a tick, and it only decides a step no figure measures. A measured
// step goes on completing itself from the balances behind it, in both
// directions, so a tick can never pin one against its own figures.
//
// `not_applicable` takes the step off the path entirely: it stops being
// counted, numbered, funded and shown. `pending` is how it comes back, which is
// why it is a status rather than a delete.
const markSchema = z.object({
  status: z.enum(['pending', 'done', 'not_applicable']),
  note: z.string().max(500).optional(),
});

/**
 * Whether this mark can change the SEQUENCE, and so is worth reopening it for.
 *
 * Only a step called done can: what is left to do has changed, so what should
 * come next may have too. But a tick on a step the figures measure changes
 * nothing at all, because `sizePath` reads those off the balances behind them
 * whatever was ticked, so reordering for one would buy the same sequence back
 * for the length and price of a model call.
 *
 * Taking a step off the path, and putting it back, are both left out for a
 * reason of their own: removing a step reorders nothing, and restoring one
 * restores a position that is already stored. A person tidying up which steps
 * apply to them would otherwise pay for every toggle.
 */
function markReopensTheOrder(
  mark: PathStepMark,
  key: string,
  { ctx, candidates }: Awaited<ReturnType<typeof pathInputs>>,
): boolean {
  if (mark !== 'done') return false;
  const candidate = candidates.find((c) => c.key === key);
  return candidate !== undefined && !stepIsMeasured(candidate, ctx);
}

/**
 * Record where this person stands on one step, and answer with the path as it
 * stands after it, including any regeneration the mark just triggered. One
 * round trip, so nothing renders a path that disagrees with the tick that was
 * just made.
 *
 * Null when no step on the active path carries that key.
 */
export async function markAndReadPath(
  tenantId: string,
  userId: string,
  key: string,
  mark: PathStepMark,
  note?: string,
) {
  // Built before the mark and reused by the read below. A mark changes nothing
  // this describes, and building it twice would run the retirement simulation
  // twice for one tick.
  const inputs = await pathInputs(tenantId, userId);

  if (!(await markPathStep(tenantId, key, mark, note))) return null;
  if (markReopensTheOrder(mark, key, inputs)) await invalidatePath(tenantId, 'step_completed');

  return readFinancialPath(tenantId, userId, inputs);
}

financialPathRoutes.patch("/steps/:key", async (c) => {
  const session = c.get("session");
  const parsed = markSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid request" }, 400);

  const path = await markAndReadPath(
    session.tenantId,
    session.userId,
    c.req.param("key"),
    parsed.data.status,
    parsed.data.note,
  );
  if (!path) return c.json({ error: "That step is not on your path" }, 404);

  return c.json(serializePath(path));
});
