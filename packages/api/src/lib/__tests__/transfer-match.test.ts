import { describe, it, expect } from "vitest";
import { findTransferPairs, type TxnForMatch } from "../transfer-match.js";

let seq = 0;
const t = (over: Partial<TxnForMatch>): TxnForMatch => ({
  id: `t${++seq}`,
  accountId: "checking",
  amount: "500.00",
  date: new Date("2026-06-10T00:00:00Z"),
  pending: 0,
  categorySource: "auto",
  linkedTransactionId: null,
  ...over,
});

describe("findTransferPairs", () => {
  it("pairs opposite-sign equal amounts across accounts within 3 days", () => {
    const a = t({ amount: "500.00", accountId: "checking" });
    const b = t({ amount: "-500.00", accountId: "credit", date: new Date("2026-06-12T00:00:00Z") });
    expect(findTransferPairs([a, b])).toEqual([[a.id, b.id]]);
  });
  it("does not pair beyond 3 days", () => {
    const a = t({});
    const b = t({ amount: "-500.00", accountId: "credit", date: new Date("2026-06-14T06:00:00Z") });
    expect(findTransferPairs([a, b])).toEqual([]);
  });
  it("does not pair within the same account", () => {
    const a = t({});
    const b = t({ amount: "-500.00" });
    expect(findTransferPairs([a, b])).toEqual([]);
  });
  it("does not pair same-sign amounts", () => {
    const a = t({});
    const b = t({ accountId: "credit" });
    expect(findTransferPairs([a, b])).toEqual([]);
  });
  it("skips pending, manual, and already-linked rows", () => {
    const base = { amount: "-500.00", accountId: "credit" } as const;
    expect(findTransferPairs([t({}), t({ ...base, pending: 1 })])).toEqual([]);
    expect(findTransferPairs([t({}), t({ ...base, categorySource: "manual" })])).toEqual([]);
    expect(findTransferPairs([t({}), t({ ...base, linkedTransactionId: "x" })])).toEqual([]);
  });
  it("greedily prefers the closest date and pairs each row at most once", () => {
    const out = t({ amount: "500.00", accountId: "checking", date: new Date("2026-06-10T00:00:00Z") });
    const near = t({ amount: "-500.00", accountId: "credit", date: new Date("2026-06-11T00:00:00Z") });
    const far = t({ amount: "-500.00", accountId: "savings", date: new Date("2026-06-13T00:00:00Z") });
    const pairs = findTransferPairs([out, near, far]);
    expect(pairs).toEqual([[out.id, near.id]]);
  });
  it("is deterministic regardless of input order", () => {
    const a = t({ id: "a", date: new Date("2026-06-10T00:00:00Z") });
    const b = t({ id: "b", amount: "-500.00", accountId: "credit", date: new Date("2026-06-11T00:00:00Z") });
    expect(findTransferPairs([b, a])).toEqual(findTransferPairs([a, b]));
  });
  it("pairs at exactly the 3-day boundary (inclusive)", () => {
    const a = t({});
    const b = t({ amount: "-500.00", accountId: "credit", date: new Date("2026-06-13T00:00:00Z") });
    expect(findTransferPairs([a, b]).length).toBe(1);
  });
  it("is idempotent: a re-run over already-linked rows finds nothing new", () => {
    const a = t({ id: "a" });
    const b = t({ id: "b", amount: "-500.00", accountId: "credit" });
    const [[idA, idB]] = findTransferPairs([a, b]);
    const linked = [
      { ...a, linkedTransactionId: idB, categorySource: "transfer" },
      { ...b, linkedTransactionId: idA, categorySource: "transfer" },
    ];
    expect(findTransferPairs(linked)).toEqual([]);
  });
});

describe("card and loan payments", () => {
  it("pair up to 5 days apart when the credit lands on a card", () => {
    const debit = t({ amount: "3150.28", accountId: "checking", accountType: "depository", date: new Date("2026-10-13T00:00:00Z") });
    const credit = t({ amount: "-3150.28", accountId: "card", accountType: "credit", date: new Date("2026-10-08T00:00:00Z") });
    expect(findTransferPairs([debit, credit])).toEqual([[credit.id, debit.id]]);
  });
  it("still stop at 3 days between two bank accounts", () => {
    const a = t({ amount: "500.00", accountId: "checking", accountType: "depository" });
    const b = t({ amount: "-500.00", accountId: "savings", accountType: "depository", date: new Date("2026-06-14T06:00:00Z") });
    expect(findTransferPairs([a, b])).toEqual([]);
  });
  it("never pair beyond 5 days", () => {
    const debit = t({ amount: "200.00", accountId: "checking", accountType: "depository", date: new Date("2026-10-14T01:00:00Z") });
    const credit = t({ amount: "-200.00", accountId: "card", accountType: "credit", date: new Date("2026-10-08T00:00:00Z") });
    expect(findTransferPairs([debit, credit])).toEqual([]);
  });
});
