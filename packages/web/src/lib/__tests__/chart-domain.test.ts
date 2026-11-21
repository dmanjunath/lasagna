import { describe, expect, it } from 'vitest';
import { clampedDomain } from '../chart-domain';

const span = (d: { min: number; max: number }) => d.max - d.min;
const contains = (d: { min: number; max: number }, values: number[]) =>
  values.every((v) => v >= d.min && v <= d.max);

describe('clampedDomain', () => {
  it('keeps a 0.4% dip small: the window is at least 10% of the mean', () => {
    const values = [1_850_000, 1_843_000, 1_852_000, 1_844_600];
    const d = clampedDomain(values);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(span(d)).toBeGreaterThanOrEqual(mean * 0.1);
    expect(contains(d, values)).toBe(true);
    // Centred on the series: the line sits mid-frame, not on the floor.
    const mid = (Math.min(...values) + Math.max(...values)) / 2;
    expect(Math.abs((d.min + d.max) / 2 - mid)).toBeLessThan(1);
  });

  it('leaves a large real swing alone, with no clipping', () => {
    const values = [2_000_000, 1_200_000, 600_000];
    const d = clampedDomain(values);
    expect(contains(d, values)).toBe(true);
    expect(span(d)).toBeLessThan((2_000_000 - 600_000) * 1.2);
  });

  it('handles a negative net worth', () => {
    const values = [-84_000, -84_300, -83_900];
    const d = clampedDomain(values);
    expect(contains(d, values)).toBe(true);
    expect(span(d)).toBeGreaterThanOrEqual(84_000 * 0.1);
    expect(d.max).toBeLessThanOrEqual(0);
  });

  it('falls back to an absolute span when the mean is near zero', () => {
    const d = clampedDomain([0, 0, 0]);
    expect(span(d)).toBeGreaterThanOrEqual(100);
    expect(d.min).toBe(0);
    const crossing = clampedDomain([-10, 12, -3]);
    expect(span(crossing)).toBeGreaterThanOrEqual(100);
    expect(contains(crossing, [-10, 12, -3])).toBe(true);
  });

  it('keeps zero as the floor for a small positive balance', () => {
    const d = clampedDomain([20, 20]);
    expect(d.min).toBe(0);
    expect(contains(d, [20])).toBe(true);
  });

  it('draws a single point mid-frame', () => {
    const d = clampedDomain([500_000]);
    expect(contains(d, [500_000])).toBe(true);
    expect(span(d)).toBeGreaterThanOrEqual(50_000);
    expect(d.ticks.length).toBeGreaterThanOrEqual(2);
  });

  it('returns nice ticks inside the domain', () => {
    const d = clampedDomain([1_850_000, 1_843_000]);
    expect(d.ticks.length).toBeGreaterThanOrEqual(3);
    for (const t of d.ticks) {
      expect(t).toBeGreaterThanOrEqual(d.min);
      expect(t).toBeLessThanOrEqual(d.max);
    }
    const step = d.ticks[1] - d.ticks[0];
    expect(step / 10 ** Math.floor(Math.log10(step))).toSatisfy((n: number) => [1, 2, 5].includes(n));
  });

  it('survives an empty or non-finite series', () => {
    const d = clampedDomain([NaN]);
    expect(Number.isFinite(d.min) && Number.isFinite(d.max)).toBe(true);
    expect(d.max).toBeGreaterThan(d.min);
  });
});
