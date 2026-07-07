import { describe, it, expect } from "vitest";
import { ruleMatches, firstMatchingRule, validateRule, resolveCategoryRef, type RuleCriteria, type TxnForRules } from "../category-rules.js";

const txn = (over: Partial<TxnForRules> = {}): TxnForRules => ({
  name: "AMZN Mktp US*123",
  merchantName: "Amazon",
  amount: "42.50",
  categoryId: "cat-other",
  accountId: "acct-1",
  ...over,
});

const rule = (over: Partial<RuleCriteria> = {}): RuleCriteria => ({
  merchantContains: null,
  amountEquals: null,
  amountMin: null,
  amountMax: null,
  accountId: null,
  matchCategoryId: null,
  setCategoryId: "cat-shop",
  ...over,
});

const U_SHOP = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const U_GROC = "b1b2c3d4-e5f6-7890-abcd-ef1234567890";
const U_GONE = "c1b2c3d4-e5f6-7890-abcd-ef1234567890";
const TAX = [
  { id: U_SHOP, systemKey: "shopping" },
  { id: U_GROC, systemKey: "groceries" },
  { id: "cat-custom", systemKey: null },
];

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
  it("matches existing category by id", () => {
    expect(ruleMatches(rule({ matchCategoryId: "cat-other" }), txn())).toBe(true);
    expect(ruleMatches(rule({ matchCategoryId: "cat-groc" }), txn())).toBe(false);
  });
  it("counts matchCategoryId alone as a criterion", () => {
    expect(ruleMatches(rule({ matchCategoryId: "cat-other" }), txn())).toBe(true);
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
    const r2 = rule({ merchantContains: "amzn", setCategoryId: "cat-shop" });
    const r3 = rule({ merchantContains: "amazon", setCategoryId: "cat-ent" });
    expect(firstMatchingRule([r1, r2, r3], txn())).toBe(r2);
  });
  it("returns null when nothing matches", () => {
    expect(firstMatchingRule([rule({ merchantContains: "walmart" })], txn())).toBeNull();
  });
});

describe("validateRule", () => {
  const valid = { merchantContains: "amzn", setCategory: U_SHOP };
  it("accepts a minimal valid rule (id form)", () => {
    expect(validateRule(valid, TAX)).toBeNull();
  });
  it("rejects a systemKey setCategory (ids only)", () => {
    expect(validateRule({ merchantContains: "amzn", setCategory: "shopping" }, TAX)).toMatch(/category/i);
  });
  it("rejects a UUID setCategory unknown to the tenant", () => {
    expect(validateRule({ merchantContains: "amzn", setCategory: U_GONE }, TAX)).toMatch(/category/i);
  });
  it("accepts a UUID matchCategory and rejects an unknown one", () => {
    expect(validateRule({ ...valid, matchCategory: U_GROC }, TAX)).toBeNull();
    expect(validateRule({ ...valid, matchCategory: U_GONE }, TAX)).toMatch(/category/i);
  });
  it("requires at least one criterion", () => {
    expect(validateRule({ setCategory: U_SHOP }, TAX)).toMatch(/criterion/i);
  });
  it("requires a valid setCategory", () => {
    expect(validateRule({ merchantContains: "x", setCategory: "nope" }, TAX)).toMatch(/category/i);
  });
  it("rejects amountEquals combined with a range", () => {
    expect(validateRule({ ...valid, amountEquals: "5", amountMin: "1" }, TAX)).toMatch(/equals/i);
  });
  it("rejects min > max", () => {
    expect(validateRule({ ...valid, amountMin: "10", amountMax: "5" }, TAX)).toMatch(/min/i);
  });
  it("rejects invalid matchCategory", () => {
    expect(validateRule({ ...valid, matchCategory: "nope" }, TAX)).toMatch(/category/i);
  });
  it("rejects non-numeric and non-finite amounts", () => {
    expect(validateRule({ ...valid, amountMin: "5abc" }, TAX)).toMatch(/number/i);
    expect(validateRule({ ...valid, amountEquals: "Infinity" }, TAX)).toMatch(/number/i);
  });
  it("rejects setCategory targeting a disabled category", () => {
    const taxWithDisabled = [
      { id: U_SHOP, systemKey: "shopping", disabledAt: new Date() }, // disabled
      { id: U_GROC, systemKey: "groceries", disabledAt: null },
      { id: "cat-custom", systemKey: null, disabledAt: null },
    ];
    expect(validateRule({ merchantContains: "amzn", setCategory: U_SHOP }, taxWithDisabled)).toMatch(/disabled/i);
    expect(validateRule({ merchantContains: "amzn", setCategory: U_GROC }, taxWithDisabled)).toBeNull();
  });
});

describe("resolveCategoryRef", () => {
  it("resolves a UUID to the tenant category id", () => {
    expect(resolveCategoryRef(U_SHOP, TAX)).toBe(U_SHOP);
  });
  it("returns null for systemKeys (ids only)", () => {
    expect(resolveCategoryRef("groceries", TAX)).toBeNull();
  });
  it("returns null for unknown uuid or key", () => {
    expect(resolveCategoryRef(U_GONE, TAX)).toBeNull();
    expect(resolveCategoryRef("nope", TAX)).toBeNull();
  });
});
