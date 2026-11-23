/**
 * How a transaction row reads (meaningful color, owner 2026-11-23): money
 * back (income, a refund) is basil, a pending row is muted until it posts,
 * and an excluded row fades as a whole because it counts toward nothing.
 * Hidden amounts show no direction.
 */
export function txnRowTone(row: { amount: string; pending?: number | boolean | null; excludedAt?: string | null }, hidden: boolean) {
  const moneyBack = parseFloat(row.amount) < 0;
  const pending = !!row.pending;
  return {
    text: pending ? ("secondary" as const) : ("content" as const),
    amount: moneyBack && !hidden ? ("positive" as const) : pending ? ("secondary" as const) : ("content" as const),
    faded: !!row.excludedAt,
  };
}
