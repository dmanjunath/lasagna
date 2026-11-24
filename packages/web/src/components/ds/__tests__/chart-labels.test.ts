import { describe, expect, it } from 'vitest';
import { formatShortMoney, tickDecimals } from '../TrendChart';

// Chart labels never wrap (owner, 2026-11-23): every axis tick and readout
// amount is one short token, at any size.
describe('formatShortMoney', () => {
  it('keeps every size to one short token', () => {
    expect(formatShortMoney(999)).toBe('$999');
    expect(formatShortMoney(1_500)).toBe('$1.5K');
    expect(formatShortMoney(45_000)).toBe('$45K');
    expect(formatShortMoney(1_234_567.89)).toBe('$1.2M');
    expect(formatShortMoney(12_345_678)).toBe('$12M');
    expect(formatShortMoney(1_234_567_890)).toBe('$1.2B');
    expect(formatShortMoney(98_765_432_100)).toBe('$99B');
  });

  it('signs negatives with a real minus', () => {
    expect(formatShortMoney(-45_000)).toBe('−$45K');
    expect(formatShortMoney(-1_234_567_890)).toBe('−$1.2B');
  });

  it('stays short for any amount up to a trillion', () => {
    for (let n = 1; n < 1e12; n *= 7.3) expect(formatShortMoney(n).length).toBeLessThanOrEqual(6);
  });
});

describe('tickDecimals', () => {
  it('adds decimals only when ticks would otherwise read the same', () => {
    expect(tickDecimals([0, 50_000, 100_000], 0)).toBe(0);
    expect(tickDecimals([92_000, 94_000, 96_000], 0)).toBe(0);
    expect(tickDecimals([1_000_000, 1_100_000, 1_200_000], 0)).toBe(1);
  });
});
