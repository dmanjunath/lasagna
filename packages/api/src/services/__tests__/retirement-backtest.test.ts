import { describe, it, expect } from "vitest";
import { runRetirementBacktest } from "../retirement-backtest.js";
import type { SimInputs } from "../retirement-sim.js";
import type { AssetAllocation } from "../market-assumptions.js";

const allocation: AssetAllocation = {
  usStocks: 0.5,
  intlStocks: 0.1,
  bonds: 0.3,
  reits: 0.05,
  cash: 0.05,
};

const base: SimInputs = {
  currentAge: 40,
  retirementAge: 65,
  planThroughAge: 95,
  startingBalance: 1_000_000,
  monthlySavings: 0,
  monthlySpend: 3000,
  strategy: "constant_dollar",
  ssMonthly: 0,
  ssClaimAge: 67,
  otherMonthly: 0,
  otherStartAge: 65,
  allocation,
  inflationAdjusted: true,
  numSimulations: 300,
  seed: 12345,
};

describe("runRetirementBacktest", () => {
  it("returns a well-formed summary with bands of length horizonYears+1", () => {
    const result = runRetirementBacktest(base);
    const horizonYears = base.planThroughAge - base.currentAge;

    expect(result.horizonYears).toBe(horizonYears);
    expect(result.startYearCount).toBeGreaterThan(0);
    expect(result.firstStartYear).toBe(1928);

    expect(result.cohortBands.p50.length).toBe(horizonYears + 1);
    expect(result.cohortBands.p5.length).toBe(horizonYears + 1);
    expect(result.cohortBands.p95.length).toBe(horizonYears + 1);

    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
  });

  it("cohort bands are ordered p5 <= p25 <= p50 <= p75 <= p95 at the start", () => {
    const result = runRetirementBacktest(base);
    const { p5, p25, p50, p75, p95 } = result.cohortBands;
    expect(p5[0]).toBeLessThanOrEqual(p25[0]);
    expect(p25[0]).toBeLessThanOrEqual(p50[0]);
    expect(p50[0]).toBeLessThanOrEqual(p75[0]);
    expect(p75[0]).toBeLessThanOrEqual(p95[0]);
  });

  it("a very low spend survives every historical cohort (successRate 1.0)", () => {
    const result = runRetirementBacktest({ ...base, monthlySpend: 1, ssMonthly: 0 });
    expect(result.successRate).toBe(1);
  });

  it("an absurdly high spend fails some cohorts (successRate < 1.0)", () => {
    const result = runRetirementBacktest({
      ...base,
      startingBalance: 200_000,
      monthlySpend: 50_000,
      ssMonthly: 0,
    });
    expect(result.successRate).toBeLessThan(1);
  });

  it("derives equityFraction from (usStocks + intlStocks + reits) / total: an all-equity mix differs from an all-bond mix", () => {
    const allEquity: SimInputs = {
      ...base,
      allocation: { usStocks: 1, intlStocks: 0, bonds: 0, reits: 0, cash: 0 },
    };
    const allBonds: SimInputs = {
      ...base,
      allocation: { usStocks: 0, intlStocks: 0, bonds: 1, reits: 0, cash: 0 },
    };
    const eq = runRetirementBacktest(allEquity);
    const bd = runRetirementBacktest(allBonds);
    // Different blended-return paths → different median terminal balances.
    const last = eq.cohortBands.p50.length - 1;
    expect(eq.cohortBands.p50[last]).not.toBe(bd.cohortBands.p50[last]);
  });
});
