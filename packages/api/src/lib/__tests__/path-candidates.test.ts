import { describe, it, expect } from 'vitest';
import { buildPathContextDefaults, type PathContext } from '../path-context.js';
import { buildPathCandidates, classifyDebtKind, taxAdvantagedChoice } from '../path-candidates.js';
import type { PathReadiness } from '../../services/retirement-readiness.js';
import type { DebtAccount } from '../debt-accounts.js';

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

function goal(id: string, name: string, target: number, deadline: Date | null = null): PathContext['goals'][number] {
  return { id, name, category: 'savings', targetAmount: target, currentAmount: 0, deadline, details: null };
}

const keys = (ctx: PathContext, readiness: PathReadiness | null = null) =>
  buildPathCandidates(ctx, readiness).map((c) => c.key);

/** A readiness read, as `buildPathReadiness` would return one. */
function readiness(overrides: Partial<PathReadiness> = {}): PathReadiness {
  return {
    successRate: 61,
    targetSuccess: 85,
    verdict: 'at_risk',
    currentAge: 50,
    retirementAge: 65,
    currentMonthlySavings: 900,
    requiredMonthlySavings: 1400,
    requiredSuccessRate: 87,
    simRuns: 8,
    ...overrides,
  };
}

/** Enough of a household that the tax-advantaged and independence steps exist. */
const EARNER = { annualIncome: 85_000, monthlyIncome: 85_000 / 12, stableMonthlyExpenses: 4_700 };

// ── Pruning ──────────────────────────────────────────────────────────────────

describe('pruning — a step whose precondition is absent is never emitted', () => {
  it('gets NO estate step for a household with nothing to transfer', () => {
    // No dependents, no property, and not a dollar anywhere. There is no
    // possible basis for the step, which is a fact rather than a judgement, so
    // it is not emitted and nothing is asked about it.
    const ctx = buildPathContextDefaults({
      annualIncome: 62000,
      monthlyIncome: 62000 / 12,
      dependentCount: 0,
      propertyValue: 0,
      cashTotal: 0,
      stableMonthlyExpenses: 3100,
    });
    expect(keys(ctx)).not.toContain('estate-legacy');
  });

  it('emits an estate step for a childless renter with a portfolio behind them', () => {
    // The case no threshold got right. This household is nowhere near 25 times
    // a year's spending, which is what the step used to wait for, and they
    // plainly have assets that will pass to somebody. Whether it belongs in
    // their sequence today is the ordering model's call, not a number's.
    const ctx = buildPathContextDefaults({
      annualIncome: 145_000,
      monthlyIncome: 145_000 / 12,
      dependentCount: 0,
      propertyValue: 0,
      cashTotal: 18_000,
      trad401kBalance: 410_000,
      stableMonthlyExpenses: 6_400,
    });
    expect(keys(ctx)).toContain('estate-legacy');
  });

  it('emits an estate step once someone depends on them', () => {
    const ctx = buildPathContextDefaults({
      annualIncome: 62000,
      dependentCount: 2,
      stableMonthlyExpenses: 3100,
    });
    expect(keys(ctx)).toContain('estate-legacy');
  });

  it('emits an estate step for a homeowner with no dependents', () => {
    const ctx = buildPathContextDefaults({
      annualIncome: 62000,
      dependentCount: 0,
      propertyValue: 540000,
      stableMonthlyExpenses: 3100,
    });
    expect(keys(ctx)).toContain('estate-legacy');
  });

  it('a user with no debt accounts gets NO debt steps', () => {
    const ctx = buildPathContextDefaults({ annualIncome: 62000, stableMonthlyExpenses: 3100 });
    expect(buildPathCandidates(ctx).filter((c) => c.kind === 'debt')).toEqual([]);
  });

  it('leaves out a debt account whose balance rounds to zero', () => {
    const ctx = buildPathContextDefaults({
      debtAccounts: [debt({ id: 'a1', name: 'Paid Card', balance: 0.4 })],
    });
    expect(buildPathCandidates(ctx).filter((c) => c.kind === 'debt')).toEqual([]);
  });

  it('no employer match on file means no match step', () => {
    const noMatch = buildPathContextDefaults({ annualIncome: 62000, employerMatchPct: 0 });
    const withMatch = buildPathContextDefaults({ annualIncome: 62000, employerMatchPct: 4 });
    expect(keys(noMatch)).not.toContain('employer-match');
    expect(keys(withMatch)).toContain('employer-match');
  });

  it('no earned income means no tax-advantaged or contribution-limits step', () => {
    const ctx = buildPathContextDefaults({ annualIncome: 0, rothIraBalance: 40000, stableMonthlyExpenses: 2000 });
    expect(keys(ctx)).not.toContain('tax-advantaged');
    expect(keys(ctx)).not.toContain('max-contributions');
  });

  it('contribution limits waits until something is already being contributed', () => {
    const notYet = buildPathContextDefaults({ annualIncome: 90000 });
    const already = buildPathContextDefaults({ annualIncome: 90000, rothIraBalance: 12000 });
    expect(keys(notYet)).not.toContain('max-contributions');
    expect(keys(already)).toContain('max-contributions');
  });

  it('nothing to price financial independence with means no independence step', () => {
    const ctx = buildPathContextDefaults({ annualIncome: 0, monthlyExpenses: null, stableMonthlyExpenses: null });
    expect(keys(ctx)).not.toContain('financial-independence');
  });
});

// ── Two people, two paths ────────────────────────────────────────────────────

describe('two situations produce different paths', () => {
  const renter = buildPathContextDefaults({
    annualIncome: 62000,
    monthlyIncome: 62000 / 12,
    stableMonthlyExpenses: 3100,
    monthlyExpenses: 3100,
    monthlySurplus: 62000 / 12 - 3100,
    cashTotal: 4200,
    debtAccounts: [debt({ id: 'card-1', name: 'Visa', mask: '1111', balance: 5200, apr: 24.5 })],
  });

  const homeowner = buildPathContextDefaults({
    annualIncome: 190000,
    monthlyIncome: 190000 / 12,
    stableMonthlyExpenses: 8200,
    monthlyExpenses: 8200,
    monthlySurplus: 190000 / 12 - 8200,
    cashTotal: 61000,
    propertyValue: 720000,
    dependentCount: 2,
    employerMatchPct: 5,
    rothIraBalance: 88000,
    trad401kBalance: 240000,
    debtAccounts: [
      debt({ id: 'm-1', name: 'Mortgage', type: 'loan', subtype: 'mortgage', balance: 410000, apr: 5.75 }),
      debt({ id: 'auto-1', name: 'Auto Loan', type: 'loan', subtype: 'auto', balance: 21000, apr: 7.2 }),
    ],
    goals: [goal('g-1', 'Kitchen remodel', 45000, new Date('2028-06-01'))],
  });

  it('gives them different step contents', () => {
    expect(keys(renter)).not.toEqual(keys(homeowner));
    expect(keys(renter)).toContain('debt:card-1');
    expect(keys(homeowner)).not.toContain('debt:card-1');
    expect(keys(homeowner)).toContain('goal:g-1');
    expect(keys(renter)).not.toContain('goal:g-1');
  });

  it('gives them different path lengths', () => {
    expect(keys(renter).length).not.toBe(keys(homeowner).length);
  });
});

// ── Per-account fan-out ──────────────────────────────────────────────────────

describe('one step per debt account', () => {
  const ctx = buildPathContextDefaults({
    annualIncome: 80000,
    debtAccounts: [
      debt({ id: 'a', name: 'Credit Card', mask: '7997', balance: 8400, apr: 22.99 }),
      debt({ id: 'b', name: 'Credit Card', mask: '1138', balance: 2100, apr: 17.5 }),
      debt({ id: 'c', name: 'Auto Loan', type: 'loan', subtype: 'auto', mask: '5849', balance: 14000, apr: 6.4 }),
    ],
  });

  it('fans three accounts out into three steps, keyed by account id', () => {
    const debts = buildPathCandidates(ctx).filter((c) => c.kind === 'debt');
    expect(debts.map((d) => d.key)).toEqual(['debt:a', 'debt:b', 'debt:c']);
    expect(debts.map((d) => d.accountId)).toEqual(['a', 'b', 'c']);
  });

  it('names exactly one account per step', () => {
    const debts = buildPathCandidates(ctx).filter((c) => c.kind === 'debt');
    expect(debts.map((d) => d.title)).toEqual([
      'Pay off Credit Card ••7997',
      'Pay off Credit Card ••1138',
      'Pay off Auto Loan ••5849',
    ]);
  });

  it('orders each account by its own rate, worst first', () => {
    const debts = buildPathCandidates(ctx).filter((c) => c.kind === 'debt');
    expect(debts.map((d) => d.debt!.apr)).toEqual([22.99, 17.5, 6.4]);
  });

  it('places the sub-8% account after investing, and the 17.5% one before it', () => {
    const all = keys(ctx);
    expect(all.indexOf('debt:b')).toBeLessThan(all.indexOf('tax-advantaged'));
    expect(all.indexOf('debt:c')).toBeGreaterThan(all.indexOf('tax-advantaged'));
  });
});

// ── No invented rates ────────────────────────────────────────────────────────

describe('an account with no rate on file is never given one', () => {
  const ctx = buildPathContextDefaults({
    debtAccounts: [
      debt({ id: 'unrated-card', name: 'Store Card', mask: '4242', balance: 900, apr: null }),
      debt({ id: 'rated-card', name: 'Promo Card', mask: '9000', balance: 3000, apr: 0 }),
    ],
  });
  const steps = buildPathCandidates(ctx).filter((c) => c.kind === 'debt');

  it('carries a null APR through to the step', () => {
    expect(steps.find((s) => s.key === 'debt:unrated-card')!.debt!.apr).toBeNull();
  });

  it('never states or implies a rate in its copy', () => {
    const step = steps.find((s) => s.key === 'debt:unrated-card')!;
    const copy = `${step.title} ${step.subtitle} ${step.why} ${step.description}`;
    expect(copy).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(copy).toContain('no rate on file');
  });

  it('treats a reported 0% as the real rate it is, not as a missing one', () => {
    const promo = steps.find((s) => s.key === 'debt:rated-card')!;
    expect(promo.debt!.apr).toBe(0);
    expect(promo.subtitle).toContain('0% APR');
  });

  it('does not argue either way about an account with no rate', () => {
    const step = steps.find((s) => s.key === 'debt:unrated-card')!;
    expect(step.description).toContain('Without a rate we cannot say');
    // Ordered urgently, but never dressed as a known high-rate account.
    expect(step.icon).not.toBe('flame');
  });

  it('orders an unrated card among cards, ahead of a rated auto loan', () => {
    const mixed = buildPathContextDefaults({
      debtAccounts: [
        debt({ id: 'auto', name: 'Auto Loan', type: 'loan', subtype: 'auto', balance: 9000, apr: 7 }),
        debt({ id: 'card', name: 'Store Card', balance: 900, apr: null }),
      ],
    });
    const order = buildPathCandidates(mixed).filter((c) => c.kind === 'debt').map((c) => c.key);
    expect(order).toEqual(['debt:card', 'debt:auto']);
  });
});

// ── Debt kinds ───────────────────────────────────────────────────────────────

describe('classifyDebtKind — type only, never the rate', () => {
  it('reads a revolving account as a card whatever its name says', () => {
    expect(classifyDebtKind({ type: 'credit', subtype: 'credit card', name: 'Home Depot' })).toBe('card');
  });
  it('separates federal from private student loans', () => {
    expect(classifyDebtKind({ type: 'loan', subtype: 'student direct', name: 'Loan' })).toBe('federal_student');
    expect(classifyDebtKind({ type: 'loan', subtype: 'student', name: 'Sallie Mae' })).toBe('private_student');
  });
  it('does not read "credit card" as a car loan', () => {
    expect(classifyDebtKind({ type: 'loan', subtype: null, name: 'credit card refi' })).toBe('personal');
    expect(classifyDebtKind({ type: 'loan', subtype: 'auto', name: 'Car Note' })).toBe('auto');
  });
});

// ── Goals ────────────────────────────────────────────────────────────────────

describe('one step per active goal', () => {
  it('names the goal and its target date', () => {
    const ctx = buildPathContextDefaults({
      goals: [goal('g-9', 'First home', 92000, new Date('2029-03-01'))],
    });
    const step = buildPathCandidates(ctx).find((c) => c.kind === 'goal')!;
    expect(step.key).toBe('goal:g-9');
    expect(step.goalId).toBe('g-9');
    expect(step.title).toBe('First home');
    expect(step.subtitle).toBe('$92,000 by March 2029');
  });

  it('puts the soonest deadline first and undated goals last', () => {
    const ctx = buildPathContextDefaults({
      goals: [
        goal('late', 'Late', 10000, new Date('2032-01-01')),
        goal('none', 'Undated', 10000, null),
        goal('soon', 'Soon', 10000, new Date('2027-01-01')),
      ],
    });
    expect(buildPathCandidates(ctx).filter((c) => c.kind === 'goal').map((c) => c.key))
      .toEqual(['goal:soon', 'goal:late', 'goal:none']);
  });
});

// ── The two newest steps ─────────────────────────────────────────────────────

describe('savings rate', () => {
  const earning = (overrides: Partial<PathContext> = {}) =>
    buildPathContextDefaults({
      annualIncome: 96000,
      monthlyIncome: 8000,
      monthlyExpenses: 6000,
      stableMonthlyExpenses: 6000,
      monthlySurplus: 2000,
      savingsRate: 25,
      ...overrides,
    });

  it('names the benchmark in the title and the dollars in the subtitle', () => {
    const step = buildPathCandidates(earning()).find((c) => c.key === 'savings-rate')!;
    expect(step.title).toBe('Save 20% of your income');
    expect(step.subtitle).toBe('$1,600 a month, out of the $8,000 you earn');
    expect(step.why).toBe('You keep 25% of what you earn.');
  });

  it('is pruned with no income to compute a rate from', () => {
    expect(keys(earning({ annualIncome: 0, monthlyIncome: 0, savingsRate: null })))
      .not.toContain('savings-rate');
  });

  it('is pruned with no expense history to compute a rate from', () => {
    expect(keys(earning({ monthlyExpenses: null, stableMonthlyExpenses: null, savingsRate: null })))
      .not.toContain('savings-rate');
  });

  it('never states a fabricated rate when nothing is left over', () => {
    const step = buildPathCandidates(earning({ monthlySurplus: -400, savingsRate: -5 }))
      .find((c) => c.key === 'savings-rate')!;
    expect(step.why).toBe('Nothing is left over at the end of the month, so nothing is reaching any of these steps.');
    expect(step.why).not.toMatch(/-?\d+%/);
  });

  it('sits before the investing steps it pays for', () => {
    const order = keys(earning({ rothIraBalance: 20000 }));
    expect(order.indexOf('savings-rate')).toBeLessThan(order.indexOf('tax-advantaged'));
    expect(order.indexOf('savings-rate')).toBeGreaterThan(order.indexOf('emergency-fund'));
  });
});

describe('taxable brokerage', () => {
  const investing = (overrides: Partial<PathContext> = {}) =>
    buildPathContextDefaults({
      annualIncome: 180000,
      monthlyIncome: 15000,
      monthlyExpenses: 9000,
      stableMonthlyExpenses: 9000,
      monthlySurplus: 6000,
      savingsRate: 40,
      rothIraBalance: 40000,
      ...overrides,
    });

  it('names the achievement and the spare cash behind it', () => {
    const step = buildPathCandidates(investing()).find((c) => c.key === 'taxable-brokerage')!;
    expect(step.title).toBe('Invest what is left in a brokerage account');
    expect(step.why).toBe('Your tax-advantaged accounts hold $40,000, and $6,000 a month has nowhere else to go.');
  });

  it('states the taxable balance it already knows about, rather than hiding it', () => {
    const step = buildPathCandidates(investing({ brokerageBalance: 88000 }))
      .find((c) => c.key === 'taxable-brokerage')!;
    expect(step.why).toBe('You hold $88,000 in a taxable account, with $6,000 a month spare to add to it.');
  });

  it('is pruned with nothing in the tax-advantaged accounts yet', () => {
    expect(keys(investing({ rothIraBalance: 0, trad401kBalance: 0, hsaBalance: 0 })))
      .not.toContain('taxable-brokerage');
  });

  it('is pruned with no surplus to invest', () => {
    expect(keys(investing({ monthlySurplus: 0 }))).not.toContain('taxable-brokerage');
    expect(keys(investing({ monthlySurplus: -500 }))).not.toContain('taxable-brokerage');
    expect(keys(investing({ monthlySurplus: null }))).not.toContain('taxable-brokerage');
  });

  it('sits after the contribution-limits step and before financial independence', () => {
    const order = keys(investing());
    expect(order.indexOf('taxable-brokerage')).toBeGreaterThan(order.indexOf('max-contributions'));
    expect(order.indexOf('taxable-brokerage')).toBeLessThan(order.indexOf('financial-independence'));
  });
});

// ── Every step names something a person can finish ───────────────────────────

describe('every title is an achievement, not a topic', () => {
  const ctx = buildPathContextDefaults({
    annualIncome: 150000,
    monthlyIncome: 12500,
    monthlyExpenses: 8000,
    stableMonthlyExpenses: 8000,
    monthlySurplus: 4500,
    savingsRate: 36,
    cashTotal: 30000,
    employerMatchPct: 5,
    rothIraBalance: 60000,
    trad401kBalance: 190000,
    brokerageBalance: 25000,
    propertyValue: 600000,
    dependentCount: 2,
    debtAccounts: [debt({ id: 'card', name: 'Visa', mask: '4242', balance: 4000, apr: 21 })],
    goals: [goal('g1', 'Fully funded retirement', 2000000)],
  });

  it('reads as the completable list the user asked for', () => {
    expect(buildPathCandidates(ctx).map((c) => c.title)).toEqual([
      'Save a starter emergency fund',
      'Capture your full employer match',
      'Pay off Visa ••4242',
      'Save 6 months of expenses',
      'Get insured and write your will',
      'Save 20% of your income',
      'Raise your 401(k) contribution',
      "Max out this year's contribution room",
      'Invest what is left in a brokerage account',
      'Fully funded retirement',
      'Reach financial independence',
      'Put your estate plan in place',
    ]);
  });

  it('carries no dash, middot or semicolon in any user-facing string', () => {
    for (const c of buildPathCandidates(ctx, readiness())) {
      const copy = `${c.title} ${c.subtitle} ${c.description} ${c.why}`;
      expect(copy).not.toMatch(/[—–·;]/);
    }
  });
});

// ── Retirement readiness ─────────────────────────────────────────────────────

describe('retirement readiness is on the path, or nowhere', () => {
  const ctx = buildPathContextDefaults(EARNER);

  it('emits the step when the simulation says they are short', () => {
    expect(keys(ctx, readiness())).toContain('retirement-readiness');
  });

  it('is pruned when they are on track', () => {
    const onTrack = readiness({ verdict: 'on_track', successRate: 94, requiredMonthlySavings: null, requiredSuccessRate: null });
    expect(keys(ctx, onTrack)).not.toContain('retirement-readiness');
  });

  it('is pruned when there was no readiness to read at all', () => {
    expect(keys(ctx, null)).not.toContain('retirement-readiness');
    expect(keys(ctx)).not.toContain('retirement-readiness');
  });

  it('is pruned when nothing they could save reaches the target', () => {
    const unreachable = readiness({ requiredMonthlySavings: null, requiredSuccessRate: null });
    expect(keys(ctx, unreachable)).not.toContain('retirement-readiness');
  });

  it('names the solved contribution in the title', () => {
    const step = buildPathCandidates(ctx, readiness({ requiredMonthlySavings: 940 }))
      .find((c) => c.key === 'retirement-readiness')!;
    expect(step.title).toBe('Raise retirement saving to $940 a month');
  });

  it('states the rate behind the verdict rather than the verdict alone', () => {
    const step = buildPathCandidates(ctx, readiness())
      .find((c) => c.key === 'retirement-readiness')!;
    expect(step.why).toContain('61 of 100 simulated markets');
    expect(step.why).toContain('at 65');
  });

  it('says so plainly when nothing is going in yet', () => {
    const step = buildPathCandidates(ctx, readiness({ currentMonthlySavings: 0 }))
      .find((c) => c.key === 'retirement-readiness')!;
    expect(step.subtitle).toBe('Nothing is going into retirement today');
  });

  it('carries only figures the readiness read produced', () => {
    const r = readiness();
    const step = buildPathCandidates(ctx, r).find((c) => c.key === 'retirement-readiness')!;
    expect(step.readiness).toEqual({
      successRate: r.successRate,
      targetSuccess: r.targetSuccess,
      verdict: r.verdict,
      retirementAge: r.retirementAge,
      currentMonthlySavings: r.currentMonthlySavings,
      requiredMonthlySavings: r.requiredMonthlySavings,
      requiredSuccessRate: r.requiredSuccessRate,
    });
  });

  it('sits after the savings-rate step and before the tax-advantaged one', () => {
    const order = keys(ctx, readiness());
    expect(order.indexOf('retirement-readiness')).toBeGreaterThan(order.indexOf('savings-rate'));
    expect(order.indexOf('retirement-readiness')).toBeLessThan(order.indexOf('tax-advantaged'));
  });
});

describe('financial independence reads against readiness, not on its own', () => {
  const ctx = buildPathContextDefaults(EARNER);
  const fiWhy = (r: PathReadiness | null) =>
    buildPathCandidates(ctx, r).find((c) => c.key === 'financial-independence')!.why;

  it('follows from being ready to retire when they are not', () => {
    expect(fiWhy(readiness())).toContain('after being ready to retire at 65');
  });

  it('reads as the same portfolio reached sooner when they are', () => {
    expect(fiWhy(readiness({ verdict: 'on_track' }))).toContain('already on track to retire at 65');
  });

  it('claims no verdict when there is none to claim', () => {
    expect(fiWhy(null)).toBe('Your own spending sets the portfolio that would cover it without work.');
  });

  it('keeps the 4% maths whatever the verdict', () => {
    for (const r of [null, readiness(), readiness({ verdict: 'on_track' })]) {
      const fi = buildPathCandidates(ctx, r).find((c) => c.key === 'financial-independence')!;
      expect(fi.description).toContain('4% rule');
      expect(fi.description).toContain('25 times');
    }
  });
});

// ── The tax-advantaged step names one account ────────────────────────────────

describe('the tax-advantaged step names the account, not the menu', () => {
  const earner = (over: Partial<PathContext>) => buildPathContextDefaults({ ...EARNER, ...over });

  it('names the HSA first when the health plan makes one available', () => {
    expect(taxAdvantagedChoice(earner({ hasHDHP: true, filingStatus: 'single' })).title)
      .toBe('Open and fund an HSA');
  });

  it('does not name an HSA to someone whose plan is not high-deductible', () => {
    expect(taxAdvantagedChoice(earner({ hasHDHP: false, filingStatus: 'single' })).title)
      .not.toContain('HSA');
  });

  it('moves past the HSA once one is funded', () => {
    expect(taxAdvantagedChoice(earner({ hasHDHP: true, hsaBalance: 12_000, filingStatus: 'single' })).title)
      .toBe('Open and fund a Roth IRA');
  });

  it('names a Roth IRA when income is under the limit for their filing status', () => {
    expect(taxAdvantagedChoice(earner({ filingStatus: 'single' })).title)
      .toBe('Open and fund a Roth IRA');
  });

  it('says fund it rather than open it when they already hold one', () => {
    expect(taxAdvantagedChoice(earner({ filingStatus: 'single', rothIraBalance: 9_000 })).title)
      .toBe('Fund your Roth IRA for this year');
  });

  it('does not name a Roth IRA to an income the limit has phased out', () => {
    const high = earner({ filingStatus: 'single', annualIncome: 210_000, monthlyIncome: 17_500, trad401kBalance: 90_000 });
    expect(taxAdvantagedChoice(high).title).toBe('Raise your 401(k) contribution');
  });

  it('does not guess at eligibility with no filing status on file', () => {
    expect(taxAdvantagedChoice(earner({ filingStatus: null, trad401kBalance: 40_000 })).title)
      .toBe('Raise your 401(k) contribution');
  });

  it('sends a matched employee past the match rather than repeating the match step', () => {
    const matched = earner({ filingStatus: null, employerMatchPct: 4 });
    expect(taxAdvantagedChoice(matched).title).toBe('Contribute to your 401(k) beyond the match');
  });

  it('keeps a generic title rather than naming the wrong account', () => {
    const unknown = earner({ filingStatus: null });
    expect(taxAdvantagedChoice(unknown).title).toBe('Fund a tax-advantaged account');
  });

  it('gives the step and its instruction the same account', () => {
    const ctx = earner({ hasHDHP: true, filingStatus: 'single' });
    const step = buildPathCandidates(ctx).find((c) => c.key === 'tax-advantaged')!;
    const choice = taxAdvantagedChoice(ctx);
    expect(step.title).toBe(choice.title);
    expect(choice.action).toContain('HSA');
  });
});
