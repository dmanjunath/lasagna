import { describe, it, expect } from "vitest";
import { MonteCarloEngine, MonteCarloParams } from "../monte-carlo.js";

describe("MonteCarloEngine", () => {
  const engine = new MonteCarloEngine();

  const defaultParams: MonteCarloParams = {
    initialBalance: 1000000,
    annualWithdrawal: 40000, // $40k/year (equivalent to 4% of $1M)
    yearsToSimulate: 30,
    assetAllocation: {
      usStocks: 0.50,
      intlStocks: 0.20,
      bonds: 0.20,
      reits: 0.05,
      cash: 0.05,
    },
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

    it("handles zero withdrawal", () => {
      const params = { ...defaultParams, annualWithdrawal: 0 };
      const result = engine.run(params);
      expect(result.successRate).toBe(1);
    });
  });

  describe("5-asset allocation", () => {
    it("accepts 5-asset allocation", () => {
      const params: MonteCarloParams = {
        ...defaultParams,
        assetAllocation: {
          usStocks: 0.40,
          intlStocks: 0.30,
          bonds: 0.15,
          reits: 0.10,
          cash: 0.05,
        },
      };
      const result = engine.run(params);
      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(1);
    });
  });

  describe("extended percentiles", () => {
    it("returns p25 and p75 percentiles", () => {
      const result = engine.run(defaultParams);
      expect(result.percentiles.p25).toBeDefined();
      expect(result.percentiles.p75).toBeDefined();
      expect(result.percentiles.p25).toHaveLength(defaultParams.yearsToSimulate + 1);
      expect(result.percentiles.p75).toHaveLength(defaultParams.yearsToSimulate + 1);

      // Verify p25 is less than p50, which is less than p75
      expect(result.percentiles.p25[10]).toBeLessThanOrEqual(result.percentiles.p50[10]);
      expect(result.percentiles.p50[10]).toBeLessThanOrEqual(result.percentiles.p75[10]);
    });
  });

  describe("histogram buckets", () => {
    it("returns histogram buckets", () => {
      const result = engine.run(defaultParams);
      expect(result.histogram).toBeDefined();
      expect(Array.isArray(result.histogram)).toBe(true);
      expect(result.histogram.length).toBeGreaterThan(0);

      // Verify structure of histogram buckets
      for (const bucket of result.histogram) {
        expect(bucket).toHaveProperty('bucket');
        expect(bucket).toHaveProperty('count');
        expect(bucket).toHaveProperty('status');
        expect(typeof bucket.bucket).toBe('number');
        expect(typeof bucket.count).toBe('number');
        expect(['success', 'close', 'failure']).toContain(bucket.status);
      }

      // Verify total count equals number of simulations
      const totalCount = result.histogram.reduce((sum, b) => sum + b.count, 0);
      expect(totalCount).toBe(defaultParams.numSimulations);
    });
  });

  describe("sample paths", () => {
    it("returns sample paths for spaghetti visualization", () => {
      const params = { ...defaultParams, includeSamplePaths: true, numSamplePaths: 5 };
      const result = engine.run(params);

      expect(result.samplePaths).toBeDefined();
      expect(Array.isArray(result.samplePaths)).toBe(true);
      expect(result.samplePaths?.length).toBe(5);

      // Verify each path has correct length
      for (const path of result.samplePaths!) {
        expect(path).toHaveLength(defaultParams.yearsToSimulate + 1);
        expect(path[0]).toBe(defaultParams.initialBalance);
      }
    });

    it("does not return sample paths when not requested", () => {
      const params = { ...defaultParams, includeSamplePaths: false };
      const result = engine.run(params);
      expect(result.samplePaths).toBeUndefined();
    });

    it("uses default number of sample paths when not specified", () => {
      const params = { ...defaultParams, includeSamplePaths: true };
      const result = engine.run(params);
      expect(result.samplePaths).toBeDefined();
      expect(result.samplePaths?.length).toBe(10); // Default is 10
    });
  });

  describe("calculates reasonable results", () => {
    it("higher withdrawal = lower success rate", () => {
      const low = engine.run({ ...defaultParams, annualWithdrawal: 30000 });
      const high = engine.run({ ...defaultParams, annualWithdrawal: 60000 });
      expect(low.successRate).toBeGreaterThan(high.successRate);
    });

    it("longer duration = lower success rate", () => {
      const short = engine.run({ ...defaultParams, yearsToSimulate: 20 });
      const long = engine.run({ ...defaultParams, yearsToSimulate: 40 });
      expect(short.successRate).toBeGreaterThan(long.successRate);
    });
  });
});
