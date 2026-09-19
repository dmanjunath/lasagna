import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS,
  dateRangeLabel,
  filtersFromQuery,
  filtersToQuery,
  filtersToSearchParams,
  wholeMonthLabel,
  wholeYearLabel,
  type TxnFilters,
} from '../TransactionFilters';

/**
 * The transactions page is a drill-in target: something elsewhere states a
 * figure for one month and one category, links here, and the number has to be
 * checkable on arrival. That only works if the URL carries the whole scope and
 * the page reads every part of it back.
 *
 * `filtersToQuery` was already the writing half, so these tests hold the two
 * halves on the same parameter names (search, categories, startDate, endDate)
 * and hold the month chip that makes the landing visible.
 */

describe('filtersFromQuery', () => {
  it('reads a date range into a custom range', () => {
    const f = filtersFromQuery('?startDate=2026-07-01&endDate=2026-07-31');
    expect(f.datePreset).toBe('custom');
    expect(f.customStart).toBe('2026-07-01');
    expect(f.customEnd).toBe('2026-07-31');
  });

  it('accepts the end-of-day stamp filtersToQuery emits', () => {
    const f = filtersFromQuery('?startDate=2026-07-01&endDate=2026-07-31T23:59:59');
    expect(f.customEnd).toBe('2026-07-31');
  });

  it('reads a search term and categories', () => {
    const f = filtersFromQuery('?search=Blue%20Bottle&categories=a,b');
    expect(f.search).toBe('Blue Bottle');
    expect(f.categories).toEqual(['a', 'b']);
  });

  it('leaves the dates alone for a query with none', () => {
    expect(filtersFromQuery('?categories=a')).toEqual({ ...EMPTY_FILTERS, categories: ['a'] });
  });

  it('ignores a malformed date rather than feeding it to the date inputs', () => {
    const f = filtersFromQuery('?startDate=july&endDate=');
    expect(f.datePreset).toBe('all');
    expect(f.customStart).toBe('');
  });

  it('round-trips a scope through the address bar', () => {
    const scoped: TxnFilters = {
      ...EMPTY_FILTERS,
      search: 'Blue Bottle',
      categories: ['cat-1', 'cat-2'],
      datePreset: 'custom',
      customStart: '2026-07-01',
      customEnd: '2026-07-31',
    };
    const query = filtersToSearchParams(scoped);
    expect(query).toBe('search=Blue%20Bottle&categories=cat-1,cat-2&startDate=2026-07-01&endDate=2026-07-31');
    expect(filtersFromQuery(`?${query}`)).toEqual(scoped);
  });

  /**
   * The exclude half of the scope. It has no authoring control on this page, so
   * the URL is the only way in and this round-trip is the only thing holding it.
   * Dropping it here would widen a drill silently: the right window, over
   * categories the figure the user clicked never counted.
   */
  it('round-trips an exclude scope without confusing it for an include one', () => {
    const scoped: TxnFilters = {
      ...EMPTY_FILTERS,
      excludeCategories: ['cat-1', 'cat-2'],
      datePreset: 'custom',
      customStart: '2026-07-01',
      customEnd: '2026-07-31',
    };
    const query = filtersToSearchParams(scoped);
    expect(query).toBe('excludeCategories=cat-1,cat-2&startDate=2026-07-01&endDate=2026-07-31');
    expect(filtersFromQuery(`?${query}`)).toEqual(scoped);
    expect(filtersFromQuery(`?${query}`).categories).toEqual([]);
  });

  it('keeps the two lists apart where a URL carries both', () => {
    const f = filtersFromQuery('?categories=a&excludeCategories=b');
    expect(f.categories).toEqual(['a']);
    expect(f.excludeCategories).toEqual(['b']);
    expect(filtersToQuery(f)).toMatchObject({ categories: ['a'], excludeCategories: ['b'] });
  });

  it('hands the API the same span the URL asked for', () => {
    expect(filtersToQuery(filtersFromQuery('?startDate=2026-07-01&endDate=2026-07-31'))).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-07-31T23:59:59',
    });
  });
});

describe('wholeMonthLabel', () => {
  it('names a range that is exactly one calendar month', () => {
    expect(wholeMonthLabel('2026-07-01', '2026-07-31')).toBe('July 2026');
    expect(wholeMonthLabel('2026-02-01', '2026-02-28')).toBe('February 2026');
    expect(wholeMonthLabel('2024-02-01', '2024-02-29')).toBe('February 2024');
  });

  it('declines anything that is not a whole month', () => {
    expect(wholeMonthLabel('2026-07-02', '2026-07-31')).toBeNull();
    expect(wholeMonthLabel('2026-07-01', '2026-07-30')).toBeNull();
    expect(wholeMonthLabel('2026-07-01', '2026-08-31')).toBeNull();
    expect(wholeMonthLabel('2026-02-01', '2026-02-29')).toBeNull();
    expect(wholeMonthLabel('2026-07-01', '')).toBeNull();
  });
});

/**
 * The year drill is the month drill's sibling: /spending's Year mode hands over
 * Jan 1 to Dec 31, and that chip has to name the year the way the month chip
 * names the month, not spell out both endpoints.
 */
describe('wholeYearLabel', () => {
  it('names a range that is exactly one calendar year', () => {
    expect(wholeYearLabel('2026-01-01', '2026-12-31')).toBe('2026');
    expect(wholeYearLabel('2024-01-01', '2024-12-31')).toBe('2024');
  });

  it('declines anything that is not a whole year', () => {
    expect(wholeYearLabel('2026-01-02', '2026-12-31')).toBeNull();
    expect(wholeYearLabel('2026-01-01', '2026-12-30')).toBeNull();
    expect(wholeYearLabel('2026-02-01', '2026-12-31')).toBeNull();
    expect(wholeYearLabel('2025-01-01', '2026-12-31')).toBeNull();
    expect(wholeYearLabel('2026-01-01', '')).toBeNull();
  });

  it('leaves a single month to wholeMonthLabel', () => {
    expect(wholeYearLabel('2026-07-01', '2026-07-31')).toBeNull();
    expect(wholeMonthLabel('2026-07-01', '2026-07-31')).toBe('July 2026');
  });
});

/**
 * The fallback for every span that is not one whole month. The chip read
 * "Custom dates", which told the reader nothing and sat directly above a tile
 * printing the real range.
 */
describe('dateRangeLabel', () => {
  it('names a multi-day range, with the year said once', () => {
    expect(dateRangeLabel('2026-01-01', '2026-08-31')).toBe('Jan 1 to Aug 31, 2026');
    expect(dateRangeLabel('2026-04-16', '2026-06-22')).toBe('Apr 16 to Jun 22, 2026');
  });

  it('names both years where the range crosses one', () => {
    expect(dateRangeLabel('2025-12-01', '2026-01-31')).toBe('Dec 1, 2025 to Jan 31, 2026');
  });

  it('names a single day once', () => {
    expect(dateRangeLabel('2026-04-16', '2026-04-16')).toBe('Apr 16, 2026');
  });

  it('names an open-ended range from the end it has', () => {
    expect(dateRangeLabel('2026-04-16', '')).toBe('From Apr 16, 2026');
    expect(dateRangeLabel('', '2026-04-16')).toBe('Through Apr 16, 2026');
  });

  it('declines a range with no readable date at all', () => {
    expect(dateRangeLabel('', '')).toBeNull();
    expect(dateRangeLabel('july', 'august')).toBeNull();
  });
});
