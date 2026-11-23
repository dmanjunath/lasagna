import { toActionRow, type ActionRow, type ApiActionRow } from "@web/lib/action-rows";
import type { GoalDetails } from "@lasagna/core/goal-target";
import type { SFSymbol } from "expo-symbols";
import type { Verdict } from "@/design/meaning";
import { formatMoney, formatStoredMonth } from "./format";

// The Goals area's pure logic, ported from packages/web/src/pages/goals.tsx,
// savings-goal.tsx and goal-shared.tsx. The screens render what these return.

export type GoalStatus = "active" | "completed" | string;

/** One goal as GET /goals sends it. */
export interface Goal {
  id: string;
  name: string;
  description?: string | null;
  targetAmount: string;
  currentAmount: string;
  monthlyContribution: string | null;
  deadline: string | null;
  category: string;
  details: GoalDetails | null;
  status: GoalStatus;
  icon: string | null;
  accountIds: string[];
  isAutoTracked: boolean;
  completedAt: string | null;
  createdAt: string;
}

/** An account as GET /accounts/balances sends it (the fields the goal pages read). */
export interface GoalBalance {
  accountId: string;
  name: string;
  type: string;
  mask: string | null;
  institutionId: string | null;
  institutionName: string | null;
  balance: string | null;
  asOf: string | null;
}

// ── Icons and presets ──────────────────────────────────────────────────────

/** The web's lucide icon keys, as SF Symbols. */
const SYMBOLS: Record<string, SFSymbol> = {
  shield: "shield",
  home: "house",
  plane: "airplane",
  car: "car",
  heart: "heart",
  graduationCap: "graduationcap",
  wrench: "wrench.and.screwdriver",
  sparkles: "sparkles",
  palmtree: "beach.umbrella",
  creditCard: "creditcard",
  wallet: "banknote",
  target: "target",
  hammer: "hammer",
};

// Goals created before the icon registry stored an emoji. Mirrors LEGACY_EMOJI_ICONS.
const LEGACY_EMOJI: Record<string, string> = {
  "🛡️": "shield", "🛡": "shield",
  "🏠": "home", "🏡": "home",
  "✈️": "plane", "✈": "plane",
  "🏖️": "palmtree", "🏖": "palmtree", "🌴": "palmtree",
  "🚗": "car",
  "🎓": "graduationCap",
  "💍": "heart", "❤️": "heart", "👶": "heart",
  "🔧": "wrench", "🔨": "hammer",
  "💳": "creditCard",
  "💰": "wallet", "💵": "wallet",
  "✨": "sparkles", "💪": "target", "🎯": "target",
};

/** A goal's glyph from its stored icon key (or legacy emoji). Unknown keys get the target. */
export function goalSymbol(key: string | null | undefined): SFSymbol {
  if (!key) return "target";
  return SYMBOLS[key] ?? SYMBOLS[LEGACY_EMOJI[key] ?? ""] ?? "target";
}

export type GoalPreset = { name: string; category: string; icon: string };

/** The kinds a goal can be. Shared by Suggested and the New goal sheet's grid, as on the web. */
export const GOAL_PRESETS: GoalPreset[] = [
  { name: "Emergency Fund", category: "emergency_fund", icon: "shield" },
  { name: "Home Purchase", category: "home_purchase", icon: "home" },
  { name: "Vacation / Travel", category: "vacation", icon: "plane" },
  { name: "Vehicle Purchase", category: "car", icon: "car" },
  { name: "Wedding Fund", category: "wedding", icon: "heart" },
  { name: "Education / 529", category: "education", icon: "graduationCap" },
  { name: "Home Repair", category: "home_repair", icon: "wrench" },
  { name: "Major Purchase", category: "major_purchase", icon: "sparkles" },
  { name: "Life Event", category: "life_event", icon: "sparkles" },
  // Title case like its siblings (W-30).
  { name: "Fully Funded Retirement", category: "retirement", icon: "palmtree" },
  { name: "Debt Payoff", category: "debt_payoff", icon: "creditCard" },
  { name: "General Savings", category: "savings", icon: "wallet" },
];

export const presetFor = (kind: string | null | undefined) => GOAL_PRESETS.find((p) => p.category === kind);

const SUGGESTED = 6;

/**
 * Suggested kinds: the presets the user has no goal of yet, active or done
 * (W-16: an Emergency Fund already finished is not suggested again).
 * General Savings stays on offer, since anyone can have many.
 */
export function suggestedPresets(goals: Pick<Goal, "category">[]): GoalPreset[] {
  const have = new Set(goals.map((g) => g.category));
  return GOAL_PRESETS.filter((p) => p.category === "savings" || !have.has(p.category)).slice(0, SUGGESTED);
}

/** "Debt payoff" from "debt_payoff". */
export function categoryLabel(category: string | null | undefined, fallback = "Savings"): string {
  const raw = category ? category.replace(/_/g, " ") : fallback.toLowerCase();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** The category, unless the goal's name already says it ("Retirement" under "Retirement Savings"). */
export function shownCategory(g: Pick<Goal, "category" | "name">): string | null {
  const label = categoryLabel(g.category);
  return g.name.toLowerCase().includes(label.toLowerCase()) ? null : label;
}

// ── Progress ───────────────────────────────────────────────────────────────

export function progressOf(g: Pick<Goal, "targetAmount" | "currentAmount">) {
  const target = parseFloat(g.targetAmount) || 0;
  const current = parseFloat(g.currentAmount) || 0;
  const raw = target > 0 ? (current / target) * 100 : 0;
  const pct = Math.min(100, Math.max(0, raw));
  const reached = target > 0 && current >= target;
  return { target, current, raw, pct, reached, notStarted: current <= 0, remaining: Math.max(0, target - current), surplus: current - target };
}

const usd = (v: number) => formatMoney(v, true);

/** A far deadline in its largest natural unit ("2 yr 3 mo left"). */
export function humanizeDaysLeft(days: number): string {
  if (days <= 0) return "Past deadline";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} left`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months left`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years} year${years === 1 ? "" : "s"} left` : `${years} yr ${rem} mo left`;
}

export function daysLeft(deadline: string, now: Date = new Date()): number {
  return Math.ceil((new Date(deadline).getTime() - now.getTime()) / 86_400_000);
}

const monthYear = (d: Date) => d.toLocaleDateString("en-US", { month: "short", year: "numeric" });

/**
 * The pace line (savings-goal.tsx): with a monthly plan, when the goal lands
 * at that rate and whether that beats the deadline. With only a deadline, the
 * monthly amount that would hit it. Null when there is nothing to project.
 */
/**
 * Where a monthly plan lands a goal: the plan, the months it takes, the month
 * it lands, and against a deadline still ahead, how many months late (0 when
 * on time). Null without a plan, or when there is nothing left to project.
 */
function planPace(g: Goal, now: Date) {
  const p = progressOf(g);
  if (g.status !== "active" || p.reached || p.notStarted || p.remaining <= 0) return null;
  const plan = g.monthlyContribution ? parseFloat(g.monthlyContribution) : 0;
  if (!(plan > 0)) return null;
  const months = Math.ceil(p.remaining / plan);
  const eta = new Date(now);
  eta.setMonth(eta.getMonth() + Math.min(months, 1201));
  const deadline = g.deadline && daysLeft(g.deadline, now) > 0 ? new Date(g.deadline) : null;
  // Calendar months past the deadline, at least one once it lands after it.
  const late = !deadline || eta.getTime() <= deadline.getTime() ? 0 : Math.max(1, (eta.getFullYear() - deadline.getFullYear()) * 12 + eta.getMonth() - deadline.getMonth());
  return { plan, months, eta, deadline, late };
}

/** How far behind still reads as slipping rather than off track. */
export const SLIPPING_MONTHS = 3;

/**
 * A goal's status, from the same comparison as its pace line: with a monthly
 * plan and a deadline still ahead, on track when the plan lands by the
 * deadline, slipping up to three months late, off track beyond. Nothing to
 * judge (no plan, no deadline, reached, not started) is no status, so the
 * goal keeps its own color.
 */
export function goalStatus(g: Goal, now: Date = new Date()): Verdict | null {
  const pace = planPace(g, now);
  if (!pace?.deadline) return null;
  if (pace.months > 1200 || pace.late > SLIPPING_MONTHS) return "bad";
  return pace.late > 0 ? "attention" : "good";
}

export function paceLine(g: Goal, now: Date = new Date()): string | null {
  const p = progressOf(g);
  if (g.status !== "active" || p.reached || p.notStarted || p.remaining <= 0) return null;
  const left = g.deadline ? daysLeft(g.deadline, now) : null;
  const deadlineMonth = g.deadline ? formatStoredMonth(g.deadline) : null;
  const pace = planPace(g, now);
  if (pace) {
    const { plan, months, eta, deadline, late } = pace;
    // A plan that would take lifetimes has no month worth naming.
    if (months > 1200) return `${usd(plan)}/mo planned, more than 100 years at this pace`;
    if (deadline) {
      return late === 0
        ? `${usd(plan)}/mo planned, on track for ${deadlineMonth}`
        : `${usd(plan)}/mo planned, on pace for ${monthYear(eta)} (behind your ${deadlineMonth} target)`;
    }
    return `${usd(plan)}/mo planned, on pace for ${monthYear(eta)}`;
  }
  if (left !== null && left > 0) {
    const months = Math.max(1, Math.round(left / 30.44));
    return `About ${usd(Math.ceil(p.remaining / months))}/mo would hit ${deadlineMonth}`;
  }
  return null;
}

/** A goal card's one status line: the pace when there is one, else what is left and by when. */
export function cardLine(g: Goal, now: Date = new Date()): string {
  const p = progressOf(g);
  if (p.reached) return p.surplus >= 1 ? `Funded. ${usd(p.surplus)} above target.` : "Funded.";
  const pace = paceLine(g, now);
  if (pace) return pace;
  const target = g.deadline ? (daysLeft(g.deadline, now) <= 0 ? "past the target date" : `target ${formatStoredMonth(g.deadline)}`) : null;
  if (p.notStarted) return target ? `Just getting started, ${target}` : "Just getting started";
  return target ? `${usd(p.remaining)} to go, ${target}` : `${usd(p.remaining)} to go`;
}

/** A completed goal's line: only "Reached" when it really hit its target. */
export function completedLine(g: Goal): string {
  const p = progressOf(g);
  const status = p.reached ? "Reached" : `Completed at ${Math.round(p.raw)}%`;
  const cat = shownCategory(g);
  return cat ? `${status}. ${cat}` : status;
}

// ── The summary hero ───────────────────────────────────────────────────────

/**
 * Saved toward all active goals, and one count of goals reached (W-17: the
 * web's "Funded 0 of 2 goals" beside "1 complete" read as a contradiction, so
 * an active goal at its target and a completed one that reached it are counted
 * together, out of every goal).
 */
export function goalsSummary(goals: Goal[]) {
  const active = goals.filter((g) => g.status === "active");
  const completed = goals.filter((g) => g.status === "completed");
  const saved = active.reduce((s, g) => s + progressOf(g).current, 0);
  const target = active.reduce((s, g) => s + progressOf(g).target, 0);
  const reached = active.filter((g) => progressOf(g).reached).length + completed.filter((g) => progressOf(g).reached).length;
  const avgPct = active.length ? Math.round(active.reduce((s, g) => s + progressOf(g).pct, 0) / active.length) : 0;
  const pct = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0;
  return { active, completed, saved, target, pct, remaining: Math.max(0, target - saved), reached, total: active.length + completed.length, avgPct };
}

// ── The goal page ──────────────────────────────────────────────────────────

/** Mark complete is offered from halfway, or once reached (savings-goal.tsx). */
export const MARK_COMPLETE_THRESHOLD = 50;

export function canMarkComplete(g: Goal): boolean {
  const p = progressOf(g);
  return g.status === "active" && (p.reached || p.raw >= MARK_COMPLETE_THRESHOLD);
}

/** The hero's status line for a goal page, or null when it would only repeat the To go tile. */
export function heroLine(g: Goal, now: Date = new Date()): string | null {
  const p = progressOf(g);
  if (g.status === "completed" && !p.reached) {
    const on = g.completedAt ? ` on ${new Date(g.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "";
    return `Marked complete${on} with ${usd(p.current)} saved`;
  }
  // The surplus is the hero's first tile, so the line doesn't repeat it.
  if (p.reached) return "Funded.";
  if (p.notStarted) return "Not started yet. Link an account or edit the amount to get going.";
  // Without a plan the line would only say what's left, which the To go tile already says.
  return paceLine(g, now);
}

export type StatTile = { key: string; label: string; value: string; caption?: string; accent?: boolean; action?: "date" };

/** The hero's figures: to go (or over), the target date (or a prompt to add one), and how it is tracked when accounts track it. */
export function heroTiles(g: Goal, now: Date = new Date()): StatTile[] {
  const p = progressOf(g);
  const archived = g.status === "completed";
  const tiles: StatTile[] = [
    p.reached
      ? { key: "go", label: "Over target", value: p.surplus >= 1 ? usd(p.surplus) : "On target", caption: "above your goal", accent: true }
      : archived
        ? { key: "go", label: "Saved", value: usd(p.current), caption: `of ${usd(p.target)} target` }
        : // The hero already says "of" the target, so the tile has no caption.
          { key: "go", label: "To go", value: usd(p.remaining) },
  ];
  if (g.deadline) {
    tiles.push({ key: "date", label: "Target date", value: formatStoredMonth(g.deadline), caption: archived ? undefined : humanizeDaysLeft(daysLeft(g.deadline, now)) });
  } else if (!g.details) {
    tiles.push({ key: "date", label: "Target date", value: "Set a date", caption: "add a deadline", action: "date" });
  }
  // With no linked accounts the page's "Tracked manually" card says it, so no tile repeats it.
  const n = g.accountIds.length;
  if (n > 0) tiles.push({ key: "track", label: "Tracking", value: g.isAutoTracked ? "Auto" : "Manual", caption: g.isAutoTracked ? `from ${n} account${n === 1 ? "" : "s"}` : "manual entry" });
  return tiles;
}

/** "Cash" and "Investments" for the account types a goal can draw on. */
export function accountTypeName(type: string): string {
  if (type === "depository") return "Cash";
  if (type === "investment") return "Investments";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The goal's linked accounts, in the order the balances list them. */
export function linkedAccounts(g: Pick<Goal, "accountIds">, balances: GoalBalance[]): GoalBalance[] {
  return balances.filter((b) => g.accountIds.includes(b.accountId));
}

// ── The accounts picker ────────────────────────────────────────────────────

/** Only liquid accounts can back a goal: a debt would track the debt, a house would read as reached. */
export function fundableAccounts(balances: GoalBalance[]): GoalBalance[] {
  return balances.filter((b) => b.type === "depository" || b.type === "investment");
}

/** The account type a goal of this kind is usually funded from. */
export function preferredAccountType(category: string): "depository" | "investment" {
  return category === "retirement" || category === "education" ? "investment" : "depository";
}

/**
 * The picker's groups: the kind's usual type first, each sorted with the
 * accounts linked when it opened first (so rows never jump under a finger),
 * then the largest balances.
 */
export function pickerGroups(accounts: GoalBalance[], preferType: string, pinned: ReadonlySet<string>) {
  const sorted = [...accounts].sort(
    (a, b) => Number(pinned.has(b.accountId)) - Number(pinned.has(a.accountId)) || parseFloat(b.balance ?? "0") - parseFloat(a.balance ?? "0"),
  );
  const types = [...new Set(accounts.map((a) => a.type))].sort((a, b) => Number(b === preferType) - Number(a === preferType));
  return types.map((type) => ({ type, title: accountTypeName(type), rows: sorted.filter((a) => a.type === type) }));
}

/** What the picked accounts hold, read against the target. Null with nothing picked. */
export function pickerTotalLine(accounts: GoalBalance[], selected: string[], target: number | null | undefined): string | null {
  if (selected.length === 0) return null;
  const total = accounts.filter((a) => selected.includes(a.accountId)).reduce((s, a) => s + parseFloat(a.balance ?? "0"), 0);
  const lead = selected.length === 1 ? "This account holds" : `These ${selected.length} accounts hold`;
  if (!target || target <= 0) return `${lead} ${usd(total)}.`;
  return `${lead} ${usd(total)} of the ${usd(target)} target.${total >= target ? " That reaches the target." : ""}`;
}

// ── Actions ────────────────────────────────────────────────────────────────

/** The Goals page's actions: the savings ones, in the server's order, as the web's embedded list shows them. */
export function savingsActions(insights: ApiActionRow[]): ActionRow[] {
  return insights.filter((i) => i.type === "savings").map(toActionRow);
}

/** The chat question behind "Reallocate surplus" on a funded goal (goals.tsx). */
export function reallocatePrompt(g: Goal): string {
  const monthly = g.monthlyContribution ? parseFloat(g.monthlyContribution) : 0;
  const freed = monthly > 0 ? `I've been putting ${usd(monthly)}/month toward it, so that amount is now freed up.` : "The money I was putting toward it each month is now freed up.";
  return (
    `My "${g.name}" goal is fully funded. ${freed} ` +
    "Look at my monthly spending, my other goals and their progress and planned contributions, " +
    "and the rest of my financial picture (debts, recurring bills, net worth), " +
    "then recommend how to best reallocate that monthly amount, and why."
  );
}
