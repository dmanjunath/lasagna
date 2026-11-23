import { describe, it, expect, vi } from "vitest";

vi.mock("../account-balances.js", () => ({ excludedTxnAccountIds: async () => [] }));

import { PgDialect, and } from "@lasagna/core";
import { parseTxnFilter, parseTxnFilterQuery, txnFilterConditions } from "../txn-filter.js";
import { validateQueryBody } from "../txn-query.js";

const render = (frag: any) => new PgDialect().sqlToQuery(frag);
const U1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const T = "00000000-0000-0000-0000-000000000001";

describe("parseTxnFilter", () => {
  it("reads every dimension", () => {
    const r = parseTxnFilter({
      search: " rent ", kind: "out", categories: [U1], excludeCategories: [U1], categoryGroups: [U1],
      accountIds: ["acct"], merchants: ["Corner Cafe", " Grocer "], amountMin: 5, amountMax: 50,
      startDate: "2026-01-01", endDate: "2026-02-01", pending: true, excluded: false, recurring: true, source: "manual",
    }) as any;
    expect(r.ok).toMatchObject({
      search: "rent", kind: "out", categoryIds: [U1], excludeCategoryIds: [U1], categoryGroupIds: [U1],
      accountIds: ["acct"], merchants: ["Corner Cafe", "Grocer"], amountMin: 5, amountMax: 50,
      pending: true, excluded: false, recurring: true, source: "manual",
    });
  });
  it("maps the old direction field onto kind", () => {
    expect((parseTxnFilter({ direction: "credit" }) as any).ok.kind).toBe("in");
    expect((parseTxnFilter({ direction: "debit" }) as any).ok.kind).toBe("out");
    expect(parseTxnFilter({ direction: "sideways" })).toEqual({ error: "direction must be credit or debit" });
  });
  it("kind wins over direction, and all is no filter", () => {
    expect((parseTxnFilter({ kind: "transfer", direction: "credit" }) as any).ok.kind).toBe("transfer");
    expect((parseTxnFilter({ kind: "all" }) as any).ok.kind).toBeUndefined();
  });
  it("folds the old single merchant into merchants", () => {
    expect((parseTxnFilter({ merchant: "Grocer", merchants: ["Grocer", "Cafe"] }) as any).ok.merchants).toEqual(["Grocer", "Cafe"]);
  });
  it("rejects bad values", () => {
    expect(parseTxnFilter({ kind: "both" })).toHaveProperty("error");
    expect(parseTxnFilter({ source: "csv" })).toHaveProperty("error");
    expect(parseTxnFilter({ pending: "maybe" })).toHaveProperty("error");
    expect(parseTxnFilter({ categoryGroups: ["food"] })).toHaveProperty("error");
    expect(parseTxnFilter({ merchants: "Grocer" })).toHaveProperty("error");
  });
});

describe("parseTxnFilterQuery", () => {
  it("reads comma ids, repeated merchants and booleans", () => {
    const q: Record<string, string> = { categories: `${U1},stale`, accountIds: "a,b", kind: "in", pending: "false", source: "bank" };
    const r = parseTxnFilterQuery((k) => q[k], (k) => (k === "merchant" ? ["A, Inc.", "B"] : undefined)) as any;
    expect(r.ok).toMatchObject({ categoryIds: [U1], accountIds: ["a", "b"], kind: "in", pending: false, source: "bank", merchants: ["A, Inc.", "B"] });
  });
  it("keeps the old single accountId", () => {
    const r = parseTxnFilterQuery((k) => (k === "accountId" ? "x" : undefined), () => undefined) as any;
    expect(r.ok.accountIds).toEqual(["x"]);
  });
});

describe("validateQueryBody uses the universal filter", () => {
  it("passes the new dimensions through", () => {
    const r = validateQueryBody({ filters: { kind: "transfer", recurring: false } }) as any;
    expect(r.ok.filters).toEqual({ kind: "transfer", recurring: false });
  });
});

describe("txnFilterConditions", () => {
  it("qualifies the outer table inside every correlated subquery", async () => {
    const conds = await txnFilterConditions(T, { search: "x", kind: "out", recurring: true, categoryGroupIds: [U1] });
    const q = render(and(...conds));
    // An unqualified account_id or category_id inside a subquery would bind to
    // the subquery's own table and match every row.
    expect(q.sql).toContain('r.account_id = "transactions"."account_id"');
    expect(q.sql).toContain('c.id = "transactions"."category_id"');
    expect(q.sql).toContain('"transactions"."category_id" in (select c.id from categories c where c.group_id in');
  });
  it("in and out leave transfers out, transfer is only them", async () => {
    for (const kind of ["in", "out"] as const) {
      const q = render(and(...(await txnFilterConditions(T, { kind }))));
      expect(q.sql).toMatch(/and not coalesce\(\(select cg\.type::text/);
    }
    const t = render(and(...(await txnFilterConditions(T, { kind: "transfer" }))));
    expect(t.sql).toContain("= 'transfer'");
    expect(t.sql).not.toContain('"amount" <');
  });
  it("search also covers notes and the category name", async () => {
    const q = render(and(...(await txnFilterConditions(T, { search: "rent" }))));
    expect(q.sql).toContain('"transactions"."notes" ILIKE');
    expect(q.sql).toContain("c.name ILIKE");
  });
});
