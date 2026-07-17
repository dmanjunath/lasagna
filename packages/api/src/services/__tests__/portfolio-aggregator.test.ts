import { describe, it, expect } from 'vitest';
import { aggregatePortfolio, symbolAccountBreakdown } from '../portfolio-aggregator';

describe('portfolio-aggregator', () => {
  describe('aggregatePortfolio', () => {
    it('groups holdings by asset class and sub-category', () => {
      const holdings = [
        { ticker: 'VTI', value: 50000, shares: 200, name: 'Vanguard Total Stock', account: 'Vanguard IRA', costBasis: 40000 },
        { ticker: 'VTSAX', value: 30000, shares: 300, name: 'Vanguard Total Stock Admiral', account: 'Fidelity 401k', costBasis: 25000 },
        { ticker: 'BND', value: 20000, shares: 250, name: 'Vanguard Total Bond', account: 'Vanguard IRA', costBasis: 19000 },
      ];

      const result = aggregatePortfolio(holdings);

      expect(result.totalValue).toBe(100000);
      expect(result.assetClasses.length).toBe(2); // US Stocks, Bonds

      const usStocks = result.assetClasses.find(a => a.name === 'US Stocks');
      expect(usStocks).toBeDefined();
      expect(usStocks!.value).toBe(80000);
      expect(usStocks!.categories.length).toBe(1); // Total Market
      expect(usStocks!.categories[0].name).toBe('Total Market');
      expect(usStocks!.categories[0].holdings.length).toBe(2);
    });

    it('calculates percentages correctly', () => {
      const holdings = [
        { ticker: 'VTI', value: 60000, shares: 200, name: 'VTI', account: 'Test', costBasis: null },
        { ticker: 'BND', value: 40000, shares: 500, name: 'BND', account: 'Test', costBasis: null },
      ];

      const result = aggregatePortfolio(holdings);

      const usStocks = result.assetClasses.find(a => a.name === 'US Stocks')!;
      expect(usStocks.percentage).toBe(60);

      const bonds = result.assetClasses.find(a => a.name === 'Bonds')!;
      expect(bonds.percentage).toBe(40);
    });

    it('places unmapped tickers with no security type in Other category', () => {
      const holdings = [
        { ticker: 'UNKNOWN123', value: 10000, shares: 100, name: 'Unknown Stock', account: 'Test', costBasis: null },
      ];

      const result = aggregatePortfolio(holdings);

      const other = result.assetClasses.find(a => a.name === 'Other');
      expect(other).toBeDefined();
      expect(other!.value).toBe(10000);
    });

    it('classifies an unmapped individual equity as US Stocks, not Other', () => {
      const holdings = [
        { ticker: 'PLTR', value: 15000, shares: 300, name: 'Palantir', account: 'Brokerage', costBasis: 9000, securityType: 'equity' },
      ];

      const result = aggregatePortfolio(holdings);

      expect(result.totalValue).toBe(15000);
      expect(result.assetClasses.find(a => a.name === 'Other')).toBeUndefined();
      const usStocks = result.assetClasses.find(a => a.name === 'US Stocks');
      expect(usStocks).toBeDefined();
      expect(usStocks!.value).toBe(15000);
      expect(usStocks!.categories[0].name).toBe('Individual Stocks');
    });

    it('preserves total value when mixing mapped and fallback holdings', () => {
      const holdings = [
        { ticker: 'VTI', value: 50000, shares: 200, name: 'VTI', account: 'IRA', costBasis: null },
        { ticker: 'PLTR', value: 20000, shares: 400, name: 'Palantir', account: 'Brokerage', costBasis: null, securityType: 'equity' },
        { ticker: 'SPY240119C00500000', value: 5000, shares: 1, name: 'SPY Call', account: 'Brokerage', costBasis: null, securityType: 'derivative' },
      ];

      const result = aggregatePortfolio(holdings);

      expect(result.totalValue).toBe(75000);
      const sumAcrossClasses = result.assetClasses.reduce((s, a) => s + a.value, 0);
      expect(sumAcrossClasses).toBe(75000);
      expect(result.assetClasses.find(a => a.name === 'US Stocks')!.value).toBe(70000);
      expect(result.assetClasses.find(a => a.name === 'Other')!.value).toBe(5000);
    });
  });

  describe('symbolAccountBreakdown', () => {
    const holdings = [
      { ticker: 'VTI', value: 60000, shares: 200, name: 'VTI', account: 'Vanguard IRA', costBasis: null },
      { ticker: 'VTI', value: 40000, shares: 130, name: 'VTI', account: 'Fidelity 401k', costBasis: null },
      { ticker: 'BND', value: 20000, shares: 250, name: 'BND', account: 'Vanguard IRA', costBasis: null },
    ];

    it('lists every account holding the symbol, sorted by value desc', () => {
      const result = symbolAccountBreakdown(holdings, 'VTI');

      expect(result.symbol).toBe('VTI');
      expect(result.accounts.map(a => a.account)).toEqual(['Vanguard IRA', 'Fidelity 401k']);
      expect(result.accounts[0].shares).toBe(200);
      expect(result.accounts[1].value).toBe(40000);
    });

    it('per-account values reconcile exactly to the symbol total across accounts', () => {
      const result = symbolAccountBreakdown(holdings, 'VTI');

      expect(result.totalValue).toBe(100000);
      const sum = result.accounts.reduce((s, a) => s + a.value, 0);
      expect(sum).toBe(result.totalValue);
      const pctSum = result.accounts.reduce((s, a) => s + a.percentage, 0);
      expect(pctSum).toBeCloseTo(100, 6);
      expect(result.accounts[0].percentage).toBe(60);
    });

    it('handles the single-account case cleanly', () => {
      const result = symbolAccountBreakdown(holdings, 'BND');
      expect(result.accounts.length).toBe(1);
      expect(result.accounts[0].account).toBe('Vanguard IRA');
      expect(result.accounts[0].percentage).toBe(100);
      expect(result.totalValue).toBe(20000);
    });

    it('sums repeated rows of the same symbol within one account', () => {
      const withSynthetic = [
        { ticker: 'VTI', value: 60000, shares: 200, name: 'VTI', account: 'Brokerage', costBasis: null },
        { ticker: 'VTI', value: 15000, shares: 15000, name: 'Brokerage (assumed 60% US Stocks)', account: 'Brokerage', costBasis: null },
      ];
      const result = symbolAccountBreakdown(withSynthetic, 'VTI');
      expect(result.accounts.length).toBe(1);
      expect(result.accounts[0].value).toBe(75000);
      expect(result.accounts[0].shares).toBe(15200);
      expect(result.totalValue).toBe(75000);
    });

    it('returns an empty breakdown for a symbol with no holdings', () => {
      const result = symbolAccountBreakdown(holdings, 'NVDA');
      expect(result.totalValue).toBe(0);
      expect(result.accounts).toEqual([]);
    });
  });
});
