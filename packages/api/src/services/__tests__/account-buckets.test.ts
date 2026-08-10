import { describe, it, expect } from "vitest";
import { bucketFor, bucketBalances, isEarmarked, type Bucket } from "../account-buckets.js";

describe("bucketFor", () => {
  it("classifies tax-treatment buckets from type/subtype", () => {
    expect(bucketFor("investment", "401k")).toBe<Bucket>("deferred");
    expect(bucketFor("investment", "roth 401k")).toBe<Bucket>("roth");
    expect(bucketFor("investment", "roth ira")).toBe<Bucket>("roth");
    expect(bucketFor("investment", "ira")).toBe<Bucket>("deferred");
    expect(bucketFor("investment", "hsa")).toBe<Bucket>("hsa");
    expect(bucketFor("investment", "brokerage")).toBe<Bucket>("taxable");
    expect(bucketFor("depository", "checking")).toBe<Bucket>("taxable");
  });
});

describe("isEarmarked", () => {
  it("flags 529/custodial/UTMA-style accounts by name or subtype", () => {
    expect(isEarmarked("Kids 529 / custodial brokerage", null)).toBe(true);
    expect(isEarmarked("College Fund", "529")).toBe(true);
    expect(isEarmarked("Junior's UTMA", null)).toBe(true);
    expect(isEarmarked("Coverdell ESA", null)).toBe(true);
  });
  it("does not flag ordinary accounts", () => {
    expect(isEarmarked("Brokerage Account", null)).toBe(false);
    expect(isEarmarked("Vanguard Brokerage", "brokerage")).toBe(false);
    expect(isEarmarked("Fidelity 401(k)", "401k")).toBe(false);
  });
});

describe("bucketBalances", () => {
  it("sums investable balances into buckets, ignoring non-investable and non-positive", () => {
    const b = bucketBalances([
      { type: "investment", subtype: "401k", rawBalance: 100_000 },
      { type: "investment", subtype: "roth ira", rawBalance: 40_000 },
      { type: "depository", subtype: "checking", rawBalance: 10_000 },
      { type: "investment", subtype: "hsa", rawBalance: 5_000 },
      { type: "real_estate", subtype: null, rawBalance: 900_000 }, // ignored
      { type: "investment", subtype: "401k", rawBalance: -3_000 }, // ignored
    ]);
    expect(b).toEqual({ taxable: 10_000, deferred: 100_000, roth: 40_000, hsa: 5_000 });
  });
});
