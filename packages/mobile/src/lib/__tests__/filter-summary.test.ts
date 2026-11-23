import { accountsSummary, amountSummary, categoriesSummary, dateSummary, merchantsSummary, sortSummary, statusSummary } from "../filter-summary";
import { EMPTY_FILTERS, type TxnFilters } from "../txn-filters";

const f = (patch: Partial<TxnFilters>): TxnFilters => ({ ...EMPTY_FILTERS, ...patch });
const groups = [
  { id: "g1", name: "Food", type: "expense", categories: [{ id: "c1", name: "Groceries" }, { id: "c2", name: "Restaurants" }] },
  { id: "g2", name: "Home", type: "expense", categories: [{ id: "c3", name: "Rent" }, { id: "c4", name: "Utilities" }] },
] as never;

test("defaults read as unset", () => {
  expect(sortSummary(EMPTY_FILTERS)).toEqual({ value: "Newest first", set: false });
  expect(dateSummary(EMPTY_FILTERS)).toEqual({ value: "All time", set: false });
  expect(categoriesSummary(EMPTY_FILTERS, groups)).toEqual({ value: "All", set: false });
  expect(accountsSummary(EMPTY_FILTERS, [])).toEqual({ value: "All", set: false });
  expect(merchantsSummary(EMPTY_FILTERS)).toEqual({ value: "All", set: false });
  expect(amountSummary(EMPTY_FILTERS)).toEqual({ value: "Any", set: false });
  expect(statusSummary(EMPTY_FILTERS)).toEqual({ value: "Any", set: false });
});

test("sort and date name the choice", () => {
  expect(sortSummary(f({ sort: "largest" }))).toEqual({ value: "Largest amount", set: true });
  expect(dateSummary(f({ datePreset: "last-month" }))).toEqual({ value: "Last month", set: true });
});

test("categories: one, several, a whole group, and all except", () => {
  expect(categoriesSummary(f({ categories: ["c1"] }), groups).value).toBe("Groceries");
  expect(categoriesSummary(f({ categories: ["c1", "c3"] }), groups).value).toBe("2 selected");
  expect(categoriesSummary(f({ categories: ["c1", "c2"] }), groups).value).toBe("Food");
  expect(categoriesSummary(f({ excludeCategories: ["c3"] }), groups)).toEqual({ value: "All except Rent", set: true });
  expect(categoriesSummary(f({ excludeCategories: ["c1", "c3"] }), groups).value).toBe("All except 2");
});

test("accounts and merchants: one by name, more as a count", () => {
  const accts = [{ id: "a1", name: "Checking" }];
  expect(accountsSummary(f({ accountIds: ["a1"] }), accts).value).toBe("Checking");
  expect(accountsSummary(f({ accountIds: ["a1", "a2"] }), accts).value).toBe("2 selected");
  expect(merchantsSummary(f({ merchants: ["Costco"] })).value).toBe("Costco");
  expect(merchantsSummary(f({ merchants: ["Costco", "CVS", "AMC"] })).value).toBe("3 selected");
});

test("amount reads Any until a figure is typed", () => {
  expect(amountSummary(f({ amountOp: "between" })).set).toBe(false);
  expect(amountSummary(f({ amountOp: "between", amountMin: "20", amountMax: "100" }))).toEqual({ value: "$20 to $100", set: true });
  expect(amountSummary(f({ amountOp: "atLeast", amountMin: "50" })).value).toBe("At least $50");
  expect(amountSummary(f({ amountOp: "atMost", amountMax: "10" })).value).toBe("At most $10");
});

test("status: one named, several counted, only the page's fields", () => {
  expect(statusSummary(f({ pending: "only" })).value).toBe("Pending only");
  expect(statusSummary(f({ source: "manual" })).value).toBe("You only");
  expect(statusSummary(f({ pending: "hide", recurring: "only" }))).toEqual({ value: "2 set", set: true });
  expect(statusSummary(f({ excluded: "only" }), ["pending", "recurring", "source"]).set).toBe(false);
});
