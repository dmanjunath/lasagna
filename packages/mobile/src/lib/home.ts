import type { AccountFacts } from "@web/lib/api";
import { HIDDEN_AMOUNT, isAmountsHidden } from "./hide-amounts";
import { transactionsHref } from "./txn-filters";

// Pure rules behind the home screen, ported from packages/web/src/pages/simple-home.tsx.

export function greetingForHour(h: number): string {
  if (h < 5) return "Good evening"; // overnight reads as late night, not morning
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function firstNameOf(
  user: { name: string | null; email: string } | null,
  tenant: { name: string } | null,
): string {
  return user?.name?.split(" ")[0] || tenant?.name?.split(" ")[0] || user?.email?.split("@")[0] || "there";
}

/** Whole dollars by default, masked when amounts are hidden. */
export function fmtUsd(n: number, frac = 0): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: frac, minimumFractionDigits: frac });
}

/** "$1.2K", "$15K", "$2.5M". */
export function formatMoneyShort(n: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

// ── Page state and the net worth composition ────────────────────────────────

/** Exactly one renders. A failed facts call is not "nothing connected". */
export function homeState(facts: AccountFacts | undefined, failed: boolean): "loading" | "failed" | "empty" | "dashboard" {
  if (failed) return "failed";
  if (!facts) return "loading";
  return facts.accountsConnected === 0 ? "empty" : "dashboard";
}

export interface NetBreakdown {
  cash: number;
  cashCount: number;
  investments: number;
  investmentsCount: number;
  /** real_estate + alternative. */
  assets: number;
  assetsCount: number;
  realEstateValue: number;
  alternativeValue: number;
  debts: number;
  debtsCount: number;
  creditCards: number;
  creditCardsCount: number;
  loans: number;
  loansCount: number;
  assetTotal: number;
  netWorth: number;
}

export function breakdownFrom({ netWorth: n }: AccountFacts): NetBreakdown {
  const t = n.byType;
  return {
    cash: t.cash.total,
    cashCount: t.cash.count,
    investments: t.investments.total,
    investmentsCount: t.investments.count,
    assets: t.realEstate.total + t.alternative.total,
    assetsCount: t.realEstate.count + t.alternative.count,
    realEstateValue: t.realEstate.total,
    alternativeValue: t.alternative.total,
    debts: n.debt,
    debtsCount: t.creditCards.count + t.loans.count,
    creditCards: t.creditCards.total,
    creditCardsCount: t.creditCards.count,
    loans: t.loans.total,
    loansCount: t.loans.count,
    assetTotal: n.assets,
    netWorth: n.netWorth,
  };
}

/** "Property" for only real estate, "Alternatives" for only alts, "Other assets" for both. */
export function assetsLabel(b: NetBreakdown): string {
  if (b.realEstateValue > 0 && b.alternativeValue > 0) return "Other assets";
  if (b.realEstateValue > 0) return "Property";
  return "Alternatives";
}

export function hasComposition(b: NetBreakdown): boolean {
  return b.cash > 0 || b.investments > 0 || b.assets > 0 || b.debts > 0;
}

export type CompSegment = { key: string; label: string; value: number; count: number };

export function assetSegments(b: NetBreakdown): CompSegment[] {
  return [
    b.cash > 0 && { key: "cash", label: "Cash", value: b.cash, count: b.cashCount },
    b.investments > 0 && { key: "inv", label: "Investments", value: b.investments, count: b.investmentsCount },
    b.assets > 0 && { key: "prop", label: assetsLabel(b), value: b.assets, count: b.assetsCount },
  ].filter(Boolean) as CompSegment[];
}

export function debtSegments(b: NetBreakdown): CompSegment[] {
  return [
    b.creditCards > 0 && { key: "cc", label: "Credit cards", value: b.creditCards, count: b.creditCardsCount },
    b.loans > 0 && { key: "loans", label: "Loans", value: b.loans, count: b.loansCount },
  ].filter(Boolean) as CompSegment[];
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ── This month ──────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * The two windows the spending card compares: this month to date, and the same
 * point last month (the day clamped for short months).
 */
export function monthWindows(now: Date) {
  const monthStart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0);
  const prevStart = `${prevMonthLastDay.getFullYear()}-${pad2(prevMonthLastDay.getMonth() + 1)}-01`;
  const prevSameDay = new Date(
    prevMonthLastDay.getFullYear(),
    prevMonthLastDay.getMonth(),
    Math.min(now.getDate(), prevMonthLastDay.getDate()),
  );
  return {
    current: { startDate: monthStart, endDate: `${ymd(now)}T23:59:59` },
    previous: { startDate: prevStart, endDate: `${ymd(prevSameDay)}T23:59:59` },
  };
}

/** This month, as /spending?period= names it. */
export function thisMonthPeriod(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/** This month to date for one category, the window the spending card counted over. */
export function thisMonthTransactionsHref(categoryId: string, now: Date): string {
  const ym = thisMonthPeriod(now);
  return transactionsHref({ startDate: `${ym}-01`, endDate: `${ym}-${pad2(now.getDate())}`, categories: [categoryId] });
}

export interface SpendingSummary {
  categories: Array<{ id: string; name: string; groupType: "income" | "expense" | "transfer"; total: number }>;
  totalSpending: number;
  totalIncome: number;
  netCashFlow: number;
}

export interface MonthFlow {
  spending: number;
  income: number;
  net: number;
  /** Spend through the same day of the previous month. */
  prevSpending: number | null;
  topCats: { id: string; name: string; total: number; pct: number }[];
}

export function monthFlowFrom(cur: SpendingSummary, prev: SpendingSummary | null): MonthFlow {
  const topCats = cur.categories
    .filter((c) => c.groupType === "expense" && c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3)
    .map((c) => ({ id: c.id, name: c.name, total: c.total, pct: cur.totalSpending > 0 ? (c.total / cur.totalSpending) * 100 : 0 }));
  return {
    spending: cur.totalSpending,
    income: cur.totalIncome,
    net: cur.netCashFlow,
    prevSpending: prev ? prev.totalSpending : null,
    topCats,
  };
}

/** Percent change against the same point last month, or null when there is no baseline. */
export function pctVsPrev(flow: MonthFlow): number | null {
  return flow.prevSpending != null && flow.prevSpending > 0 ? ((flow.spending - flow.prevSpending) / flow.prevSpending) * 100 : null;
}

// ── Upcoming bill ───────────────────────────────────────────────────────────

const BIG_CATEGORIES = new Set(["housing", "debt_payment", "transportation", "insurance", "utilities"]);
const BILL_MIN_AMOUNT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Bill {
  id: string;
  name: string;
  amount: number;
  dueDate: Date;
  daysAway: number;
  accountId: string | null;
}

/** The soonest big bill due from yesterday to a week out, or null. */
export function upcomingBill(
  recurring: Array<{ id: string; name: string; amount: string; category: string | null; nextDueDate: string | null; accountId: string | null }>,
  now: Date,
): Bill | null {
  const t = now.getTime();
  const next = recurring
    .filter((r) => r.nextDueDate && r.category && BIG_CATEGORIES.has(r.category))
    .map((r) => ({ id: r.id, name: r.name, amount: parseFloat(r.amount), dueDate: new Date(r.nextDueDate!), accountId: r.accountId }))
    .filter((r) => r.amount >= BILL_MIN_AMOUNT)
    .filter((r) => {
      const ms = r.dueDate.getTime() - t;
      return ms >= -DAY_MS && ms <= 7 * DAY_MS;
    })
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  return next ? { ...next, daysAway: calendarDaysBetween(now, next.dueDate) } : null;
}

/** Whole calendar days from `a`'s day to `b`'s, in local time: yesterday is -1 at any hour (M-14). */
function calendarDaysBetween(a: Date, b: Date): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(b) - day(a)) / DAY_MS);
}

/** "Due today", "Due tomorrow", "Due in 4 days", and "Was due yesterday" for one already past. */
export function billWhen(daysAway: number): string {
  if (daysAway < 0) return daysAway === -1 ? "Was due yesterday" : `Was due ${-daysAway} days ago`;
  return daysAway === 0 ? "Due today" : daysAway === 1 ? "Due tomorrow" : `Due in ${daysAway} days`;
}

/** A balance row's signed value, as the web home reads it. */
export function balanceValue(b: { effectiveBalance: number | null; invertBalance: boolean; balance: string | null }): number {
  const v = b.effectiveBalance ?? (b.invertBalance ? -1 : 1) * parseFloat(b.balance ?? "0");
  return Number.isNaN(v) ? 0 : v;
}

// ── Goals ───────────────────────────────────────────────────────────────────

export type GoalAccent = "brand" | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Index into the viz palette (0-based), or "brand". Mirrors goalAccent in goal-shared.tsx. */
export function goalAccent(category: string, name = ""): GoalAccent {
  const c = `${category ?? ""} ${name}`.toLowerCase();
  if (c.includes("emergency") || c.includes("safety")) return "brand";
  if (c.includes("home") || c.includes("house") || c.includes("down_payment")) return 1;
  if (c.includes("retire")) return 0;
  if (c.includes("educat") || c.includes("529")) return 5;
  if (c.includes("travel") || c.includes("vacation") || c.includes("relocation")) return 4;
  if (c.includes("car") || c.includes("vehicle") || c.includes("transport")) return 2;
  if (c.includes("wedding") || c.includes("life")) return 3;
  if (c.includes("debt")) return 6;
  if (c.includes("repair") || c.includes("major")) return 2;
  if (category === "savings") return 7;
  return 1;
}

export function goalProgress(g: { targetAmount: string; currentAmount: string }) {
  const target = parseFloat(g.targetAmount);
  const current = parseFloat(g.currentAmount);
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
  const reached = target > 0 && current >= target;
  const notStarted = current <= 0;
  return { target, current, pct, reached, notStarted };
}

// ── Onboarding resume ───────────────────────────────────────────────────────

const STAGE_STEP: Record<string, number> = { profile: 0, income: 1, lifestyle: 2, accounts: 3, complete: 3 };
const SCREENS = 4;

/** Null unless the user chose "Finish later" and has not finished since. */
export function onboardingResume(user: { onboardingDeferred?: boolean; onboardingStage: string | null } | null) {
  if (!user?.onboardingDeferred || user.onboardingStage === null) return null;
  const index = STAGE_STEP[user.onboardingStage] ?? 0;
  return { pct: Math.round(((index + 1) / SCREENS) * 100), step: index + 1 };
}
