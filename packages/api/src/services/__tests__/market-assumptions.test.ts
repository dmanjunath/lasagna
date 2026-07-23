import { describe, it, expect } from "vitest";
import {
  ASSET_CLASSES,
  MARKET_MODEL,
  blendedExpectedReturn,
  blendedVolatility,
} from "../market-assumptions.js";
import type { AssetAllocation } from "../monte-carlo.js";

describe("market-assumptions", () => {
  describe("ASSET_CLASSES", () => {
    it("contains exactly the 5 expected keys", () => {
      expect(ASSET_CLASSES).toEqual([
        "usStocks",
        "intlStocks",
        "bonds",
        "reits",
        "cash",
      ]);
    });
  });

  describe("MARKET_MODEL", () => {
    it("has correct numbers for usStocks", () => {
      expect(MARKET_MODEL.usStocks).toEqual({ mean: 0.10, stdDev: 0.18 });
    });

    it("has correct numbers for intlStocks", () => {
      expect(MARKET_MODEL.intlStocks).toEqual({ mean: 0.08, stdDev: 0.20 });
    });

    it("has correct numbers for bonds", () => {
      expect(MARKET_MODEL.bonds).toEqual({ mean: 0.05, stdDev: 0.07 });
    });

    it("has correct numbers for reits", () => {
      expect(MARKET_MODEL.reits).toEqual({ mean: 0.09, stdDev: 0.22 });
    });

    it("has correct numbers for cash", () => {
      expect(MARKET_MODEL.cash).toEqual({ mean: 0.02, stdDev: 0.01 });
    });

    it("has correct numbers for inflation", () => {
      expect(MARKET_MODEL.inflation).toEqual({ mean: 0.03, stdDev: 0.015 });
    });
  });

  describe("blendedExpectedReturn", () => {
    it("returns 0.10 for 100% usStocks", () => {
      const allocation: AssetAllocation = {
        usStocks: 1,
        intlStocks: 0,
        bonds: 0,
        reits: 0,
        cash: 0,
      };
      expect(blendedExpectedReturn(allocation)).toBeCloseTo(0.10);
    });

    it("returns 0.08 for a 60/40 usStocks/bonds mix", () => {
      // 0.6 * 0.10 + 0.4 * 0.05 = 0.06 + 0.02 = 0.08
      const allocation: AssetAllocation = {
        usStocks: 0.6,
        intlStocks: 0,
        bonds: 0.4,
        reits: 0,
        cash: 0,
      };
      expect(blendedExpectedReturn(allocation)).toBeCloseTo(0.08);
    });

    it("normalizes an allocation whose weights sum to > 1", () => {
      // usStocks weight=2, bonds weight=2 → sum=4, each normalized to 0.5
      // 0.5 * 0.10 + 0.5 * 0.05 = 0.05 + 0.025 = 0.075
      const allocation = { usStocks: 2, intlStocks: 0, bonds: 2, reits: 0, cash: 0 } as AssetAllocation;
      expect(blendedExpectedReturn(allocation)).toBeCloseTo(0.075);
    });
  });

  describe("blendedVolatility", () => {
    it("returns 0.18 for 100% usStocks", () => {
      const allocation: AssetAllocation = {
        usStocks: 1,
        intlStocks: 0,
        bonds: 0,
        reits: 0,
        cash: 0,
      };
      expect(blendedVolatility(allocation)).toBeCloseTo(0.18);
    });
  });
});
