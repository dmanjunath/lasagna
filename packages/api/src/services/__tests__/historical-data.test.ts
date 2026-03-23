import { describe, it, expect } from "vitest";
import { HistoricalDataService } from "../historical-data.js";

describe("HistoricalDataService", () => {
  const service = new HistoricalDataService();

  describe("getYearlyReturns", () => {
    it("returns data for valid year range", () => {
      const returns = service.getYearlyReturns(1950, 1960);
      expect(returns).toHaveLength(11);
      expect(returns[0].year).toBe(1950);
      expect(returns[10].year).toBe(1960);
    });

    it("throws for invalid year range", () => {
      expect(() => service.getYearlyReturns(1960, 1950)).toThrow();
    });
  });

  describe("getReturnStatistics", () => {
    it("calculates mean and stddev", () => {
      const stats = service.getReturnStatistics(1950, 2000);
      expect(stats.mean).toBeGreaterThan(0);
      expect(stats.mean).toBeLessThan(0.2);
      expect(stats.stdDev).toBeGreaterThan(0);
      expect(stats.stdDev).toBeLessThan(0.3);
    });
  });

  describe("getAvailableYearRange", () => {
    it("returns start and end years", () => {
      const range = service.getAvailableYearRange();
      expect(range.startYear).toBeLessThanOrEqual(1930);
      expect(range.endYear).toBeGreaterThanOrEqual(2020);
    });
  });
});
