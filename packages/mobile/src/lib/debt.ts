import { compareStrategies, simulatePayoff, type PayoffResult, type PayoffStrategy, type StrategyComparison } from "@lasagna/core/debt-payoff";
import { accountTypeLabel } from "@web/lib/account-types";
import { formatMoney, formatStoredMonth } from "./format";

// The Debt page's rules, ported from packages/web/src/pages/debt.tsx: the
// /accounts/debts rows as the page reads them, the payoff plan built on the
// shared payoff math (@lasagna/core/debt-payoff), and each line's words.

export type PlanRole = "payoff" | "clears-monthly" | "needs-rate";

export interface ApiDebt {
  id: string;
  name: string;
  mask?: string | null;
  type: string;
  subtype: string | null;
  property: { id: string; name: string } | null;
  balance: number;
  interestRate: number | null;
  minimumPayment: number;
  payoffDate: string | null;
  planRole?: PlanRole;
  paidInFull?: boolean;
  paidInFullMonthly: boolean;
  liabilitySource: "plaid" | "manual" | null;
}

export interface DebtsResponse {
  debts: ApiDebt[];
  totalDebt: number;
  debtOnPayoffPlan?: { amount: number; notInPlan: { amount: number; count: number } };
  monthlyInterest: number;
  /** The journey's extra above the minimum on its current debt. Null: none. */
  suggestedExtra?: number | null;
}

export interface DebtAccount {
  id: string;
  name: string;
  mask: string | null;
  balance: number;
  type: string;
  subtype: string | null;
  property: { id: string; name: string } | null;
  apr: number;
  /** No rate on file, so `apr` is a stand-in. Everything built on it says so. */
  aprAssumed: boolean;
  minPayment: number;
  /** What the old fixed plan put on top of the minimum. Only seeds the extra field. */
  suggestedExtra: number;
  payoffDate: string | null;
  planRole: PlanRole;
  paidInFullMonthly: boolean;
  liabilitySource: "plaid" | "manual" | null;
}

export interface DebtPage {
  /** On the payoff plan, highest rate first. */
  payoff: DebtAccount[];
  clears: DebtAccount[];
  needsRate: DebtAccount[];
  debtOnPlan: number;
  notInPlan: { amount: number; count: number };
  /** The journey's extra, or null when the journey has no debt step. */
  journeyExtra: number | null;
}

/** The response as the page reads it: stand-in rates, the three roles, and the server's split of the total. */
export function toDebtPage(res: DebtsResponse): DebtPage {
  const mapped: DebtAccount[] = res.debts.map((d) => {
    const isMortgage = d.subtype === "mortgage" || d.name?.toLowerCase().includes("mortgage");
    const planRole: PlanRole = d.planRole ?? (d.paidInFull ? "clears-monthly" : "payoff");
    // A card with no rate and no payment history gets no stand-in: it sits outside the payoff math.
    const apr = planRole === "needs-rate" ? 0 : (d.interestRate ?? (d.type === "credit" ? 21.99 : isMortgage ? 6.5 : 8.0));
    const isHighInterest = apr >= 7 && !isMortgage;
    return {
      id: d.id,
      name: d.name,
      mask: d.mask ?? null,
      balance: d.balance,
      type: d.type,
      subtype: d.subtype ?? null,
      property: d.property ?? null,
      apr: Math.round(apr * 100) / 100,
      aprAssumed: planRole !== "needs-rate" && d.interestRate == null,
      minPayment: d.minimumPayment,
      suggestedExtra: isHighInterest ? Math.round(d.minimumPayment * 1.8) - d.minimumPayment : 0,
      payoffDate: d.payoffDate ?? null,
      planRole,
      paidInFullMonthly: d.paidInFullMonthly,
      liabilitySource: d.liabilitySource ?? null,
    };
  });
  mapped.sort((a, b) => b.apr - a.apr);
  const payoff = mapped.filter((d) => d.planRole === "payoff");
  const off = mapped.filter((d) => d.planRole !== "payoff");
  return {
    payoff,
    clears: mapped.filter((d) => d.planRole === "clears-monthly"),
    needsRate: mapped.filter((d) => d.planRole === "needs-rate"),
    // The server's split, so this page and chat state the same figures. An older API sends none.
    debtOnPlan: res.debtOnPayoffPlan ? res.debtOnPayoffPlan.amount : payoff.reduce((s, d) => s + d.balance, 0),
    notInPlan: res.debtOnPayoffPlan ? res.debtOnPayoffPlan.notInPlan : { amount: off.reduce((s, d) => s + d.balance, 0), count: off.length },
    journeyExtra: "suggestedExtra" in res ? (res.suggestedExtra ?? null) : null,
  };
}

/** "Credit Card ••5087". */
export const debtName = (d: Pick<DebtAccount, "name" | "mask">) => `${d.name}${d.mask ? ` ••${d.mask}` : ""}`;

/** The month a count of months from now lands in ("Feb 2027"), or "Never". */
export function addMonths(months: number, now: Date = new Date()): string {
  if (!Number.isFinite(months)) return "Never";
  const d = new Date(now.getFullYear(), now.getMonth() + months, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** "4 years 2 months", "11 months". */
export function formatDuration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts: string[] = [];
  if (y > 0) parts.push(`${y} year${y === 1 ? "" : "s"}`);
  if (m > 0) parts.push(`${m} month${m === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** The extra-payment field as a number. Empty, invalid or negative is none. */
export function parseExtra(text: string): number {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : 0;
}

export function extraInvalid(text: string): boolean {
  return text.trim() !== "" && !(Number(text.replace(/[$,\s]/g, "")) >= 0);
}

/** Balance-weighted APR, to one decimal. */
export function blendedApr(debts: Pick<DebtAccount, "apr" | "balance">[]): number {
  const total = debts.reduce((s, d) => s + d.balance, 0);
  if (total === 0) return 0;
  return Math.round((debts.reduce((s, d) => s + d.apr * d.balance, 0) / total) * 10) / 10;
}

/** The debt's kind from the shared catalog. A loan with nothing on file is just "Loan". */
export function debtTypeLabel(d: Pick<DebtAccount, "type" | "subtype" | "name">): string {
  if (d.type === "credit") return accountTypeLabel("credit", d.subtype);
  if (d.subtype) return accountTypeLabel(d.type, d.subtype);
  const name = d.name?.toLowerCase() ?? "";
  if (name.includes("mortgage")) return accountTypeLabel("loan", "mortgage");
  if (name.includes("student")) return accountTypeLabel("loan", "student");
  return "Loan";
}

/** What to call this set of debts in a sentence, so the claim stays true. */
export function debtsNoun(debts: DebtAccount[]): string {
  const mortgage = accountTypeLabel("loan", "mortgage");
  if (debts.every((d) => debtTypeLabel(d) === mortgage)) return "mortgages";
  if (debts.every((d) => d.type === "credit")) return "cards";
  if (debts.every((d) => d.type === "loan")) return "loans";
  return "debts";
}

/** A rate above 20% that is on file (an assumed rate is not evidence). */
export const isHighRate = (d: Pick<DebtAccount, "apr" | "aprAssumed">) => d.apr > 20 && !d.aprAssumed;

/** The extra the field starts at: the journey's, else the old fixed suggestion. */
export function startingExtra(page: Pick<DebtPage, "payoff" | "journeyExtra">): number {
  return page.journeyExtra ?? Math.round(page.payoff.reduce((s, d) => s + d.suggestedExtra, 0));
}

export interface Plan {
  comparison: StrategyComparison;
  /** The order in use: avalanche whenever the two tie. */
  strategy: PayoffStrategy;
  plan: PayoffResult;
  minimums: PayoffResult;
  /** What $500 a month would do, offered while no extra is set. */
  preview: PayoffResult | null;
  ordered: DebtAccount[];
  /** Sums of the whole-dollar figures the rows show, so the column adds up. */
  totalMinPayment: number;
  monthlyPayment: number;
  /** The order only matters with extra to send and more than one debt to send it to. */
  ranked: boolean;
}

export function buildPlan(debts: DebtAccount[], extra: number, strategy: PayoffStrategy): Plan {
  const input = debts.map((d) => ({ id: d.id, balance: d.balance, apr: d.apr, minPayment: d.minPayment }));
  const comparison = compareStrategies(input, extra);
  const active: PayoffStrategy = comparison.tie ? "avalanche" : strategy;
  const plan = comparison[active];
  const byId = new Map(debts.map((d) => [d.id, d]));
  const ordered = plan.order.map((id) => byId.get(id)!).filter(Boolean);
  return {
    comparison,
    strategy: active,
    plan,
    minimums: simulatePayoff(input, "avalanche", 0),
    preview: extra === 0 ? simulatePayoff(input, "avalanche", 500) : null,
    ordered,
    totalMinPayment: debts.reduce((s, d) => s + Math.round(d.minPayment), 0),
    monthlyPayment: ordered.reduce((s, d, i) => s + Math.round(d.minPayment + (i === 0 ? extra : 0)), 0),
    ranked: extra > 0 && debts.length > 1,
  };
}

/** Which order is cheaper, and which closes an account first, each only when the numbers bear it out. */
export function strategyNotes(c: StrategyComparison): { cheaper: PayoffStrategy | null; firstClose: PayoffStrategy | null } {
  const a = Math.round(c.avalanche.totalInterest);
  const b = Math.round(c.snowball.totalInterest);
  const fa = c.avalanche.firstClearedMonths;
  const fb = c.snowball.firstClearedMonths;
  return {
    cheaper: a < b ? "avalanche" : b < a ? "snowball" : null,
    firstClose: fa < fb ? "avalanche" : fb < fa ? "snowball" : null,
  };
}

/** The line under the extra field: what the extra does, or what $500 would. */
export function extraHint(p: Plan, extra: number): string | null {
  const { plan, minimums, preview } = p;
  if (extra > 0) {
    if (!Number.isFinite(plan.months) || !Number.isFinite(minimums.months)) return null;
    const lead = minimums.months > plan.months ? `${formatDuration(minimums.months - plan.months)} sooner than paying only the minimums, and ` : "Same finish as paying only the minimums, and ";
    return `${lead}${formatMoney(Math.round(minimums.totalInterest - plan.totalInterest), true)} less in interest.`;
  }
  if (preview && Number.isFinite(preview.months)) {
    const saving = Number.isFinite(minimums.totalInterest) ? `, saving ${formatMoney(Math.round(minimums.totalInterest - preview.totalInterest), true)} in interest` : "";
    return `Add $500/month and you are debt-free in ${addMonths(preview.months)}${saving}.`;
  }
  return null;
}

/** The hero's sentence: the debt-free month and the interest, or why there is none. */
export function heroSentence(p: Plan, extra: number): string {
  if (Number.isFinite(p.plan.months)) {
    return `You're debt-free by ${addMonths(p.plan.months)}, and it costs about ${formatMoney(Math.round(p.plan.totalInterest), true)} in interest along the way.`;
  }
  return extra === 0
    ? "At minimum payments this debt never clears. Put more toward the highest-rate balance to set a real debt-free date."
    : "At this payment the debt still never clears. Raise the extra amount to set a real debt-free date.";
}

/** When the order changes nothing, one statement instead of a choice. Null when there is nothing to say. */
export function orderStatement(debts: DebtAccount[], extra: number, clears: boolean): string | null {
  if (debts.length === 1 || !clears) return null;
  return extra === 0
    ? `With no extra payment, the order you pay these ${debtsNoun(debts)} in does not change anything. What changes it is paying more.`
    : "Paying the highest rate first or the smallest balance first comes out the same here.";
}

/** A row's payment line: what to send, on one scale, so the column sums to the monthly payment. */
export function paymentLine(d: DebtAccount, lead: boolean, extra: number): string {
  const base =
    lead && extra > 0
      ? `${formatMoney(d.minPayment + extra, true)}/mo, ${formatMoney(extra, true)} above the minimum`
      : `${formatMoney(d.minPayment, true)}/mo minimum`;
  return d.aprAssumed ? `${base} (rate assumed)` : base;
}

/** The debt's payoff month: the lender's date while it gets only its minimum, the plan's once extra speeds it up. */
export function payoffMonth(d: DebtAccount, p: Plan): string {
  return d.payoffDate && p.plan.monthsById[d.id] >= p.minimums.monthsById[d.id] ? formatStoredMonth(d.payoffDate) : addMonths(p.plan.monthsById[d.id]);
}

/** The page's facts under the title: how many, how many above 20%, how many need a rate (audit W-21: plain words). */
export function debtFacts(page: Pick<DebtPage, "payoff" | "needsRate">): string[] {
  const n = page.payoff.length;
  const high = page.payoff.filter(isHighRate).length;
  const need = page.needsRate.length;
  return [
    `${n} account${n === 1 ? "" : "s"}`,
    ...(high > 0 ? [`${high} above 20% APR`] : []),
    ...(need > 0 ? [`Rate not on file for ${need} card${need === 1 ? "" : "s"}`] : []),
  ];
}

// The debt color leads, the rest alternate through the chart palette (the web's DEBT_SHADES: viz-4, 3, 7, 5, 2, 6).
const DEBT_SHADES = [3, 2, 6, 4, 1, 5];

/** The composition bar's segments: the six largest balances, each with its chart color's index. */
export function debtSegments(debts: DebtAccount[]): Array<{ key: string; label: string; value: number; pct: number; chart: number }> {
  const top = [...debts].sort((a, b) => b.balance - a.balance).slice(0, 6);
  const total = top.reduce((s, d) => s + Math.abs(d.balance), 0);
  return top.map((d, i) => ({
    key: d.id,
    label: debtName(d),
    value: Math.abs(d.balance),
    pct: total > 0 ? (Math.abs(d.balance) / total) * 100 : 0,
    chart: DEBT_SHADES[i % DEBT_SHADES.length],
  }));
}

export const STRATEGIES: Array<{ value: PayoffStrategy; title: string; short: string }> = [
  { value: "avalanche", title: "Highest rate first", short: "Highest rate" },
  { value: "snowball", title: "Smallest balance first", short: "Smallest balance" },
];

export type { PayoffStrategy };
