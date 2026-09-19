import { describe, expect, it } from 'vitest';
import { formatTxnDay, txnDayKey } from '../utils';

/**
 * A stored transaction date is a calendar day held as midnight UTC, so it must
 * print as that day wherever the reader is. Read in the host's own zone it
 * printed the day before west of UTC, which put "Apr 15" in the drill
 * destination under a receipt reading "on Apr 16, 2026".
 *
 * Run under `TZ=America/Los_Angeles` (behind UTC) and `TZ=Asia/Tokyo` (ahead)
 * to cover both directions.
 */
describe('a stored transaction date names one day in every zone', () => {
  const MIDNIGHT_UTC = '2026-04-16T00:00:00.000Z';

  it('prints the stored day, not the host zone day', () => {
    expect(formatTxnDay(MIDNIGHT_UTC)).toBe('Apr 16');
    expect(formatTxnDay(MIDNIGHT_UTC, { year: 'numeric' })).toBe('Apr 16, 2026');
  });

  it('keys the stored day, so a heading groups what it labels', () => {
    expect(txnDayKey(MIDNIGHT_UTC)).toBe('2026-04-16');
  });

  it('holds across a year boundary, where a day slip changes the year too', () => {
    expect(formatTxnDay('2026-01-01T00:00:00.000Z', { year: 'numeric' })).toBe('Jan 1, 2026');
    expect(txnDayKey('2026-01-01T00:00:00.000Z')).toBe('2026-01-01');
  });

  it('returns an unparseable value untouched rather than "Invalid Date"', () => {
    expect(formatTxnDay('not a date')).toBe('not a date');
    expect(txnDayKey('not a date')).toBe('not a date');
  });
});
