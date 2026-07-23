import { describe, it, expect } from "vitest";
import { getMonteCarloEngine, MonteCarloParams } from "../monte-carlo.js";

const baseParams: MonteCarloParams = {
  initialBalance: 1_000_000,
  annualWithdrawal: 45_000,
  yearsToSimulate: 30,
  assetAllocation: {
    usStocks: 0.42,
    intlStocks: 0.18,
    bonds: 0.30,
    reits: 0.05,
    cash: 0.05,
  },
  numSimulations: 200,
  seed: 12345,
};

describe("Monte Carlo seeded RNG", () => {
  it("two runs with the same seed produce identical successRate", () => {
    const engine = getMonteCarloEngine();
    const r1 = engine.run(baseParams);
    const r2 = engine.run(baseParams);
    expect(r1.successRate).toBe(r2.successRate);
  });

  it("two runs with the same seed produce identical p50 percentile array", () => {
    const engine = getMonteCarloEngine();
    const r1 = engine.run(baseParams);
    const r2 = engine.run(baseParams);
    expect(r1.percentiles.p50).toEqual(r2.percentiles.p50);
  });

  it("a different seed produces a different successRate OR different p50", () => {
    const engine = getMonteCarloEngine();
    const r1 = engine.run(baseParams);
    const r2 = engine.run({ ...baseParams, seed: 99999 });
    const sameRate = r1.successRate === r2.successRate;
    const sameP50 = JSON.stringify(r1.percentiles.p50) === JSON.stringify(r2.percentiles.p50);
    expect(sameRate && sameP50).toBe(false);
  });
});
