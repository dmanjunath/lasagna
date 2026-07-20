import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTickerCategory,
  getTickerCategoryWithFallback,
  ASSET_CLASS_COLORS,
  type AssetClass,
  type Category
} from '../ticker-categories.js';

describe('ticker-categories', () => {
  describe('getTickerCategory', () => {
    it('returns US Stocks / Total Market for VTI', () => {
      const result = getTickerCategory('VTI');
      assert.deepEqual(result, {
        assetClass: 'US Stocks',
        category: 'Total Market',
        color: '#4ade80',
      });
    });

    it('returns US Stocks / S&P 500 for VOO', () => {
      const result = getTickerCategory('VOO');
      assert.deepEqual(result, {
        assetClass: 'US Stocks',
        category: 'S&P 500',
        color: '#4ade80',
      });
    });

    it('returns International Stocks / Developed for VEA', () => {
      const result = getTickerCategory('VEA');
      assert.deepEqual(result, {
        assetClass: 'International Stocks',
        category: 'Developed',
        color: '#60a5fa',
      });
    });

    it('returns Bonds / Total Bond for BND', () => {
      const result = getTickerCategory('BND');
      assert.deepEqual(result, {
        assetClass: 'Bonds',
        category: 'Total Bond',
        color: '#f59e0b',
      });
    });

    it('returns REITs / US REITs for VNQ', () => {
      const result = getTickerCategory('VNQ');
      assert.deepEqual(result, {
        assetClass: 'REITs',
        category: 'US REITs',
        color: '#8b5cf6',
      });
    });

    it('returns Cash / Money Market for VMFXX', () => {
      const result = getTickerCategory('VMFXX');
      assert.deepEqual(result, {
        assetClass: 'Cash',
        category: 'Money Market',
        color: '#ec4899',
      });
    });

    it('categorizes VUSXX (Treasury money-market fund) as Cash / Treasuries, not a mutual fund', () => {
      const result = getTickerCategory('VUSXX');
      assert.deepEqual(result, {
        assetClass: 'Cash',
        category: 'Treasuries',
        color: '#ec4899',
      });
    });

    it('returns Other / Unknown for unmapped ticker', () => {
      const result = getTickerCategory('UNKNOWN123');
      assert.deepEqual(result, {
        assetClass: 'Other',
        category: 'Unknown',
        color: '#a8a29e',
      });
    });

    it('handles lowercase tickers', () => {
      const result = getTickerCategory('vti');
      assert.equal(result.assetClass, 'US Stocks');
    });
  });

  describe('getTickerCategoryWithFallback', () => {
    it('still prefers the hardcoded map when the ticker is known', () => {
      const result = getTickerCategoryWithFallback('VTI', 'etf');
      assert.equal(result.assetClass, 'US Stocks');
      assert.equal(result.category, 'Total Market');
    });

    it('classifies an unmapped US-listed equity as US Stocks', () => {
      const result = getTickerCategoryWithFallback('PLTR', 'equity');
      assert.deepEqual(result, {
        assetClass: 'US Stocks',
        category: 'Individual Stocks',
        color: '#4ade80',
      });
    });

    it('routes a foreign-listed equity to International Stocks', () => {
      const result = getTickerCategoryWithFallback('RY.TO', 'equity');
      assert.equal(result.assetClass, 'International Stocks');
      assert.equal(result.category, 'Individual Stocks');
    });

    it('classifies an unmapped ETF as US Stocks', () => {
      const result = getTickerCategoryWithFallback('ARKK', 'etf');
      assert.equal(result.assetClass, 'US Stocks');
      assert.equal(result.category, 'ETFs');
    });

    it('classifies an unmapped mutual fund as US Stocks', () => {
      const result = getTickerCategoryWithFallback('PRGFX', 'mutual fund');
      assert.equal(result.assetClass, 'US Stocks');
      assert.equal(result.category, 'Mutual Funds');
    });

    it('classifies fixed income as Bonds', () => {
      const result = getTickerCategoryWithFallback('SOMEBOND', 'fixed income');
      assert.equal(result.assetClass, 'Bonds');
      assert.equal(result.category, 'Bond Funds');
    });

    it('labels an unmapped cryptocurrency as Other / Crypto', () => {
      const result = getTickerCategoryWithFallback('BTC', 'cryptocurrency');
      assert.deepEqual(result, {
        assetClass: 'Other',
        category: 'Crypto',
        color: '#a8a29e',
      });
    });

    it('still prefers the map for a Treasury money-market fund over the mutual-fund fallback', () => {
      const result = getTickerCategoryWithFallback('VUSXX', 'mutual fund');
      assert.equal(result.assetClass, 'Cash');
      assert.equal(result.category, 'Treasuries');
    });

    it('keeps derivatives/options in Other', () => {
      const result = getTickerCategoryWithFallback('SPY240119C00500000', 'derivative');
      assert.equal(result.assetClass, 'Other');
    });

    it('keeps an unrecognized security with no type in Other', () => {
      const result = getTickerCategoryWithFallback('UNKNOWN123');
      assert.deepEqual(result, {
        assetClass: 'Other',
        category: 'Unknown',
        color: '#a8a29e',
      });
    });
  });

  describe('ASSET_CLASS_COLORS', () => {
    it('has correct colors for all asset classes', () => {
      assert.equal(ASSET_CLASS_COLORS['US Stocks'], '#4ade80');
      assert.equal(ASSET_CLASS_COLORS['International Stocks'], '#60a5fa');
      assert.equal(ASSET_CLASS_COLORS['Bonds'], '#f59e0b');
      assert.equal(ASSET_CLASS_COLORS['REITs'], '#8b5cf6');
      assert.equal(ASSET_CLASS_COLORS['Cash'], '#ec4899');
      assert.equal(ASSET_CLASS_COLORS['Other'], '#a8a29e');
    });
  });
});
