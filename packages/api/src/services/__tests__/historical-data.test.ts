import { describe, it, expect } from 'vitest';
import { getHistoricalDataService } from '../historical-data.js';

describe('HistoricalDataService', () => {
  const service = getHistoricalDataService();

  describe('getAvailableYearRange', () => {
    it('returns 1928 as start year', () => {
      const { startYear } = service.getAvailableYearRange();
      expect(startYear).toBe(1928);
    });
  });

  describe('getReturnsForYear', () => {
    it('returns all asset class returns for a year', () => {
      const returns = service.getReturnsForYear(2020);
      expect(returns).toHaveProperty('usStocks');
      expect(returns).toHaveProperty('bonds');
      expect(returns).toHaveProperty('cash');
      expect(returns).toHaveProperty('intlStocks');
      expect(returns).toHaveProperty('reits');
    });

    it('returns null for intlStocks before 1970', () => {
      const returns = service.getReturnsForYear(1960);
      expect(returns?.intlStocks).toBeNull();
    });

    it('returns null for reits before 1972', () => {
      const returns = service.getReturnsForYear(1970);
      expect(returns?.reits).toBeNull();
    });
  });

  describe('prorateAllocation', () => {
    it('prorates when intl and reits are null', () => {
      const allocation = {
        usStocks: 0.5,
        intlStocks: 0.2,
        bonds: 0.2,
        reits: 0.05,
        cash: 0.05,
      };
      const result = service.prorateAllocation(allocation, 1960);

      // intl + reits (25%) redistributed to us + bonds (70%)
      // us: 0.5 + (0.5/0.7 * 0.25) ≈ 0.679
      // bonds: 0.2 + (0.2/0.7 * 0.25) ≈ 0.271
      expect(result.usStocks + result.bonds + result.cash).toBeCloseTo(1);
      expect(result.intlStocks).toBe(0);
      expect(result.reits).toBe(0);
    });
  });
});
