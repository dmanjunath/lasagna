/**
 * The pure arithmetic behind every savings figure the app prints.
 *
 * Kept out of the components so the one rule that is easy to get subtly wrong —
 * how a summary is rounded against the rows it sits over — can be tested
 * without a DOM.
 */

/**
 * A figure and the period it covers.
 *
 * The period is load-bearing and never inferred: money back ONCE is printed
 * "once" and summed apart from everything else. A $2,900 bank fee divided
 * across an eight month window read "$363 a month" and carried $363 into a
 * headline that said the same.
 */
export interface ActionAmount {
  value: number;
  period: 'monthly' | 'once';
}

/** Anything carrying one of those figures, or carrying none. */
export interface HasAmount {
  amount: ActionAmount | null;
}

/** Whole dollars. Cents on a projected saving claim a precision it lacks. */
export function wholeMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * One row's figure as the row PRINTS it: whole dollars, cents dropped.
 *
 * A sum of estimates carried to the cent claims a precision the estimates do
 * not have, which is what the word "about" on every summary figure covers.
 */
export function displayedSaving(row: HasAmount): number {
  return Math.round(row.amount?.value ?? 0);
}

/**
 * The words on a row's figure pill, rounded by `displayedSaving` so the pill
 * and the summary above it can never disagree about the same row.
 */
export function amountLabel(amount: ActionAmount): string {
  const period = amount.period === 'once' ? 'once' : 'a month';
  return `about ${wholeMoney(Math.round(amount.value))} ${period}`;
}

/** Whether this row's figure is money back once rather than money back monthly. */
export function isOneTime(row: HasAmount): boolean {
  return row.amount?.period === 'once';
}

/**
 * Rows whose figure is per month, and rows whose figure is a one-off.
 *
 * Both drop a row with no figure at all, because such a row contributes nothing
 * to either total and must not be counted into one by being on the wrong side
 * of a `!isOneTime` test.
 */
export function monthlyCuts<T extends HasAmount>(rows: T[]): T[] {
  return rows.filter((r) => r.amount?.period === 'monthly');
}

export function oneTimeCuts<T extends HasAmount>(rows: T[]): T[] {
  return rows.filter((r) => r.amount?.period === 'once');
}

/**
 * A summary figure: the sum of the rows printed beneath it, as printed.
 *
 * THE rule for every summary, so that a reader adding the row pills up lands
 * exactly on the sentence above them.
 *
 * Rounding each level independently from the exact server totals is what broke
 * this: a real set of {41.49 all, 23.50 S, 17.99 M} printed a $40 headline over
 * a $25 subtotal and an $18 row (43), and the $25 subtotal itself sat above rows
 * of $21 and $3 (24). "About" covers dropped cents. It cannot cover arithmetic
 * that does not work.
 *
 * Hand it ONE period's rows: `monthlyCuts` or `oneTimeCuts`, never both. The two
 * are summed separately and printed as two figures, or the total would be
 * dollars per month added to dollars.
 */
export function displayedTotal(rows: HasAmount[]): number {
  return rows.reduce((sum, r) => sum + displayedSaving(r), 0);
}
