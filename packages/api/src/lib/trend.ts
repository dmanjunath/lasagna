// Pure aggregation for the trend endpoint: rows arrive pre-bucketed by
// to_char(date, 'YYYY-MM' | 'YYYY'); this zero-fills the requested window
// and sums income (amount < 0) vs expenses (> 0), skipping transfers.

export interface TrendRow {
  period: string;
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
    if (amount < 0) entry.income += Math.abs(amount);
    else entry.expenses += amount;
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
