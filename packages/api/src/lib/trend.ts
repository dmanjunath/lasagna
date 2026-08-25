// Pure aggregation for the trend endpoint: rows arrive pre-bucketed by
// to_char(date, 'YYYY-MM' | 'YYYY') AND pre-netted per category, so one row is
// one category's net for one period. This zero-fills the requested window and
// sums income (income-category inflows) vs expenses (categories whose net is
// positive), skipping transfers.

export interface TrendRow {
  period: string;
  // The category's NET for this period (sum of its amounts), not a single
  // transaction: a refund cancels against its own category before it is
  // classified, which is what /spending-summary does for the same window.
  amount: string;
  // Taxonomy group type (income/expense/transfer). Null classifies as
  // expense (defensive coalesce; should not occur post-backfill).
  groupType?: string | null;
}

export interface TrendPeriod {
  period: string;
  income: number;
  expenses: number;
  net: number;
}

export function buildPeriods(
  rows: TrendRow[],
  opts: { granularity: "month" | "year"; limit: number | null; now: Date },
): TrendPeriod[] {
  const { granularity, limit, now } = opts;
  const keys: string[] = [];

  if (granularity === "month") {
    const n = limit ?? 6;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
  } else {
    const current = now.getFullYear();
    let first = limit != null
      ? current - limit + 1
      : Math.min(current, ...rows.map((r) => parseInt(r.period, 10)).filter((y) => !Number.isNaN(y)));
    for (let y = first; y <= current; y++) keys.push(String(y));
  }

  const map = new Map<string, { income: number; expenses: number }>(
    keys.map((k) => [k, { income: 0, expenses: 0 }]),
  );
  for (const row of rows) {
    const entry = map.get(row.period);
    if (!entry || row.groupType === "transfer") continue;
    const amount = parseFloat(row.amount || "0");
    // Income = income-category inflows only. A refund in an expense category is
    // NOT income; it has already cancelled against its own category upstream.
    // Spending = the categories whose net came out positive, so a category the
    // period refunded more than it spent counts as neither. Identical to the
    // /spending-summary route and computeSpendingTotal — keep all three in
    // lockstep, or the same month reads differently on two screens.
    if (row.groupType === "income") entry.income += Math.abs(amount);
    else if (amount > 0) entry.expenses += amount;
  }
  return keys.map((period) => {
    const e = map.get(period)!;
    return {
      period,
      income: Math.round(e.income * 100) / 100,
      expenses: Math.round(e.expenses * 100) / 100,
      net: Math.round((e.income - e.expenses) * 100) / 100,
    };
  });
}
