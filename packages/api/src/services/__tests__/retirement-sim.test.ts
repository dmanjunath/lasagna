import { describe, it, expect } from "vitest";
import { runRetirementSim, type SimInputs } from "../retirement-sim.js";
import { blendedExpectedReturn, type AssetAllocation } from "../market-assumptions.js";

const allocation: AssetAllocation = {
  usStocks: 0.42,
  intlStocks: 0.18,
  bonds: 0.3,
  reits: 0.05,
  cash: 0.05,
};

const base: SimInputs = {
  currentAge: 34,
  retirementAge: 65,
  planThroughAge: 95,
  startingBalance: 1_000_000,
  monthlySavings: 0,
  monthlySpend: 4000,
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

describe("runRetirementSim", () => {
  it("accumulates contributions + growth so median balance at retirement exceeds the start", () => {
    // Tiny spend, six accumulation years with heavy savings; the median balance
    // at retirement must be strictly greater than the starting balance.
    const result = runRetirementSim({
      ...base,
      currentAge: 34,
      retirementAge: 40,
      planThroughAge: 90,
      monthlySavings: 5000,
      startingBalance: 1_000_000,
      monthlySpend: 1,
    });
    const idxAtRetirement = 40 - 34;
    expect(result.percentiles.p50[idxAtRetirement]).toBeGreaterThan(1_000_000);
  });

  it("Social Security income raises the success rate (netting reduces withdrawals)", () => {
    // Retire soon-ish with a spend generous enough to cause some failures, then
    // add SS claimed at retirement — the netted run must succeed strictly more.
    const stressed: SimInputs = {
      ...base,
      currentAge: 60,
      retirementAge: 62,
      planThroughAge: 95,
      startingBalance: 800_000,
      monthlySavings: 0,
      monthlySpend: 6000,
      ssClaimAge: 62,
    };
    const withoutSS = runRetirementSim({ ...stressed, ssMonthly: 0 });
    const withSS = runRetirementSim({ ...stressed, ssMonthly: 4000 });
    expect(withSS.successRate).toBeGreaterThan(withoutSS.successRate);
  });

  it("returns bands of the right length and matching summary fields", () => {
    const result = runRetirementSim(base);
    const horizonYears = base.planThroughAge - base.currentAge;
    expect(result.horizonYears).toBe(horizonYears);
    expect(result.percentiles.p50.length).toBe(horizonYears + 1);
    expect(result.percentiles.p5.length).toBe(horizonYears + 1);
    expect(result.percentiles.p95.length).toBe(horizonYears + 1);
    expect(result.blendedExpectedReturn).toBe(blendedExpectedReturn(allocation));
    expect(result.successRate).toBeGreaterThanOrEqual(0);
    expect(result.successRate).toBeLessThanOrEqual(1);
  });
});
