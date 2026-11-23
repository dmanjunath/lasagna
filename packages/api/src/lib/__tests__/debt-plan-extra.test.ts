/**
 * The Debt page's payoff plan starts from the same monthly amount the journey
 * puts on the debt it is standing on (audit W-8). It used to seed an arbitrary
 * 0.8x-the-minimum "extra", so the page said "$237/mo until 2029" beside a
 * journey step and an action saying one payment clears the card now.
 */
import { describe, it, expect } from "vitest";
import { journeyDebtExtra } from "../debt-plan-extra.js";

type Step = Parameters<typeof journeyDebtExtra>[0][number];
const debtStep = (over: Partial<Step> & { balance: number; minimumPayment: number }): Step =>
  ({
    kind: "debt",
    status: "in_progress",
    monthlyFunding: 0,
    debt: { balance: over.balance, minimumPayment: over.minimumPayment },
    ...over,
  }) as Step;

describe("journeyDebtExtra", () => {
  it("caps at the balance when one payment clears the debt", () => {
    // Surplus 3,687 + minimum 88.74 covers the 2,878.70 card in one payment.
    const steps = [debtStep({ balance: 2878.7, minimumPayment: 88.74, monthlyFunding: 3775.74 })];
    expect(journeyDebtExtra(steps)).toBe(2790);
  });
  it("is the funding above the minimum otherwise", () => {
    const steps = [debtStep({ balance: 9000, minimumPayment: 88.74, monthlyFunding: 500 })];
    expect(journeyDebtExtra(steps)).toBe(411);
  });
  it("reads the first unfinished debt step", () => {
    const steps = [
      { kind: "emergency-fund", status: "not_started", monthlyFunding: 900 } as Step,
      debtStep({ balance: 500, minimumPayment: 25, monthlyFunding: 0, status: "complete" }),
      debtStep({ balance: 4000, minimumPayment: 100, monthlyFunding: 300 }),
    ];
    expect(journeyDebtExtra(steps)).toBe(200);
  });
  it("is null with no debt step to read", () => {
    expect(journeyDebtExtra([])).toBeNull();
  });
});
