import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor, validateQueryBody, buildKeysetPredicate, cursorForRow } from "../txn-query.js";
import { PgDialect } from "@lasagna/core";

const render = (sqlFrag: any) => new PgDialect().sqlToQuery(sqlFrag);

describe("cursor codec", () => {
  it("roundtrips", () => {
    const c = { v: "2026-07-01T00:00:00.000Z", id: "abc-123" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it("rejects garbage", () => {
    expect(decodeCursor("not-base64!@#")).toBeNull();
    expect(decodeCursor(Buffer.from('{"x":1}').toString("base64url"))).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

describe("validateQueryBody", () => {
  it("normalizes an empty body to defaults", () => {
    const r = validateQueryBody({});
    expect(r).toMatchObject({
      ok: {
        filters: {}, groupBy: null,
        sort: { field: "date", dir: "desc" },
        limit: 50, cursor: null,
      },
    });
  });
  it("clamps limit to 1..100", () => {
    expect((validateQueryBody({ limit: 500 }) as any).ok.limit).toBe(100);
    expect((validateQueryBody({ limit: 0 }) as any).ok.limit).toBe(1);
    expect((validateQueryBody({ limit: "abc" }) as any).ok.limit).toBe(50);
  });
  it("rejects unknown categories, groupBy, sort values", () => {
    expect(validateQueryBody({ filters: { categories: ["nope"] } })).toEqual({ error: "categories must be category ids" });
    expect(validateQueryBody({ groupBy: "account" })).toEqual({ error: "groupBy must be date, category, group, or merchant" });
    expect(validateQueryBody({ sort: { field: "merchant", dir: "desc" } })).toHaveProperty("error");
    expect(validateQueryBody({ sort: { field: "date", dir: "sideways" } })).toHaveProperty("error");
  });
  it("accepts groupBy group", () => {
    expect((validateQueryBody({ groupBy: "group" }) as any).ok.groupBy).toBe("group");
  });
  it("routes an all-UUID categories array to categoryIds", () => {
    const u1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const u2 = "b1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const r = validateQueryBody({ filters: { categories: [u1, u2] } }) as any;
    expect(r.ok.filters.categoryIds).toEqual([u1, u2]);
  });
  it("rejects legacy systemKey category filters (ids only)", () => {
    expect(validateQueryBody({ filters: { categories: ["groceries", "gas"] } })).toEqual({
      error: "categories must be category ids",
    });
  });
  it("rejects a mixed ids/keys categories array", () => {
    const u1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(validateQueryBody({ filters: { categories: ["groceries", u1] } })).toEqual({
      error: "categories must be category ids",
    });
  });
  it("rejects amountMin > amountMax and non-finite amounts", () => {
    expect(validateQueryBody({ filters: { amountMin: 10, amountMax: 5 } })).toHaveProperty("error");
    expect(validateQueryBody({ filters: { amountMin: Infinity } })).toHaveProperty("error");
  });
  it("rejects unparseable dates and garbage cursors", () => {
    expect(validateQueryBody({ filters: { startDate: "not-a-date" } })).toHaveProperty("error");
    expect(validateQueryBody({ cursor: "garbage" })).toHaveProperty("error");
  });
  it("rejects a valid-shape cursor with a non-UUID id", () => {
    expect(validateQueryBody({ cursor: encodeCursor({ v: "2026-07-01T00:00:00.000Z", id: "not-a-uuid" }) })).toHaveProperty("error");
  });
  it("rejects a date-sort cursor whose v is not a valid date", () => {
    const validUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(validateQueryBody({ cursor: encodeCursor({ v: "garbage", id: validUuid }) })).toHaveProperty("error");
  });
  it("rejects an amount-sort cursor whose v is an ISO date string", () => {
    const validUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(validateQueryBody({ sort: { field: "amount", dir: "desc" }, cursor: encodeCursor({ v: "2026-07-01T00:00:00.000Z", id: validUuid }) })).toHaveProperty("error");
  });
  it("accepts an amount-sort cursor whose v is a negative decimal", () => {
    const validUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(validateQueryBody({ sort: { field: "amount", dir: "desc" }, cursor: encodeCursor({ v: "-42.50", id: validUuid }) })).toHaveProperty("ok");
  });
  it("accepts a full valid body", () => {
    const r = validateQueryBody({
      filters: { search: " amzn ", categories: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"], accountIds: ["a1"], startDate: "2026-01-01", endDate: "2026-12-31", amountMin: 1, amountMax: 100, merchant: "Starbucks" },
      groupBy: "merchant", sort: { field: "amount", dir: "asc" }, limit: 20,
    }) as any;
    expect(r.ok.filters.search).toBe("amzn");
    expect(r.ok.groupBy).toBe("merchant");
    expect(r.ok.sort).toEqual({ field: "amount", dir: "asc" });
  });
});

describe("buildKeysetPredicate", () => {
  const cur = { v: "2026-07-01T00:00:00.000Z", id: "id-9" };
  it.each([
    ["date", "desc", "<"],
    ["date", "asc", ">"],
    ["amount", "desc", "<"],
    ["amount", "asc", ">"],
  ] as const)("%s %s uses row-wise %s with id tie-break", (field, dir, op) => {
    const q = render(buildKeysetPredicate({ field, dir }, field === "amount" ? { v: "42.50", id: "id-9" } : cur));
    expect(q.sql).toContain(op);
    // row-wise comparison carries both the field value and the id as params
    expect(q.params).toContain(field === "amount" ? "42.50" : cur.v);
    expect(q.params).toContain("id-9");
    // pin the right column and cast in the rendered SQL
    if (field === "amount") {
      expect(q.sql).toContain('"amount"');
      expect(q.sql).toContain("::numeric");
    } else {
      expect(q.sql).toContain('"date"');
      expect(q.sql).toContain("::timestamptz");
    }
  });
});

describe("cursorForRow", () => {
  const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  it("returns ISO date string for date sort", () => {
    const row = { date: new Date("2026-07-01T12:00:00.000Z"), amount: "42.50", id };
    expect(cursorForRow({ field: "date", dir: "desc" }, row)).toEqual({ v: "2026-07-01T12:00:00.000Z", id });
  });
  it("returns amount string for amount sort", () => {
    const row = { date: "2026-07-01T12:00:00.000Z", amount: "-42.50", id };
    expect(cursorForRow({ field: "amount", dir: "asc" }, row)).toEqual({ v: "-42.50", id });
  });
});
