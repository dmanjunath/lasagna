import { describe, it, expect } from "vitest";
import { ruleMatches, firstMatchingRule, validateRule, type RuleCriteria, type TxnForRules } from "../category-rules.js";

const txn = (over: Partial<TxnForRules> = {}): TxnForRules => ({
  name: "AMZN Mktp US*123",
  merchantName: "Amazon",
  amount: "42.50",
  category: "other",
  accountId: "acct-1",
  ...over,
});

const rule = (over: Partial<RuleCriteria> = {}): RuleCriteria => ({
  merchantContains: null,
  amountEquals: null,
  amountMin: null,
  amountMax: null,
  accountId: null,
  matchCategory: null,
  setCategory: "shopping",
  ...over,
});

describe("ruleMatches", () => {
  it("matches merchant substring case-insensitively against name", () => {
    expect(ruleMatches(rule({ merchantContains: "amzn" }), txn())).toBe(true);
  });
  it("matches merchant substring against merchantName", () => {
    expect(ruleMatches(rule({ merchantContains: "amazon" }), txn())).toBe(true);
  });
  it("rejects when merchant text is absent from both fields", () => {
    expect(ruleMatches(rule({ merchantContains: "walmart" }), txn())).toBe(false);
  });
  it("matches amountEquals against absolute amount (charge and refund)", () => {
    expect(ruleMatches(rule({ amountEquals: "42.50" }), txn())).toBe(true);
    expect(ruleMatches(rule({ amountEquals: "42.50" }), txn({ amount: "-42.50" }))).toBe(true);
    expect(ruleMatches(rule({ amountEquals: "42.51" }), txn())).toBe(false);
  });
  it("matches amount range inclusively on abs(amount)", () => {
    expect(ruleMatches(rule({ amountMin: "40", amountMax: "45" }), txn())).toBe(true);
    expect(ruleMatches(rule({ amountMin: "43" }), txn())).toBe(false);
    expect(ruleMatches(rule({ amountMax: "42" }), txn())).toBe(false);
  });
  it("matches accountId exactly", () => {
    expect(ruleMatches(rule({ accountId: "acct-1" }), txn())).toBe(true);
    expect(ruleMatches(rule({ accountId: "acct-2" }), txn())).toBe(false);
  });
  it("matches existing category", () => {
    expect(ruleMatches(rule({ matchCategory: "other" }), txn())).toBe(true);
    expect(ruleMatches(rule({ matchCategory: "groceries" }), txn())).toBe(false);
  });
  it("ANDs all provided criteria", () => {
    const r = rule({ merchantContains: "amazon", amountMin: "40", accountId: "acct-1" });
    expect(ruleMatches(r, txn())).toBe(true);
    expect(ruleMatches(r, txn({ accountId: "acct-2" }))).toBe(false);
  });
  it("never matches a rule with no criteria (safety)", () => {
    expect(ruleMatches(rule(), txn())).toBe(false);
  });
});

describe("firstMatchingRule", () => {
  it("returns the first matching rule in array order", () => {
    const r1 = rule({ merchantContains: "walmart" });
    const r2 = rule({ merchantContains: "amzn", setCategory: "shopping" });
    const r3 = rule({ merchantContains: "amazon", setCategory: "entertainment" });
    expect(firstMatchingRule([r1, r2, r3], txn())).toBe(r2);
  });
  it("returns null when nothing matches", () => {
    expect(firstMatchingRule([rule({ merchantContains: "walmart" })], txn())).toBeNull();
  });
});

describe("validateRule", () => {
  const valid = { merchantContains: "amzn", setCategory: "shopping" };
  it("accepts a minimal valid rule", () => {
    expect(validateRule(valid)).toBeNull();
  });
  it("requires at least one criterion", () => {
    expect(validateRule({ setCategory: "shopping" })).toMatch(/criterion/i);
  });
  it("requires a valid setCategory", () => {
    expect(validateRule({ merchantContains: "x", setCategory: "nope" })).toMatch(/category/i);
  });
  it("rejects amountEquals combined with a range", () => {
    expect(validateRule({ ...valid, amountEquals: "5", amountMin: "1" })).toMatch(/equals/i);
  });
  it("rejects min > max", () => {
    expect(validateRule({ ...valid, amountMin: "10", amountMax: "5" })).toMatch(/min/i);
  });
  it("rejects invalid matchCategory", () => {
    expect(validateRule({ ...valid, matchCategory: "nope" })).toMatch(/category/i);
  });
  it("rejects non-numeric and non-finite amounts", () => {
    expect(validateRule({ ...valid, amountMin: "5abc" })).toMatch(/number/i);
    expect(validateRule({ ...valid, amountEquals: "Infinity" })).toMatch(/number/i);
  });
});
