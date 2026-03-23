import { describe, it, expect } from "vitest";
import { MonteCarloEngine, MonteCarloParams } from "../monte-carlo.js";

describe("MonteCarloEngine", () => {
  const engine = new MonteCarloEngine();

  const defaultParams: MonteCarloParams = {
    initialBalance: 1000000,
    withdrawalRate: 0.04,
    yearsToSimulate: 30,
    assetAllocation: { stocks: 0.7, bonds: 0.25, cash: 0.05 },
    inflationAdjusted: true,
    numSimulations: 1000,
  };

  describe("run", () => {
    it("returns success rate between 0 and 1", () => {
      const result = engine.run(defaultParams);
      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(1);
    });

    it("returns percentile arrays of correct length", () => {
      const result = engine.run(defaultParams);
      expect(result.percentiles.p50).toHaveLength(defaultParams.yearsToSimulate + 1);
    });

    it("initial balance matches in all percentiles", () => {
      const result = engine.run(defaultParams);
      expect(result.percentiles.p5[0]).toBe(defaultParams.initialBalance);
      expect(result.percentiles.p50[0]).toBe(defaultParams.initialBalance);
      expect(result.percentiles.p95[0]).toBe(defaultParams.initialBalance);
    });

    it("handles zero withdrawal rate", () => {
      const params = { ...defaultParams, withdrawalRate: 0 };
      const result = engine.run(params);
      expect(result.successRate).toBe(1);
    });
  });

  describe("calculates reasonable results", () => {
    it("higher withdrawal rate = lower success rate", () => {
      const low = engine.run({ ...defaultParams, withdrawalRate: 0.03 });
      const high = engine.run({ ...defaultParams, withdrawalRate: 0.06 });
      expect(low.successRate).toBeGreaterThan(high.successRate);
    });

    it("longer duration = lower success rate", () => {
      const short = engine.run({ ...defaultParams, yearsToSimulate: 20 });
      const long = engine.run({ ...defaultParams, yearsToSimulate: 40 });
      expect(short.successRate).toBeGreaterThan(long.successRate);
    });
  });
});
