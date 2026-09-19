import { describe, it, expect } from 'vitest';
import {
  EMPTY_SPEND_FILTER,
  isActive,
  spendFilterAllows,
  spendFilterFromQuery,
  spendFilterToSearchParams,
  type SpendFilter,
} from '../spending-filters';
import { filtersFromQuery } from '../../components/transactions/TransactionFilters';

/**
 * The spending scope is shareable, so the URL has to carry all of it and the
 * page has to read every part of it back. These hold the two halves on the same
 * parameter names, and hold the one name that crosses pages.
 */

// Category ids are uuids. Written out here because the parser now checks the
// shape, the way the transactions route does.
const CAT_A = '11111111-2222-4333-8444-555555555555';
const CAT_B = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('spendFilterFromQuery', () => {
  it('reads an include list', () => {
    const { filter } = spendFilterFromQuery(`?categories=${CAT_A},${CAT_B}`);
    expect(filter).toEqual({ include: [CAT_A, CAT_B], exclude: [] });
  });

  it('reads an exclude list', () => {
    const { filter } = spendFilterFromQuery(`?excludeCategories=${CAT_A},${CAT_B}`);
    expect(filter).toEqual({ include: [], exclude: [CAT_A, CAT_B] });
  });

  it('reads no scope at all from an empty query', () => {
    const { filter, period } = spendFilterFromQuery('');
    expect(filter).toEqual(EMPTY_SPEND_FILTER);
    expect(period).toBeNull();
    expect(isActive(filter)).toBe(false);
  });

  /**
   * The client and the server have to agree on what an id even is. The server
   * drops a non-uuid before it reaches Postgres, so a token this half kept
   * would filter the page down to nothing under a chip the server ignored —
   * a hero of $0 over an unfiltered 131 transactions.
   */
  it('drops a truncated id from include and from exclude', () => {
    const cut = CAT_A.slice(0, 28); // a line-wrapped shared link
    expect(spendFilterFromQuery(`?categories=${cut}`).filter).toEqual(EMPTY_SPEND_FILTER);
    expect(spendFilterFromQuery(`?excludeCategories=${cut}`).filter).toEqual(EMPTY_SPEND_FILTER);
  });

  it('drops a token that is obviously not an id', () => {
    const { filter } = spendFilterFromQuery('?categories=not-a-uuid');
    expect(filter).toEqual(EMPTY_SPEND_FILTER);
    expect(isActive(filter)).toBe(false);
  });

  it('keeps a well-formed id it cannot resolve, rather than rewriting a shared link', () => {
    const otherTenantsCategory = 'deadbeef-dead-4eef-8eef-deadbeefdead';
    const { filter } = spendFilterFromQuery(`?categories=${CAT_A},${otherTenantsCategory}`);
    expect(filter.include).toEqual([CAT_A, otherTenantsCategory]);
    expect(isActive(filter)).toBe(true);
  });

  it('keeps the valid ids of a mixed list, in order', () => {
    const { filter } = spendFilterFromQuery(`?categories=nope,${CAT_A},${CAT_B.slice(0, 20)},${CAT_B}`);
    expect(filter.include).toEqual([CAT_A, CAT_B]);
  });

  it('reads a month and a year period', () => {
    expect(spendFilterFromQuery('?period=2026-08').period).toBe('2026-08');
    expect(spendFilterFromQuery('?period=2026').period).toBe('2026');
  });

  it('ignores a period it cannot land on', () => {
    for (const bad of ['august', '2026-13', '2026-1', '20260-01', '']) {
      expect(spendFilterFromQuery(`?period=${bad}`).period).toBeNull();
    }
  });
});

describe('spendFilterToSearchParams', () => {
  it('round-trips an include scope and its period', () => {
    const filter: SpendFilter = { include: [CAT_A, CAT_B], exclude: [] };
    const query = spendFilterToSearchParams(filter, '2026-08');
    expect(query).toBe(`period=2026-08&categories=${CAT_A},${CAT_B}`);
    expect(spendFilterFromQuery(`?${query}`)).toEqual({ filter, period: '2026-08' });
  });

  it('round-trips an exclude scope and a year period', () => {
    const filter: SpendFilter = { include: [], exclude: [CAT_B] };
    const query = spendFilterToSearchParams(filter, '2026');
    expect(query).toBe(`period=2026&excludeCategories=${CAT_B}`);
    expect(spendFilterFromQuery(`?${query}`)).toEqual({ filter, period: '2026' });
  });

  it('omits an empty list and an absent period', () => {
    expect(spendFilterToSearchParams(EMPTY_SPEND_FILTER)).toBe('');
    expect(spendFilterToSearchParams(EMPTY_SPEND_FILTER, null)).toBe('');
  });
});

/**
 * The name that crosses pages. An include scope must hand to /transactions
 * verbatim — no translation step to drift.
 */
describe('the include list is the transactions page vocabulary', () => {
  it('hands its categories straight to filtersFromQuery', () => {
    const query = spendFilterToSearchParams({ include: ['a', 'b'], exclude: [] });
    expect(filtersFromQuery(`?${query}`).categories).toEqual(['a', 'b']);
  });

  it('never hands an exclude list over as an include list', () => {
    const query = spendFilterToSearchParams({ include: [], exclude: ['a', 'b'] });
    expect(filtersFromQuery(`?${query}`).categories).toEqual([]);
  });
});

describe('spendFilterAllows', () => {
  it('keeps only the named rows under an include list, uncategorized included', () => {
    const f: SpendFilter = { include: ['a'], exclude: [] };
    expect(spendFilterAllows('a', f)).toBe(true);
    expect(spendFilterAllows('b', f)).toBe(false);
    expect(spendFilterAllows(null, f)).toBe(false);
  });

  it('drops only the named rows under an exclude list, and keeps uncategorized', () => {
    const f: SpendFilter = { include: [], exclude: ['a'] };
    expect(spendFilterAllows('a', f)).toBe(false);
    expect(spendFilterAllows('b', f)).toBe(true);
    expect(spendFilterAllows(null, f)).toBe(true);
  });

  it('keeps everything when no scope is set', () => {
    expect(spendFilterAllows('a', EMPTY_SPEND_FILTER)).toBe(true);
    expect(spendFilterAllows(null, EMPTY_SPEND_FILTER)).toBe(true);
  });

  it('lets exclude win where a hand-edited URL carries both', () => {
    const f: SpendFilter = { include: ['a', 'b'], exclude: ['b'] };
    expect(spendFilterAllows('a', f)).toBe(true);
    expect(spendFilterAllows('b', f)).toBe(false);
    expect(spendFilterAllows('c', f)).toBe(false);
  });
});
