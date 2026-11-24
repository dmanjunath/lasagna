// A spending figure against its usual month (meaningful color, owner decision
// 2026-11-23), shared by the web and the app (the app imports it through @web).
// The usual is the category's median over the three complete months before,
// from /spending-summary on a one-month window.

/** No verdict before this day of a running month: a few days say nothing. */
export const PACE_FIRST_DAY = 7;
/** Within a tenth of the usual pace either way is just usual. */
export const PACE_BAND = 0.1;

/** Whether "YYYY-MM" is the month `now` is in. */
function isRunningMonth(key: string, now: Date): boolean {
  return key === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * "bad" when the spend runs more than a tenth ahead of its usual month,
 * prorated by the days gone in a running month, "good" when more than a tenth
 * under. Nothing for a year, before the 7th of a running month, or without a
 * usual (less than three months of history).
 */
export function paceVerdict(spent: number, usual: number | null | undefined, key: string, now: Date = new Date()): "good" | "bad" | null {
  if (!usual || usual <= 0 || key.length !== 7) return null;
  let fraction = 1;
  if (isRunningMonth(key, now)) {
    const day = now.getDate();
    if (day < PACE_FIRST_DAY) return null;
    fraction = day / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  }
  const expected = usual * fraction;
  if (spent > expected * (1 + PACE_BAND)) return "bad";
  if (spent < expected * (1 - PACE_BAND)) return "good";
  return null;
}
