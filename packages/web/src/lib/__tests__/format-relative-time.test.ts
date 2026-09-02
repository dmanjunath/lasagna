import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime } from '../utils';

// Local noon, so shifting by whole days never crosses a date boundary through
// the timezone the test runs in.
const NOW = new Date(2026, 8, 2, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('counts in minutes, hours and days up to a week', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 30 * 1000))).toBe('just now');
    expect(formatRelativeTime(new Date(NOW.getTime() - 45 * 60 * 1000))).toBe('45m ago');
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * 60 * 60 * 1000))).toBe('5h ago');
    expect(formatRelativeTime(daysAgo(3))).toBe('3d ago');
  });

  it('drops the year on a date from this year', () => {
    expect(formatRelativeTime(daysAgo(60))).toBe('Jul 4');
  });

  it('carries the year on any date from another year', () => {
    // The bug this guards: a day count alone put the boundary at eleven months,
    // so a 250-day-old plan printed a bare "Dec 26" that reads as this coming
    // December, i.e. the future.
    expect(formatRelativeTime(daysAgo(250))).toBe('Dec 26, 2025');
    // The first day over the boundary, and a date well past it.
    expect(formatRelativeTime(new Date(2025, 11, 31, 12))).toBe('Dec 31, 2025');
    expect(formatRelativeTime(new Date(2024, 5, 9, 12))).toBe('Jun 9, 2024');
  });

  it('keeps the year off the last date of this year that is still a week old', () => {
    expect(formatRelativeTime(new Date(2026, 0, 1, 12))).toBe('Jan 1');
  });
});
