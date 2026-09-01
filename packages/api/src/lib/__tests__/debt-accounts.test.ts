import { describe, it, expect, vi } from "vitest";

/**
 * What a balance's minimum payment is, and what its rate is.
 *
 * Both are read straight onto the path: the minimum is money the waterfall
 * takes off the top every month before anything else is funded, and the rate
 * decides where the balance sits in the payoff order. Neither had a test.
 *
 * `resolveDebtAccounts` is a database read, so the two queries it makes stand
 * in as a fake that answers from a fixture. Everything under test is the
 * arithmetic between them.
 */

const { state } = vi.hoisted(() => ({
  state: { accounts: [] as Record<string, unknown>[], balance: "0" },
}));

vi.mock("@lasagna/core", async () => {
  const actual = await vi.importActual<typeof import("@lasagna/core")>("@lasagna/core");
  return {
    eq: (...args: unknown[]) => ["eq", ...args],
    and: (...args: unknown[]) => ["and", ...args],
    desc: (...args: unknown[]) => ["desc", ...args],
    sql: (strings: TemplateStringsArray) => ["sql", strings.join("")],
    accounts: { type: "accounts.type", tenantId: "accounts.tenant_id", excludeFromNetWorth: "accounts.exclude" },
    balanceSnapshots: { accountId: "snapshots.account_id", snapshotAt: "snapshots.at" },
    parseLoanMetadata: actual.parseLoanMetadata,
  };
});

vi.mock("../db.js", () => ({
  db: {
    query: {
      accounts: { findMany: async () => state.accounts },
      balanceSnapshots: {
        findFirst: async () => ({ balance: state.balance, snapshotAt: new Date("2026-08-01T00:00:00Z") }),
      },
    },
  },
}));

const { resolveDebtAccounts, resolveDebtApr, creditCardPaysInFull } = await import(
  "../debt-accounts.js"
);

/** A resolved card, defaulted to one we cannot classify, for the classifier tests. */
function card(
  over: Partial<Awaited<ReturnType<typeof resolveDebtAccounts>>[number]> = {},
): Awaited<ReturnType<typeof resolveDebtAccounts>>[number] {
  return {
    id: "card-1",
    name: "Visa",
    mask: "1111",
    type: "credit",
    subtype: null,
    balance: 1000,
    apr: 22,
    minimumPayment: 25,
    minimumPaymentEstimated: true,
    minimumPaymentAssumedApr: null,
    termMonths: null,
    originationDate: null,
    payoffDate: null,
    propertyAccountId: null,
    liabilitySource: "plaid",
    liabilityLastSyncedAt: null,
    lastUpdated: null,
    lastStatementBalance: null,
    lastPaymentAmount: null,
    paidInFullMonthly: false,
    ...over,
  };
}

/** How many months ago, as an origination date the resolver can read. */
function monthsAgo(months: number): string {
  const at = new Date();
  at.setMonth(at.getMonth() - months);
  return at.toISOString().slice(0, 10);
}

async function resolveOne(
  account: Record<string, unknown>,
  balance: string,
): Promise<Awaited<ReturnType<typeof resolveDebtAccounts>>[number]> {
  state.accounts = [{
    id: "acct-1",
    name: "Auto Loan",
    mask: null,
    type: "loan",
    subtype: "auto",
    metadata: null,
    excludeFromNetWorth: false,
    invertBalance: false,
    propertyAccountId: null,
    ...account,
  }];
  state.balance = balance;
  const [resolved] = await resolveDebtAccounts("tenant-1");
  return resolved;
}

describe("a loan is amortised over the schedule it still has", () => {
  it("spreads the balance over the months left on the term", () => {
    // A five year loan taken out a year ago has 48 months to run.
    return resolveOne(
      { metadata: JSON.stringify({ termMonths: 60, originationDate: monthsAgo(12) }) },
      "24000",
    ).then((loan) => {
      expect(loan.minimumPayment).toBe(500);
      expect(loan.minimumPaymentEstimated).toBe(true);
    });
  });

  it("never asks for the whole balance once the term has run out", async () => {
    // A $27,537 auto loan whose five year term ended two years ago reported a
    // minimum payment of $27,537 a month, because the months remaining were
    // clamped to 1 and the balance divided by them. Past its own term the
    // schedule tells us nothing, so it falls back to the same estimate a
    // balance carrying no schedule at all gets.
    const loan = await resolveOne(
      { metadata: JSON.stringify({ termMonths: 60, originationDate: monthsAgo(84) }) },
      "27537",
    );
    expect(loan.minimumPayment).toBe(550.74);
    expect(loan.minimumPayment).toBeLessThan(loan.balance);
  });

  it("estimates the same way for a loan that carries no schedule at all", async () => {
    const loan = await resolveOne({ metadata: null }, "27537");
    expect(loan.minimumPayment).toBe(550.74);
  });

  it("holds the floor on a balance too small for the percentage to reach it", async () => {
    const loan = await resolveOne(
      { metadata: JSON.stringify({ termMonths: 36, originationDate: monthsAgo(48) }) },
      "400",
    );
    expect(loan.minimumPayment).toBe(25);
  });

  it("takes the lender's own payment over any estimate, term or no term", async () => {
    const loan = await resolveOne(
      {
        metadata: JSON.stringify({
          type: "other_loan",
          minimumPaymentAmount: 412.19,
          interestRatePercentage: 7.25,
        }),
      },
      "27537",
    );
    expect(loan.minimumPayment).toBe(412.19);
    expect(loan.minimumPaymentEstimated).toBe(false);
    expect(loan.apr).toBe(7.25);
  });
});

describe("a card carries the last statement and last payment behind it", () => {
  it("reads the last statement balance and last payment off card metadata", async () => {
    const card = await resolveOne(
      {
        type: "credit",
        subtype: "credit card",
        metadata: JSON.stringify({
          type: "credit_card",
          lastStatementBalance: 1200,
          lastPaymentAmount: 1200,
        }),
      },
      "800",
    );
    expect(card.lastStatementBalance).toBe(1200);
    expect(card.lastPaymentAmount).toBe(1200);
  });

  it("reports null for a loan, which has no statement of its own", async () => {
    const loan = await resolveOne({ metadata: null }, "9000");
    expect(loan.lastStatementBalance).toBeNull();
    expect(loan.lastPaymentAmount).toBeNull();
  });
});

describe("a card paid in full is a transactor, not a balance to plan around", () => {
  it("calls it paid when the last payment cleared the last statement", () => {
    expect(creditCardPaysInFull(card({ lastStatementBalance: 1200, lastPaymentAmount: 1200 }))).toBe(
      true,
    );
  });

  it("calls it paid when the last payment covered more than the statement", () => {
    expect(creditCardPaysInFull(card({ lastStatementBalance: 1200, lastPaymentAmount: 1300 }))).toBe(
      true,
    );
  });

  it("calls it paid when the last statement owed nothing at all", () => {
    expect(creditCardPaysInFull(card({ lastStatementBalance: 0, lastPaymentAmount: null }))).toBe(
      true,
    );
  });

  it("calls it a carrier when the last payment fell short of the statement", () => {
    expect(creditCardPaysInFull(card({ lastStatementBalance: 5000, lastPaymentAmount: 200 }))).toBe(
      false,
    );
  });

  it("cannot tell without a statement, and does not guess", () => {
    expect(creditCardPaysInFull(card({ lastStatementBalance: null, lastPaymentAmount: 4000 }))).toBe(
      false,
    );
  });

  it("cannot tell when a statement was owed but no payment is on file", () => {
    expect(creditCardPaysInFull(card({ lastStatementBalance: 3000, lastPaymentAmount: null }))).toBe(
      false,
    );
  });

  it("never applies to a loan, which is not a revolving statement", () => {
    expect(
      creditCardPaysInFull(
        card({ type: "loan", lastStatementBalance: 0, lastPaymentAmount: 0 }),
      ),
    ).toBe(false);
  });

  it("honours a manual designation even with no statement signal on file", () => {
    // The fallback for banks that report neither: the user says it clears.
    expect(creditCardPaysInFull(card({ paidInFullMonthly: true }))).toBe(true);
  });

  it("honours a manual designation even when the last statement was carried", () => {
    expect(
      creditCardPaysInFull(
        card({ paidInFullMonthly: true, lastStatementBalance: 5000, lastPaymentAmount: 200 }),
      ),
    ).toBe(true);
  });

  it("still never applies the manual designation to a loan", () => {
    expect(creditCardPaysInFull(card({ type: "loan", paidInFullMonthly: true }))).toBe(false);
  });
});

describe("a rate we do not hold is never reported as a rate of zero", () => {
  it("reads null off metadata that names none", () => {
    expect(resolveDebtApr(null)).toBeNull();
    expect(resolveDebtApr("{}")).toBeNull();
    expect(resolveDebtApr("not json")).toBeNull();
  });

  it("reads a card's purchase APR ahead of whatever else it lists", () => {
    expect(
      resolveDebtApr(JSON.stringify({
        type: "credit_card",
        aprs: [
          { aprType: "cash_apr", aprPercentage: 29.99 },
          { aprType: "purchase_apr", aprPercentage: 22.49 },
        ],
      })),
    ).toBe(22.49);
  });
});
