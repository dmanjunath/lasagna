import type { AccountFacts } from "@web/lib/api";
import { setAmountsHidden } from "../hide-amounts";
import {
  assetSegments,
  assetsLabel,
  balanceValue,
  billWhen,
  breakdownFrom,
  debtSegments,
  firstNameOf,
  fmtUsd,
  formatMoneyShort,
  goalAccent,
  goalProgress,
  greetingForHour,
  hasComposition,
  homeState,
  monthFlowFrom,
  monthWindows,
  onboardingResume,
  pctVsPrev,
  thisMonthPeriod,
  thisMonthTransactionsHref,
  upcomingBill,
} from "../home";

afterEach(() => setAmountsHidden(false));

const T = (total: number, count: number) => ({ total, count });
const facts = (over: Partial<Record<keyof AccountFacts["netWorth"]["byType"], { total: number; count: number }>> = {}, connected = 3): AccountFacts => {
  const byType = { cash: T(1000, 1), investments: T(5000, 1), realEstate: T(0, 0), alternative: T(0, 0), creditCards: T(200, 1), loans: T(0, 0), ...over };
  const assets = byType.cash.total + byType.investments.total + byType.realEstate.total + byType.alternative.total;
  const debt = byType.creditCards.total + byType.loans.total;
  return { accountsConnected: connected, accountsCounted: connected, netWorth: { assets, debt, netWorth: assets - debt, byType } };
};

test("greeting follows the hour, and overnight is evening", () => {
  expect(greetingForHour(3)).toBe("Good evening");
  expect(greetingForHour(9)).toBe("Good morning");
  expect(greetingForHour(13)).toBe("Good afternoon");
  expect(greetingForHour(20)).toBe("Good evening");
});

test("first name falls back from name to tenant to email", () => {
  expect(firstNameOf({ name: "Ana Lima", email: "a@x.test" }, null)).toBe("Ana");
  expect(firstNameOf({ name: null, email: "a@x.test" }, { name: "Lima household" })).toBe("Lima");
  expect(firstNameOf({ name: null, email: "pat@x.test" }, null)).toBe("pat");
  expect(firstNameOf(null, null)).toBe("there");
});

test("money formats mask when hidden", () => {
  expect(fmtUsd(1234.5)).toBe("$1,235");
  expect(fmtUsd(1234.5, 2)).toBe("$1,234.50");
  expect(formatMoneyShort(1500)).toBe("$1.5K");
  expect(formatMoneyShort(25000)).toBe("$25K");
  expect(formatMoneyShort(-2_500_000)).toBe("−$2.5M");
  expect(formatMoneyShort(80)).toBe("$80");
  setAmountsHidden(true);
  expect(fmtUsd(5)).toBe("$•••••");
  expect(formatMoneyShort(5)).toBe("$•••••");
});

test("home state: failed wins, zero connected is empty", () => {
  expect(homeState(undefined, false)).toBe("loading");
  expect(homeState(facts(), true)).toBe("failed");
  expect(homeState(facts({}, 0), false)).toBe("empty");
  expect(homeState(facts(), false)).toBe("dashboard");
});

test("breakdown segments and the other-assets label", () => {
  const b = breakdownFrom(facts({ realEstate: T(300000, 1) }));
  expect(assetSegments(b).map((s) => s.label)).toEqual(["Cash", "Investments", "Property"]);
  expect(debtSegments(b).map((s) => s.label)).toEqual(["Credit cards"]);
  expect(assetsLabel(breakdownFrom(facts({ alternative: T(10, 1) })))).toBe("Alternatives");
  expect(assetsLabel(breakdownFrom(facts({ alternative: T(10, 1), realEstate: T(10, 1) })))).toBe("Other assets");
  expect(hasComposition(breakdownFrom(facts({ cash: T(0, 0), investments: T(0, 0), creditCards: T(0, 0) })))).toBe(false);
});

test("month windows clamp the day for a short previous month", () => {
  expect(monthWindows(new Date(2026, 2, 31, 10))).toEqual({
    current: { startDate: "2026-03-01", endDate: "2026-03-31T23:59:59" },
    previous: { startDate: "2026-02-01", endDate: "2026-02-28T23:59:59" },
  });
  expect(monthWindows(new Date(2026, 0, 15)).previous).toEqual({ startDate: "2025-12-01", endDate: "2025-12-15T23:59:59" });
});

test("this month links name the month and the category window", () => {
  const now = new Date(2026, 10, 21);
  expect(thisMonthPeriod(now)).toBe("2026-11");
  expect(thisMonthTransactionsHref("c1", now)).toBe("/transactions?categories=c1&startDate=2026-11-01&endDate=2026-11-21");
});

test("month flow keeps the top three expense categories and compares with last month", () => {
  const cur = {
    totalSpending: 1000,
    totalIncome: 3000,
    netCashFlow: 2000,
    categories: [
      { id: "a", name: "Rent", groupType: "expense" as const, total: 500 },
      { id: "b", name: "Pay", groupType: "income" as const, total: 3000 },
      { id: "c", name: "Food", groupType: "expense" as const, total: 300 },
      { id: "d", name: "Fun", groupType: "expense" as const, total: 100 },
      { id: "e", name: "Gas", groupType: "expense" as const, total: 100.5 },
      { id: "f", name: "Zero", groupType: "expense" as const, total: 0 },
    ],
  };
  const flow = monthFlowFrom(cur, { ...cur, totalSpending: 800 });
  expect(flow.topCats.map((c) => c.id)).toEqual(["a", "c", "e"]);
  expect(flow.topCats[0].pct).toBe(50);
  expect(flow.topCats[0].ids).toEqual(["a"]);
  expect(pctVsPrev(flow)).toBe(25);
  expect(pctVsPrev(monthFlowFrom(cur, null))).toBeNull();
  expect(pctVsPrev(monthFlowFrom(cur, { ...cur, totalSpending: 0 }))).toBeNull();
});

test("Home's top rows roll categories up by group, as Spending's default view does", () => {
  const cur = {
    totalSpending: 1000,
    totalIncome: 0,
    netCashFlow: -1000,
    categories: [
      { id: "rent", name: "Rent", groupType: "expense" as const, total: 500, groupId: "housing", groupName: "Housing" },
      { id: "groc", name: "Groceries", groupType: "expense" as const, total: 200, groupId: "food", groupName: "Food & Dining" },
      { id: "dine", name: "Dining Out", groupType: "expense" as const, total: 250, groupId: "food", groupName: "Food & Dining" },
      { id: "gas", name: "Gas", groupType: "expense" as const, total: 50, groupId: "auto", groupName: "Auto" },
    ],
  };
  const top = monthFlowFrom(cur, null).topCats;
  expect(top.map((c) => c.name)).toEqual(["Housing", "Food & Dining", "Auto"]);
  expect(top[1]).toMatchObject({ total: 450, ids: ["dine", "groc"], lead: "dine" });
});

test("money back stays off Home's top categories", () => {
  const cur = {
    totalSpending: 633,
    totalIncome: 0,
    netCashFlow: -633,
    categories: [
      { id: "rent", name: "Rent", groupType: "expense" as const, total: 900, groupId: "housing", groupName: "Housing" },
      { id: "other", name: "Other", groupType: "expense" as const, total: 267, groupId: "o", groupName: "Other", moneyBack: true },
    ],
  };
  expect(monthFlowFrom(cur, null).topCats.map((c) => c.name)).toEqual(["Housing"]);
});

test("upcoming bill is the soonest big one within a week", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const r = (id: string, amount: string, category: string | null, due: string | null) => ({ id, name: id, amount, category, nextDueDate: due, accountId: null });
  const bill = upcomingBill(
    [
      r("small", "50", "housing", "2026-11-22T12:00:00Z"),
      r("coffee", "900", "food_dining", "2026-11-22T12:00:00Z"),
      r("far", "900", "housing", "2026-12-10T12:00:00Z"),
      r("rent", "1500", "housing", "2026-11-24T12:00:00Z"),
      r("car", "400", "transportation", "2026-11-23T12:00:00Z"),
    ],
    now,
  );
  expect(bill?.id).toBe("car");
  expect(bill?.daysAway).toBe(2);
  expect(upcomingBill([r("old", "900", "housing", "2026-11-19T12:00:00Z")], now)).toBeNull();
  expect(billWhen(0)).toBe("Due today");
  expect(billWhen(1)).toBe("Due tomorrow");
  expect(billWhen(4)).toBe("Due in 4 days");
  expect(billWhen(-1)).toBe("Was due yesterday");
});

test("a bill due late yesterday is a day past, never due today (M-14)", () => {
  const now = new Date(2026, 10, 21, 1, 0);
  const due = new Date(2026, 10, 20, 23, 0).toISOString();
  const bill = upcomingBill([{ id: "rent", name: "Rent", amount: "1500", category: "housing", nextDueDate: due, accountId: null }], now);
  expect(bill?.daysAway).toBe(-1);
});

test("balance value prefers the effective balance and inverts when asked", () => {
  expect(balanceValue({ effectiveBalance: 12, invertBalance: true, balance: "5" })).toBe(12);
  expect(balanceValue({ effectiveBalance: null, invertBalance: true, balance: "5" })).toBe(-5);
  expect(balanceValue({ effectiveBalance: null, invertBalance: false, balance: null })).toBe(0);
});

test("goal accents and progress", () => {
  expect(goalAccent("emergency_fund", "Emergency Fund")).toBe("brand");
  expect(goalAccent("retirement", "Retirement Savings")).toBe(0);
  expect(goalAccent("debt_payoff", "Become Debt Free")).toBe(6);
  expect(goalAccent("savings", "New car fund")).toBe(2);
  expect(goalAccent("savings", "Rainy day")).toBe(7);
  expect(goalProgress({ targetAmount: "100", currentAmount: "150" })).toMatchObject({ pct: 100, reached: true, notStarted: false });
  expect(goalProgress({ targetAmount: "100", currentAmount: "0" })).toMatchObject({ pct: 0, reached: false, notStarted: true });
});

test("onboarding resume shows only for a deferred, unfinished setup", () => {
  expect(onboardingResume({ onboardingDeferred: true, onboardingStage: "income" })).toEqual({ pct: 50, step: 2 });
  expect(onboardingResume({ onboardingDeferred: false, onboardingStage: "income" })).toBeNull();
  expect(onboardingResume({ onboardingDeferred: true, onboardingStage: null })).toBeNull();
});
