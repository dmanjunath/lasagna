import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTickerCategory,
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
