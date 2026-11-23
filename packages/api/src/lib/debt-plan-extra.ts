import type { SizedStep } from "./path-sizing.js";

/**
 * What the journey puts on the debt it is standing on, above that debt's
 * minimum, in whole dollars. The Debt page seeds its payoff plan's "extra each
 * month" with it, so the page's plan and the journey's step state one plan.
 *
 * Capped at the balance: when a month of funding clears the debt, the journey
 * says "One payment of $X clears this" and the plan pays exactly that.
 * Null when the journey has no unfinished debt step.
 */
export function journeyDebtExtra(
  steps: Array<Pick<SizedStep, "kind" | "status" | "monthlyFunding"> & {
    debt?: { balance: number; minimumPayment: number } | null;
  }>,
): number | null {
  const step = steps.find((s) => s.kind === "debt" && s.status !== "complete" && s.debt);
  if (!step?.debt) return null;
  const pay = Math.min(step.monthlyFunding, step.debt.balance);
  return Math.max(0, Math.round(pay - step.debt.minimumPayment));
}
