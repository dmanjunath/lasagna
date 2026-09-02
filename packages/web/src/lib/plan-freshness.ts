import type { FinancialPlanSummary } from './types';

/** A plan older than this stops describing the accounts the user actually has. */
export const PLAN_STALE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = PLAN_STALE_DAYS * DAY_MS;

export type PlanFreshnessKind =
  /** No plan has ever been generated. Recommend generating one. */
  | 'none'
  /**
   * A plan exists but we deliberately say nothing: a run is in flight, the last
   * run failed (the plan's own page owns that state), or the API never told us
   * when the plan was written.
   */
  | 'pending'
  /** The freshest plan was written more than PLAN_STALE_DAYS ago. */
  | 'stale'
  /** The freshest plan is recent enough. */
  | 'fresh';

/** Everything the verdict reads. The plan page has these two without a list. */
export type PlanTimestamps = Pick<FinancialPlanSummary, 'generatedAt' | 'reportStatus'>;

export type PlanFreshness<T extends PlanTimestamps = FinancialPlanSummary> = {
  kind: PlanFreshnessKind;
  /** The plan the verdict is about. Null unless we have a dated plan. */
  newest: T | null;
  /** `newest.generatedAt`, hoisted so callers can label it without re-deriving. */
  generatedAt: string | null;
};

const timeOf = (iso: string | null | undefined): number | null => {
  // Explicit, because there is no honest coercion here. `new Date(undefined)` is
  // NaN and `?? 0` is the epoch, and either one would paint every plan whose
  // timestamp we simply do not know as infinitely stale.
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Decide what, if anything, to tell the user about the age of their plans.
 *
 * Staleness measures from the plan with the newest GENERATION, not the newest
 * row: the list arrives ordered by creation date, so an old plan regenerated
 * yesterday is the freshest thing the user has.
 *
 * Generic over the item so the plan page can pass the one plan it already holds
 * without inventing the rest of a list row. A one-item call never returns
 * 'none', which is the answer to "you have no plans at all".
 */
export function planFreshness<T extends PlanTimestamps>(
  plans: T[],
  now: number = Date.now(),
): PlanFreshness<T> {
  const nothing = { newest: null, generatedAt: null };

  if (plans.length === 0) return { kind: 'none', ...nothing };

  // A run in flight anywhere: the user is already getting a fresh plan, and a
  // second request would only earn an "update already in progress" error.
  const inFlight = plans.some(
    (p) => p.reportStatus === 'generating' || p.reportStatus === 'revising',
  );
  if (inFlight) return { kind: 'pending', ...nothing };

  // A failed run is the plan page's story to tell, not a banner's.
  const dated = plans
    .filter((p) => p.reportStatus !== 'failed')
    .map((plan) => ({ plan, at: timeOf(plan.generatedAt) }))
    .filter((x): x is { plan: T; at: number } => x.at !== null);

  if (dated.length === 0) return { kind: 'pending', ...nothing };

  const newest = dated.reduce((best, x) => (x.at > best.at ? x : best));

  return {
    kind: now - newest.at > STALE_MS ? 'stale' : 'fresh',
    newest: newest.plan,
    generatedAt: newest.plan.generatedAt ?? null,
  };
}
