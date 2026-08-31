import { describe, it, expect } from 'vitest';
import { buildPathContextDefaults, type PathContext } from '../path-context.js';
import { CONTRIBUTION_TAX_YEAR, buildPathCandidates, savingsRateTarget } from '../path-candidates.js';
import { sizePath, contributionLimits, emergencyFundTarget, type StepMark } from '../path-sizing.js';
import { currentStepKey } from '../../routes/financial-path.js';
import type { DebtAccount } from '../debt-accounts.js';
import type { PathReadiness } from '../../services/retirement-readiness.js';

function debt(overrides: Partial<DebtAccount> & { id: string; name: string }): DebtAccount {
  return {
    mask: null,
    type: 'credit',
    subtype: null,
    balance: 1000,
    apr: null,
    minimumPayment: 25,
    minimumPaymentEstimated: true,
    minimumPaymentAssumedApr: null,
    termMonths: null,
    originationDate: null,
    payoffDate: null,
    propertyAccountId: null,
    liabilitySource: null,
    liabilityLastSyncedAt: null,
    lastUpdated: null,
    ...overrides,
  };
}

/**
 * A median projected path, one entry per age from today, compounding at a flat
 * rate. Stands in for the percentile series `runRetirementSim` returns.
 */
function medianPath(start: number, years: number, rate = 0.06): number[] {
  return Array.from({ length: years + 1 }, (_, i) => Math.round(start * (1 + rate) ** i));
}

/** Marks by key, as the stored path hands them to the sizing pass. */
function marks(entries: Record<string, StepMark>): Map<string, StepMark> {
  return new Map(Object.entries(entries));
}

/** A step ticked done by hand, with the sentence they typed. */
const done = (note = ''): StepMark => ({ mark: 'done', note });

function size(
  ctx: PathContext,
  readiness: PathReadiness | null = null,
  stepMarks: ReadonlyMap<string, StepMark> = new Map(),
) {
  const steps = sizePath(buildPathCandidates(ctx, readiness), ctx, stepMarks);
  return { steps, byKey: new Map(steps.map((s) => [s.key, s])) };
}

// ── Ported maths ─────────────────────────────────────────────────────────────

describe('starter buffer', () => {
  it('targets $1,000 against cash on hand', () => {
    const { byKey } = size(buildPathContextDefaults({ cashTotal: 400 }));
    const step = byKey.get('stabilize')!;
    expect(step.target).toBe(1000);
    expect(step.current).toBe(400);
    expect(step.progress).toBe(40);
    expect(step.status).toBe('in_progress');
    expect(step.action).toBe('Save $600 more to reach the $1,000 starter fund.');
  });

  it('reads complete at $1,000', () => {
    const { byKey } = size(buildPathContextDefaults({ cashTotal: 1000 }));
    expect(byKey.get('stabilize')!.status).toBe('complete');
    expect(byKey.get('stabilize')!.progress).toBe(100);
  });

  it('holds at not started while an account is in collections', () => {
    const ctx = buildPathContextDefaults({
      cashTotal: 300,
      debtAccounts: [debt({ id: 'c', name: 'Collections Account', subtype: 'collections', balance: 900 })],
    });
    const { byKey } = size(ctx);
    expect(byKey.get('stabilize')!.status).toBe('not_started');
    expect(byKey.get('stabilize')!.action).toContain('Clear what is in collections first');
    expect(byKey.get('stabilize')!.action).toContain('save $700');
  });

  it('asks for no saving once the buffer is already there behind the collections', () => {
    // Two independent things gate this step. With the cash already saved the
    // instruction used to ask them to "save $0 to reach the $1,000 starter
    // fund", which is an order to do nothing.
    const ctx = buildPathContextDefaults({
      cashTotal: 5000,
      debtAccounts: [debt({ id: 'c', name: 'Collections Account', subtype: 'collections', balance: 900 })],
    });
    const action = size(ctx).byKey.get('stabilize')!.action;
    expect(action).toContain('Clear what is in collections');
    expect(action).not.toContain('$0');
  });
});

describe('emergency fund months by employment type', () => {
  const spend = (employmentType: string) =>
    buildPathContextDefaults({ employmentType, stableMonthlyExpenses: 4000 });

  it('uses 6 months for W2', () => {
    expect(emergencyFundTarget(spend('w2'))).toBe(24000);
    expect(size(spend('w2')).byKey.get('emergency-fund')!.title).toBe('Save 6 months of expenses');
  });

  it('uses 9 months for self-employed and 1099', () => {
    expect(emergencyFundTarget(spend('self_employed'))).toBe(36000);
    expect(emergencyFundTarget(spend('1099'))).toBe(36000);
    expect(size(spend('1099')).byKey.get('emergency-fund')!.title).toBe('Save 9 months of expenses');
  });

  it('prices from the stable trailing figure, not the 30-day one', () => {
    const ctx = buildPathContextDefaults({ stableMonthlyExpenses: 3000, monthlyExpenses: 9000 });
    expect(emergencyFundTarget(ctx)).toBe(18000);
  });

  it('falls back to 70% of income when there is no spending history', () => {
    const ctx = buildPathContextDefaults({ annualIncome: 60000 });
    expect(emergencyFundTarget(ctx)).toBe((60000 / 12) * 0.7 * 6);
  });

  it('has no target at all with neither spending nor income', () => {
    const { byKey } = size(buildPathContextDefaults({}));
    expect(byKey.get('emergency-fund')!.target).toBeNull();
    expect(byKey.get('emergency-fund')!.action).toContain('Add your income');
  });
});

describe('contribution limits by age', () => {
  // Everything the age table says is only reachable once the accounts are.
  // `usable` holds an IRA they can fully fund and a workplace plan; the tests
  // that take one of those away are the ones below it.
  //
  // `employerMatchPct: 0` IS the workplace plan. Onboarding writes 0 for a
  // 401(k) that matches nothing and null for no 401(k) at all, and a balance
  // stands for neither: one left at a former employer is no room to fill.
  const usable = (over: Partial<PathContext> = {}) =>
    buildPathContextDefaults({
      age: 30,
      annualIncome: 90_000,
      filingStatus: 'single',
      employerMatchPct: 0,
      ...over,
    });

  it('age 30 with an HDHP: 7500 + 24500 + 4400', () => {
    expect(contributionLimits(usable({ hasHDHP: true })).total).toBe(36400);
  });
  it('age 30 without an HDHP drops the HSA room', () => {
    expect(contributionLimits(usable()).total).toBe(32000);
  });
  it('age 61 with an HDHP: 8600 + 35750 + 5400', () => {
    expect(contributionLimits(usable({ age: 61, hasHDHP: true })).total).toBe(49750);
  });
  it('age 52 uses the 50+ catch-up but not the 60-63 one', () => {
    expect(contributionLimits(usable({ age: 52 })).total).toBe(41100);
  });
  it('an unknown age is priced at the under-50 room', () => {
    expect(contributionLimits(usable({ age: null })).total).toBe(32000);
  });

  it('counts no 401(k) room for a household with no workplace plan', () => {
    // An IRA holder with no employer plan was told to fill the whole elective
    // deferral limit in an account they do not have.
    const room = contributionLimits(usable({ employerMatchPct: null }));
    expect(room.k401Max).toBe(0);
    expect(room.total).toBe(7500);
  });

  it('counts the 401(k) room of a plan that matches nothing', () => {
    // 0 is a plan, null is no plan, and reading the column as `?? 0` flattened
    // the two and cost this household the entire deferral limit.
    expect(contributionLimits(usable({ employerMatchPct: 0 })).k401Max).toBe(24500);
    expect(contributionLimits(usable({ employerMatchPct: null })).k401Max).toBe(0);
  });

  it('counts no room against a 401(k) balance nobody said they still have', () => {
    // A balance can be one left behind at a former employer, which is no room
    // to contribute to. Their own answer is the only thing that says.
    const room = contributionLimits(usable({ employerMatchPct: null, trad401kBalance: 190_000 }));
    expect(room.k401Max).toBe(0);
  });

  it('counts no Roth room for a household over the phase-out', () => {
    // The tax-advantaged step declines to name a Roth at this income, so the
    // room step must not count one.
    const room = contributionLimits(usable({ annualIncome: 400_000 }));
    expect(room.rothMax).toBe(0);
    expect(room.total).toBe(24500);
  });

  it('offers no step at all when no account is open to them', () => {
    // The room being 0 is not the point. What the reader would have seen is:
    // a numbered step headed "Max out your contribution room", instructing
    // them to fill $0 of it, holding a $0 standing share of their surplus.
    const noneOpen = buildPathContextDefaults({
      age: 30,
      annualIncome: 90_000,
      rothIraBalance: 20_000,
    });
    expect(contributionLimits(noneOpen).total).toBe(0);

    const step = size(noneOpen).byKey.get('max-contributions');
    expect(step).toBeUndefined();
  });
});

describe('the financial independence number', () => {
  it('is 25x annual spending', () => {
    const ctx = buildPathContextDefaults({
      annualIncome: 120000,
      stableMonthlyExpenses: 5000,
      rothIraBalance: 100000,
      brokerageBalance: 50000,
    });
    const step = size(ctx).byKey.get('financial-independence')!;
    expect(step.target).toBe(5000 * 12 * 25);
    expect(step.current).toBe(150000);
    expect(step.progress).toBe(10);
  });

  it('reads complete once the portfolio covers it', () => {
    const ctx = buildPathContextDefaults({
      annualIncome: 60000,
      stableMonthlyExpenses: 2000,
      brokerageBalance: 700000,
    });
    expect(size(ctx).byKey.get('financial-independence')!.status).toBe('complete');
  });
});

describe('debt payoff totals', () => {
  it('states the account balance as the amount to clear', () => {
    const ctx = buildPathContextDefaults({
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 8400, apr: 22.99, minimumPayment: 210 })],
    });
    const step = size(ctx).byKey.get('debt:a')!;
    expect(step.current).toBe(8400);
    expect(step.target).toBe(0);
  });
});

// ── Estimated minimum payments ───────────────────────────────────────────────

describe('an estimated minimum payment is never presented as reported', () => {
  it('says so when the lender reports none', () => {
    const ctx = buildPathContextDefaults({
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 5000, apr: 20, minimumPayment: 150, minimumPaymentEstimated: true })],
    });
    expect(size(ctx).byKey.get('debt:a')!.notes).toEqual([
      'The $150 minimum is our estimate. Your lender has not reported one.',
    ]);
  });

  it('says nothing when the lender does report one', () => {
    const ctx = buildPathContextDefaults({
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 5000, apr: 20, minimumPayment: 150, minimumPaymentEstimated: false })],
    });
    expect(size(ctx).byKey.get('debt:a')!.notes).toEqual([]);
  });

  // The note qualifies a figure, so the figure has to be on the card. `action`
  // carries it only on the step you are standing on, and the page hides that
  // box everywhere else, so the fact states it in every state.
  it('states the minimum as a fact, so the note has something to qualify', () => {
    const ctx = buildPathContextDefaults({
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 5000, apr: 20, minimumPayment: 150, minimumPaymentEstimated: true })],
    });
    const step = size(ctx).byKey.get('debt:a')!;
    expect(step.fact).toBe('Minimum payment $150 a month.');
    expect(step.notes[0]).toContain('$150');
  });

  it('leaves the fact empty where there is no figure to qualify', () => {
    const ctx = buildPathContextDefaults({});
    expect(size(ctx).byKey.get('emergency-fund')!.fact).toBe('');
  });
});

// ── What a card says when you are not standing on it ─────────────────────────

// The page renders `action` only on the current step, so off it `fact` is the
// only line carrying figures. A measured step that leaves it empty puts a card
// on screen with no number on it at all.
describe('every measured step states its own figures', () => {
  const READINESS: PathReadiness = {
    successRate: 61,
    targetSuccess: 85,
    verdict: 'at_risk',
    currentAge: 50,
    retirementAge: 65,
    currentMonthlySavings: 900,
    requiredMonthlySavings: 1400,
    requiredSuccessRate: 87,
    medianByAge: medianPath(135_000, 40),
    simRuns: 8,
  };
  const ctx = buildPathContextDefaults({
    age: 40,
    annualIncome: 120_000,
    monthlyIncome: 10_000,
    monthlyExpenses: 6_000,
    stableMonthlyExpenses: 6_000,
    monthlySurplus: 4_000,
    savingsRate: 40,
    cashTotal: 20_000,
    hasHDHP: true,
    trad401kBalance: 90_000,
    rothIraBalance: 30_000,
    brokerageBalance: 15_000,
    debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 5_000, apr: 20, minimumPayment: 150 })],
    goals: [{ id: 'g', name: 'Boat', category: 'savings', targetAmount: 60_000, currentAmount: 15_000, deadline: null, details: null }],
  });

  it('leaves no unfinished measured step without a figure, and adds none to the rest', () => {
    const { steps } = size(ctx, READINESS);
    const measured = steps.filter((s) => s.target !== null);
    const unmeasured = steps.filter((s) => s.target === null);

    // The sweep is only worth anything if it actually sees the measured kinds.
    expect(new Set(measured.map((s) => s.kind))).toEqual(new Set([
      'buffer', 'debt', 'emergency-fund', 'savings-rate', 'goal', 'independence',
    ]));
    expect(measured.filter((s) => s.status !== 'complete' && s.fact === '')).toEqual([]);
    expect(unmeasured.filter((s) => s.fact !== '')).toEqual([]);
  });

  // A finished step is already ticked. Restating a position against a target it
  // has run past reads as a lopsided ratio nobody would say out loud, and the
  // tick has already said the only thing left worth saying.
  it('says nothing about where a finished step stands', () => {
    // No simulation, so the amount step is the benchmark share, which this
    // surplus is already past. Both measured steps are therefore finished.
    const { byKey } = size(ctx);
    const buffer = byKey.get('stabilize')!;
    const rate = byKey.get('savings-rate')!;

    // Both are measured, both are past their target: the case this covers.
    expect([buffer.status, rate.status]).toEqual(['complete', 'complete']);
    expect(buffer.current! > buffer.target!).toBe(true);
    expect(rate.current! > rate.target!).toBe(true);

    expect(buffer.fact).toBe('');
    expect(rate.fact).toBe('');
  });

  it('states a pot as what is saved against what it is for', () => {
    const { byKey } = size(ctx, READINESS);
    // The shared context has the buffer long finished, so it is read short of
    // its target instead.
    expect(size({ ...ctx, cashTotal: 400 }, READINESS).byKey.get('stabilize')!.fact)
      .toBe('$400 saved of the $1,000 target.');
    expect(byKey.get('emergency-fund')!.fact).toBe('$20,000 saved of the $36,000 target.');
    expect(byKey.get('goal:g')!.fact).toBe('$15,000 saved of the $60,000 target.');
    expect(byKey.get('financial-independence')!.fact).toBe('$135,000 saved of the $1,800,000 target.');
  });

  // A month's surplus is not a pot that has been put aside, so it is stated in
  // the unit it is measured in.
  it('states a rate in its own unit', () => {
    // The simulation asked for $2,600 against a $2,000 benchmark, so the
    // simulation set the target and what it reports going in is the reading.
    const simBinds = { ...READINESS, requiredMonthlySavings: 2_600 };
    expect(size(ctx, simBinds).byKey.get('savings-rate')!.fact)
      .toBe('$900 a month of the $2,600 target.');
    // Where the benchmark sets it, the surplus is the reading, whether or not
    // a simulation ran. Both figures come off one test or the line compares
    // two different quantities.
    const short = { ...ctx, monthlySurplus: 1_000 };
    expect(size(short).byKey.get('savings-rate')!.fact)
      .toBe('$1,000 a month of the $2,000 target.');
    expect(size(short, READINESS).byKey.get('savings-rate')!.fact)
      .toBe('$1,000 a month of the $2,000 target.');
  });

  // Its balance is already the payoff figure the rest of the card quotes, so a
  // saved-of-target line would say the same thing a second way.
  it('leaves a debt step with the minimum it already stated, and nothing else', () => {
    expect(size(ctx, READINESS).byKey.get('debt:a')!.fact).toBe('Minimum payment $150 a month.');
  });
});

// ── The waterfall ────────────────────────────────────────────────────────────

describe('monthly funding waterfalls over the surplus in path order', () => {
  const ctx = buildPathContextDefaults({
    annualIncome: 96000,
    monthlyIncome: 8000,
    monthlyExpenses: 6000,
    stableMonthlyExpenses: 6000,
    monthlySurplus: 2000,
    cashTotal: 0,
  });

  it('puts the whole surplus on the first unfinished step', () => {
    const { steps } = size(ctx);
    expect(steps[0].key).toBe('stabilize');
    expect(steps[0].monthlyFunding).toBe(2000);
  });

  it('gives later steps a date that includes the wait for the ones ahead', () => {
    const { byKey } = size(ctx);
    const buffer = byKey.get('stabilize')!;
    const fund = byKey.get('emergency-fund')!;
    expect(buffer.projectedDate).not.toBeNull();
    expect(fund.projectedDate).not.toBeNull();
    expect(fund.projectedDate! > buffer.projectedDate!).toBe(true);
  });

  it('funds nothing and dates nothing when there is no surplus', () => {
    const broke = buildPathContextDefaults({
      annualIncome: 48000, monthlyIncome: 4000, monthlyExpenses: 4200,
      stableMonthlyExpenses: 4200, monthlySurplus: -200,
    });
    const { byKey } = size(broke);
    expect(byKey.get('stabilize')!.monthlyFunding).toBe(0);
    expect(byKey.get('stabilize')!.projectedDate).toBeNull();
  });

  it('keeps a debt minimum flowing even with no surplus, and dates it from that', () => {
    const broke = buildPathContextDefaults({
      monthlySurplus: 0,
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 1200, apr: 20, minimumPayment: 100, minimumPaymentEstimated: false })],
    });
    const step = size(broke).byKey.get('debt:a')!;
    expect(step.monthlyFunding).toBe(100);
    expect(step.action).toMatch(/^The \$100 minimum clears this by /);
  });

  it('names the surplus separately from the minimum already leaving the account', () => {
    const ctx2 = buildPathContextDefaults({
      monthlySurplus: 400,
      cashTotal: 1000,
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 6000, apr: 24, minimumPayment: 200, minimumPaymentEstimated: false })],
    });
    const step = size(ctx2).byKey.get('debt:a')!;
    expect(step.action).toMatch(/^Add \$400 a month to the \$200 minimum and it clears by /);
  });

  it('does not quote a monthly rate for a balance one payment clears', () => {
    const ctx2 = buildPathContextDefaults({
      monthlySurplus: 5000,
      cashTotal: 1000,
      debtAccounts: [debt({ id: 'a', name: 'Store Card', balance: 1850, minimumPayment: 37 })],
    });
    expect(size(ctx2).byKey.get('debt:a')!.action).toBe('One payment of $1,850 clears this.');
  });

  it('claims no progress on a step with nothing measurable to measure', () => {
    const ctx2 = buildPathContextDefaults({
      annualIncome: 90000, employerMatchPct: 4, trad401kBalance: 50000,
    });
    const { byKey } = size(ctx2);
    for (const key of ['employer-match', 'tax-advantaged']) {
      const step = byKey.get(key)!;
      expect(step.target).toBeNull();
      expect(step.progress).toBe(0);
    }
  });

  it('adds the surplus to the minimum once the waterfall reaches the account', () => {
    const ctx2 = buildPathContextDefaults({
      monthlySurplus: 400,
      cashTotal: 1000, // starter buffer already done, so debt is first in line
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 6000, apr: 24, minimumPayment: 200, minimumPaymentEstimated: false })],
    });
    expect(size(ctx2).byKey.get('debt:a')!.monthlyFunding).toBe(600);
  });

  it('caps a contribution-limits step at the monthly rate that fills the room', () => {
    const ctx2 = buildPathContextDefaults({
      annualIncome: 250000, monthlyIncome: 250000 / 12,
      monthlyExpenses: 5000, stableMonthlyExpenses: 5000, monthlySurplus: 15833,
      // Over the Roth phase-out at any filing status, so the room this
      // household can actually use is the 401(k) limit and nothing else.
      cashTotal: 400000, age: 40, hasHDHP: false, employerMatchPct: 0, trad401kBalance: 5000,
    });
    const step = size(ctx2).byKey.get('max-contributions')!;
    expect(step.monthlyFunding).toBe(Math.round(24500 / 12));
    // An annual limit resets rather than finishing, so it never carries a date.
    expect(step.projectedDate).toBeNull();
    // A balance is not a contribution made this year, so no progress is claimed.
    expect(step.current).toBeNull();
    expect(step.target).toBeNull();
    expect(step.action).toBe(
      `Fill $24,500 of ${CONTRIBUTION_TAX_YEAR} contribution room across your tax-advantaged accounts.`,
    );
  });

  it('leaves the steps below a recurring step only what it did not claim', () => {
    const ctx2 = buildPathContextDefaults({
      annualIncome: 250000, monthlyIncome: 250000 / 12,
      monthlyExpenses: 15000, stableMonthlyExpenses: 15000, monthlySurplus: 5833,
      cashTotal: 400000, age: 40, hasHDHP: false, employerMatchPct: 0, trad401kBalance: 5000,
      goals: [{ id: 'g', name: 'Boat', category: 'savings', targetAmount: 60000, currentAmount: 0, deadline: null, details: null }],
    });
    const { byKey } = size(ctx2);
    const room = Math.round(24500 / 12);
    expect(byKey.get('max-contributions')!.monthlyFunding).toBe(room);
    expect(byKey.get('goal:g')!.monthlyFunding).toBe(5833 - room);
  });
});

// ── Bookkeeping ──────────────────────────────────────────────────────────────

describe('what the person said about a step survives the rebuild', () => {
  it('marks a step complete from the stored note, and stops instructing', () => {
    const ctx = buildPathContextDefaults({ dependentCount: 1 });
    const step = size(ctx, null, marks({ 'term-life': done('Got term life') }))
      .byKey.get('term-life')!;
    expect(step.status).toBe('complete');
    expect(step.progress).toBe(100);
    // A finished step issues no order.
    expect(step.action).toBe('');
    // Their own words come back as the note, which is where the page prints it.
    expect(step.note).toBe('Got term life');
  });

  it('keeps their note when the figures, not the tick, decide the status', () => {
    // A measured step: the balance says where it stands, so the tick no longer
    // sets the status. The sentence they typed is still theirs, and used to be
    // dropped on the floor here.
    const ctx = buildPathContextDefaults({
      annualIncome: 96000, monthlyIncome: 8000,
      monthlyExpenses: 6000, stableMonthlyExpenses: 6000, monthlySurplus: 2000,
      cashTotal: 500,
    });
    const step = size(ctx, null, marks({ stabilize: done('Opened the savings account') }))
      .byKey.get('stabilize')!;
    expect(step.status).toBe('in_progress');
    expect(step.note).toBe('Opened the savings account');
  });

  it('does not instruct on a measured step the figures already finished', () => {
    // $2.5M invested against a $1.2M independence number: built, and the step
    // kept saying "Build the portfolio to $1,200,000" anyway.
    const ctx = buildPathContextDefaults({
      annualIncome: 96000, monthlyIncome: 8000,
      monthlyExpenses: 4000, stableMonthlyExpenses: 4000, monthlySurplus: 4000,
      brokerageBalance: 2_500_000,
    });
    const step = size(ctx).byKey.get('financial-independence')!;
    expect(step.status).toBe('complete');
    expect(step.action).toBe('');
  });

  it('never lets a step taken off the path reach the sizing pass at all', () => {
    // The stored path splits these out before it sizes anything, because the
    // waterfall walks the list it is given in order: a step nobody is working
    // on, left in, would push every date behind it out by its own funding.
    const ctx = buildPathContextDefaults({
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 500, apr: 19 })],
    });
    const candidates = buildPathCandidates(ctx).filter((c) => c.key !== 'debt:a');
    expect(sizePath(candidates, ctx).map((s) => s.key)).not.toContain('debt:a');
  });
});

// ── The two newest steps ─────────────────────────────────────────────────────

describe('savings rate', () => {
  const earning = (overrides: Partial<PathContext> = {}) =>
    buildPathContextDefaults({
      annualIncome: 96000, monthlyIncome: 8000,
      monthlyExpenses: 6000, stableMonthlyExpenses: 6000,
      monthlySurplus: 2000, savingsRate: 25,
      ...overrides,
    });

  it('measures what is kept each month against 20% of income', () => {
    const step = size(earning()).byKey.get('savings-rate')!;
    expect(step.target).toBe(1600);
    expect(step.current).toBe(2000);
    expect(step.status).toBe('complete');
  });

  it('reads in progress below the benchmark, with the shortfall in the action', () => {
    const step = size(earning({ monthlySurplus: 800, savingsRate: 10 })).byKey.get('savings-rate')!;
    expect(step.status).toBe('in_progress');
    expect(step.progress).toBe(50);
    expect(step.action).toBe('Free up $800 a month to save 20% of what you earn.');
  });

  it('counts nothing kept when the month ends in the red', () => {
    const step = size(earning({ monthlySurplus: -400, savingsRate: -5 })).byKey.get('savings-rate')!;
    expect(step.current).toBe(0);
    expect(step.status).toBe('not_started');
    expect(step.progress).toBe(0);
  });

  it('takes no share of the waterfall, because the surplus IS the step', () => {
    const { byKey } = size(earning({ monthlySurplus: 800, savingsRate: 10, cashTotal: 0 }));
    const rate = byKey.get('savings-rate')!;
    expect(rate.monthlyFunding).toBe(0);
    expect(rate.projectedDate).toBeNull();
    // The steps below it still see the whole surplus.
    expect(byKey.get('stabilize')!.monthlyFunding).toBe(800);
  });
});

describe('taxable brokerage', () => {
  const investing = (overrides: Partial<PathContext> = {}) =>
    buildPathContextDefaults({
      annualIncome: 180000, monthlyIncome: 15000,
      monthlyExpenses: 9000, stableMonthlyExpenses: 9000,
      monthlySurplus: 6000, savingsRate: 40, rothIraBalance: 40000,
      ...overrides,
    });

  it('reads not started with nothing in a taxable account yet', () => {
    const step = size(investing()).byKey.get('taxable-brokerage')!;
    expect(step.current).toBe(0);
    expect(step.status).toBe('not_started');
    expect(step.action).toBe('Open a taxable brokerage account and set up a monthly transfer into broad index funds.');
    // The manual tick is the only way to finish a step with no dollar target.
    expect(step.target).toBeNull();
  });

  it('is off the path entirely once one is open, so nothing sizes it', () => {
    // The step is the opening, and an opening somebody has done is not a step
    // they are part way through. What goes in each month is the amount step's
    // job and the waterfall's, both of which read the same surplus.
    expect(size(investing({ brokerageBalance: 25000, taxableBrokerageBalance: 25000 }))
      .byKey.get('taxable-brokerage')).toBeUndefined();
  });
});

// ── Every estimate announces itself ──────────────────────────────────────────

describe('a figure we assumed is never stated back as theirs', () => {
  const noHistory = () =>
    buildPathContextDefaults({ annualIncome: 120000, monthlyIncome: 10000, cashTotal: 5000 });

  it('says where the emergency-fund figure came from when no spending priced it', () => {
    const step = size(noHistory()).byKey.get('emergency-fund')!;
    // 70% of $10,000 a month, six months of it.
    expect(step.target).toBe(42000);
    expect(step.notes.join(' ')).toContain('no spending history');
    expect(step.notes.join(' ')).toContain('70% of your income');
  });

  it('stops calling the independence figure the amount they spend', () => {
    const step = size(noHistory()).byKey.get('financial-independence')!;
    expect(step.action).not.toContain('you spend');
    expect(step.notes.join(' ')).toContain('70% of your income');
  });

  it('says nothing of the sort once there is spending to price it from', () => {
    const ctx = buildPathContextDefaults({
      annualIncome: 120000, monthlyIncome: 10000, cashTotal: 5000,
      monthlyExpenses: 6000, stableMonthlyExpenses: 6000, monthlySurplus: 4000, savingsRate: 40,
    });
    const { byKey } = size(ctx);
    expect(byKey.get('emergency-fund')!.notes).toEqual([]);
    expect(byKey.get('financial-independence')!.action).toContain('a year you spend');
  });

  it('discloses the rate a mortgage minimum was amortised at when we chose it', () => {
    // Every other estimate on this page announces itself. This one quoted a
    // payment worked out from a rate nobody supplied and said only that the
    // payment was an estimate.
    const ctx = buildPathContextDefaults({
      annualIncome: 120000, monthlyIncome: 10000, cashTotal: 5000,
      monthlyExpenses: 6000, stableMonthlyExpenses: 6000, monthlySurplus: 4000,
      debtAccounts: [
        debt({
          id: 'm', name: 'Home Loan', type: 'loan', subtype: 'mortgage',
          balance: 300000, apr: null, minimumPayment: 1896.2,
          minimumPaymentEstimated: true, minimumPaymentAssumedApr: 6.5,
        }),
      ],
    });
    const note = size(ctx).byKey.get('debt:m')!.notes.join(' ');
    expect(note).toContain('6.5% a year');
    expect(note).toContain('neither a payment nor a rate');
  });
});

// ── The pointer has to be able to move ───────────────────────────────────────

describe('a step that cannot be finished never holds "you are here"', () => {
  const readiness = (): PathReadiness => ({
    successRate: 61,
    targetSuccess: 85,
    verdict: 'at_risk',
    retirementAge: 65,
    currentAge: 36,
    simRuns: 100,
    currentMonthlySavings: 900,
    // By construction the smallest contribution that clears the threshold, so
    // it is always above what is going in and the step can never read complete.
    requiredMonthlySavings: 2400,
    requiredSuccessRate: 86,
    medianByAge: medianPath(20_000, 54),
  });

  // Everything above the two rate steps is finished, so the rate steps are the
  // first unfinished thing on the path. That is the situation the pointer got
  // stuck in, and it is not exotic: it is any household that has built its
  // reserve and is still saving under 20%.
  const reachedTheRateSteps = () =>
    buildPathContextDefaults({
      annualIncome: 96000, monthlyIncome: 8000,
      monthlyExpenses: 7000, stableMonthlyExpenses: 7000,
      monthlySurplus: 1000, savingsRate: 12,
      cashTotal: 50000, dateOfBirth: new Date('1990-01-01'), age: 36,
      rothIraBalance: 20000, dependentCount: 0,
    });
  const willIsWritten = marks({ 'will-trust': done() });

  it('stands on a step below it rather than on the rate step', () => {
    const { steps, byKey } = size(reachedTheRateSteps(), readiness(), willIsWritten);
    const order = steps.map((st) => st.key);
    // The rate step really is unfinished, and it really is above the step the
    // pointer settles on.
    expect(order.indexOf('savings-rate')).toBeGreaterThan(order.indexOf('tax-advantaged'));
    expect(byKey.get('savings-rate')!.status).not.toBe('complete');

    const standing = currentStepKey(steps);
    expect(standing).not.toBe('savings-rate');
    expect(standing).toBe('tax-advantaged');
  });

  it('leaves the rate step able to state its own instruction anyway', () => {
    // Losing the pointer must not silence it: on a rate step the number IS the
    // order, and the page renders an instruction only where it is told to.
    const { byKey } = size(reachedTheRateSteps(), readiness(), willIsWritten);
    expect(byKey.get('savings-rate')!.action).toContain('a month more into savings');
  });

  it('advances as the steps below the rate step are finished', () => {
    // The whole failure this prevents: the pointer settled on the rate step and
    // never moved again, so every step below it went uninstructed for good.
    const { steps } = size(
      reachedTheRateSteps(),
      readiness(),
      marks({ 'will-trust': done(), 'tax-advantaged': done() }),
    );
    expect(currentStepKey(steps)).not.toBe('tax-advantaged');
    expect(currentStepKey(steps)).not.toBe('savings-rate');
  });

  it('never lands on a step that is already finished', () => {
    // With nothing but rate steps left unfinished, the pointer fell straight
    // through to the LAST step, which can be one already ticked done. The hero
    // then read "You are here" on a card marked complete, and the docstring
    // claimed it landed somewhere it did not.
    const steps = [
      { key: 'stabilize', kind: 'buffer', status: 'complete' },
      { key: 'savings-rate', kind: 'savings-rate', status: 'in_progress' },
      { key: 'emergency-fund', kind: 'emergency-fund', status: 'complete' },
    ] as unknown as Parameters<typeof currentStepKey>[0];

    expect(currentStepKey(steps)).toBe('savings-rate');
  });
});

// ── A user can slip back down ────────────────────────────────────────────────

describe('a step regresses when the balance behind it falls', () => {
  const withCash = (cashTotal: number, overrides: Partial<PathContext> = {}) =>
    buildPathContextDefaults({
      annualIncome: 96000, monthlyIncome: 8000,
      monthlyExpenses: 4000, stableMonthlyExpenses: 4000,
      monthlySurplus: 4000, savingsRate: 50,
      cashTotal, dependentCount: 0,
      ...overrides,
    });

  it('drops a fully funded emergency fund back to in progress once it is spent', () => {
    const funded = size(withCash(24000)).byKey.get('emergency-fund')!;
    expect(funded.status).toBe('complete');
    expect(funded.progress).toBe(100);

    const drained = size(withCash(6000)).byKey.get('emergency-fund')!;
    expect(drained.status).toBe('in_progress');
    expect(drained.progress).toBe(25);
    expect(drained.action).toBe('Save $18,000 more to reach 6 months of expenses. At $4,000 a month that is ' +
      new Date(drained.projectedDate! + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + '.');
  });

  it('drops the starter fund back to not started once the cash is gone', () => {
    expect(size(withCash(1000)).byKey.get('stabilize')!.status).toBe('complete');
    expect(size(withCash(0)).byKey.get('stabilize')!.status).toBe('not_started');
  });

  it('moves the "you are here" pointer back up to the step that regressed', () => {
    expect(currentStepKey(size(withCash(24000)).steps)).not.toBe('emergency-fund');
    expect(currentStepKey(size(withCash(6000)).steps)).toBe('emergency-fund');
  });

  it('never lets a stored tick pin a measured step complete against the figures', () => {
    // The old fixed ladder let a user tick these off by hand. The balance is
    // the truth now, in both directions.
    const ticked = marks({ 'emergency-fund': done('done'), stabilize: done() });
    const { byKey } = size(withCash(6000), null, ticked);
    expect(byKey.get('emergency-fund')!.status).toBe('in_progress');
    expect(byKey.get('stabilize')!.status).toBe('complete'); // $6,000 clears $1,000 on its own
    expect(size(withCash(0), null, ticked).byKey.get('stabilize')!.status).toBe('not_started');
  });

  it('still honours a stored tick on a step nothing measures', () => {
    const { byKey } = size(withCash(6000), null, marks({ 'will-trust': done('Signed at the lawyer') }));
    expect(byKey.get('will-trust')!.status).toBe('complete');
  });
});

// ── The amount step, when the simulation is what sets its figure ─────────────

describe('the retirement gap is sized as a monthly rate, not a pot', () => {
  const READINESS: PathReadiness = {
    successRate: 61,
    targetSuccess: 85,
    verdict: 'at_risk',
    currentAge: 50,
    retirementAge: 65,
    currentMonthlySavings: 900,
    // Above 20% of this income, so the simulation is what the step settles on.
    requiredMonthlySavings: 2000,
    requiredSuccessRate: 87,
    medianByAge: medianPath(50_000, 40),
    simRuns: 8,
  };
  const ctx = buildPathContextDefaults({
    annualIncome: 85_000,
    monthlyIncome: 85_000 / 12,
    monthlyExpenses: 4_700,
    stableMonthlyExpenses: 4_700,
    monthlySurplus: 2_383,
    savingsRate: 34,
    cashTotal: 40_000,
    employerMatchPct: 0,
    trad401kBalance: 50_000,
  });

  it('measures what goes in today against what would have to', () => {
    const step = size(ctx, READINESS).byKey.get('savings-rate')!;
    expect(step.current).toBe(900);
    expect(step.target).toBe(2000);
    expect(step.progress).toBe(45);
    expect(step.status).toBe('in_progress');
  });

  it('names the gap to close, in the same figures', () => {
    const step = size(ctx, READINESS).byKey.get('savings-rate')!;
    expect(step.action).toBe('Move $1,100 a month more into savings to reach $2,000.');
  });

  it('sizes against the larger of the two tests, never the smaller', () => {
    // 20% of this income is $1,417. Sized off the simulation's own figure
    // alone, a household the benchmark binds on would read a target below the
    // one its own title states.
    const benchmarkBinds = { ...READINESS, requiredMonthlySavings: 1_000 };
    const step = size(ctx, benchmarkBinds).byKey.get('savings-rate')!;
    expect(step.target).toBeCloseTo(1_416.67, 2);
    expect(step.target!).toBeGreaterThan(1_000);
  });

  // ── The two figures are on one basis ──────────────────────────────────────
  //
  // The target is the higher of the benchmark share and the simulation's
  // contribution. `current` has to be whichever quantity that same test
  // measures, and it was not: it came off the simulation whenever a simulation
  // had run, and the simulation counts `max(0, income * 0.75 - annual spend) /
  // 12 + match` where the benchmark counts `income - spending`. On this
  // household those are $900 and $2,383.
  //
  // So the whole card turned on whether a readiness read happened to be
  // attached, not on which test bound. Same income, same spending, same target.

  it('measures the surplus against the benchmark when the benchmark is what binds', () => {
    const benchmarkBinds = { ...READINESS, requiredMonthlySavings: 1_000 };
    const step = size(ctx, benchmarkBinds).byKey.get('savings-rate')!;
    // Not 900. The simulation's contribution is not a share of gross income,
    // and it is not what the $1,417 was worked out from.
    expect(step.current).toBe(2_383);
    expect(step.status).toBe('complete');
    expect(step.progress).toBe(100);
    expect(step.action).toBe('');
  });

  it('reads a household the same way whether or not a simulation ran', () => {
    const benchmarkBinds = { ...READINESS, requiredMonthlySavings: 1_000 };
    const attached = size(ctx, benchmarkBinds).byKey.get('savings-rate')!;
    const none = size(ctx, null).byKey.get('savings-rate')!;
    expect(attached.target).toBe(none.target);
    expect(attached.current).toBe(none.current);
    expect(attached.status).toBe(none.status);
    expect(attached.progress).toBe(none.progress);
    expect(attached.action).toBe(none.action);
  });

  it('names the benchmark, not the simulation, in the instruction the benchmark set', () => {
    // Below the benchmark on the surplus basis: $1,417 wanted, $600 going.
    const tight = buildPathContextDefaults({
      ...ctx,
      monthlySurplus: 600,
      stableMonthlyExpenses: 85_000 / 12 - 600,
      savingsRate: 8,
    });
    const benchmarkBinds = { ...READINESS, requiredMonthlySavings: 1_000 };
    const step = size(tight, benchmarkBinds).byKey.get('savings-rate')!;
    expect(step.current).toBe(600);
    expect(step.action).toBe('Free up $817 a month to save 20% of what you earn.');
  });

  it('takes no share of the surplus, because the surplus is what it is made of', () => {
    const step = size(ctx, READINESS).byKey.get('savings-rate')!;
    expect(step.monthlyFunding).toBe(0);
    expect(step.projectedDate).toBeNull();
  });

  it('leaves the steps below it exactly the funding they had without it', () => {
    const withStep = size(ctx, READINESS).byKey;
    const without = size(ctx, null).byKey;
    expect(withStep.get('emergency-fund')!.monthlyFunding)
      .toBe(without.get('emergency-fund')!.monthlyFunding);
    expect(withStep.get('max-contributions')!.monthlyFunding)
      .toBe(without.get('max-contributions')!.monthlyFunding);
  });

  it('cannot be ticked off by hand while the figures say otherwise', () => {
    const ticked = marks({ 'savings-rate': done('done') });
    expect(size(ctx, READINESS, ticked).byKey.get('savings-rate')!.status).toBe('in_progress');
  });

  it('reads not started when nothing goes in today', () => {
    const step = size(ctx, { ...READINESS, currentMonthlySavings: 0 }).byKey.get('savings-rate')!;
    expect(step.status).toBe('not_started');
    expect(step.progress).toBe(0);
  });
});

// ── The retirement pot is dated by the simulation ────────────────────────────
//
// One household, two sentences about one event. The hero pill read "On track to
// retire at 58" off the Monte Carlo. The retirement step read December 2068,
// off `remaining / monthlyFunding`, which credits no growth to the $1,252,000
// already invested or to any dollar added after it. Roughly 26 years of that
// gap was missing compounding.

describe('a retirement pot takes its date from the simulation, not the surplus', () => {
  // Crosses $6,250,000 between index 13 and index 14, so at age 59.
  const ON_TRACK: PathReadiness = {
    successRate: 100,
    targetSuccess: 85,
    verdict: 'on_track',
    currentAge: 45,
    retirementAge: 58,
    currentMonthlySavings: 8_650,
    requiredMonthlySavings: null,
    requiredSuccessRate: null,
    medianByAge: medianPath(1_403_835, 45, 0.12),
    simRuns: 1,
  };

  const household = (overrides: Partial<PathContext> = {}) =>
    buildPathContextDefaults({
      age: 45,
      dateOfBirth: new Date('1981-03-01'),
      annualIncome: 250_000,
      monthlyIncome: 20_833,
      monthlyExpenses: 7_721,
      stableMonthlyExpenses: 7_721,
      monthlySurplus: 13_112,
      savingsRate: 42,
      cashTotal: 130_939,
      trad401kBalance: 700_000,
      rothIraBalance: 300_000,
      brokerageBalance: 252_000,
      goals: [{
        id: 'r',
        name: 'Retirement Savings',
        category: 'retirement',
        targetAmount: 6_250_000,
        currentAmount: 1_252_000,
        deadline: null,
        details: null,
      }],
      ...overrides,
    });

  /** The first of the month `months` out, the way the sizing pass writes one. */
  const monthsOut = (months: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1))
      .toISOString().slice(0, 10);
  };

  it('lands the retirement goal where the median path crosses it, not where the surplus does', () => {
    const step = size(household(), ON_TRACK).byKey.get('goal:r')!;
    // 14 years out, the first age the median is worth $6,250,000 — a year after
    // the 58 the same simulation says they can retire at, not 42 years after it.
    expect(step.projectedDate).toBe(monthsOut(14 * 12));
    expect(step.action).toBe(
      'Save $4,998,000 more to reach $6,250,000. ' +
      "The retirement simulation's median path reaches it at age 59.",
    );
    // The straight-line sentence names a model this date did not come from.
    expect(step.action).not.toContain('a month that is');
  });

  it('gives the same treatment to the independence step, which prices the same pot', () => {
    // No retirement goal, so the built-in step stands rather than being covered.
    const step = size(household({ goals: [] }), ON_TRACK).byKey.get('financial-independence')!;
    // $2,316,300 is 25 x their spending, crossed at index 5.
    expect(step.target).toBe(2_316_300);
    expect(step.projectedDate).toBe(monthsOut(5 * 12));
    expect(step.action).toContain("The retirement simulation's median path reaches it at age 50.");
  });

  it('prints no date at all when no simulation ran', () => {
    const step = size(household(), null).byKey.get('goal:r')!;
    expect(step.projectedDate).toBeNull();
    expect(step.action).toBe('Save $4,998,000 more to reach $6,250,000.');
  });

  it('prints no date when the median never reaches the target', () => {
    const short = { ...ON_TRACK, medianByAge: medianPath(1_403_835, 45, 0.01) };
    const step = size(household(), short).byKey.get('goal:r')!;
    expect(step.projectedDate).toBeNull();
    expect(step.action).toBe('Save $4,998,000 more to reach $6,250,000.');
  });

  it('says which retirement the target prices when it is not the one the verdict priced', () => {
    const step = size(household(), ON_TRACK).byKey.get('goal:r')!;
    expect(step.notes).toEqual([
      'This target buys $250,000 a year at the 4% rule. The retirement verdict on this page ' +
      'runs on what you spend now instead, so the two are not pricing the same retirement.',
    ]);
  });

  it('says nothing of the sort when the target IS their own spending priced', () => {
    // 25 x the $92,652 a year they spend. The two readings agree, and a
    // sentence saying they differ would tell the reader nothing.
    const theirs = household({
      goals: [{
        id: 'r', name: 'Retirement Savings', category: 'retirement',
        targetAmount: 2_316_300, currentAmount: 1_252_000, deadline: null, details: null,
      }],
    });
    expect(size(theirs, ON_TRACK).byKey.get('goal:r')!.notes).toEqual([]);
  });
});
