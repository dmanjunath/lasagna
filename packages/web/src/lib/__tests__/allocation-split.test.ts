import { describe, it, expect } from 'vitest';
import { allocationSplitLabel } from '../allocation-split';

describe('allocationSplitLabel', () => {
  it('shows cash as cash, not as bonds (audit W-6)', () => {
    // The Portfolio page mix: 42% US stocks, 2% REITs, 20% bonds, 36% cash.
    const alloc = { usStocks: 0.4194, intlStocks: 0, bonds: 0.1964, reits: 0.0195, cash: 0.3648 };
    expect(allocationSplitLabel(alloc)).toBe('44% stocks, 20% bonds, 36% cash');
  });
  it('leaves cash out when there is none', () => {
    expect(allocationSplitLabel({ usStocks: 60, intlStocks: 0, bonds: 40, reits: 0, cash: 0 })).toBe('60% stocks, 40% bonds');
  });
  it('always adds up to 100', () => {
    expect(allocationSplitLabel({ usStocks: 1, bonds: 1, cash: 1 })).toBe('34% stocks, 33% bonds, 33% cash');
  });
  it('returns null with nothing to split', () => {
    expect(allocationSplitLabel(null)).toBeNull();
    expect(allocationSplitLabel({ usStocks: 0, bonds: 0 })).toBeNull();
  });
});
