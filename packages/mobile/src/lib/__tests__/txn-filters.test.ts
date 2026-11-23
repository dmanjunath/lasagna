import { EMPTY_FILTERS, filtersToApiQuery, filtersToSearchParams, hasAnyChoice, transactionsHref } from "../txn-filters";

test("writes the scope in the names /transactions reads", () => {
  expect(
    filtersToSearchParams({
      ...EMPTY_FILTERS,
      search: " Blue Bottle ",
      categories: ["cat-1", "cat-2"],
      datePreset: "custom",
      customStart: "2026-07-01",
      customEnd: "2026-07-31",
    }),
  ).toBe("search=Blue%20Bottle&categories=cat-1,cat-2&startDate=2026-07-01&endDate=2026-07-31");
});

test("writes merchants, accounts, kind and only the used side of an amount range", () => {
  expect(filtersToSearchParams({ ...EMPTY_FILTERS, merchants: ["Blue Bottle & Co", "A, B"], accountIds: ["a", "b"] })).toBe(
    "merchant=Blue%20Bottle%20%26%20Co&merchant=A%2C%20B&accountIds=a,b",
  );
  expect(filtersToSearchParams({ ...EMPTY_FILTERS, kind: "out", amountOp: "between", amountMin: "20", amountMax: "100" })).toBe(
    "kind=out&amountOp=between&amountMin=20&amountMax=100",
  );
  expect(filtersToSearchParams({ ...EMPTY_FILTERS, amountOp: "atLeast", amountMin: "50", amountMax: "10" })).toBe(
    "amountOp=atLeast&amountMin=50",
  );
});

test("an empty filter set writes nothing", () => {
  expect(filtersToSearchParams(EMPTY_FILTERS)).toBe("");
});

test("transactionsHref carries any dimension, and a bare link says to start unfiltered", () => {
  expect(transactionsHref({ accountIds: ["a1", "a2"] })).toBe("/transactions?accountIds=a1,a2");
  expect(transactionsHref({ merchants: ["Costco"], startDate: "2026-11-01", endDate: "2026-11-30" })).toBe(
    "/transactions?merchant=Costco&startDate=2026-11-01&endDate=2026-11-30",
  );
  expect(transactionsHref({})).toBe("/transactions?fresh=1");
});

test("the GET endpoints get the filter, the window left to them", () => {
  expect(
    filtersToApiQuery({
      ...EMPTY_FILTERS,
      merchants: ["A, B"],
      accountIds: ["a"],
      pending: "hide",
      recurring: "only",
      source: "bank",
      kind: "out",
      amountOp: "atLeast",
      amountMin: "10",
      datePreset: "custom",
      customStart: "2026-01-01",
    }),
  ).toEqual(["accountIds=a", "merchant=A%2C%20B", "amountMin=10", "kind=out", "pending=false", "recurring=true", "source=bank"]);
});

test("Clear all resets the order too", () => {
  expect(hasAnyChoice({ ...EMPTY_FILTERS, sort: "oldest" })).toBe(true);
  expect(hasAnyChoice(EMPTY_FILTERS)).toBe(false);
});

test("transactionsHref keeps the day and the category scope", () => {
  expect(transactionsHref({ startDate: "2026-11-01", endDate: "2026-11-21T23:59:59", categories: ["c1"] })).toBe(
    "/transactions?categories=c1&startDate=2026-11-01&endDate=2026-11-21",
  );
  expect(transactionsHref({ startDate: "2026-07-01", endDate: "2026-07-31", excludeCategories: ["x"] })).toBe(
    "/transactions?excludeCategories=x&startDate=2026-07-01&endDate=2026-07-31",
  );
});

import type { TaxonomyGroup } from "@web/lib/api";
import {
  accountLabel,
  amountRangeInverted,
  categoryChips,
  dateChipLabel,
  dateRangeInverted,
  dateRangeLabel,
  filterChips,
  filtersFromParams,
  filtersFromQuery,
  filtersToParams,
  filtersToQuery,
  hasActiveFilters,
  hasPanelFilters,
  isDateActive,
  resolveCategoryRefs,
  parseQuery,
  wholeMonthLabel,
  wholeYearLabel,
} from "../txn-filters";

const cat = (id: string, name: string, disabled = false) => ({ id, name, systemKey: null, emoji: null, disabled, locked: false, sortOrder: 0 });
const GROUPS = [
  { id: "g-food", name: "Food & Dining", type: "expense", categories: [cat("c-coffee", "Coffee Shops"), cat("c-dining", "Dining Out"), cat("c-old", "Old", true)] },
  { id: "g-travel", name: "Travel", type: "expense", categories: [cat("c-travel", "Travel")] },
] as unknown as TaxonomyGroup[];

describe("filtersFromQuery", () => {
  test("round-trips everything filtersToSearchParams writes", () => {
    const f = {
      ...EMPTY_FILTERS,
      search: "Blue Bottle",
      merchants: ["Blue Bottle & Co", "Tea, Inc"],
      categories: ["c1", "c2"],
      excludeCategories: ["x"],
      accountIds: ["a"],
      kind: "transfer" as const,
      pending: "only" as const,
      excluded: "hide" as const,
      recurring: "only" as const,
      source: "manual" as const,
      sort: "largest" as const,
      amountOp: "between" as const,
      amountMin: "20",
      amountMax: "100",
      datePreset: "custom" as const,
      customStart: "2026-07-01",
      customEnd: "2026-07-31",
    };
    expect(filtersFromQuery(filtersToSearchParams(f))).toEqual(f);
    expect(filtersFromQuery(`?${filtersToSearchParams(f)}`)).toEqual(f);
  });

  test("a date range arrives as a custom range, keeping only the day", () => {
    const f = filtersFromQuery("startDate=2026-07-01T00:00:00&endDate=2026-07-31T23:59:59");
    expect(f).toMatchObject({ datePreset: "custom", customStart: "2026-07-01", customEnd: "2026-07-31" });
  });

  test("drops junk: bad dates, unknown kind and amountOp, empty list items", () => {
    const f = filtersFromQuery("startDate=yesterday&direction=sideways&kind=up&sort=random&pending=maybe&amountOp=huge&amountMin=5&categories=,a,,b,");
    expect(f.datePreset).toBe("all");
    expect(f.kind).toBe("all");
    expect(f.sort).toBe("newest");
    expect(f.pending).toBe("any");
    expect(f.amountOp).toBe("any");
    expect(f.amountMin).toBe("");
    expect(f.categories).toEqual(["a", "b"]);
  });

  test("reads expo-router params, where a repeated key is an array", () => {
    expect(filtersFromParams({ categories: ["a,b", "c"], search: "  tea " })).toMatchObject({ categories: ["a", "b"], search: "tea" });
  });

  test("parseQuery decodes keys, values and plus signs", () => {
    expect(parseQuery("?merchant=Blue%20Bottle&search=a+b&flag")).toEqual({ merchant: "Blue Bottle", search: "a b", flag: "" });
  });
});

test("filtersToParams sets every key, so a cleared filter leaves the route", () => {
  const p = filtersToParams({ ...EMPTY_FILTERS, categories: ["a", "b"] });
  expect(p.categories).toBe("a,b");
  expect("search" in p && p.search === undefined).toBe(true);
  expect(Object.keys(p)).toHaveLength(18);
  expect("direction" in p && p.direction === undefined).toBe(true);
});

test("a relative date preset survives the route params, a custom range wins over it", () => {
  const f = { ...EMPTY_FILTERS, datePreset: "last-month" as const, kind: "out" as const, merchants: ["A", "B"] };
  expect(filtersFromParams(filtersToParams(f))).toEqual(f);
  expect(filtersFromParams({ datePreset: "bogus" }).datePreset).toBe("all");
  expect(filtersFromParams({ datePreset: "ytd", startDate: "2026-01-05" })).toMatchObject({ datePreset: "custom", customStart: "2026-01-05" });
});

describe("filtersToQuery", () => {
  const now = new Date(2026, 10, 21); // Nov 21, 2026 local

  test("date presets", () => {
    expect(filtersToQuery({ ...EMPTY_FILTERS, datePreset: "this-month" }, now)).toEqual({ startDate: "2026-11-01" });
    expect(filtersToQuery({ ...EMPTY_FILTERS, datePreset: "last-month" }, now)).toEqual({ startDate: "2026-10-01", endDate: "2026-10-31T23:59:59" });
    expect(filtersToQuery({ ...EMPTY_FILTERS, datePreset: "last-3-months" }, now)).toEqual({ startDate: "2026-09-01" });
    expect(filtersToQuery({ ...EMPTY_FILTERS, datePreset: "ytd" }, now)).toEqual({ startDate: "2026-01-01" });
    expect(filtersToQuery({ ...EMPTY_FILTERS, datePreset: "custom", customStart: "2026-02-01", customEnd: "2026-02-10" }, now)).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-10T23:59:59",
    });
  });

  test("an inverted range is left out until fixed", () => {
    expect(filtersToQuery({ ...EMPTY_FILTERS, datePreset: "custom", customStart: "2026-03-01", customEnd: "2026-02-01" }, now)).toEqual({});
    expect(filtersToQuery({ ...EMPTY_FILTERS, amountOp: "between", amountMin: "50", amountMax: "10" }, now)).toEqual({});
  });

  test("amount bounds follow the operator", () => {
    expect(filtersToQuery({ ...EMPTY_FILTERS, amountOp: "atLeast", amountMin: "25", amountMax: "99" }, now)).toEqual({ amountMin: 25 });
    expect(filtersToQuery({ ...EMPTY_FILTERS, amountOp: "atMost", amountMin: "25", amountMax: "99" }, now)).toEqual({ amountMax: 99 });
    expect(filtersToQuery({ ...EMPTY_FILTERS, amountOp: "between", amountMin: "25", amountMax: "99" }, now)).toEqual({ amountMin: 25, amountMax: 99 });
  });

  test("status filters become booleans, any is left out", () => {
    expect(filtersToQuery({ ...EMPTY_FILTERS, pending: "only", excluded: "hide", recurring: "any", source: "bank" }, now)).toEqual({ pending: true, excluded: false, source: "bank" });
  });

  test("an old direction link becomes a kind", () => {
    expect(filtersFromQuery("direction=credit").kind).toBe("in");
    expect(filtersFromQuery("direction=debit").kind).toBe("out");
    expect(filtersFromQuery("kind=transfer&direction=credit").kind).toBe("transfer");
  });

  test("search is trimmed, lists and kind pass through", () => {
    expect(
      filtersToQuery({ ...EMPTY_FILTERS, search: "  tea ", merchants: ["Tea Co"], categories: ["c"], excludeCategories: ["x"], accountIds: ["a"], kind: "in" }, now),
    ).toEqual({ search: "tea", merchants: ["Tea Co"], categories: ["c"], excludeCategories: ["x"], accountIds: ["a"], kind: "in" });
  });
});

describe("activity checks", () => {
  test("inverted ranges", () => {
    expect(amountRangeInverted({ ...EMPTY_FILTERS, amountOp: "between", amountMin: "9", amountMax: "10" })).toBe(false);
    expect(amountRangeInverted({ ...EMPTY_FILTERS, amountOp: "between", amountMin: "90", amountMax: "10" })).toBe(true);
    expect(amountRangeInverted({ ...EMPTY_FILTERS, amountOp: "atLeast", amountMin: "90", amountMax: "10" })).toBe(false);
    expect(dateRangeInverted({ ...EMPTY_FILTERS, datePreset: "custom", customStart: "2026-02-02", customEnd: "2026-02-01" })).toBe(true);
    expect(dateRangeInverted({ ...EMPTY_FILTERS, datePreset: "custom", customStart: "2026-02-01", customEnd: "" })).toBe(false);
  });

  test("custom with no dates is not a filter yet", () => {
    expect(isDateActive({ ...EMPTY_FILTERS, datePreset: "custom" })).toBe(false);
    expect(isDateActive({ ...EMPTY_FILTERS, datePreset: "custom", customEnd: "2026-01-01" })).toBe(true);
    expect(hasPanelFilters({ ...EMPTY_FILTERS, datePreset: "custom" })).toBe(false);
  });

  test("search alone is not a panel filter but is an active one", () => {
    const f = { ...EMPTY_FILTERS, search: "tea" };
    expect(hasPanelFilters(f)).toBe(false);
    expect(hasActiveFilters(f)).toBe(true);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasPanelFilters({ ...EMPTY_FILTERS, merchants: ["Tea Co"] })).toBe(true);
    expect(hasPanelFilters({ ...EMPTY_FILTERS, amountOp: "between", amountMin: "90", amountMax: "10" })).toBe(false);
  });

  test("money in or out is set on the page, not in the sheet", () => {
    const f = { ...EMPTY_FILTERS, kind: "in" as const };
    expect(hasPanelFilters(f)).toBe(false);
    expect(hasActiveFilters(f)).toBe(true);
    expect(filterChips(f, [], [])).toEqual([]);
  });
});

describe("labels", () => {
  test("a whole month and a whole year name the period", () => {
    expect(wholeMonthLabel("2026-07-01", "2026-07-31")).toBe("July 2026");
    expect(wholeMonthLabel("2026-02-01", "2026-02-27")).toBeNull();
    expect(wholeMonthLabel("2026-07-02", "2026-07-31")).toBeNull();
    expect(wholeYearLabel("2025-01-01", "2025-12-31")).toBe("2025");
    expect(wholeYearLabel("2025-01-01", "2025-12-30")).toBeNull();
  });

  test("other spans print their ends, the year once when shared", () => {
    expect(dateRangeLabel("2026-01-01", "2026-08-31")).toBe("Jan 1 to Aug 31, 2026");
    expect(dateRangeLabel("2025-12-20", "2026-01-05")).toBe("Dec 20, 2025 to Jan 5, 2026");
    expect(dateRangeLabel("2026-03-04", "2026-03-04")).toBe("Mar 4, 2026");
    expect(dateRangeLabel("2026-03-04", "")).toBe("From Mar 4, 2026");
    expect(dateRangeLabel("", "2026-03-04")).toBe("Through Mar 4, 2026");
    expect(dateRangeLabel("", "")).toBeNull();
  });

  test("date chip falls back to the preset name", () => {
    expect(dateChipLabel({ ...EMPTY_FILTERS, datePreset: "ytd" })).toBe("Year to date");
    expect(dateChipLabel({ ...EMPTY_FILTERS, datePreset: "custom", customStart: "2026-11-01", customEnd: "2026-11-30" })).toBe("November 2026");
  });

  test("a shared account name gets its mask", () => {
    const accounts = [
      { id: "1", name: "Card", mask: "1111" },
      { id: "2", name: "Card", mask: "2222" },
      { id: "3", name: "Checking", mask: "3333" },
    ];
    expect(accountLabel(accounts[0], accounts)).toBe("Card ••1111");
    expect(accountLabel(accounts[2], accounts)).toBe("Checking");
  });
});

describe("chips", () => {
  test("a fully selected group collapses into one chip, disabled children aside", () => {
    expect(categoryChips(["c-coffee", "c-dining", "c-travel"], GROUPS).map((c) => c.label)).toEqual(["Food & Dining", "Travel"]);
    expect(categoryChips(["c-coffee"], GROUPS).map((c) => c.label)).toEqual(["Coffee Shops"]);
    expect(categoryChips(["00000000-0000-0000-0000-000000000000", "legacy"], GROUPS).map((c) => c.label)).toEqual(["Unavailable category", "legacy"]);
  });

  test("each chip carries the filters its removal leaves", () => {
    const f = {
      ...EMPTY_FILTERS,
      search: "tea",
      merchants: ["Tea Co"],
      categories: ["c-coffee", "c-dining"],
      excludeCategories: ["c-travel"],
      accountIds: ["a1"],
      datePreset: "this-month" as const,
      amountOp: "atLeast" as const,
      amountMin: "5",
      kind: "in" as const,
      pending: "hide" as const,
      source: "manual" as const,
      sort: "oldest" as const,
    };
    const chips = filterChips(f, GROUPS, [{ id: "a1", name: "Checking", mask: "1" }]);
    expect(chips.map((c) => c.label)).toEqual([
      '"tea"',
      "Tea Co",
      "Only Food & Dining",
      "Except Travel",
      "Checking",
      "This month",
      "≥$5",
      "No pending",
      "Entered by you",
      "Oldest first",
    ]);
    expect(chips[7].next.pending).toBe("any");
    expect(chips[9].next.sort).toBe("newest");
    expect(chips[1].next.merchants).toEqual([]);
    expect(chips[2].tone).toBe("brand");
    expect(chips[2].next.categories).toEqual([]);
    expect(chips[3].removeLabel).toBe("Stop excluding Travel");
    expect(chips[4].next.accountIds).toEqual([]);
    expect(chips[5].next.datePreset).toBe("all");
    expect(chips[6].next).toMatchObject({ amountOp: "any", amountMin: "" });
  });

  test("an amount range chip, and none while it's backwards", () => {
    expect(filterChips({ ...EMPTY_FILTERS, amountOp: "between", amountMin: "5", amountMax: "9" }, GROUPS, []).map((c) => c.label)).toEqual(["$5 to $9"]);
    expect(filterChips({ ...EMPTY_FILTERS, amountOp: "atMost", amountMax: "9" }, GROUPS, []).map((c) => c.label)).toEqual(["≤$9"]);
    expect(filterChips({ ...EMPTY_FILTERS, amountOp: "between", amountMin: "50", amountMax: "9" }, GROUPS, [])).toEqual([]);
  });
});

describe("category references from a link (M-6)", () => {
  const ID = "11111111-2222-3333-4444-555555555555";
  const groups = [
    { id: "g", name: "Food", type: "expense", categories: [{ id: ID, name: "Groceries", systemKey: "groceries", emoji: null, disabled: false }] },
  ] as never;
  test("ids pass, keys become ids, unknown slugs drop", () => {
    expect(resolveCategoryRefs([ID], groups)).toBeNull();
    expect(resolveCategoryRefs(["groceries"], groups)).toEqual([ID]);
    expect(resolveCategoryRefs(["Groceries", ID, "nope"], groups)).toEqual([ID]);
    expect(resolveCategoryRefs(["nope"], groups)).toEqual([]);
  });
});
