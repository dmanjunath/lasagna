import { describe, expect, it, vi } from 'vitest';
import { formatStoredDay, formatStoredMonth, localDayKey, storedDayKey } from '../utils';

/**
 * A stored date is a calendar day held as midnight UTC, so it must print as
 * that day wherever the reader is. Read in the host's own zone it printed the
 * day before west of UTC, which put "Apr 15" in the drill destination under a
 * receipt reading "on Apr 16, 2026", and dropped a row dated the 1st into the
 * previous month's total.
 *
 * Run under `TZ=America/Los_Angeles` (behind UTC) and `TZ=Asia/Tokyo` (ahead)
 * to cover both directions.
 */
describe('a stored date names one day in every zone', () => {
  const MIDNIGHT_UTC = '2026-04-16T00:00:00.000Z';

  it('prints the stored day, not the host zone day', () => {
    expect(formatStoredDay(MIDNIGHT_UTC)).toBe('Apr 16');
    expect(formatStoredDay(MIDNIGHT_UTC, { year: 'numeric' })).toBe('Apr 16, 2026');
  });

  it('keys the stored day, so a heading groups what it labels', () => {
    expect(storedDayKey(MIDNIGHT_UTC)).toBe('2026-04-16');
  });

  it('holds across a year boundary, where a day slip changes the year too', () => {
    expect(formatStoredDay('2026-01-01T00:00:00.000Z', { year: 'numeric' })).toBe('Jan 1, 2026');
    expect(storedDayKey('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
  });

  it('reads a bare calendar date the same way', () => {
    expect(formatStoredDay('2026-04-16')).toBe('Apr 16');
    expect(storedDayKey('2026-04-16')).toBe('2026-04-16');
    expect(formatStoredMonth('2026-04-01')).toBe('Apr 2026');
  });

  it('names the month a day on the boundary belongs to', () => {
    expect(formatStoredMonth('2026-04-01T00:00:00.000Z')).toBe('Apr 2026');
    expect(formatStoredMonth('2026-04-30T00:00:00.000Z')).toBe('Apr 2026');
    expect(formatStoredMonth('2026-01-01T00:00:00.000Z')).toBe('Jan 2026');
    expect(formatStoredMonth('2026-04-01T00:00:00.000Z', { month: 'long' })).toBe('April 2026');
  });

  it('ignores a caller trying to hand it another zone', () => {
    expect(formatStoredDay(MIDNIGHT_UTC, { timeZone: 'America/Los_Angeles' })).toBe('Apr 16');
    expect(formatStoredMonth('2026-04-01T00:00:00.000Z', { timeZone: 'Asia/Tokyo' })).toBe(
      'Apr 2026',
    );
  });

  it('returns an unparseable value untouched rather than "Invalid Date"', () => {
    expect(formatStoredDay('not a date')).toBe('not a date');
    expect(formatStoredMonth('not a date')).toBe('not a date');
    expect(storedDayKey('not a date')).toBe('not a date');
  });
});

/**
 * The opposite direction. `/accounts/:id/history` returns raw balance
 * snapshots, so `snapshotAt` is the MOMENT the balance was read, not a bucketed
 * day. The account chart keys each one to the viewer's own day before printing
 * it, otherwise a balance that landed at 8am in Tokyo renders under the
 * previous date, and one recorded at 11pm in Los Angeles renders under the next.
 *
 * Node re-reads the `TZ` env var when it is assigned, so each case here states
 * an absolute answer instead of one that depends on where the suite is run.
 */
describe('an instant is keyed to the day the viewer was on', () => {
  const inZone = <T,>(tz: string, fn: () => T): T => {
    vi.stubEnv('TZ', tz);
    try {
      return fn();
    } finally {
      vi.unstubAllEnvs();
    }
  };

  // 11:00pm on Apr 13 in Los Angeles, already Apr 14 in UTC.
  const LATE_EVENING = '2026-04-14T06:00:00.000Z';
  // 8:00am on Sep 19 in Tokyo, still Sep 18 in UTC.
  const EARLY_MORNING = '2026-09-18T23:00:01.678Z';

  it('keeps a late-evening moment on the evening it happened, west of UTC', () => {
    expect(inZone('America/Los_Angeles', () => localDayKey(LATE_EVENING))).toBe('2026-04-13');
    expect(storedDayKey(LATE_EVENING)).toBe('2026-04-14');
  });

  it('moves an early-morning moment onto the day it happened, east of UTC', () => {
    expect(inZone('Asia/Tokyo', () => localDayKey(EARLY_MORNING))).toBe('2026-09-19');
    expect(storedDayKey(EARLY_MORNING)).toBe('2026-09-18');
  });

  it('pads a single-digit month and day, so the key stays sortable', () => {
    expect(inZone('UTC', () => localDayKey('2026-01-02T12:00:00.000Z'))).toBe('2026-01-02');
  });

  it('matches the stored key when the viewer sits on UTC', () => {
    expect(inZone('UTC', () => localDayKey(EARLY_MORNING))).toBe(storedDayKey(EARLY_MORNING));
  });

  it('names a day the stored helpers can then print, in any zone', () => {
    const key = inZone('Asia/Tokyo', () => localDayKey(EARLY_MORNING));
    expect(formatStoredDay(key, { year: 'numeric' })).toBe('Sep 19, 2026');
  });

  it('returns an unparseable value untouched rather than "Invalid Date"', () => {
    expect(localDayKey('not a date')).toBe('not a date');
  });
});
