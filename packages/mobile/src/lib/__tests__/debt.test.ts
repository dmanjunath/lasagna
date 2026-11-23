import {
  addMonths,
  blendedApr,
  buildPlan,
  debtFacts,
  debtSegments,
  debtTypeLabel,
  extraHint,
  extraInvalid,
  formatDuration,
  heroSentence,
  orderStatement,
  parseExtra,
  paymentLine,
  startingExtra,
  strategyNotes,
  toDebtPage,
  type ApiDebt,
} from "../debt";

const api = (over: Partial<ApiDebt>): ApiDebt => ({
  id: "x",
  name: "Card",
  mask: null,
  type: "credit",
  subtype: "credit card",
  property: null,
  balance: 1000,
  interestRate: 20,
  minimumPayment: 50,
  payoffDate: null,
  planRole: "payoff",
  paidInFullMonthly: false,
  liabilitySource: null,
  ...over,
});

// The seeded household: a 24.99% card and a 7.5% auto loan, the journey putting $2,790 on the card.
const seeded = {
  debts: [
    api({ id: "car", name: "Auto Loan", mask: "8675", type: "loan", subtype: "auto", balance: 4781.2, interestRate: 7.5, minimumPayment: 95.62 }),
    api({ id: "card", name: "Credit Card", mask: "5087", balance: 2878.7, interestRate: 24.99, minimumPayment: 88.74 }),
  ],
  totalDebt: 7659.9,
  debtOnPayoffPlan: { amount: 7659.9, notInPlan: { amount: 0, count: 0 } },
  monthlyInterest: 89.83,
  suggestedExtra: 2790,
};

test("the page sorts by rate, keeps the server's split, and starts the extra at the journey's", () => {
  const page = toDebtPage(seeded);
  expect(page.payoff.map((d) => d.id)).toEqual(["card", "car"]);
  expect(page.debtOnPlan).toBe(7659.9);
  expect(startingExtra(page)).toBe(2790);
  expect(blendedApr(page.payoff)).toBe(14.1);
  expect(debtFacts(page)).toEqual(["2 accounts", "1 above 20% APR"]);
});

test("the plan matches the web page's figures for the seeded household", () => {
  const page = toDebtPage(seeded);
  const now = new Date(2026, 10, 22);
  const p = buildPlan(page.payoff, 2790, "snowball");
  // The two orders tie, so the plan is the one order (highest rate first).
  expect(p.comparison.tie).toBe(true);
  expect(p.strategy).toBe("avalanche");
  expect(p.ordered.map((d) => d.id)).toEqual(["card", "car"]);
  expect(p.monthlyPayment).toBe(2975);
  expect(p.totalMinPayment).toBe(185);
  expect(addMonths(p.plan.months, now)).toBe("Feb 2027");
  expect(addMonths(p.minimums.months, now)).toBe("Dec 2031");
  expect(Math.round(p.plan.totalInterest)).toBe(132);
  expect(extraHint(p, 2790)).toBe("4 years 10 months sooner than paying only the minimums, and $2,805 less in interest.");
  expect(paymentLine(p.ordered[0], true, 2790)).toBe("$2,879/mo, $2,790 above the minimum");
  expect(paymentLine(p.ordered[1], false, 2790)).toBe("$96/mo minimum");
  expect(orderStatement(page.payoff, 2790, true)).toBe("Paying the highest rate first or the smallest balance first comes out the same here.");
});

test("with no extra the order changes nothing and $500 is offered", () => {
  const page = toDebtPage({ ...seeded, suggestedExtra: null });
  const p = buildPlan(page.payoff, 0, "avalanche");
  expect(p.ranked).toBe(false);
  expect(p.preview).not.toBeNull();
  expect(extraHint(p, 0)).toMatch(/^Add \$500\/month and you are debt-free in [A-Z][a-z]{2} \d{4}, saving \$[\d,]+ in interest\.$/);
  expect(orderStatement(page.payoff, 0, true)).toBe("With no extra payment, the order you pay these debts in does not change anything. What changes it is paying more.");
});

test("a debt that never clears says so", () => {
  const page = toDebtPage({ debts: [api({ id: "a", balance: 10000, interestRate: 30, minimumPayment: 100 })], totalDebt: 10000, monthlyInterest: 0 });
  const p = buildPlan(page.payoff, 0, "avalanche");
  expect(heroSentence(p, 0)).toMatch(/^At minimum payments this debt never clears/);
  expect(addMonths(Infinity)).toBe("Never");
});

test("when the orders differ, each claim goes to the order the numbers bear it out for", () => {
  const page = toDebtPage({
    debts: [
      api({ id: "big", balance: 9000, interestRate: 29, minimumPayment: 250 }),
      api({ id: "small", balance: 400, interestRate: 9, minimumPayment: 25 }),
    ],
    totalDebt: 9400,
    monthlyInterest: 0,
  });
  const p = buildPlan(page.payoff, 200, "snowball");
  expect(p.comparison.tie).toBe(false);
  expect(p.strategy).toBe("snowball");
  expect(p.ordered[0].id).toBe("small");
  expect(strategyNotes(p.comparison)).toEqual({ cheaper: "avalanche", firstClose: "snowball" });
});

test("cards off the plan, stand-in rates, and an older API without plan roles", () => {
  const page = toDebtPage({
    debts: [
      api({ id: "clear", planRole: "clears-monthly", paidInFullMonthly: true }),
      api({ id: "norate", planRole: "needs-rate", interestRate: null }),
      api({ id: "loan", type: "loan", subtype: null, name: "Family loan", interestRate: null }),
      { ...api({ id: "old", paidInFull: true }), planRole: undefined },
    ],
    totalDebt: 4000,
    monthlyInterest: 0,
  });
  expect(page.clears.map((d) => d.id)).toEqual(["clear", "old"]);
  expect(page.needsRate.map((d) => d.id)).toEqual(["norate"]);
  expect(page.needsRate[0].apr).toBe(0);
  expect(page.payoff[0]).toMatchObject({ id: "loan", apr: 8, aprAssumed: true });
  // No server split: summed from the rows.
  expect(page.notInPlan).toEqual({ amount: 3000, count: 3 });
  expect(debtTypeLabel(page.payoff[0])).toBe("Loan");
  expect(paymentLine(page.payoff[0], false, 0)).toBe("$50/mo minimum (rate assumed)");
  expect(debtFacts(page)).toEqual(["1 account", "Rate not on file for 1 card"]);
});

test("the extra field reads money as typed and rejects negatives", () => {
  expect(parseExtra("$1,200")).toBe(1200);
  expect(parseExtra("")).toBe(0);
  expect(parseExtra("-5")).toBe(0);
  expect(extraInvalid("-5")).toBe(true);
  expect(extraInvalid("abc")).toBe(true);
  expect(extraInvalid("0")).toBe(false);
  expect(formatDuration(25)).toBe("2 years 1 month");
  expect(formatDuration(11)).toBe("11 months");
});

test("the composition bar takes the six largest, the debt color first", () => {
  const page = toDebtPage(seeded);
  const segs = debtSegments(page.payoff);
  expect(segs.map((s) => [s.label, Math.round(s.pct), s.chart])).toEqual([
    ["Auto Loan ••8675", 62, 3],
    ["Credit Card ••5087", 38, 2],
  ]);
});
