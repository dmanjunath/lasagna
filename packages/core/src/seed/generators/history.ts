/**
 * Balance history for a seeded account.
 *
 * The net worth card offers 1M, 6M, 1Y and All. Thirty days of history, which
 * is what this used to generate, leaves every range but 1M drawing a flat line
 * from a single point, so most of the control does nothing.
 *
 * Daily for the last month, weekly for the year before it: enough resolution
 * where the chart is read closely, without a row per account per day for a year.
 */
export interface HistoryPoint {
  snapshotAt: Date;
  balance: number;
}

const DAILY_DAYS = 30;
const WEEKLY_WEEKS = 52;

/**
 * @param balance     Today's balance. Earlier points are derived from it.
 * @param annualDrift Fraction the balance changes per year, signed as the
 *                    account behaves: +0.08 for something that grew 8% over the
 *                    year (so a year ago it was lower), negative for a loan
 *                    being paid down (so a year ago it was higher).
 * @param jitter      Day-to-day noise, as a fraction of the balance.
 */
export function balanceHistory(
  now: Date,
  balance: number,
  annualDrift: number,
  jitter: number,
): HistoryPoint[] {
  const points: HistoryPoint[] = [];

  const at = (daysAgo: number): HistoryPoint => {
    const snapshotAt = new Date(now);
    snapshotAt.setDate(snapshotAt.getDate() - daysAgo);
    const yearsAgo = daysAgo / 365;
    // Undo the drift to walk backwards from today's balance.
    const drifted = balance / (1 + annualDrift * yearsAgo);
    const noise = 1 + (Math.random() * 2 - 1) * jitter;
    return { snapshotAt, balance: drifted * noise };
  };

  for (let w = WEEKLY_WEEKS; w >= 1; w--) {
    const daysAgo = w * 7 + DAILY_DAYS;
    points.push(at(daysAgo));
  }
  for (let d = DAILY_DAYS; d >= 0; d--) {
    points.push(at(d));
  }

  return points;
}
