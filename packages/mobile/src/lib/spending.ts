// The Spending screen's logic, ported from packages/web/src/pages/spending.tsx
// (a React module, so it cannot be imported at runtime). The URL scope comes
// from @web/lib/spending-filters, which has no imports and is shared as is.
import { spendFilterAllows, spendFilterFromQuery, type SpendFilter } from "@web/lib/spending-filters";

export type Granularity = "month" | "year";

/** What the page shows: a month ("2026-11") or a year ("2026"). */
export type Period = { granularity: Granularity; year: number; month: number /* 0-11, unused for a year */ };

export interface SpendingCategory {
  /** Null for uncategorized ("Other"), which has no transactions to filter. */
  id: string | null;
  name: string;
  systemKey: string | null;
  groupId: string | null;
  groupName: string;
  groupType: "income" | "expense" | "transfer";
  total: number;
  count: number;
  percentage: number;
  /** The category's usual month (median of the three before, same filter), on a one-month window with enough history. */
  usual?: number | null;
}

export interface SpendingSummaryData {
  categories: SpendingCategory[];
  totalSpending: number;
  totalIncome: number;
  netCashFlow: number;
}

export interface TrendPeriod {
  period: string;
  income: number;
  expenses: number;
  net: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The current month, where the page opens (as the web and Home do). */
export function currentPeriod(now: Date = new Date(), granularity: Granularity = "month"): Period {
  return { granularity, year: now.getFullYear(), month: now.getMonth() };
}

/** The scope a link carries: ?period=YYYY-MM|YYYY&categories=…&excludeCategories=…. */
export function scopeFromQuery(query: string | undefined, now: Date = new Date()): { period: Period; filter: SpendFilter } {
  const { filter, period } = spendFilterFromQuery(query ?? "");
  if (period?.length === 4) return { filter, period: { granularity: "year", year: Number(period), month: 0 } };
  if (period?.length === 7) return { filter, period: { granularity: "month", year: Number(period.slice(0, 4)), month: Number(period.slice(5, 7)) - 1 } };
  return { filter, period: currentPeriod(now) };
}

/** "2026-11" or "2026": the key the trend uses. */
export function periodKey(p: Period): string {
  return p.granularity === "year" ? String(p.year) : `${p.year}-${pad2(p.month + 1)}`;
}

/** The window the summary is counted over, the same strings a drill hands to Transactions. */
export function periodRange(p: Period): { startDate: string; endDate: string } {
  if (p.granularity === "year") return { startDate: `${p.year}-01-01`, endDate: `${p.year}-12-31T23:59:59` };
  const last = new Date(p.year, p.month + 1, 0).getDate();
  return { startDate: `${p.year}-${pad2(p.month + 1)}-01`, endDate: `${p.year}-${pad2(p.month + 1)}-${pad2(last)}T23:59:59` };
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "November 2026" or "2026", for the stepper. */
export function periodTitle(p: Period): string {
  return p.granularity === "year" ? String(p.year) : `${MONTHS_LONG[p.month]} ${p.year}`;
}

/** "November" or "2026", inside a sentence. */
/** "Nov 2026" or "2026", for the compact stepper in the scope row. */
export function periodShort(p: Period): string {
  return p.granularity === "year" ? String(p.year) : `${MONTHS[p.month]} ${p.year}`;
}

export function periodName(p: Period): string {
  return p.granularity === "year" ? String(p.year) : MONTHS_LONG[p.month];
}

/** One step back or forward. Forward stops at the current period. */
export function stepPeriod(p: Period, dir: -1 | 1, now: Date = new Date()): Period {
  if (p.granularity === "year") return { ...p, year: Math.min(p.year + dir, now.getFullYear()) };
  const d = new Date(p.year, p.month + dir, 1);
  const next = { ...p, year: d.getFullYear(), month: d.getMonth() };
  return isAfterNow(next, now) ? p : next;
}

function isAfterNow(p: Period, now: Date): boolean {
  return p.granularity === "year" ? p.year > now.getFullYear() : p.year * 12 + p.month > now.getFullYear() * 12 + now.getMonth();
}

/** The period the calendar is inside: its figures are days so far, not a whole period. */
export function isCurrent(p: Period, now: Date = new Date()): boolean {
  return p.granularity === "year" ? p.year === now.getFullYear() : p.year === now.getFullYear() && p.month === now.getMonth();
}

/** A trend key ("2026-11" or "2026") is the running period. */
export function isCurrentKey(key: string, now: Date = new Date()): boolean {
  return key === (key.length === 4 ? String(now.getFullYear()) : `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
}

/**
 * Whether the stepper can go back or forward. `earliestYear` is the first year
 * with any money in or out: undefined while it loads (no floor yet), null when
 * there is none at all.
 */
export function stepBounds(p: Period, earliestYear: number | null | undefined, now: Date = new Date()): { canBack: boolean; canForward: boolean } {
  const canForward = !isCurrent(p, now);
  const floor = earliestYear === null ? true : earliestYear === undefined ? false : p.granularity === "month" ? p.year * 12 + p.month <= earliestYear * 12 : p.year <= earliestYear;
  return { canBack: !floor, canForward };
}

/** Switching granularity keeps the selection sensible: to a year, the year of the month in view. */
export function withGranularity(p: Period, g: Granularity, now: Date = new Date()): Period {
  if (g === p.granularity) return p;
  if (g === "year") return { granularity: "year", year: p.year, month: p.month };
  // Back to months: the month last in view, or this month if that is now in the future.
  const m = { granularity: "month" as const, year: p.year, month: p.month };
  return isAfterNow(m, now) ? currentPeriod(now) : m;
}

/** The first year with any income or spending, or null when there is none. */
export function earliestYearOf(periods: TrendPeriod[]): number | null {
  const years = periods.filter((p) => p.income || p.expenses).map((p) => Number(p.period));
  return years.length > 0 ? Math.min(...years) : null;
}

// ---------------------------------------------------------------------------
// The summary, under the category filter
// ---------------------------------------------------------------------------

export type Scoped = { expenses: SpendingCategory[]; income: SpendingCategory[]; spending: number; incomeTotal: number; net: number };

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * The summary's rows and totals under the filter. Unfiltered, the server's own
 * totals are used as they are. Filtered, the surviving rows are summed, which
 * reproduces the server's figures (it sums the same rows the same way).
 */
export function scopeSummary(s: SpendingSummaryData, f: SpendFilter): Scoped {
  const active = f.include.length > 0 || f.exclude.length > 0;
  const rows = active ? s.categories.filter((c) => spendFilterAllows(c.id, f)) : s.categories;
  const expenses = rows.filter((c) => c.groupType !== "income" && c.groupType !== "transfer");
  const income = rows.filter((c) => c.groupType === "income");
  if (!active) return { expenses, income, spending: s.totalSpending, incomeTotal: s.totalIncome, net: s.netCashFlow };
  const spending = cents(expenses.reduce((a, c) => a + c.total, 0));
  const incomeTotal = cents(income.reduce((a, c) => a + c.total, 0));
  return { expenses, income, spending, incomeTotal, net: cents(incomeTotal - spending) };
}

/** Percent of income kept, or null without income. */
export function savingsRate(income: number, spending: number): number | null {
  return income > 0 ? ((income - spending) / income) * 100 : null;
}

/**
 * The change against the period before, in words, or null when there is no
 * whole period to compare (the running one, or no baseline).
 */
export function changeLine(trend: TrendPeriod[], key: string, spending: number, granularity: Granularity, now: Date = new Date()): string | null {
  const unit = granularity === "month" ? "month" : "year";
  if (isCurrentKey(key, now)) return `So far this ${unit}`;
  const i = trend.findIndex((p) => p.period === key);
  const prior = i > 0 ? trend[i - 1] : null;
  if (!prior || prior.expenses === 0 || spending === 0) return null;
  const pct = Math.round(((spending - prior.expenses) / prior.expenses) * 100);
  if (pct === 0) return `About the same as last ${unit}`;
  return `${Math.abs(pct)}% ${pct > 0 ? "more" : "less"} than last ${unit}`;
}

// ---------------------------------------------------------------------------
// Breakdown rows: one per group, holding its categories
// ---------------------------------------------------------------------------

export interface BreakdownRow {
  /** Group id, or null for uncategorized. */
  key: string | null;
  label: string;
  total: number;
  /** The categories in the group, largest first. */
  children: Array<{ id: string | null; label: string; total: number; usual: number | null }>;
}

export type BreakdownSort = "amount:desc" | "amount:asc" | "label:asc" | "label:desc";

export const SORT_OPTIONS: Array<{ value: BreakdownSort; label: string }> = [
  { value: "amount:desc", label: "Largest" },
  { value: "amount:asc", label: "Smallest" },
  { value: "label:asc", label: "A to Z" },
  { value: "label:desc", label: "Z to A" },
];

/**
 * Categories rolled up by group, each group's children largest first, then
 * sorted. `byCategory` makes each category its own row (income, which sits in
 * one group, so a group row would only restate the Income total).
 */
export function breakdownRows(cats: SpendingCategory[], sort: BreakdownSort = "amount:desc", byCategory = false): BreakdownRow[] {
  const byGroup = new Map<string | null, BreakdownRow>();
  for (const c of cats) {
    const child = { id: c.id, label: c.name, total: Math.abs(c.total), usual: c.usual ?? null };
    if (byCategory) {
      byGroup.set(c.id, { key: c.id, label: c.name, total: child.total, children: [child] });
      continue;
    }
    const g = byGroup.get(c.groupId);
    if (g) {
      g.total += child.total;
      g.children.push(child);
    } else byGroup.set(c.groupId, { key: c.groupId, label: c.groupName || "Other", total: child.total, children: [child] });
  }
  const rows = [...byGroup.values()];
  for (const r of rows) r.children.sort((a, b) => b.total - a.total);
  const [key, dir] = sort.split(":") as ["amount" | "label", "asc" | "desc"];
  return rows.sort((a, b) => {
    const cmp = key === "label" ? a.label.localeCompare(b.label) : a.total - b.total;
    return dir === "asc" ? cmp : -cmp;
  });
}

/** Before this day of the running month, a pace says more about payday than about spending. */
export const PACE_FIRST_DAY = 7;
/** Within a tenth of the usual pace is no verdict: that is the usual. */
export const PACE_BAND = 0.1;

/**
 * A spending row against its usual (meaningful color, owner 2026-11-23):
 * "bad" (sauce) when it runs more than a tenth ahead of its usual month,
 * prorated by the days gone in the running month, "good" (basil) when more
 * than a tenth under. Nothing for a year, before the 7th, or without a usual
 * (less than three months of history).
 */
export function paceVerdict(spent: number, usual: number | null | undefined, key: string, now: Date = new Date()): "good" | "bad" | null {
  if (!usual || usual <= 0 || key.length !== 7) return null;
  let fraction = 1;
  if (isCurrentKey(key, now)) {
    const day = now.getDate();
    if (day < PACE_FIRST_DAY) return null;
    fraction = day / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  }
  const expected = usual * fraction;
  if (spent > expected * (1 + PACE_BAND)) return "bad";
  if (spent < expected * (1 - PACE_BAND)) return "good";
  return null;
}

/** A row's pace: its categories that have a usual, spent against the sum of their usuals. */
export function rowPace(row: BreakdownRow, key: string, now: Date = new Date()): "good" | "bad" | null {
  const known = row.children.filter((c) => c.usual !== null && c.usual > 0);
  if (known.length === 0) return null;
  return paceVerdict(
    known.reduce((s, c) => s + c.total, 0),
    known.reduce((s, c) => s + (c.usual ?? 0), 0),
    key,
    now,
  );
}

/** The category ids a row stands for (none for uncategorized). */
export function rowIds(row: BreakdownRow): string[] {
  return row.children.map((c) => c.id).filter((id): id is string => id !== null);
}

// ---------------------------------------------------------------------------
// The cash flow chart
// ---------------------------------------------------------------------------

/** How many months the trend must reach back to include January of `year`. */
export function monthsBackTo(year: number, now: Date = new Date()): number {
  return Math.max(1, (now.getFullYear() - year) * 12 + now.getMonth() + 1);
}

/** "Nov", "Jan ’26" on January, or "2026". */
export function columnLabel(key: string, withYear: boolean): string {
  if (key.length === 4) return key;
  const short = MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
  return withYear ? `${short} ’${key.slice(2, 4)}` : short;
}

/** "November 2026" or "2026", for a column's spoken label. */
export function columnTitle(key: string): string {
  return key.length === 4 ? key : `${MONTHS_LONG[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

function niceStep(max: number, count: number): number {
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/**
 * The chart's domain and gridlines: income up, spending down, one shared zero.
 * The domain is fit over every period so scrolling never rescales. Ticks are
 * mirrored across zero and signed below it.
 */
export function chartScale(periods: TrendPeriod[]): { top: number; bottom: number; ticks: number[] } {
  const up = Math.max(0, ...periods.map((p) => p.income));
  const down = Math.max(0, ...periods.map((p) => p.expenses));
  const mag = Math.max(up, down);
  if (mag <= 0) return { top: 1, bottom: -1, ticks: [0] };
  const top = (up || mag * 0.05) * 1.08;
  const bottom = -(down || mag * 0.05) * 1.08;
  const step = niceStep(mag * 1.08, 2);
  const ticks = new Set<number>([0]);
  for (let v = step; v <= mag * 1.08; v += step) {
    if (v <= top) ticks.add(v);
    if (-v >= bottom) ticks.add(-v);
  }
  return { top, bottom, ticks: [...ticks].sort((a, b) => a - b) };
}

/** "$5K", "−$2.5K", "$1.2M": a gridline's label. */
export function shortMoney(v: number): string {
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const fmt = (n: number) => String(Number(n.toFixed(1)));
  if (a >= 1_000_000) return `${sign}$${fmt(a / 1_000_000)}M`;
  if (a >= 1000) return `${sign}$${fmt(a / 1000)}K`;
  return `${sign}$${Math.round(a)}`;
}
