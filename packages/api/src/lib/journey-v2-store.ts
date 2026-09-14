/**
 * Journey v2 — reading, storing and marking.
 *
 * The whole engine's persistence, kept in its own file and its own table so the
 * trial can be lifted out in one delete without touching the path every
 * household is already on.
 *
 * What is stored is the ANSWER: the steps the model chose, in its order, with
 * the copy it wrote for the ones it invented and the target it set for each. A
 * step's figures are not stored, exactly as v1 refuses to store them, because a
 * balance moves and a stored one is a page frozen against the accounts behind
 * it. `target` is the single exception, and only because nothing else can
 * derive it: the model chose it.
 */

import { createHash } from 'node:crypto';
import { and, eq, financialJourneys } from '@lasagna/core';
import { db } from './db.js';
import {
  buildJourneyCatalog,
  journeyCandidates,
  proposeJourney,
  type JourneyAnswer,
} from './journey-v2.js';
import type { PathCandidate } from './path-candidates.js';
import { buildPathContext, type PathContext } from './path-context.js';
import { buildPathReadiness } from '../services/retirement-readiness.js';
import { sizePath, type SizedStep, type StepMark } from './path-sizing.js';
import type { PathReadiness } from '../services/retirement-readiness.js';
import type { PathStepMark } from './path-generator.js';

/** Where the person stands on a step, by key. Survives a regeneration. */
type MarkMap = Record<string, { mark: PathStepMark; note: string; markedAt: string | null }>;

/** One step of a stored answer. Only what nothing can recompute. */
interface StoredJourneyStep {
  key: string;
  why: string;
  target: number | null;
  /** Set only for a step the model invented, which has no catalog entry. */
  title?: string;
  subtitle?: string;
  description?: string;
}

interface StoredJourney {
  steps: StoredJourneyStep[];
  leftOut: Array<{ key: string; title: string; reason: string }>;
}

/**
 * What this journey was generated against.
 *
 * Only the catalog and the figures a step is sized from. It deliberately does
 * NOT digest every balance to the dollar: a journey that regenerated whenever a
 * checking account moved would pay for a model call on every page view and
 * reshuffle a plan somebody is standing in the middle of.
 */
export function journeyFingerprint(ctx: PathContext, catalog: PathCandidate[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        keys: catalog.map((c) => c.key),
        income: Math.round(ctx.annualIncome),
        dependents: ctx.dependentCount,
        match: ctx.employerMatchPct,
        employment: ctx.employmentType,
        retirementAge: ctx.retirementAgeSet ? ctx.retirementAge : null,
      }),
    )
    .digest('hex');
}

async function readRow(tenantId: string) {
  const [row] = await db
    .select()
    .from(financialJourneys)
    .where(eq(financialJourneys.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

/** The answer as it should be stored: the model's words and targets, nothing else. */
function toStored(
  steps: PathCandidate[],
  leftOut: Array<{ candidate: PathCandidate; reason: string }>,
): StoredJourney {
  return {
    steps: steps.map((s) => ({
      key: s.key,
      why: s.why,
      target: s.targetOverride ?? null,
      ...(s.kind === 'custom'
        ? { title: s.title, subtitle: s.subtitle, description: s.description }
        : {}),
    })),
    leftOut: leftOut.map((o) => ({
      key: o.candidate.key,
      title: o.candidate.title,
      reason: o.reason,
    })),
  };
}

/**
 * A stored answer read back as candidates.
 *
 * A catalog step is rebuilt from TODAY's catalog, so a payoff step shows what
 * is owing now rather than what was owing when the journey was generated. Only
 * the model's `why` and its target survive from the stored row. A step whose
 * catalog entry is gone (a balance since cleared) is dropped, the same way v1
 * drops a key whose row has gone.
 *
 * An invented step has no catalog entry to rebuild from, so its stored words
 * ARE the step.
 */
function fromStored(stored: StoredJourney, catalog: PathCandidate[]): PathCandidate[] {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const out: PathCandidate[] = [];
  for (const step of stored.steps ?? []) {
    const target = typeof step.target === 'number' && step.target > 0 ? step.target : undefined;
    const known = byKey.get(step.key);
    if (known) {
      out.push({ ...known, why: step.why || known.why, targetOverride: target });
      continue;
    }
    if (!step.key.startsWith('custom:') || !step.title) continue;
    out.push({
      key: step.key,
      kind: 'custom',
      title: step.title,
      subtitle: step.subtitle ?? '',
      description: step.description ?? '',
      why: step.why ?? '',
      icon: 'layers',
      accountId: null,
      goalId: null,
      targetOverride: target,
    });
  }
  // The debt-free milestone counts only the payoff steps that made it onto the
  // journey, so it can never draw a finish line through a balance the plan left
  // off. Set after the sequence is decided, because that is when it is known.
  const scope = out.filter((c) => c.kind === 'debt' && c.accountId).map((c) => c.accountId!);
  for (const c of out) if (c.kind === 'debt-free') c.debtScopeIds = scope;

  return out;
}

export interface JourneyView {
  ctx: PathContext;
  readiness: PathReadiness | null;
  steps: SizedStep[];
  /** Steps the person took off their journey themselves. */
  notApplicable: PathCandidate[];
  /** Steps the model judged do not belong, with the line it wrote. */
  leftOut: Array<{ candidate: PathCandidate; reason: string }>;
  generatedAt: Date;
  model: string | null;
  reason: string;
}

/**
 * This household's journey, generated if there is none or if what it was built
 * against has moved.
 *
 * The one place in this engine that can write, and the one that can pay for a
 * model call. Everything else reads.
 */
/**
 * Generations in flight, by tenant.
 *
 * The home page, the dashboard and the journey page all read this endpoint on
 * mount, and one read can cost a frontier generation. Without this, opening the
 * app fires three at once: the unique constraint keeps one row and the bill
 * keeps all three.
 *
 * In process only. It does not coordinate across instances, which would need a
 * database lock. It removes the common case, which is one person's own tabs.
 */
const inFlight = new Map<string, Promise<JourneyView>>();

export async function readJourney(tenantId: string, userId: string, opts: { generate?: boolean } = {}): Promise<JourneyView> {
  const existing = inFlight.get(tenantId);
  if (existing) return existing;
  const run = readJourneyOnce(tenantId, userId, opts).finally(() => inFlight.delete(tenantId));
  inFlight.set(tenantId, run);
  return run;
}

async function readJourneyOnce(tenantId: string, userId: string, opts: { generate?: boolean }): Promise<JourneyView> {
  const ctx = await buildPathContext(tenantId, userId);
  const catalog = buildJourneyCatalog(ctx);
  const fingerprint = journeyFingerprint(ctx, catalog);

  // The simulation's verdict, for the model and for the page's own hero. Null
  // when we cannot run one on what they have given us, and the page then says
  // nothing about retirement rather than guessing.
  const readiness =
    ctx.dateOfBirth !== null && ctx.retirementAgeSet
      ? await buildPathReadiness(tenantId, userId, ctx.monthlyIncome)
      : null;

  const row = await readRow(tenantId);
  const marks = (row?.marks ?? {}) as MarkMap;
  const fresh = row !== null && row.inputsFingerprint === fingerprint;

  let stored = fresh ? (row.payload as StoredJourney) : null;
  let generatedAt = row?.generatedAt ?? new Date();
  let model = row?.model ?? null;
  // A first build borrows v1's word for it, so the page says "Built for you on
  // <date>." A rebuild deliberately does NOT: this engine regenerates on the
  // household moving in any of several ways, and every cause the page has a
  // sentence for names one specific event. Falling through to a bare "Updated
  // <date>." is the only line here that is true.
  let reason = fresh ? 'stored' : row ? 'household_changed' : 'no_active_path';

  if (!stored && opts.generate === false) {
    // A reader that must not spend: ticking a step is not a reason to rebuild a
    // plan somebody is standing in the middle of, which is what `markJourneyStep`
    // already promises. Serve what is stored, even if the household has moved.
    stored = (row?.payload as StoredJourney) ?? null;
    reason = row ? 'stored' : 'generation_failed';
  }

  if (!stored) {
    const proposed = await proposeJourney(tenantId, ctx, catalog, readiness);
    if (proposed) {
      const { steps, leftOut } = journeyCandidates(proposed.answer, catalog);
      stored = toStored(steps, leftOut);
      generatedAt = new Date();
      model = proposed.model;
      await db
        .insert(financialJourneys)
        .values({ tenantId, inputsFingerprint: fingerprint, model, payload: stored, marks })
        .onConflictDoUpdate({
          target: financialJourneys.tenantId,
          set: { inputsFingerprint: fingerprint, model, payload: stored, generatedAt },
        });
    } else if (row) {
      // The call failed and there is an older answer. Serving it beats serving
      // nothing: it is this person's journey, just built against a household
      // that has since moved.
      stored = row.payload as StoredJourney;
      reason = 'stale_generation_failed';
    }
  }

  if (!stored) {
    // An empty journey is not the same as a journey of nothing, and the page
    // cannot tell them apart: it reads zero steps as zero steps REMAINING and
    // renders "Every step done", "Your 0 steps", and a chat prompt offering to
    // discuss the 0 steps they finished. Said plainly here, the route can fail
    // the request and the page shows the error state it already has.
    return {
      ctx, readiness, steps: [], notApplicable: [], leftOut: [], generatedAt, model,
      reason: 'generation_failed',
    };
  }

  const all = fromStored(stored, catalog);
  // A step taken off the journey is out of the sequence entirely, so the
  // waterfall never funds it and nothing after it is dated behind it.
  const off = new Set(
    Object.entries(marks).filter(([, m]) => m.mark === 'not_applicable').map(([key]) => key),
  );
  const onPath = all.filter((c) => !off.has(c.key));
  const stepMarks = new Map<string, StepMark>(
    Object.entries(marks).map(([key, m]) => [key, { mark: m.mark, note: m.note }]),
  );

  const byKey = new Map(catalog.map((c) => [c.key, c]));
  return {
    ctx,
    readiness,
    steps: sizePath(onPath, ctx, stepMarks),
    notApplicable: all.filter((c) => off.has(c.key)),
    leftOut: (stored.leftOut ?? [])
      .map((o) => {
        const candidate = byKey.get(o.key);
        return candidate ? { candidate, reason: o.reason } : null;
      })
      .filter((o): o is { candidate: PathCandidate; reason: string } => o !== null),
    generatedAt,
    model,
    reason,
  };
}

/**
 * Record where this person stands on one step.
 *
 * Unlike v1 this never reopens the order. The whole sequence came from one
 * call, so reordering for a tick would buy a whole new journey for the price of
 * a checkbox, and the person is standing in the middle of this one.
 *
 * False when no step of the stored journey carries that key.
 */
export async function markJourneyStep(
  tenantId: string,
  key: string,
  mark: PathStepMark,
  note = '',
): Promise<boolean> {
  const row = await readRow(tenantId);
  if (!row) return false;
  const stored = row.payload as StoredJourney;
  if (!(stored.steps ?? []).some((s) => s.key === key)) return false;

  const marks = { ...((row.marks ?? {}) as MarkMap) };
  if (mark === 'pending') delete marks[key];
  else marks[key] = { mark, note, markedAt: new Date().toISOString() };

  await db
    .update(financialJourneys)
    .set({ marks })
    .where(and(eq(financialJourneys.tenantId, tenantId), eq(financialJourneys.id, row.id)));
  return true;
}
