import { describe, it, expect } from "vitest";
import { debtsMonthlyInterest } from "../accounts.js";
import type { DebtAccount } from "../../lib/debt-accounts.js";

function debt(overrides: Partial<DebtAccount> & { id: string }): DebtAccount {
  return {
    name: "Card",
    mask: null,
    type: "credit",
    subtype: null,
    balance: 1000,
    apr: 20,
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
    lastStatementBalance: null,
    lastPaymentAmount: null,
    paidInFullMonthly: false,
    ...overrides,
  };
}

describe("debtsMonthlyInterest — a card paid in full accrues none", () => {
  it("charges interest on a carried balance", () => {
    // $1,000 at 20% APR = $16.67 a month.
    expect(debtsMonthlyInterest([debt({ id: "revolver", balance: 1000, apr: 20 })])).toBeCloseTo(
      16.6667,
      3,
    );
  });

  it("charges nothing on a card cleared each month", () => {
    expect(
      debtsMonthlyInterest([
        debt({ id: "transactor", balance: 1000, apr: 20, lastStatementBalance: 1000, lastPaymentAmount: 1000 }),
      ]),
    ).toBe(0);
  });

  it("still charges interest on a loan, which has no statement to clear", () => {
    // $12,000 at 6% APR = $60 a month.
    expect(
      debtsMonthlyInterest([debt({ id: "auto", type: "loan", balance: 12000, apr: 6 })]),
    ).toBe(60);
  });

  it("charges nothing when there is no rate on file", () => {
    expect(debtsMonthlyInterest([debt({ id: "unrated", balance: 3000, apr: null })])).toBe(0);
  });
});
