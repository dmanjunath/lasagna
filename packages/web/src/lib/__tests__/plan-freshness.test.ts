import { describe, it, expect } from 'vitest';
import { planFreshness, PLAN_STALE_DAYS } from '../plan-freshness';
import type { FinancialPlanSummary } from '../types';

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS).toISOString();

function plan(over: Partial<FinancialPlanSummary> = {}): FinancialPlanSummary {
  return {
    id: 'p1',
    title: 'Financial Insights',
    status: 'draft',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    generatedAt: daysAgo(1),
    reportStatus: 'ready',
    ...over,
  };
}

describe('planFreshness', () => {
  it('reports none when the user has never generated a plan', () => {
    expect(planFreshness([], NOW)).toEqual({ kind: 'none', newest: null, generatedAt: null });
  });

  it('stays quiet while a run is in flight', () => {
    for (const reportStatus of ['generating', 'revising'] as const) {
      expect(planFreshness([plan({ reportStatus })], NOW).kind).toBe('pending');
    }
  });

  it('stays quiet when a run is in flight even though another plan is stale', () => {
    const plans = [
      plan({ id: 'running', reportStatus: 'generating' }),
      plan({ id: 'old', generatedAt: daysAgo(400) }),
    ];
    expect(planFreshness(plans, NOW).kind).toBe('pending');
  });

  it('stays quiet for a failed run, which the plan page owns', () => {
    expect(planFreshness([plan({ reportStatus: 'failed' })], NOW).kind).toBe('pending');
  });

  it('reports fresh for a recently generated plan', () => {
    const result = planFreshness([plan({ generatedAt: daysAgo(3) })], NOW);
    expect(result.kind).toBe('fresh');
    expect(result.generatedAt).toBe(daysAgo(3));
  });

  it('is not yet stale at exactly the threshold', () => {
    expect(planFreshness([plan({ generatedAt: daysAgo(PLAN_STALE_DAYS) })], NOW).kind).toBe('fresh');
  });

  it('is stale one day past the threshold', () => {
    const result = planFreshness([plan({ generatedAt: daysAgo(PLAN_STALE_DAYS + 1) })], NOW);
    expect(result.kind).toBe('stale');
    expect(result.newest?.id).toBe('p1');
  });

  it('stays quiet when an older API omits generatedAt entirely', () => {
    // Both fields are optional exactly so an old API response still typechecks.
    const legacy: FinancialPlanSummary = {
      id: 'p1',
      title: 'Financial Insights',
      status: 'draft',
      createdAt: daysAgo(400),
      updatedAt: daysAgo(400),
    };
    expect(planFreshness([legacy], NOW).kind).toBe('pending');
  });

  it('stays quiet when the document carried no timestamp', () => {
    expect(planFreshness([plan({ generatedAt: null })], NOW).kind).toBe('pending');
  });

  it('treats a legacy structured plan (no freeform run) as datable', () => {
    const result = planFreshness(
      [plan({ reportStatus: null, generatedAt: daysAgo(90) })],
      NOW,
    );
    expect(result.kind).toBe('stale');
  });

  it('measures from the newest GENERATION, not the newest row', () => {
    // The list arrives newest-created first, but the older row was regenerated
    // yesterday, so the user does have a current plan.
    const plans = [
      plan({ id: 'new-row', createdAt: daysAgo(2), generatedAt: daysAgo(2) }),
      plan({ id: 'old-row-refreshed', createdAt: daysAgo(200), generatedAt: daysAgo(1) }),
    ];
    const result = planFreshness(plans, NOW);
    expect(result.kind).toBe('fresh');
    expect(result.newest?.id).toBe('old-row-refreshed');
  });

  it('reports stale off the newest generation when every plan is old', () => {
    const plans = [
      plan({ id: 'a', generatedAt: daysAgo(120) }),
      plan({ id: 'b', generatedAt: daysAgo(45) }),
    ];
    const result = planFreshness(plans, NOW);
    expect(result.kind).toBe('stale');
    expect(result.newest?.id).toBe('b');
  });
});
