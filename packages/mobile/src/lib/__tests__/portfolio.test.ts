import { holdingGain,
  accountIdFor,
  accountsIn,
  allocationSlices,
  blendedReturnOf,
  cleanAccountLabel,
  collapseSmall,
  drillFrom,
  filterByAccounts,
  fmtPct,
  holdingLabel,
  holdingMeta,
  holdingsByTicker,
  securityName,
  sortHoldings,
  toggleAccount,
  totalOf,
  type AssetClass,
  type Exposure,
} from "../portfolio";

const h = (ticker: string, value: number, account: string, name = ticker) => ({ ticker, name, shares: 1, value, costBasis: null, account });

const classes: AssetClass[] = [
  {
    name: "US Stocks",
    value: 600,
    percentage: 60,
    categories: [
      { name: "Total Market", value: 500, percentage: 50, holdings: [h("VTI", 300, "401(k)"), h("VTI", 200, "Brokerage")] },
      { name: "Large Cap", value: 100, percentage: 10, holdings: [h("AMZN", 100, "Brokerage")] },
    ],
  },
  { name: "Cash", value: 300, percentage: 30, categories: [{ name: "Savings & Checking", value: 300, percentage: 30, holdings: [h("CASH", 300, "Savings Account")] }] },
  { name: "Bonds", value: 100, percentage: 10, categories: [{ name: "Total Bond", value: 100, percentage: 10, holdings: [h("BND", 100, "401(k)")] }] },
];
const exposure: Exposure = {
  totalValue: 1000,
  blendedReturn: 6,
  exposures: [
    { name: "Total Market", assetClass: "US Stocks", value: 500, percentage: 50, historicalReturn: 10, holdings: [{ ticker: "VTI", account: "401(k)" }] },
    { name: "Large Cap", assetClass: "US Stocks", value: 100, percentage: 10, historicalReturn: 10.5, holdings: [{ ticker: "AMZN", account: "Brokerage" }] },
    { name: "Savings & Checking", assetClass: "Cash", value: 300, percentage: 30, historicalReturn: 1.5, holdings: [{ ticker: "CASH", account: "Savings Account" }] },
  ],
};

test("holdings group by ticker, cash reads as Cash and carries no return", () => {
  const rows = holdingsByTicker(classes, 1000, exposure);
  expect(rows.map((r) => [r.label, r.totalValue, r.percentage, r.historicalReturn])).toEqual([
    ["VTI", 500, 50, 10],
    ["Cash", 300, 30, null],
    ["AMZN", 100, 10, 10.5],
    ["BND", 100, 10, null],
  ]);
  expect(holdingMeta(rows[0])).toBe("US Stocks, 2 accounts");
  expect(holdingMeta(rows[1])).toBe("Cash, Savings Account");
});

test("sorting the holdings", () => {
  const rows = holdingsByTicker(classes, 1000, exposure);
  expect(sortHoldings(rows, "value:asc").map((r) => r.label)).toEqual(["AMZN", "BND", "Cash", "VTI"]);
  expect(sortHoldings(rows, "name:asc").map((r) => r.label)).toEqual(["AMZN", "BND", "Cash", "VTI"]);
  expect(sortHoldings(rows, "return:desc").map((r) => r.label)).toEqual(["AMZN", "VTI", "Cash", "BND"]);
  expect(sortHoldings(rows, "value:desc").map((r) => r.label)).toEqual(["VTI", "Cash", "AMZN", "BND"]);
});

test("the allocation by class, the web's colors, and a drill into one class", () => {
  const top = allocationSlices("assetClass", null, classes, 1000, []);
  expect(top.map((s) => [s.label, s.pct, s.chart])).toEqual([
    ["US Stocks", 60, 1],
    ["Cash", 30, 0],
    ["Bonds", 10, 5],
  ]);
  const drilled = allocationSlices("assetClass", "US Stocks", classes, 1000, []);
  // A fund held in two accounts is one row.
  expect(drilled.map((s) => [s.name, s.value, Math.round(s.pct)])).toEqual([
    ["VTI", 500, 83],
    ["AMZN", 100, 17],
  ]);
});

test("by account, by holding, and the drill never dead-ends", () => {
  const rows = holdingsByTicker(classes, 1000, exposure);
  expect(allocationSlices("account", null, classes, 1000, rows).map((s) => [s.name, s.value])).toEqual([
    ["401(k)", 400],
    ["Brokerage", 300],
    ["Savings Account", 300],
  ]);
  expect(allocationSlices("account", "Brokerage", classes, 1000, rows).map((s) => [s.name, s.value])).toEqual([
    ["VTI", 200],
    ["AMZN", 100],
  ]);
  expect(allocationSlices("holding", "VTI", classes, 1000, rows).map((s) => s.name)).toEqual(["401(k)", "Brokerage"]);
  expect(drillFrom("assetClass", null, "US Stocks")).toEqual({ groupBy: "assetClass", drill: "US Stocks" });
  expect(drillFrom("assetClass", "US Stocks", "VTI")).toEqual({ groupBy: "holding", drill: "VTI" });
  expect(drillFrom("holding", "VTI", "401(k)")).toEqual({ groupBy: "account", drill: "401(k)" });
});

test("a class named Other is shown as its holdings", () => {
  const other: AssetClass[] = [{ name: "Other", value: 50, percentage: 100, categories: [{ name: "Misc", value: 50, percentage: 100, holdings: [h("UNKNOWN", 50, "B", "Gold Fund")] }] }];
  expect(allocationSlices("assetClass", null, other, 50, []).map((s) => s.label)).toEqual(["Gold Fund"]);
  expect(holdingLabel({ ticker: "UNKNOWN", name: "Gold Fund" })).toBe("Gold Fund");
});

test("slivers fold into one Other, only when that removes two or more", () => {
  const s = (name: string, value: number) => ({ name, label: name, value, pct: value, chart: 0 });
  const folded = collapseSmall([s("A", 97), s("B", 1), s("C", 1), s("D", 1)]);
  expect(folded.map((x) => x.label)).toEqual(["A", "Other"]);
  expect(folded[1].children?.map((c) => c.name)).toEqual(["B", "C", "D"]);
  expect(collapseSmall([s("A", 99), s("B", 1)]).length).toBe(2);
  expect(fmtPct(0.05)).toBe("<0.1%");
  expect(fmtPct(0)).toBe("0%");
});

test("the account filter never empties and all chosen means no filter", () => {
  const all = accountsIn(classes);
  expect(all).toEqual(["401(k)", "Brokerage", "Savings Account"]);
  const one = toggleAccount(null, "Brokerage", all);
  expect([...one!]).toEqual(["401(k)", "Savings Account"]);
  expect(toggleAccount(one, "Brokerage", all)).toBeNull();
  expect([...toggleAccount(new Set(["401(k)"]), "401(k)", all)!]).toEqual(all);
  const only = filterByAccounts(classes, new Set(["401(k)"]));
  // The value and the shares follow the filter.
  expect(totalOf(only, 0)).toBe(400);
  expect(allocationSlices("assetClass", null, only, 400, []).map((x) => [x.label, x.pct])).toEqual([
    ["US Stocks", 75],
    ["Bonds", 25],
  ]);
  expect(only.flatMap((c) => c.categories.flatMap((x) => x.holdings.map((y) => y.account)))).toEqual(["401(k)", "401(k)"]);
});

test("labels and the account a breakdown row names", () => {
  expect(cleanAccountLabel("Alex - 529, Jordan - 000000000-01")).toBe("Alex - 529");
  expect(cleanAccountLabel("Plan 000000000-01")).toBe("Plan");
  const accounts = [
    { id: "a1", name: "Brokerage" },
    { id: "a2", name: "Joint" },
    { id: "a3", name: "Joint" },
  ];
  expect(accountIdFor("Brokerage", accounts)).toBe("a1");
  expect(accountIdFor("Joint", accounts)).toBeNull();
  expect(accountIdFor("Nope", accounts)).toBeNull();
});

test("securityName: a real security's name, never the API's stand-in rows or cash", () => {
  const row = (ticker: string, holdings: Array<{ name: string; shares: number }>) => ({
    ticker,
    label: holdingLabel({ ticker }),
    holdings: holdings.map((h) => ({ ...h, ticker, value: 1, costBasis: null, account: "Synthetic Brokerage" })),
  });
  expect(securityName(row("BND", [{ name: "Example 401(k) (assumed 40% Bonds)", shares: 0 }]))).toBeNull();
  expect(securityName(row("BND", [{ name: "Example 401(k) (assumed 40% Bonds)", shares: 0 }, { name: "Example Total Bond Fund", shares: 12 }]))).toBe("Example Total Bond Fund");
  expect(securityName(row("CASH", [{ name: "Example Savings (Cash)", shares: 500 }]))).toBeNull();
  expect(securityName(row("AMZN", [{ name: "AMZN", shares: 3 }]))).toBeNull();
});

test("a holding's gain needs real cost basis on every lot, never cash or an estimate", () => {
  const lot = (over: object) => ({ ticker: "VTI", name: "Vanguard", shares: 10, value: 2500, costBasis: 2000, account: "Brokerage", ...over });
  expect(holdingGain({ ticker: "VTI", holdings: [lot({})] })).toEqual({ amount: 500, pct: 25 });
  expect(holdingGain({ ticker: "VTI", holdings: [lot({ value: 1800 })] })).toEqual({ amount: -200, pct: -10 });
  expect(holdingGain({ ticker: "VTI", holdings: [lot({}), lot({ costBasis: null })] })).toBeNull(); // one lot without basis
  expect(holdingGain({ ticker: "VTI", holdings: [lot({ shares: 0, costBasis: 2500 })] })).toBeNull(); // the API's estimated split
  expect(holdingGain({ ticker: "VTI", holdings: [lot({ costBasis: 2500 })] })).toBeNull(); // basis equal to the balance
  expect(holdingGain({ ticker: "CASH", holdings: [lot({ ticker: "CASH" })] })).toBeNull();
  expect(holdingGain({ ticker: "VTI", holdings: [lot({ value: 2000.4 })] })).toBeNull(); // under a dollar is no gain
});

test("blendedReturnOf: the past yearly return follows the account filter, weighted like the API's", () => {
  // Total Bond has no published rate, so it takes the API's 7% default.
  expect(blendedReturnOf(classes, exposure)).toBe(7.2);
  expect(blendedReturnOf(filterByAccounts(classes, new Set(["401(k)"])), exposure)).toBe(9.25);
  expect(blendedReturnOf(filterByAccounts(classes, new Set(["Savings Account"])), exposure)).toBe(1.5);
  expect(blendedReturnOf(classes, null)).toBeNull();
  expect(blendedReturnOf([], exposure)).toBeNull();
});
