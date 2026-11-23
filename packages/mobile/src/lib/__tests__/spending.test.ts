import { paceVerdict, rowPace,
  breakdownRows,
  changeLine,
  chartScale,
  columnLabel,
  earliestYearOf,
  monthsBackTo,
  periodKey,
  periodRange,
  periodTitle,
  rowIds,
  savingsRate,
  scopeFromQuery,
  scopeSummary,
  shortMoney,
  stepBounds,
  stepPeriod,
  withGranularity,
  type SpendingCategory,
} from "../spending";

const NOW = new Date(2026, 10, 22); // Nov 22, 2026
const ID = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;

const cat = (p: Partial<SpendingCategory>): SpendingCategory => ({
  id: ID(1),
  name: "Groceries",
  systemKey: null,
  groupId: "g-food",
  groupName: "Food",
  groupType: "expense",
  total: 100,
  count: 1,
  percentage: 0,
  ...p,
});

test("a link's period and filter, else the current month", () => {
  expect(scopeFromQuery("", NOW).period).toEqual({ granularity: "month", year: 2026, month: 10 });
  expect(scopeFromQuery("period=2026-07", NOW).period).toEqual({ granularity: "month", year: 2026, month: 6 });
  expect(scopeFromQuery("period=2025", NOW).period.granularity).toBe("year");
  expect(scopeFromQuery(`categories=${ID(1)},junk`, NOW).filter).toEqual({ include: [ID(1)], exclude: [] });
});

test("period keys, ranges and titles", () => {
  const feb = { granularity: "month" as const, year: 2028, month: 1 };
  expect(periodKey(feb)).toBe("2028-02");
  expect(periodRange(feb)).toEqual({ startDate: "2028-02-01", endDate: "2028-02-29T23:59:59" });
  expect(periodTitle(feb)).toBe("February 2028");
  expect(periodRange({ granularity: "year", year: 2025, month: 0 })).toEqual({ startDate: "2025-01-01", endDate: "2025-12-31T23:59:59" });
});

test("the stepper stops at now and at the first year with data", () => {
  const nov = { granularity: "month" as const, year: 2026, month: 10 };
  expect(stepPeriod(nov, 1, NOW)).toEqual(nov);
  expect(stepPeriod(nov, -1, NOW).month).toBe(9);
  expect(stepPeriod({ granularity: "month", year: 2026, month: 0 }, -1, NOW)).toMatchObject({ year: 2025, month: 11 });
  expect(stepBounds(nov, 2025, NOW)).toEqual({ canBack: true, canForward: false });
  expect(stepBounds({ granularity: "month", year: 2025, month: 0 }, 2025, NOW).canBack).toBe(false);
  expect(stepBounds(nov, null, NOW).canBack).toBe(false);
  expect(stepBounds(nov, undefined, NOW).canBack).toBe(true);
});

test("switching granularity keeps the year in view", () => {
  const jul = { granularity: "month" as const, year: 2025, month: 6 };
  expect(withGranularity(jul, "year", NOW)).toMatchObject({ granularity: "year", year: 2025 });
  expect(withGranularity(withGranularity(jul, "year", NOW), "month", NOW)).toEqual(jul);
});

test("the earliest year with money in or out", () => {
  expect(earliestYearOf([{ period: "2024", income: 0, expenses: 0, net: 0 }, { period: "2025", income: 5, expenses: 0, net: 5 }])).toBe(2025);
  expect(earliestYearOf([])).toBeNull();
});

test("the summary under a filter sums the surviving rows", () => {
  const s = {
    categories: [
      cat({ id: ID(1), total: 100.1 }),
      cat({ id: ID(2), name: "Dining", total: 50.2 }),
      cat({ id: ID(3), name: "Pay", groupType: "income", groupId: "g-inc", groupName: "Income", total: 1000 }),
      cat({ id: ID(4), name: "Transfer", groupType: "transfer", total: 999 }),
    ],
    totalSpending: 150.3,
    totalIncome: 1000,
    netCashFlow: 849.7,
  };
  expect(scopeSummary(s, { include: [], exclude: [] }).spending).toBe(150.3);
  const only = scopeSummary(s, { include: [ID(1)], exclude: [] });
  expect(only).toMatchObject({ spending: 100.1, incomeTotal: 0, net: -100.1 });
  const except = scopeSummary(s, { include: [], exclude: [ID(2)] });
  expect(except).toMatchObject({ spending: 100.1, incomeTotal: 1000, net: 899.9 });
  expect(except.expenses.map((c) => c.id)).toEqual([ID(1)]);
});

test("savings rate", () => {
  expect(savingsRate(1000, 250)).toBe(75);
  expect(savingsRate(0, 250)).toBeNull();
});

test("the change says it in words, never as a signed percent", () => {
  const trend = [
    { period: "2026-09", income: 0, expenses: 200, net: 0 },
    { period: "2026-10", income: 0, expenses: 150, net: 0 },
    { period: "2026-11", income: 0, expenses: 10, net: 0 },
  ];
  expect(changeLine(trend, "2026-10", 150, "month", NOW)).toBe("25% less than last month");
  expect(changeLine(trend, "2026-11", 10, "month", NOW)).toBe("So far this month");
  expect(changeLine(trend, "2026-09", 200, "month", NOW)).toBeNull();
  expect(changeLine([{ period: "2026-09", income: 0, expenses: 100, net: 0 }, ...trend.slice(1)], "2026-10", 150, "month", NOW)).toBe("50% more than last month");
});

test("breakdown rolls categories into groups, largest first", () => {
  const rows = breakdownRows([
    cat({ id: ID(1), total: 100 }),
    cat({ id: ID(2), name: "Dining", total: 300 }),
    cat({ id: ID(3), name: "Rent", groupId: "g-home", groupName: "Home", total: 350 }),
    cat({ id: null, name: "Other", groupId: null, groupName: "", total: 5 }),
  ]);
  expect(rows.map((r) => [r.label, r.total])).toEqual([["Food", 400], ["Home", 350], ["Other", 5]]);
  expect(rows[0].children.map((c) => c.label)).toEqual(["Dining", "Groceries"]);
  expect(rowIds(rows[0])).toEqual([ID(2), ID(1)]);
  expect(rowIds(rows[2])).toEqual([]);
  expect(breakdownRows([cat({}), cat({ id: ID(3), groupId: "g-a", groupName: "Auto", total: 1 })], "label:asc").map((r) => r.label)).toEqual(["Auto", "Food"]);
});

test("income breaks down by category, and the trend reaches back to January", () => {
  const inc = [
    cat({ id: ID(1), name: "Paycheck", groupType: "income", groupId: "g-inc", groupName: "Income", total: 900 }),
    cat({ id: ID(2), name: "Interest", groupType: "income", groupId: "g-inc", groupName: "Income", total: 10 }),
  ];
  expect(breakdownRows(inc, "amount:desc", true).map((r) => [r.label, rowIds(r)])).toEqual([["Paycheck", [ID(1)]], ["Interest", [ID(2)]]]);
  expect(monthsBackTo(2026, NOW)).toBe(11);
  expect(monthsBackTo(2025, NOW)).toBe(23);
});

test("chart scale is mirrored and signed", () => {
  const s = chartScale([{ period: "2026-10", income: 4000, expenses: 3000, net: 1000 }]);
  expect(s.top).toBeCloseTo(4320);
  expect(s.bottom).toBeCloseTo(-3240);
  expect(s.ticks).toEqual([-2500, 0, 2500]);
  expect(chartScale([]).ticks).toEqual([0]);
  expect(shortMoney(-2500)).toBe("−$2.5K");
  expect(shortMoney(1_200_000)).toBe("$1.2M");
  expect(columnLabel("2026-01", true)).toBe("Jan ’26");
  expect(columnLabel("2026", false)).toBe("2026");
});

test("pace: prorated against the usual month, a tenth either way, never early in the month", () => {
  const now = new Date(2026, 10, 15, 12); // Nov 15: half of a 30-day month gone
  expect(paceVerdict(300, 400, "2026-11", now)).toBe("bad"); // expected 200
  expect(paceVerdict(150, 400, "2026-11", now)).toBe("good");
  expect(paceVerdict(210, 400, "2026-11", now)).toBeNull(); // within a tenth
  expect(paceVerdict(300, 400, "2026-11", new Date(2026, 10, 6, 12))).toBeNull(); // before the 7th
  expect(paceVerdict(500, 400, "2026-10", now)).toBe("bad"); // a past month against the whole usual
  expect(paceVerdict(500, null, "2026-10", now)).toBeNull(); // no usual, no marker
  expect(paceVerdict(500, 400, "2026", now)).toBeNull(); // a year
});

test("pace: a group row adds up its categories that have a usual", () => {
  const now = new Date(2026, 10, 15, 12);
  const row = {
    key: "g", label: "Food", total: 380,
    children: [
      { id: "a", label: "Groceries", total: 300, usual: 400 },
      { id: "b", label: "Dining", total: 80, usual: null },
    ],
  };
  expect(rowPace(row, "2026-11", now)).toBe("bad"); // 300 against 200
  expect(rowPace({ ...row, children: [row.children[1]] }, "2026-11", now)).toBeNull();
});
