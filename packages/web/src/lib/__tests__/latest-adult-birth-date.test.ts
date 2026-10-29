import { describe, it, expect } from 'vitest';
import { latestAdultBirthDate } from '../utils';

describe('latestAdultBirthDate', () => {
  it('is the same day 18 years back', () => {
    expect(latestAdultBirthDate(new Date(2026, 9, 29))).toBe('2008-10-29');
  });
  it('falls back to Feb 28 when that year has no Feb 29', () => {
    expect(latestAdultBirthDate(new Date(2028, 1, 29))).toBe('2010-02-28');
  });
  it('keeps a Feb 29 birthday under 18 until Mar 1', () => {
    expect('2008-02-29' <= latestAdultBirthDate(new Date(2026, 1, 28))).toBe(false);
    expect('2008-02-29' <= latestAdultBirthDate(new Date(2026, 2, 1))).toBe(true);
  });
});
