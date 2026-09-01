import { describe, it, expect } from "vitest";
import { normalizePunctuation, debtAccountPaidInFull } from "../insights-engine.js";

describe("debtAccountPaidInFull — a card cleared each month is not a payoff target", () => {
  const card = (metadata: Record<string, unknown>) => ({ type: "credit", metadata });

  it("is true when the last payment cleared the last statement", () => {
    expect(
      debtAccountPaidInFull(
        card({ type: "credit_card", lastStatementBalance: 1200, lastPaymentAmount: 1200 }),
      ),
    ).toBe(true);
  });

  it("is false for a carried balance", () => {
    expect(
      debtAccountPaidInFull(
        card({ type: "credit_card", lastStatementBalance: 5000, lastPaymentAmount: 200 }),
      ),
    ).toBe(false);
  });

  it("is false for legacy metadata that carries no statement signal", () => {
    expect(debtAccountPaidInFull(card({ interestRate: 24.99 }))).toBe(false);
  });

  it("never applies to a loan", () => {
    expect(
      debtAccountPaidInFull({
        type: "loan",
        metadata: { lastStatementBalance: 0, lastPaymentAmount: 0 },
      }),
    ).toBe(false);
  });

  it("honours a manual designation with no statement signal", () => {
    expect(
      debtAccountPaidInFull({ type: "credit", metadata: { interestRate: 24.99 }, paidInFullMonthly: true }),
    ).toBe(true);
  });

  it("never applies a manual designation to a loan", () => {
    expect(debtAccountPaidInFull({ type: "loan", metadata: null, paidInFullMonthly: true })).toBe(false);
  });
});

describe("normalizePunctuation", () => {
  it("replaces the spaced em dash seen in generated insights with a comma", () => {
    const out = normalizePunctuation(
      "overpaid by $61,821 federally and $10,358 to Virginia — a combined $72,179",
    );
    expect(out).toBe(
      "overpaid by $61,821 federally and $10,358 to Virginia, a combined $72,179",
    );
  });

  it("converts dashes between digits to 'to' ranges", () => {
    expect(normalizePunctuation("expected returns of 7–10% beat 3—5% savings")).toBe(
      "expected returns of 7 to 10% beat 3 to 5% savings",
    );
  });

  it("replaces unspaced dashes and middots with commas", () => {
    expect(normalizePunctuation("Rebalance now—your allocation drifted")).toBe(
      "Rebalance now, your allocation drifted",
    );
    expect(normalizePunctuation("Dining $840 · Groceries $410")).toBe(
      "Dining $840, Groceries $410",
    );
  });

  it("leaves hyphens, currency, and URLs untouched", () => {
    const s = "Set up a $500/mo auto-transfer via https://example.com/my-bank";
    expect(normalizePunctuation(s)).toBe(s);
  });
});
