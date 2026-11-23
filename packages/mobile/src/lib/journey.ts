import type { FinancialPath } from "@web/lib/api";
import { maskCurrencyInText } from "./hide-amounts";
import { formatMoneyShort } from "./home";

// The home journey card's rules, ported from LevelSection in
// packages/web/src/pages/simple-home.tsx and components/common/level-rail.tsx.

export type LevelState = "done" | "current" | "ongoing" | "future";

export function levelStateOf(step: { id: string; status: string; rateShaped?: boolean }, currentStepId: string): LevelState {
  if (step.rateShaped) return "ongoing";
  if (step.status === "complete") return "done";
  if (step.id === currentStepId) return "current";
  return "future";
}

export type PathStep = FinancialPath["steps"][number];

/** The step the card stands on: the server's current step, else the first. */
export function currentStep(path: FinancialPath | undefined): PathStep | null {
  if (!path) return null;
  return path.steps.find((s) => s.id === path.currentStepId) ?? path.steps[0] ?? null;
}

export function journeySummary(path: FinancialPath) {
  const states = path.steps.map((s) => levelStateOf(s, path.currentStepId));
  const count = (st: LevelState) => states.filter((s) => s === st).length;
  return {
    states,
    total: path.steps.length || 1,
    done: count("done"),
    ongoing: count("ongoing"),
    future: count("future"),
    // With no steps every step is vacuously complete, so length comes first.
    allComplete: path.steps.length > 0 && path.steps.every((s) => s.status === "complete"),
  };
}

/** "$1.2K saved of $5K target", or a monthly rate for a savings-rate step. Null without figures. */
export function stepDetail(step: Pick<PathStep, "kind" | "current" | "target">): string | null {
  if (step.current == null || step.target == null || !(step.target > 0)) return null;
  return step.kind === "savings-rate"
    ? `${formatMoneyShort(step.current)} of ${formatMoneyShort(step.target)} a month`
    : `${formatMoneyShort(step.current)} saved of ${formatMoneyShort(step.target)} target`;
}

/** The same words /financial-level hands off to chat with. */
export function stepHelpPrompt(step: Pick<PathStep, "order" | "title">): string {
  return `Walk me through step ${step.order} of my financial path, "${step.title}". What exactly should I do on this step, and why does it sit where it does?`;
}

// ── The journey page (/financial-level), ported from pages/financial-level.tsx ──

export type OffPathStep = FinancialPath["offPath"][number];
type Summary = FinancialPath["summary"];

const UPDATE_CAUSE: Record<string, string> = {
  goal_added: "after you added a goal",
  goal_updated: "after you changed a goal",
  goal_removed: "after you removed a goal",
  step_completed: "after you marked a step done",
  debt_added: "after a new balance appeared",
  debt_cleared: "after a balance was cleared",
};

/** When the order was last settled, and why where the server knows. The date comes first so it reads one way. */
export function updatedLine(updatedAt: string, reason: string): string {
  const d = new Date(updatedAt);
  const on = Number.isNaN(d.getTime()) ? updatedAt : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  if (reason === "no_active_path") return `Built for you on ${on}.`;
  const cause = UPDATE_CAUSE[reason];
  return cause ? `Updated ${on}, ${cause}.` : `Updated ${on}.`;
}

/** Nothing to build a path from yet: no income, cash or investments. */
export function needsNumbers(summary: Pick<Summary, "monthlyIncome" | "totalCash" | "totalInvested">): boolean {
  return summary.monthlyIncome === 0 && summary.totalCash === 0 && summary.totalInvested === 0;
}

/** A step the figures measure completes itself, so only an unmeasured one takes a tick. */
export function canTick(step: Pick<PathStep, "target">): boolean {
  return step.target === null;
}

/** A rate to at most 2 decimals. 0 is a real rate. No rate on file asks for one. */
export function aprLabel(apr: number | null): string {
  if (apr == null) return "Add rate";
  return `${Math.round(apr * 100) / 100}% APR`;
}

/** The one account a debt step acts on, skipping any that would print as $0. */
export function stepAccount(step: Pick<PathStep, "accounts">) {
  return (step.accounts ?? []).find((a) => Math.round(Math.abs(a.balance)) > 0) ?? null;
}

/**
 * What the detail says the step asks for: the instruction on the step you
 * stand on ("Next step"), the standing monthly instruction of a rate step
 * anywhere else ("Every month"), else where an unfinished step stands (the
 * fact, no heading). Null when there is nothing to say.
 */
export function stepGuidance(step: Pick<PathStep, "action" | "fact" | "rateShaped">, state: LevelState): { heading: string | null; text: string } | null {
  if (state === "current") return step.action ? { heading: "Next step", text: step.action } : null;
  if (step.rateShaped) return step.action ? { heading: "Every month", text: step.action } : null;
  return step.fact ? { heading: null, text: step.fact } : null;
}

/** The pill a step wears: never color alone. */
export function statePillLabel(state: LevelState, rateShaped: boolean): string {
  if (state === "ongoing" || rateShaped) return "Ongoing";
  if (state === "current") return "You are here";
  if (state === "done") return "Done";
  return "Ahead";
}

/** Why a step is off the path, or null when the heading already says all there is. */
export function offPathLine(off: Pick<OffPathStep, "byYou" | "reason">): string | null {
  if (off.byYou) return "You said this does not apply to you.";
  return off.reason || null;
}

/**
 * "Why these steps?": what the path is made of and who chose its order,
 * written for the balances actually on it (the web's WhyThisPathPopover).
 */
export function whyTheseSteps(path: Pick<FinancialPath, "steps" | "orderSource"> & { summary: Pick<Summary, "monthlySurplus"> }): string[] {
  const { steps } = path;
  const debts = steps.filter((s) => s.kind === "debt");
  const debtCount = debts.length;
  const goalCount = steps.filter((s) => s.kind === "goal").length;
  const rated = debts.filter((s) => s.accounts?.[0]?.apr != null).length;
  const debtLine =
    rated === debtCount
      ? debtCount === 1
        ? "Your balance sits where its own interest rate puts it, which is not a judgement call."
        : "Balances sit by their interest rate, highest first, which is not a judgement call."
      : rated === 0
        ? debtCount === 1
          ? "Your lender reports no rate, so the balance sits where accounts of its type usually sit, until you add one."
          : "No lender on your path reports a rate, so each balance sits where accounts of its type usually sit, until you add one."
        : rated === 1
          ? "The one balance that reports a rate sits where that rate puts it. The rest sit where accounts of their type usually sit, until you add one."
          : "The balances that report a rate sit by it, highest first. The rest sit where accounts of their type usually sit, until you add one.";
  const madeOf = [
    debtCount > 0 ? `${debtCount} ${debtCount === 1 ? "debt account" : "debt accounts"}` : null,
    goalCount > 0 ? `${goalCount} ${goalCount === 1 ? "goal" : "goals"}` : null,
  ].filter(Boolean) as string[];
  const first = [
    `These ${steps.length} steps are built from your own accounts, goals and profile.`,
    madeOf.length > 0 ? `One step each for ${madeOf.join(" and ")}, named individually.` : null,
    "Anything that does not apply to you is left out rather than shown greyed.",
  ];
  const order =
    path.orderSource === "model"
      ? "The order is chosen for your situation, not read off a fixed list. What protects you is weighed against what you are saving for, so a goal with a date close by can sit ahead of a step that would come first for someone else."
      : "The order is our default sequence: steady ground first, then what protects you, then what compounds.";
  const second = [order, debtCount > 0 ? debtLine : null, "It holds until something on your path changes, and the line under the title says when it last did."];
  const surplus = path.summary.monthlySurplus;
  const third =
    surplus !== null && surplus > 0
      ? `Your ${formatMoneyWhole(surplus)} a month goes to the step you are on, then moves down as each finishes.`
      : "Add income or link a spending account and each step gets a monthly figure and a date.";
  return [first.filter(Boolean).join(" "), second.filter(Boolean).join(" "), third];
}

/** The open actions that serve one step. */
export function stepActions<T extends { pathStepKey: string | null }>(actions: T[], stepId: string): T[] {
  return actions.filter((a) => a.pathStepKey === stepId);
}

function formatMoneyWhole(n: number): string {
  return maskCurrencyInText(`$${Math.round(n).toLocaleString("en-US")}`);
}
