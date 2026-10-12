/**
 * How long an action stays on the list without being found again.
 *
 * One definition for both producers. Each run that finds an action still
 * holds moves its expiry this far out again, so a relevant action stays and
 * one nothing has re-confirmed for this long drops off on its own.
 */
export const ACTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function actionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + ACTION_TTL_MS);
}
