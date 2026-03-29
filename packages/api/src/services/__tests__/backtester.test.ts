import { describe, it, expect } from "vitest";
import { Backtester, BacktestParams } from "../backtester.js";

describe("Backtester", () => {
  const backtester = new Backtester();

  const defaultParams: BacktestParams = {
    initialBalance: 1000000,
    withdrawalRate: 0.04,
    yearsToSimulate: 30,
    assetAllocation: {
      usStocks: 0.7,
      intlStocks: 0,
      bonds: 0.3,
      reits: 0,
      cash: 0,
    },
    inflationAdjusted: true,
  };

  describe("run", () => {
    it("returns periods for each valid starting year", () => {
      const result = backtester.run(defaultParams);
      expect(result.totalPeriods).toBeGreaterThan(0);
      expect(result.periods).toHaveLength(result.totalPeriods);
    });

    it("calculates success rate correctly", () => {
      const result = backtester.run(defaultParams);
      const actualSuccesses = result.periods.filter((p) => p.status === "success").length;
      expect(result.successfulPeriods).toBe(actualSuccesses);
      expect(result.successRate).toBeCloseTo(actualSuccesses / result.totalPeriods, 2);
    });

    it("each period has required fields", () => {
      const result = backtester.run(defaultParams);
      for (const period of result.periods) {
        expect(period.startYear).toBeDefined();
        expect(period.endBalance).toBeDefined();
        expect(period.yearsLasted).toBeDefined();
        expect(period.status).toMatch(/success|failed|close/);
        expect(period.worstDrawdown).toBeDefined();
        expect(period.worstYear).toBeDefined();
      }
    });

    it("respects startYearRange filter", () => {
      const params = {
        ...defaultParams,
        startYearRange: { from: 1990, to: 2000 },
      };
      const result = backtester.run(params);
      expect(result.periods[0].startYear).toBeGreaterThanOrEqual(1990);
      expect(result.periods[result.periods.length - 1].startYear).toBeLessThanOrEqual(2000);
    });
  });

  describe("historical accuracy", () => {
    it("1930 start with 4% SWR for 30 years should be challenging", () => {
      const params = {
        ...defaultParams,
        startYearRange: { from: 1930, to: 1930 },
        yearsToSimulate: 30,
      };
      const result = backtester.run(params);
      const period1930 = result.periods.find((p) => p.startYear === 1930);
      expect(period1930).toBeDefined();
    });
  });

  describe("run with 5 asset classes", () => {
    it("accepts 5-asset allocation", () => {
      const result = backtester.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 30,
        assetAllocation: {
          usStocks: 0.5,
          intlStocks: 0.2,
          bonds: 0.2,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: true,
      });

      expect(result.totalPeriods).toBeGreaterThan(0);
      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(1);
    });

    it("returns period details with worstDrawdown", () => {
      const result = backtester.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 20,
        assetAllocation: {
          usStocks: 0.6,
          intlStocks: 0.1,
          bonds: 0.2,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: false,
      });

      expect(result.periods.length).toBeGreaterThan(0);
      expect(result.periods[0]).toHaveProperty("startYear");
      expect(result.periods[0]).toHaveProperty("endBalance");
      expect(result.periods[0]).toHaveProperty("status");
      expect(result.periods[0]).toHaveProperty("worstDrawdown");
    });

    it("handles proration for early years", () => {
      const result = backtester.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 10,
        assetAllocation: {
          usStocks: 0.3,
          intlStocks: 0.3,
          bonds: 0.3,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: false,
        startYearRange: { from: 1960, to: 1970 },
      });

      // Should still run even though intl/reits have no data
      expect(result.totalPeriods).toBeGreaterThan(0);
    });
  });
});
