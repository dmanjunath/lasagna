import { describe, it, expect } from 'vitest';
import { buildPathContextDefaults, type PathContext } from '../path-context.js';
import {
  CONTRIBUTION_TAX_YEAR,
  buildPathCandidates,
  classifyDebtKind,
  contributionLimits,
  taxAdvantagedChoice,
} from '../path-candidates.js';
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
    medianByAge: Array.from({ length: 41 }, (_, i) => Math.round(135_000 * 1.06 ** i)),
    simRuns: 8,
    ...overrides,
  };
}

/** Enough of a household that the tax-advantaged and independence steps exist. */
const EARNER = { annualIncome: 85_000, monthlyIncome: 85_000 / 12, stableMonthlyExpenses: 4_700 };

// ── Pruning ──────────────────────────────────────────────────────────────────

describe('pruning — a step whose precondition is absent is never emitted', () => {
  it('gets NO will step for a household with nothing to direct', () => {
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
    expect(keys(ctx)).not.toContain('will-trust');
  });

  it('emits a late will step for a childless renter with a portfolio behind them', () => {
    // The case no threshold got right. This household is nowhere near 25 times
    // a year's spending, which is what the step used to wait for, and they
    // plainly have assets that will pass to somebody. Whether it belongs in
    // their sequence today is the ordering model's call, not a number's.
    //
    // With nobody relying on this income it is about what has been built, so it
    // waits: below the reserve, above the independence step.
    const ctx = buildPathContextDefaults({
      annualIncome: 145_000,
      monthlyIncome: 145_000 / 12,
      dependentCount: 0,
      propertyValue: 0,
      cashTotal: 18_000,
      trad401kBalance: 410_000,
      stableMonthlyExpenses: 6_400,
    });
    const order = keys(ctx);
    expect(order).toContain('will-trust');
    expect(order.indexOf('will-trust')).toBeGreaterThan(order.indexOf('emergency-fund'));
    expect(order.indexOf('will-trust')).toBeLessThan(order.indexOf('financial-independence'));
  });

  it('moves the will up above the full reserve once someone depends on them', () => {
    // Nothing about the household's assets moved. What moved is who is left
    // holding them, which is the larger loss and the one a reserve cannot
    // absorb, so the will sits with the cover rather than after it.
    const ctx = buildPathContextDefaults({
      annualIncome: 62000,
      dependentCount: 2,
      stableMonthlyExpenses: 3100,
    });
    const order = keys(ctx);
    expect(order).toContain('will-trust');
    expect(order.indexOf('will-trust')).toBeLessThan(order.indexOf('emergency-fund'));
  });

  it('emits a will step for a homeowner with no dependents', () => {
    const ctx = buildPathContextDefaults({
      annualIncome: 62000,
      dependentCount: 0,
      propertyValue: 540000,
      stableMonthlyExpenses: 3100,
    });
    expect(keys(ctx)).toContain('will-trust');
  });

  it('offers term life only where somebody lives on this income', () => {
    // Term life exists for one reason: replacing income somebody else depends
    // on. With nobody in that position it is not an early step or a late one,
    // it is not a step, and offering it anyway sells a product against a risk
    // this household does not carry. The will is not gated with it.
    const alone = buildPathContextDefaults({
      annualIncome: 62000,
      dependentCount: 0,
      propertyValue: 540000,
      stableMonthlyExpenses: 3100,
    });
    const provider = buildPathContextDefaults({
      annualIncome: 62000,
      dependentCount: 2,
      propertyValue: 540000,
      stableMonthlyExpenses: 3100,
    });
    expect(keys(alone)).not.toContain('term-life');
    expect(keys(alone)).toContain('will-trust');
    expect(keys(provider)).toContain('term-life');
  });

  it('does not answer the dependants question for somebody who skipped it', () => {
    // The column holds three states, and the context flattened two of them:
    // null is a question nobody answered, 0 is the answer "nobody". Read as
    // `?? 0`, the skip deleted the step from everyone who never filled the
    // field in, which is most people, on the strength of an answer they never
    // gave. Unknown offers the step and says what would settle it.
    const unanswered = buildPathContextDefaults({
      annualIncome: 62000,
      dependentCount: null,
      stableMonthlyExpenses: 3100,
    });
    const step = buildPathCandidates(unanswered).find((c) => c.key === 'term-life')!;
    expect(step).toBeDefined();
    expect(step.subtitle).toBe('Enough to replace your income for anyone who relies on it');
    // It states no count, in either direction.
    expect(step.why).not.toMatch(/\d/);
    expect(step.why).toContain('does not say whether anyone relies on your income');
  });

  it('offers no cover where there is no income to replace', () => {
    const noIncome = buildPathContextDefaults({ dependentCount: null, cashTotal: 4_000 });
    expect(keys(noIncome)).not.toContain('term-life');
  });

  it('leaves the will where an unanswered question cannot move it', () => {
    // Dependants move WHEN the will comes, and an unanswered question is not
    // somebody depending on this income, so it takes the later position.
    const unanswered = buildPathContextDefaults({
      annualIncome: 62000,
      dependentCount: null,
      stableMonthlyExpenses: 3100,
      cashTotal: 20_000,
    });
    const order = keys(unanswered);
    expect(order.indexOf('will-trust')).toBeGreaterThan(order.indexOf('emergency-fund'));
    const step = buildPathCandidates(unanswered).find((c) => c.key === 'will-trust')!;
    expect(step.why).not.toContain('Someone depends on you');
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
    // `single` at this income can fully fund an IRA, so there is room to fill
    // once something is going in. The room itself is the other precondition,
    // and it has a test of its own below.
    const notYet = buildPathContextDefaults({ annualIncome: 90000, filingStatus: 'single' });
    const already = buildPathContextDefaults({
      annualIncome: 90000,
      filingStatus: 'single',
      rothIraBalance: 12000,
    });
    expect(keys(notYet)).not.toContain('max-contributions');
    expect(keys(already)).toContain('max-contributions');
  });

  it('is not offered at all when no room is open to this household', () => {
    // A Roth holder past the phase-out, with no workplace plan on file and no
    // HDHP, reaches none of the three limits. The step used to be emitted
    // anyway and read "Fill $0 of 2026 contribution room across your
    // tax-advantaged accounts", taking a $0 standing share of the surplus with
    // it, which is an order to do nothing.
    const noRoom = buildPathContextDefaults({
      annualIncome: 400_000,
      filingStatus: 'single',
      rothIraBalance: 40_000,
    });
    expect(contributionLimits(noRoom).total).toBe(0);
    expect(keys(noRoom)).not.toContain('max-contributions');
  });

  it('nothing to price financial independence with means no independence step', () => {
    const ctx = buildPathContextDefaults({ annualIncome: 0, monthlyExpenses: null, stableMonthlyExpenses: null });
    expect(keys(ctx)).not.toContain('financial-independence');
  });
});

// ── The dated figures ────────────────────────────────────────────────────────

describe('the contribution tax year', () => {
  it('is the year the reader is in, so the limits beside it are not last year\'s', () => {
    // The whole limit table, the catch-ups and the Roth phase-out floors are
    // one year's figures, and the page prints that year next to them: "Max out
    // your 2026 contribution room", above a sentence saying the room you skip
    // for that year does not come back. A constant cannot notice a new year
    // opening, and it did not: the 2025 table was still being offered in
    // August 2026.
    //
    // WHEN THIS FAILS: read the IRS notice for the new year (the annual
    // "401(k) limit increases" newsroom item, plus the Rev. Proc. for the HSA
    // limits) and move `CONTRIBUTION_TAX_YEAR`, `contributionLimits` and
    // `ROTH_PHASE_OUT_START` together. Never move the year alone.
    expect(CONTRIBUTION_TAX_YEAR).toBe(new Date().getUTCFullYear());
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

// ── A goal and a built-in step covering the same job ─────────────────────────
//
// Two goal categories work out exactly what a built-in step works out, and both
// used to be emitted, so a person saving into an emergency fund got their own
// goal AND a step telling them to save the same months of expenses, one after
// the other. Where the goal exists, the goal is the step.

describe('a goal that covers a built-in step', () => {
  const typed = (id: string, name: string, category: string, target: number) => ({
    ...goal(id, name, target),
    category,
  });

  it('drops the emergency-fund step for an active emergency_fund goal', () => {
    const ctx = buildPathContextDefaults({
      ...EARNER,
      goals: [typed('ef', 'Emergency Fund', 'emergency_fund', 25500)],
    });
    expect(keys(ctx)).not.toContain('emergency-fund');
    expect(keys(ctx)).toContain('goal:ef');
  });

  it('drops the independence step for an active retirement goal', () => {
    const ctx = buildPathContextDefaults({
      ...EARNER,
      goals: [typed('ret', 'Retirement Savings', 'retirement', 2125000)],
    });
    expect(keys(ctx)).not.toContain('financial-independence');
    expect(keys(ctx)).toContain('goal:ret');
  });

  it('keeps both steps for a household with no goal in either category', () => {
    const ctx = buildPathContextDefaults({
      ...EARNER,
      goals: [typed('house', 'First home', 'home_purchase', 92000)],
    });
    expect(keys(ctx)).toContain('emergency-fund');
    expect(keys(ctx)).toContain('financial-independence');
  });

  it('keeps the emergency-fund step when that goal is no longer active', () => {
    // `buildPathContext` loads goals with `goal_status = 'active'`, so a
    // completed emergency-fund goal is simply not in `ctx.goals`. Having any
    // goal at all must not cost this person the step.
    const ctx = buildPathContextDefaults({
      ...EARNER,
      goals: [typed('other', 'Become Debt Free', 'debt_payoff', 4000)],
    });
    expect(keys(ctx)).toContain('emergency-fund');
    expect(keys(ctx)).toContain('financial-independence');
  });

  it('suppresses once for two active goals of the same category, and keeps both goals', () => {
    const ctx = buildPathContextDefaults({
      ...EARNER,
      goals: [
        typed('ef-1', 'Emergency Fund', 'emergency_fund', 25500),
        typed('ef-2', 'Bigger cushion', 'emergency_fund', 40000),
      ],
    });
    expect(keys(ctx).filter((k) => k === 'emergency-fund')).toEqual([]);
    expect(keys(ctx)).toContain('goal:ef-1');
    expect(keys(ctx)).toContain('goal:ef-2');
  });

  it('marks the goal that suppressed a step as the one standing in for it', () => {
    // The flag is what stops the pair vanishing together. Suppression means
    // only one of the two is ever emitted, so a substitute that can be dropped
    // is a job that can leave the path in both forms at once.
    const ctx = buildPathContextDefaults({
      ...EARNER,
      goals: [
        typed('ef', 'Emergency Fund', 'emergency_fund', 25500),
        typed('ret', 'Retirement Savings', 'retirement', 2125000),
        typed('house', 'First home', 'home_purchase', 92000),
      ],
    });
    const byKey = new Map(buildPathCandidates(ctx).map((c) => [c.key, c]));

    expect(byKey.get('goal:ef')!.coversStep).toBe('emergency-fund');
    expect(byKey.get('goal:ret')!.coversStep).toBe('financial-independence');
    // A goal that took nothing's place is as droppable as any other candidate.
    expect(byKey.get('goal:house')!.coversStep).toBeUndefined();
  });

  it('claims to stand in for nothing when the step it covers was never emitted', () => {
    // The independence step is itself pruned when there is neither spending
    // nor income to price it from, so a retirement goal on such a household
    // displaced nothing. Flagged anyway, it became un-leave-out-able on the
    // strength of having taken a step's place that was never there.
    const ctx = buildPathContextDefaults({
      annualIncome: 0,
      monthlyExpenses: null,
      stableMonthlyExpenses: null,
      goals: [typed('ret', 'Retirement Savings', 'retirement', 2125000)],
    });
    const byKey = new Map(buildPathCandidates(ctx).map((c) => [c.key, c]));

    expect(byKey.has('financial-independence')).toBe(false);
    expect(byKey.get('goal:ret')!.coversStep).toBeUndefined();
  });

  it('does not suppress on a goal that carries no target, since it is no step either', () => {
    const ctx = buildPathContextDefaults({
      ...EARNER,
      goals: [typed('ef-0', 'Emergency Fund', 'emergency_fund', 0)],
    });
    expect(keys(ctx)).not.toContain('goal:ef-0');
    expect(keys(ctx)).toContain('emergency-fund');
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

  it('names the dollars in the title and where they stand in the subtitle', () => {
    const step = buildPathCandidates(earning()).find((c) => c.key === 'savings-rate')!;
    expect(step.title).toBe('Put $1,600 a month away');
    expect(step.subtitle).toBe('Already there, at $2,000 a month');
    expect(step.why).toBe('You keep 25% of what you earn, against a 20% benchmark.');
  });

  it('reads as a climb from what is going away today when it is short', () => {
    const step = buildPathCandidates(earning({ monthlySurplus: 800, savingsRate: 10 }))
      .find((c) => c.key === 'savings-rate')!;
    expect(step.subtitle).toBe('Up from the $800 a month going away now');
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

  it('sits after the account that names where the money goes, and above the rest', () => {
    // "Put more away" with nowhere named to put it is half an instruction, so
    // the account step comes first. Everything else it pays for comes after.
    const order = keys(earning({ rothIraBalance: 20000 }));
    expect(order.indexOf('savings-rate')).toBeGreaterThan(order.indexOf('tax-advantaged'));
    expect(order.indexOf('savings-rate')).toBeGreaterThan(order.indexOf('emergency-fund'));
    expect(order.indexOf('savings-rate')).toBeLessThan(order.indexOf('taxable-brokerage'));
  });

  // ── The one step the two tests share ──
  //
  // The benchmark share and the contribution the simulation solved for were two
  // steps that said the same thing: move more per month. They are one step at
  // the HIGHER of the two figures, which is the only figure that satisfies
  // both, and it says which test set it.

  const shortBySim = (requiredMonthlySavings: number, over: Partial<PathReadiness> = {}) =>
    buildPathCandidates(earning(), readiness({ requiredMonthlySavings, ...over }))
      .find((c) => c.key === 'savings-rate')!;

  it('takes the simulation figure when it is the larger of the two', () => {
    const step = shortBySim(2400);
    expect(step.title).toBe('Put $2,400 a month away');
    expect(step.description).toContain('Monte Carlo simulation');
    expect(step.why).toContain('61 of 100 simulated markets');
  });

  it('takes the benchmark share when the simulation asks for less', () => {
    // $900 a month clears the retirement test, and 20% of this income is
    // $1,600. Quoting the smaller of the two would tell somebody they are done
    // at a figure the other test says they are short of.
    const step = shortBySim(900);
    expect(step.title).toBe('Put $1,600 a month away');
    expect(step.description).toContain('20% of what you earn is the benchmark');
    expect(step.why).toBe('You keep 25% of what you earn, against a 20% benchmark.');
  });

  // ── One test sets both figures, or the card measures two quantities ──
  //
  // The target is the higher of the two. `current` has to be whatever the same
  // test counts, and it was taken from the simulation the moment a simulation
  // had run at all. The simulation counts `max(0, income * 0.75 - annual spend)
  // / 12 + match`; the benchmark counts `income - spending`. On this household
  // those are $900 and $2,000, so attaching a readiness read to a household the
  // BENCHMARK binds on turned "already there" into a climb, and issued an order
  // for $700 a month they were already $400 past.

  it('reads what goes away off the surplus when the benchmark is what binds', () => {
    const step = shortBySim(900);
    expect(step.subtitle).toBe('Already there, at $2,000 a month');
    expect(step.subtitle).not.toContain('$900');
  });

  it('says the same thing about a household whether or not a simulation ran', () => {
    const withSim = shortBySim(900);
    const without = buildPathCandidates(earning()).find((c) => c.key === 'savings-rate')!;
    expect(withSim.title).toBe(without.title);
    expect(withSim.subtitle).toBe(without.subtitle);
    expect(withSim.why).toBe(without.why);
    expect(withSim.description).toBe(without.description);
    expect(withSim.icon).toBe(without.icon);
  });

  it('states one of the two explanations, never the wrong one', () => {
    const benchmark = shortBySim(900);
    expect(benchmark.why).not.toContain('simulated markets');
    expect(benchmark.description).not.toContain('Monte Carlo');

    const simulation = shortBySim(2400);
    expect(simulation.why).not.toContain('benchmark');
    expect(simulation.description).not.toContain('benchmark');
  });

  it('reports what the simulation counts only where the simulation set the figure', () => {
    const step = shortBySim(2400);
    expect(step.subtitle).toBe('Up from the $900 a month going away now');
    expect(step.why).toContain('At $900 a month');
  });

  it('never says it is climbing up from a figure larger than its own target', () => {
    // The simulation counts contributions, so what it reports going in can be
    // above the benchmark share the step settled on. Read as a climb, the
    // subtitle asked for less than the line above it already had.
    const step = shortBySim(900, { currentMonthlySavings: 2_000 });
    expect(step.title).toBe('Put $1,600 a month away');
    expect(step.subtitle).toBe('Already there, at $2,000 a month');
    expect(step.subtitle).not.toContain('Up from');
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

  it('names the one act it asks for, and the accounts that ran out of room', () => {
    const step = buildPathCandidates(investing()).find((c) => c.key === 'taxable-brokerage')!;
    expect(step.title).toBe('Open a taxable brokerage account');
    expect(step.why).toBe(
      'Your tax-advantaged accounts hold $40,000, and their limits are annual, so this is where anything past them goes.',
    );
  });

  it('is pruned once a taxable account is already open', () => {
    // "Invest what is left" is not something a person can finish, so the step
    // is the opening. Somebody who already holds one has done it, and what goes
    // in each month is the amount step's job and the sizing waterfall's.
    expect(keys(investing({ brokerageBalance: 88000, taxableBrokerageBalance: 88000 })))
      .not.toContain('taxable-brokerage');
  });

  it('is not pruned by a wrapper that is only in the catch-all bucket', () => {
    // `brokerageBalance` is every investment account that is not an HSA, a Roth
    // IRA or a workplace plan, which is a traditional IRA and a crypto account
    // as much as it is a brokerage account. Read as "they have a brokerage",
    // a household with a $125,748 traditional IRA, a 401(k) and $6,000 a month
    // spare was never told where anything past the annual limits goes.
    expect(keys(investing({ brokerageBalance: 125_748, taxableBrokerageBalance: 0 })))
      .toContain('taxable-brokerage');
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
    taxableBrokerageBalance: 25000,
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
      'Take out term life insurance',
      'Put your will and trust in place',
      'Save 6 months of expenses',
      'Put $2,500 a month away',
      `Max out your ${CONTRIBUTION_TAX_YEAR} contribution room`,
      'Fully funded retirement',
      'Reach financial independence',
    ]);
  });

  it('does not repeat the amount step as an order to raise a rate', () => {
    // This household already holds a 401(k), so the account step resolved to
    // "raise your 401(k) contribution", which is the amount step's whole
    // instruction said a second time in the same list.
    expect(taxAdvantagedChoice(ctx).opensAccount).toBe(false);
    expect(buildPathCandidates(ctx).map((c) => c.key)).not.toContain('tax-advantaged');
  });

  it('keeps the account step when it is an opening rather than a top-up', () => {
    const nothingHeld = buildPathContextDefaults({
      ...EARNER,
      monthlyIncome: 85_000 / 12,
      monthlySurplus: 1_500,
      savingsRate: 21,
      filingStatus: 'single',
    });
    expect(taxAdvantagedChoice(nothingHeld).opensAccount).toBe(true);
    expect(keys(nothingHeld)).toContain('tax-advantaged');
    expect(keys(nothingHeld)).toContain('savings-rate');
  });

  it('names a retirement goal for the achievement under it, not the date', () => {
    // "Retirement" arrives whether or not anything was done about it, so as a
    // step it can never be ticked. Being ready for it can.
    const retiring = buildPathContextDefaults({
      ...EARNER,
      goals: [{ ...goal('g-ret', 'Retirement', 2_000_000), category: 'retirement' }],
    });
    const step = buildPathCandidates(retiring).find((c) => c.key === 'goal:g-ret')!;
    expect(step.title).toBe('Retirement ready');
    // A goal in any other category keeps the person's own words for it.
    expect(buildPathCandidates(ctx).find((c) => c.key === 'goal:g1')!.title)
      .toBe('Fully funded retirement');
  });

  it('carries no dash, middot or semicolon in any user-facing string', () => {
    for (const c of buildPathCandidates(ctx, readiness())) {
      const copy = `${c.title} ${c.subtitle} ${c.description} ${c.why}`;
      expect(copy).not.toMatch(/[—–·;]/);
    }
  });
});

// ── Retirement readiness ─────────────────────────────────────────────────────

// The retirement gap was its own step, sitting beside the savings-rate step and
// giving the same order in different words. It is the same step now, and what
// the simulation says is one of the two things that can set its figure. These
// hold the half of it that only the simulation can produce: no rate on file
// anywhere, so the step exists at all only because the simulation solved for
// something.

describe('the retirement gap is the amount step, or nowhere', () => {
  const ctx = buildPathContextDefaults(EARNER);

  it('emits the step when the simulation says they are short', () => {
    // `EARNER` carries no savings rate, so the benchmark share is unavailable
    // and the solved contribution is the only figure there is.
    expect(keys(ctx, readiness())).toContain('savings-rate');
  });

  it('is pruned when they are on track', () => {
    const onTrack = readiness({ verdict: 'on_track', successRate: 94, requiredMonthlySavings: null, requiredSuccessRate: null });
    expect(keys(ctx, onTrack)).not.toContain('savings-rate');
  });

  it('is pruned when there was no readiness to read at all', () => {
    expect(keys(ctx, null)).not.toContain('savings-rate');
    expect(keys(ctx)).not.toContain('savings-rate');
  });

  it('is pruned when nothing they could save reaches the target', () => {
    const unreachable = readiness({ requiredMonthlySavings: null, requiredSuccessRate: null });
    expect(keys(ctx, unreachable)).not.toContain('savings-rate');
  });

  it('names the solved contribution in the title', () => {
    const step = buildPathCandidates(ctx, readiness({ requiredMonthlySavings: 940 }))
      .find((c) => c.key === 'savings-rate')!;
    expect(step.title).toBe('Put $940 a month away');
  });

  it('states the rate behind the verdict rather than the verdict alone', () => {
    const step = buildPathCandidates(ctx, readiness())
      .find((c) => c.key === 'savings-rate')!;
    expect(step.why).toContain('61 of 100 simulated markets');
    expect(step.why).toContain('at 65');
  });

  it('says so plainly when nothing is going in yet', () => {
    const step = buildPathCandidates(ctx, readiness({ currentMonthlySavings: 0 }))
      .find((c) => c.key === 'savings-rate')!;
    expect(step.subtitle).toBe('Nothing is going away each month today');
  });

  it('carries only figures the readiness read produced', () => {
    const r = readiness();
    const step = buildPathCandidates(ctx, r).find((c) => c.key === 'savings-rate')!;
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

  it('carries none at all when the simulation is not what set the figure', () => {
    const earning = buildPathContextDefaults({
      annualIncome: 96000, monthlyIncome: 8000,
      monthlyExpenses: 6000, stableMonthlyExpenses: 6000,
      monthlySurplus: 2000, savingsRate: 25,
    });
    expect(buildPathCandidates(earning, null).find((c) => c.key === 'savings-rate')!.readiness)
      .toBeUndefined();
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
    const high = earner({ filingStatus: 'single', annualIncome: 210_000, monthlyIncome: 17_500, employerMatchPct: 0 });
    expect(taxAdvantagedChoice(high).title).toBe('Raise your 401(k) contribution');
  });

  it('does not guess at eligibility with no filing status on file', () => {
    expect(taxAdvantagedChoice(earner({ filingStatus: null, employerMatchPct: 0 })).title)
      .toBe('Raise your 401(k) contribution');
  });

  it('reads the answer on file for whether there is a 401(k), never a balance', () => {
    // A balance left at a former employer is no room to contribute to, which
    // is exactly why `hasEmployerPlan` refuses to read one. This branch read it
    // anyway, so a household with $80,000 in a legacy plan and no plan on file
    // was told to raise a rate they have no plan to raise, and the step was
    // then pruned for naming an account they already hold.
    const legacy = earner({ filingStatus: null, trad401kBalance: 80_000, employerMatchPct: null });
    expect(taxAdvantagedChoice(legacy).title).toBe('Fund a tax-advantaged account');
    expect(taxAdvantagedChoice(legacy).opensAccount).toBe(true);
  });

  it('never leaves a household with no investing instruction at all', () => {
    // The pruning is safe only because two steps stand behind it: the room step
    // prices the limits, the brokerage step names where anything past them
    // goes. Both need a tax-advantaged balance, so a household with a plan at
    // work and nothing in it yet gets neither, and taking this step off left
    // the whole path silent about where a $3,000 surplus should go.
    const nothingHeld = earner({
      filingStatus: null,
      employerMatchPct: 0,
      annualIncome: 120_000,
      monthlyIncome: 10_000,
      stableMonthlyExpenses: 7_000,
      monthlySurplus: 3_000,
      savingsRate: 30,
      age: 40,
    });
    const emitted = keys(nothingHeld);
    expect(emitted).not.toContain('max-contributions');
    expect(emitted).not.toContain('taxable-brokerage');
    expect(emitted).toContain('tax-advantaged');
    expect(taxAdvantagedChoice(nothingHeld).opensAccount).toBe(false);
  });

  it('gives a legacy balance with no plan on file somewhere to put money', () => {
    // Verbatim: $120,000, $4,000 a month spare, $80,000 in a 401(k) left at a
    // former employer, no plan on file. The account step named that balance and
    // was pruned for naming an account they hold, and the only investing
    // instruction left on the whole path was "Open a taxable brokerage account".
    const legacy = earner({
      filingStatus: null,
      employerMatchPct: null,
      trad401kBalance: 80_000,
      annualIncome: 120_000,
      monthlyIncome: 10_000,
      stableMonthlyExpenses: 6_000,
      monthlySurplus: 4_000,
      savingsRate: 40,
      age: 40,
    });
    expect(keys(legacy)).toContain('tax-advantaged');
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
