import { describe, it, expect } from 'vitest';
import { buildPathContextDefaults } from '../path-context.js';
import { buildJourneyCatalog, journeyCandidates } from '../journey-v2.js';
import { monthsToPayOff, sizePath } from '../path-sizing.js';
import type { DebtAccount } from '../debt-accounts.js';

function debt(o: Partial<DebtAccount> & { id: string; name: string }): DebtAccount {
  return {
    mask: null, type: 'loan', subtype: 'mortgage', balance: 1000, apr: null,
    minimumPayment: 25, minimumPaymentEstimated: true, minimumPaymentAssumedApr: null,
    termMonths: null, originationDate: null, payoffDate: null, propertyAccountId: null,
    liabilitySource: null, liabilityLastSyncedAt: null, lastUpdated: null,
    lastStatementBalance: null, lastPaymentAmount: null, paidInFullMonthly: false, ...o,
  };
}

const onlyDebt = (ctx: ReturnType<typeof buildPathContextDefaults>, key: string) => {
  const { steps } = journeyCandidates(
    { steps: [{ key, why: 'a' }], leftOut: [] },
    buildJourneyCatalog(ctx),
  );
  return sizePath(steps, ctx)[0];
};

describe('monthsToPayOff', () => {
  // $4,075 IS the 30-year amortising payment for $770,000 at 4.875%, so
  // dividing the balance back out by it returned the interest-free term.
  it('amortises rather than dividing the balance by the payment', () => {
    expect(monthsToPayOff(770_000, 4_075, 4.875)).toBe(360);
    expect(Math.round(770_000 / 4_075)).toBe(189); // what it used to answer
  });

  it('falls back to plain division when no rate is on file', () => {
    expect(monthsToPayOff(1_000, 100, null)).toBe(10);
    expect(monthsToPayOff(1_000, 100, 0)).toBe(10);
  });

  it('never clears when the payment does not cover the interest', () => {
    // $1,000 a month against $770,000 at 4.875% is under the $3,128 of monthly
    // interest, so there is no date to give.
    expect(monthsToPayOff(770_000, 1_000, 4.875)).toBe(Infinity);
  });

  it('clears immediately when nothing is owed', () => {
    expect(monthsToPayOff(0, 100, 5)).toBe(0);
  });
});

describe("a loan is dated from its own schedule, not from today", () => {
  const thirtyYearLoan = (over: Partial<DebtAccount> = {}) =>
    buildPathContextDefaults({
      monthlySurplus: 0,
      debtAccounts: [debt({
        id: 'm', name: 'Primary Mortgage', balance: 770_000, apr: 4.875,
        minimumPayment: 4_075, originationDate: '2022-06-01', ...over,
      })],
    });

  // Amortising from today put a loan already four years into its term thirty
  // years from NOW, so a 2022 mortgage was dated 2056 instead of 2052.
  it('assumes thirty years for a mortgage that names no term', () => {
    expect(onlyDebt(thirtyYearLoan(), 'debt:m').projectedDate).toBe('2052-06-01');
  });

  it('uses the term the user set instead of assuming', () => {
    expect(onlyDebt(thirtyYearLoan({ termMonths: 180 }), 'debt:m').projectedDate)
      .toBe('2037-06-01');
  });

  // Thirty years is a fair default for a home loan and a nonsense one for a car.
  it('assumes nothing for a loan that is not a mortgage', () => {
    const ctx = buildPathContextDefaults({
      monthlySurplus: 0,
      debtAccounts: [debt({
        id: 'car', name: 'Auto Loan', subtype: 'auto', balance: 20_000, apr: 7,
        minimumPayment: 500, originationDate: '2022-06-01',
      })],
    });
    // Worked out from the rate, not dated 2052.
    expect(onlyDebt(ctx, 'debt:car').projectedDate).not.toBe('2052-06-01');
  });

  it('prefers the date the lender reported over the assumed term', () => {
    expect(onlyDebt(thirtyYearLoan({ payoffDate: '2049-01-01' }), 'debt:m').projectedDate)
      .toBe('2049-01-01');
  });

  // A schedule that has already run out describes nothing.
  it('falls back to the rate when the term has already expired', () => {
    const sized = onlyDebt(thirtyYearLoan({ originationDate: '1980-01-01' }), 'debt:m');
    expect(sized.projectedDate).not.toBe('2010-01-01');
    expect(Number(sized.projectedDate!.slice(0, 4))).toBeGreaterThan(new Date().getUTCFullYear());
  });
});

describe('the projected payoff date', () => {
  // Plaid reports a mortgage's maturity date and a student loan's expected
  // payoff date. Paying the minimum leaves that schedule intact, so the
  // lender's own answer is used rather than modelled.
  it('uses the date the lender reported when only the minimum is paid', () => {
    const ctx = buildPathContextDefaults({
      monthlySurplus: 0,
      debtAccounts: [debt({
        id: 'm', name: 'Mortgage', balance: 770_000, apr: 4.875,
        minimumPayment: 4_075, payoffDate: '2054-03-01',
      })],
    });
    expect(onlyDebt(ctx, 'debt:m').projectedDate).toBe('2054-03-01');
  });

  it('works the date out when there is no reported one, using the rate', () => {
    const ctx = buildPathContextDefaults({
      monthlySurplus: 0,
      debtAccounts: [debt({
        id: 'm', name: 'Mortgage', balance: 770_000, apr: 4.875, minimumPayment: 4_075,
      })],
    });
    const sized = onlyDebt(ctx, 'debt:m');
    const years = new Date(sized.projectedDate!).getUTCFullYear() - new Date().getUTCFullYear();
    expect(years).toBe(30);     // was 15, the interest-free answer
  });

  // Paying more than the minimum breaks the lender's schedule, so its date no
  // longer describes what happens and the faster payoff has to be worked out.
  it('ignores the reported date once extra money is going in', () => {
    const ctx = buildPathContextDefaults({
      monthlySurplus: 6_000,
      debtAccounts: [debt({
        id: 'm', name: 'Mortgage', balance: 770_000, apr: 4.875,
        minimumPayment: 4_075, payoffDate: '2054-03-01',
      })],
    });
    const sized = onlyDebt(ctx, 'debt:m');
    expect(sized.projectedDate).not.toBe('2054-03-01');
    expect(sized.monthlyFunding).toBe(10_075);
    expect(new Date(sized.projectedDate!).getTime()).toBeLessThan(new Date('2054-03-01').getTime());
  });
});

// ── Every reader follows the engine that is actually on ──────────────────────
//
// The chat agent and the plan report both read `readStoredPath`. While it
// answered only from v1, the assistant described a plan the page was no longer
// showing.
describe('the reader the chat agent and the report use', () => {
  it('reads whichever engine the flag has on', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../routes/financial-path.ts', import.meta.url), 'utf8'),
    );
    const fn = src.slice(src.indexOf('export async function readStoredPath('));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toContain("journeyEngine()) === 'v2'");
    expect(body).toContain('readStoredJourney');
    // It must never generate: a question is not a reason to buy a new plan.
    expect(src).toContain('readJourney(tenantId, userId, { generate: false })');
  });
});
