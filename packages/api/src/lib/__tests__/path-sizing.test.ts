import { describe, it, expect } from 'vitest';
import { buildPathContextDefaults, type PathContext } from '../path-context.js';
import { buildPathCandidates } from '../path-candidates.js';
import { sizePath, contributionLimits, emergencyFundTarget } from '../path-sizing.js';
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

function size(ctx: PathContext, readiness: PathReadiness | null = null) {
  const steps = sizePath(buildPathCandidates(ctx, readiness), ctx);
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
      cashTotal: 5000,
      debtAccounts: [debt({ id: 'c', name: 'Collections Account', subtype: 'collections', balance: 900 })],
    });
    const { byKey } = size(ctx);
    expect(byKey.get('stabilize')!.status).toBe('not_started');
    expect(byKey.get('stabilize')!.action).toContain('Clear what is in collections first');
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
  it('age 30 with an HDHP: 7000 + 23500 + 4300', () => {
    expect(contributionLimits(30, true).total).toBe(34800);
  });
  it('age 30 without an HDHP drops the HSA room', () => {
    expect(contributionLimits(30, false).total).toBe(30500);
  });
  it('age 61 with an HDHP: 8000 + 34750 + 5300', () => {
    expect(contributionLimits(61, true).total).toBe(48050);
  });
  it('age 52 uses the 50+ catch-up but not the 60-63 one', () => {
    expect(contributionLimits(52, false).total).toBe(39000);
  });
  it('an unknown age is priced at the under-50 room', () => {
    expect(contributionLimits(null, false).total).toBe(30500);
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
      'buffer', 'debt', 'emergency-fund', 'savings-rate', 'retirement-readiness', 'goal', 'independence',
    ]));
    expect(measured.filter((s) => s.status !== 'complete' && s.fact === '')).toEqual([]);
    expect(unmeasured.filter((s) => s.fact !== '')).toEqual([]);
  });

  // A finished step is already ticked. Restating a position against a target it
  // has run past reads as a lopsided ratio nobody would say out loud, and the
  // tick has already said the only thing left worth saying.
  it('says nothing about where a finished step stands', () => {
    const { byKey } = size(ctx, READINESS);
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
    const { byKey } = size(ctx, READINESS);
    expect(byKey.get('retirement-readiness')!.fact).toBe('$900 a month of the $1,400 target.');
    // The surplus here already clears the benchmark, so the savings-rate step is
    // finished. Below it, it states the rate the same way.
    expect(size({ ...ctx, monthlySurplus: 1_000 }, READINESS).byKey.get('savings-rate')!.fact)
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
      cashTotal: 400000, age: 40, hasHDHP: false, rothIraBalance: 5000,
    });
    const step = size(ctx2).byKey.get('max-contributions')!;
    expect(step.monthlyFunding).toBe(Math.round(30500 / 12));
    // An annual limit resets rather than finishing, so it never carries a date.
    expect(step.projectedDate).toBeNull();
    // A balance is not a contribution made this year, so no progress is claimed.
    expect(step.current).toBeNull();
    expect(step.target).toBeNull();
    expect(step.action).toBe('Fill $30,500 of contribution room this year across your tax-advantaged accounts.');
  });

  it('leaves the steps below a recurring step only what it did not claim', () => {
    const ctx2 = buildPathContextDefaults({
      annualIncome: 250000, monthlyIncome: 250000 / 12,
      monthlyExpenses: 15000, stableMonthlyExpenses: 15000, monthlySurplus: 5833,
      cashTotal: 400000, age: 40, hasHDHP: false, rothIraBalance: 5000,
      goals: [{ id: 'g', name: 'Boat', category: 'savings', targetAmount: 60000, currentAmount: 0, deadline: null, details: null }],
    });
    const { byKey } = size(ctx2);
    const room = Math.round(30500 / 12);
    expect(byKey.get('max-contributions')!.monthlyFunding).toBe(room);
    expect(byKey.get('goal:g')!.monthlyFunding).toBe(5833 - room);
  });
});

// ── Bookkeeping ──────────────────────────────────────────────────────────────

describe('manual completion and skipping survive the rebuild', () => {
  it('marks a step complete from the stored note, and stops instructing', () => {
    const ctx = buildPathContextDefaults({
      completedSteps: [{ id: 'insurance-will', note: 'Got term life', completedAt: '2026-01-02T00:00:00Z' }],
    });
    const step = size(ctx).byKey.get('insurance-will')!;
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
      completedSteps: [{ id: 'stabilize', note: 'Opened the savings account', completedAt: '2026-01-02T00:00:00Z' }],
    });
    const step = size(ctx).byKey.get('stabilize')!;
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

  it('carries a skip through by key, including a per-account one', () => {
    const ctx = buildPathContextDefaults({
      skippedStepIds: ['debt:a'],
      debtAccounts: [debt({ id: 'a', name: 'Visa', balance: 500, apr: 19 })],
    });
    expect(size(ctx).byKey.get('debt:a')!.skipped).toBe(true);
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

  it('reads in progress once it holds something, and claims no share of a target it cannot name', () => {
    const step = size(investing({ brokerageBalance: 25000 })).byKey.get('taxable-brokerage')!;
    expect(step.current).toBe(25000);
    expect(step.status).toBe('in_progress');
    expect(step.target).toBeNull();
    expect(step.progress).toBe(0);
  });
});

// ── A user can slip back down ────────────────────────────────────────────────

describe('a step regresses when the balance behind it falls', () => {
  const withCash = (cashTotal: number, overrides: Partial<PathContext> = {}) =>
    buildPathContextDefaults({
      annualIncome: 96000, monthlyIncome: 8000,
      monthlyExpenses: 4000, stableMonthlyExpenses: 4000,
      monthlySurplus: 4000, savingsRate: 50,
      cashTotal,
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
    const stored = [
      { id: 'emergency-fund', note: 'done', completedAt: '2026-01-02T00:00:00Z' },
      { id: 'stabilize', note: '', completedAt: '2026-01-02T00:00:00Z' },
    ];
    const { byKey } = size(withCash(6000, { completedSteps: stored }));
    expect(byKey.get('emergency-fund')!.status).toBe('in_progress');
    expect(byKey.get('stabilize')!.status).toBe('complete'); // $6,000 clears $1,000 on its own
    expect(size(withCash(0, { completedSteps: stored })).byKey.get('stabilize')!.status).toBe('not_started');
  });

  it('still honours a stored tick on a step nothing measures', () => {
    const { byKey } = size(withCash(6000, {
      completedSteps: [{ id: 'insurance-will', note: 'Got term life', completedAt: '2026-01-02T00:00:00Z' }],
    }));
    expect(byKey.get('insurance-will')!.status).toBe('complete');
  });
});

// ── The retirement readiness step ────────────────────────────────────────────

describe('retirement readiness is sized as a monthly rate, not a pot', () => {
  const READINESS: PathReadiness = {
    successRate: 61,
    targetSuccess: 85,
    verdict: 'at_risk',
    currentAge: 50,
    retirementAge: 65,
    currentMonthlySavings: 900,
    requiredMonthlySavings: 1400,
    requiredSuccessRate: 87,
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
    trad401kBalance: 50_000,
  });

  it('measures what goes in today against what would have to', () => {
    const step = size(ctx, READINESS).byKey.get('retirement-readiness')!;
    expect(step.current).toBe(900);
    expect(step.target).toBe(1400);
    expect(step.progress).toBe(64);
    expect(step.status).toBe('in_progress');
  });

  it('names the gap to close, in the same figures', () => {
    const step = size(ctx, READINESS).byKey.get('retirement-readiness')!;
    expect(step.action).toBe('Move $500 a month more into retirement to reach $1,400.');
  });

  it('takes no share of the surplus, because the surplus is what it is made of', () => {
    const step = size(ctx, READINESS).byKey.get('retirement-readiness')!;
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
    const ticked = buildPathContextDefaults({
      ...ctx,
      completedSteps: [{ id: 'retirement-readiness', note: 'done', completedAt: '2026-01-01' }],
    });
    expect(size(ticked, READINESS).byKey.get('retirement-readiness')!.status).toBe('in_progress');
  });

  it('reads not started when nothing goes in today', () => {
    const step = size(ctx, { ...READINESS, currentMonthlySavings: 0 }).byKey.get('retirement-readiness')!;
    expect(step.status).toBe('not_started');
    expect(step.progress).toBe(0);
  });
});
