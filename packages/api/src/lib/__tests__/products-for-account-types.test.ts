import { describe, it, expect, vi } from "vitest";

// syncItem's module graph is heavy and irrelevant here — only the pure
// account-type decision is under test.
vi.mock("@lasagna/core", () => ({
  eq: vi.fn(), and: vi.fn(), plaidItems: {}, accounts: {}, balanceSnapshots: {},
  securities: {}, holdings: {}, syncLog: {}, decrypt: vi.fn(),
  parseLoanMetadata: vi.fn(),
}));
vi.mock("../db.js", () => ({ db: {} }));
vi.mock("../plaid.js", () => ({ plaidClient: {} }));
vi.mock("../env.js", () => ({ env: {} }));
vi.mock("../transaction-sync.js", () => ({ syncTransactions: vi.fn() }));
vi.mock("../billing.js", () => ({ resolveTenantPlan: vi.fn(), isTenantDisabled: vi.fn() }));
vi.mock("../account-limits.js", () => ({ recomputeFrozenAccounts: vi.fn() }));
vi.mock("../activity.js", () => ({ logPlaidEvent: vi.fn() }));
vi.mock("../security-classifier.js", () => ({ classifyUnknownSecuritiesForTenant: vi.fn() }));

const { productsForAccountTypes } = await import("../sync.js");
// The pure pricing module has no heavy deps, so it needs no mocks.
const { monthlyPlaidCostForAccountTypes } = await import("../plaid-pricing.js");

describe("productsForAccountTypes", () => {
  it("fetches neither for a cash-only Item", () => {
    // The SoFi case: billed for both, can return neither. ~$0.38/mo each.
    expect(productsForAccountTypes(["depository"])).toEqual({
      investments: false,
      liabilities: false,
    });
  });

  it("fetches investments for an investment account", () => {
    expect(productsForAccountTypes(["investment"])).toMatchObject({ investments: true });
  });

  it("treats Plaid's legacy `brokerage` type as an investment account", () => {
    // Missing this would silently stop holdings syncing to save $0.18 — a far
    // worse trade than the call.
    expect(productsForAccountTypes(["brokerage"])).toMatchObject({ investments: true });
  });

  it("fetches liabilities for credit or loan accounts", () => {
    expect(productsForAccountTypes(["credit"])).toMatchObject({ liabilities: true });
    expect(productsForAccountTypes(["loan"])).toMatchObject({ liabilities: true });
  });

  it("fetches both when Plaid could not classify the account", () => {
    // `other` means unknown, not empty. Bias toward the call.
    expect(productsForAccountTypes(["other"])).toEqual({
      investments: true,
      liabilities: true,
    });
  });

  it("fetches both for a full-service bank", () => {
    expect(productsForAccountTypes(["depository", "credit", "investment", "loan"])).toEqual({
      investments: true,
      liabilities: true,
    });
  });

  it("fetches neither for an Item with no accounts", () => {
    expect(productsForAccountTypes([])).toEqual({ investments: false, liabilities: false });
  });

  it("ignores duplicate types", () => {
    expect(productsForAccountTypes(["depository", "depository", "depository"])).toEqual({
      investments: false,
      liabilities: false,
    });
  });
});

describe("monthlyPlaidCostForAccountTypes", () => {
  // Rates: transactions $0.30, investments $0.18, liabilities $0.20 per item-month.
  it("bills only Transactions for a cash-only Item", () => {
    expect(monthlyPlaidCostForAccountTypes(["depository"])).toBeCloseTo(0.3, 6);
  });

  it("bills only Investments for an investment-only Item", () => {
    expect(monthlyPlaidCostForAccountTypes(["investment"])).toBeCloseTo(0.18, 6);
  });

  it("bills Transactions + Liabilities for a credit Item", () => {
    expect(monthlyPlaidCostForAccountTypes(["credit"])).toBeCloseTo(0.3 + 0.2, 6);
  });

  it("bills Transactions + Investments for a brokerage + checking Item", () => {
    expect(monthlyPlaidCostForAccountTypes(["investment", "depository"])).toBeCloseTo(0.3 + 0.18, 6);
  });

  it("bills all three when Plaid could not classify the account", () => {
    expect(monthlyPlaidCostForAccountTypes(["other"])).toBeCloseTo(0.3 + 0.18 + 0.2, 6);
  });

  it("costs nothing for an Item with no accounts", () => {
    expect(monthlyPlaidCostForAccountTypes([])).toBe(0);
  });
});
