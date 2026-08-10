import { describe, it, expect, vi, beforeEach } from "vitest";
import { computePropertySaleAdjustment } from "../plan-assumptions-overrides.js";

// ── computePropertySaleAdjustment — the pure net-equity reclassification ──────
// Fixture: a primary residence with a linked mortgage, a rental with its own
// linked mortgage, plus an unrelated investment account.
const ACCTS = [
  { id: "home", type: "real_estate", name: "Primary Residence", rawBalance: 600000, propertyAccountId: null },
  { id: "home-loan", type: "loan", name: "Home Mortgage", rawBalance: -400000, propertyAccountId: "home" },
  { id: "rental", type: "real_estate", name: "Rental Duplex", rawBalance: 300000, propertyAccountId: null },
  { id: "rental-loan", type: "loan", name: "Rental Mortgage", rawBalance: -100000, propertyAccountId: "rental" },
  { id: "brokerage", type: "investment", name: "Brokerage", rawBalance: 250000, propertyAccountId: null },
];

describe("computePropertySaleAdjustment", () => {
  it("no sold ids → zero adjustment", () => {
    expect(computePropertySaleAdjustment(ACCTS, undefined)).toEqual({
      netEquity: 0,
      excludedAccountIds: [],
      soldProperties: [],
    });
    expect(computePropertySaleAdjustment(ACCTS, [])).toEqual({
      netEquity: 0,
      excludedAccountIds: [],
      soldProperties: [],
    });
  });

  it("netEquity = value − linked mortgage; excludes BOTH the property and its mortgage", () => {
    const adj = computePropertySaleAdjustment(ACCTS, ["home"]);
    expect(adj.netEquity).toBe(200000); // 600k − 400k
    expect(adj.excludedAccountIds.sort()).toEqual(["home", "home-loan"]);
    expect(adj.soldProperties).toEqual([{ id: "home", name: "Primary Residence", netEquity: 200000 }]);
  });

  it("sums net equity across multiple sold properties, each with its own mortgage", () => {
    const adj = computePropertySaleAdjustment(ACCTS, ["home", "rental"]);
    expect(adj.netEquity).toBe(400000); // 200k + 200k
    expect(adj.excludedAccountIds.sort()).toEqual(["home", "home-loan", "rental", "rental-loan"]);
    expect(adj.soldProperties.map((p) => p.name).sort()).toEqual(["Primary Residence", "Rental Duplex"]);
  });

  it("ignores unknown ids and non-real-estate ids (guard)", () => {
    // brokerage is investment, not real estate; "ghost" doesn't exist.
    expect(computePropertySaleAdjustment(ACCTS, ["brokerage", "ghost"])).toEqual({
      netEquity: 0,
      excludedAccountIds: [],
      soldProperties: [],
    });
  });

  it("a property with no linked mortgage nets its full value", () => {
    const noLoan = [{ id: "cabin", type: "real_estate", name: "Cabin", rawBalance: 150000, propertyAccountId: null }];
    const adj = computePropertySaleAdjustment(noLoan, ["cabin"]);
    expect(adj.netEquity).toBe(150000);
    expect(adj.excludedAccountIds).toEqual(["cabin"]);
  });
});

// ── buildFinancialSnapshot reconciliation — a sale reclassifies, unchanged NW ──
// Mock the leaf reads so we exercise the aggregation math on a fixed account set.
const snapshotAccts = [
  { id: "home", type: "real_estate", name: "Primary Residence", rawBalance: 600000, effectiveBalance: 600000, excludeFromNetWorth: false, invertBalance: false, subtype: "primary", propertyAccountId: null },
  { id: "home-loan", type: "loan", name: "Home Mortgage", rawBalance: -400000, effectiveBalance: -400000, excludeFromNetWorth: false, invertBalance: false, subtype: "mortgage", propertyAccountId: "home" },
  { id: "brokerage", type: "investment", name: "Brokerage", rawBalance: 250000, effectiveBalance: 250000, excludeFromNetWorth: false, invertBalance: false, subtype: "brokerage", propertyAccountId: null },
];

vi.mock("../../lib/account-balances.js", () => ({
  LIABILITY_TYPES: new Set(["credit", "loan"]),
  fetchAccountsWithBalances: async () => snapshotAccts,
}));
vi.mock("../../lib/spending.js", () => ({
  computeSpendingTotal: async () => 4000,
  defaultSpendingWindow: () => ({ startDate: new Date(), endDate: new Date() }),
}));
vi.mock("../../lib/profile-resolver.js", () => ({
  readUserPersonalProfile: async () => ({ dateOfBirth: null, annualIncome: null }),
}));

import { buildFinancialSnapshot } from "../financial-snapshot.js";
import { computePropertySaleAdjustment as adjust } from "../plan-assumptions-overrides.js";

beforeEach(() => vi.clearAllMocks());

describe("buildFinancialSnapshot with a property sale", () => {
  it("keeps net worth UNCHANGED while reclassifying equity into investable", async () => {
    // Baseline: home 600k asset + brokerage 250k asset = 850k assets; 400k debt.
    const base = await buildFinancialSnapshot("t", "u");
    expect(base.totalAssets).toBe(850000);
    expect(base.totalDebt).toBe(400000);
    expect(base.netWorth).toBe(450000);

    // Sell the home: its 600k value and 400k mortgage drop out; net equity 200k
    // reclassifies into investable. Net worth is unchanged; only where it sits moved.
    const sale = adjust(snapshotAccts, ["home"]);
    const sold = await buildFinancialSnapshot("t", "u", sale);
    expect(sold.netWorth).toBe(450000); // UNCHANGED
    expect(sold.totalDebt).toBe(0); // mortgage gone
    expect(sold.totalAssets).toBe(450000); // 250k brokerage + 200k reinvested equity
    // The 200k lands in the investment bucket (reinvested at current allocation).
    const investment = sold.breakdown.find((b) => b.kind === "asset" && b.type === "investment");
    expect(investment?.value).toBe(450000);
    // No real_estate asset remains, and the sold property is disclosed.
    expect(sold.breakdown.find((b) => b.type === "real_estate")).toBeUndefined();
    expect(sold.soldProperties).toEqual([{ id: "home", name: "Primary Residence", netEquity: 200000 }]);
  });
});
