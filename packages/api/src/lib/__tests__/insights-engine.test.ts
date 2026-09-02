import { describe, it, expect } from "vitest";
import {
  normalizePunctuation,
  debtAccountPaidInFull,
  mentionsTaxSavingAmount,
} from "../insights-engine.js";

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

describe("mentionsTaxSavingAmount — an action may not price the tax it saves", () => {
  it("catches a tax saving stated after the verb", () => {
    expect(
      mentionsTaxSavingAmount(
        "You're contributing $15k to your 401(k). Increasing to $23,500 saves $2,040 in taxes at your 24% bracket.",
      ),
    ).toBe(true);
    expect(mentionsTaxSavingAmount("Open an HSA to save $1,290/yr in taxes")).toBe(true);
  });

  it("catches a tax saving stated before the amount", () => {
    expect(mentionsTaxSavingAmount("Harvest the loss to cut your tax bill by $2,000")).toBe(true);
    expect(mentionsTaxSavingAmount("Bunch your gifts and reduce taxes by 12%")).toBe(true);
  });

  it("catches a bare tax-savings label", () => {
    expect(mentionsTaxSavingAmount("$1,200+ tax savings")).toBe(true);
    expect(mentionsTaxSavingAmount("Save $2,040 in federal tax")).toBe(true);
    expect(mentionsTaxSavingAmount("That is $2,040 less in taxes this year")).toBe(true);
  });

  it("leaves a figure read straight off a document alone", () => {
    // Both of these were dropped by an earlier, broader matcher, which took
    // the whole withholding lens with them.
    expect(
      mentionsTaxSavingAmount(
        "Review your W-4 withholding after $41,200 federal withheld Your W-2 shows $41,200 in federal tax withheld on $250,000 wages.",
      ),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount(
        "Fund a NY 529 with up to $10,000 to claim the state deduction Your W-2 shows $14,100 in state tax withheld on $250,000 income.",
      ),
    ).toBe(false);
  });

  it("leaves non-tax dollar benefits alone", () => {
    expect(
      mentionsTaxSavingAmount(
        "Pay down your $3,076 card to stop $736/yr in interest Because the numbers say so. Save $340/yr",
      ),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Raise your 401(k) to 4% to claim $3,400/yr in free match"),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Invest $33,290 of idle cash to earn about $998/yr more"),
    ).toBe(false);
  });

  it("leaves an amount the user is asked to act on alone", () => {
    expect(
      mentionsTaxSavingAmount(
        "Contribute $8,550 to your HSA to lower your taxable income. $8,550 room left",
      ),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount(
        "Claim the $2,500 student loan interest deduction on your return. $2,500 cap",
      ),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Harvest the $4,200 loss sitting in your taxable brokerage"),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Move $50,000 into a tax-advantaged account to cut fund fees"),
    ).toBe(false);
    // The amount is the base the action moves, not the tax it removes.
    expect(
      mentionsTaxSavingAmount("Fund a NY 529 and lower your state taxable income by $7,000"),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Contribute $7,000 to a NY 529 to deduct against state tax"),
    ).toBe(false);
  });
});
