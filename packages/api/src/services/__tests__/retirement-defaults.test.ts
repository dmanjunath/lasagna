import { describe, it, expect } from "vitest";
import {
  estimateSSMonthly,
  deriveSimInputs,
  type RawResolverData,
} from "../retirement-defaults.js";
import type { AssetAllocation } from "../market-assumptions.js";

// ── Fixture mirroring a real dashboard prefill ────────────────────────────────
// (income 235k, spending 15,317/mo, 88/3/2/0/8 allocation, $6.8M invested,
// retire at 36, currently 34, no employer match.)
const allocation: AssetAllocation = {
  usStocks: 0.882,
  intlStocks: 0.025,
  bonds: 0.017,
  reits: 0,
  cash: 0.076,
};

const raw: RawResolverData = {
  age: 34,
  dateOfBirth: null,
  annualIncome: 235000,
  employerMatchPercent: 0,
  retirementAge: 36,
  spendingTotal: 15317,
  startingBalance: 6_800_000,
  allocation,
};

describe("estimateSSMonthly (server mirror of retirement-v2.tsx:26-40)", () => {
  it("matches the client bend-point estimate at full retirement age", () => {
    // aime = min(235000, 176100)/12 = 14675
    // pia = 0.9*1226 + 0.32*(7391-1226) + 0.15*(14675-7391)
    //     = 1103.4 + 1972.8 + 1092.6 = 4168.8
    // claimAge 67 → factor 1 → round(4168.8) = 4169
    expect(estimateSSMonthly(235000, 67)).toBe(4169);
  });

  it("returns 0 for non-positive income", () => {
    expect(estimateSSMonthly(0, 67)).toBe(0);
    expect(estimateSSMonthly(-100, 67)).toBe(0);
  });

  it("applies early-claim reduction below FRA", () => {
    // 62 → months = -60. factor = 1 - 36*(5/900) - 24*(5/1200)
    //   = 1 - 0.2 - 0.1 = 0.7
    const pia = estimateSSMonthly(235000, 67); // 4169 (pia rounded)
    // recompute pia unrounded for the expected: 4168.8 * 0.7 = 2918.16 → 2918
    expect(estimateSSMonthly(235000, 62)).toBe(Math.round(4168.8 * 0.7));
    expect(pia).toBeGreaterThan(estimateSSMonthly(235000, 62));
  });

  it("applies delayed-credit increase above FRA", () => {
    // 70 → months = 36. factor = 1 + 36*(0.08/12) = 1.24
    expect(estimateSSMonthly(235000, 70)).toBe(Math.round(4168.8 * 1.24));
  });
});

describe("deriveSimInputs", () => {
  const out = deriveSimInputs(raw);

  it("passes through age, retirementAge, startingBalance, allocation", () => {
    expect(out.currentAge).toBe(34);
    expect(out.retirementAge).toBe(36);
    expect(out.startingBalance).toBe(6_800_000);
    expect(out.allocation).toEqual(allocation);
  });

  it("rounds monthlySpend and passes it through uncapped", () => {
    // round(15317) = 15317
    expect(out.monthlySpend).toBe(15317);
  });

  it("derives monthlySavings exactly like the dashboard", () => {
    // annualSavings = max(0, 235000*0.75 - 15317*12) + 235000*(0/100)
    //              = max(0, 176250 - 183804) + 0 = 0
    // monthlySavings = clamp(round(0/12/50)*50, 0, 15000) = 0
    const annualSavings = Math.max(0, 235000 * 0.75 - 15317 * 12) + 235000 * (0 / 100);
    const expected = Math.max(0, Math.min(15000, Math.round(annualSavings / 12 / 50) * 50));
    expect(expected).toBe(0);
    expect(out.monthlySavings).toBe(expected);
  });

  it("derives ssMonthly from estimateSSMonthly(income, ssClaimAge=67)", () => {
    expect(out.ssMonthly).toBe(estimateSSMonthly(235000, 67));
    expect(out.ssMonthly).toBe(4169);
  });

  it("sets all scalar defaults", () => {
    expect(out.ssClaimAge).toBe(67);
    expect(out.planThroughAge).toBe(90);
    expect(out.otherMonthly).toBe(0);
    expect(out.otherStartAge).toBe(36); // defaults to retirementAge
    expect(out.strategy).toBe("constant_dollar");
    expect(out.inflationAdjusted).toBe(true);
    expect(out.numSimulations).toBe(1000);
  });

  // ── Non-degenerate savings case (exercises the full formula) ────────────────
  it("derives a non-zero monthlySavings and clamps to the $50 grid", () => {
    // income 200k, spend 4000/mo, match 5%:
    // annualSavings = max(0, 150000 - 48000) + 200000*0.05
    //              = 102000 + 10000 = 112000
    // /12 = 9333.33 → /50 = 186.67 → round 187 → *50 = 9350
    const r: RawResolverData = { ...raw, annualIncome: 200000, spendingTotal: 4000, employerMatchPercent: 5 };
    const o = deriveSimInputs(r);
    const annualSavings = Math.max(0, 200000 * 0.75 - 4000 * 12) + 200000 * (5 / 100);
    const expected = Math.max(0, Math.min(15000, Math.round(annualSavings / 12 / 50) * 50));
    expect(expected).toBe(9350);
    expect(o.monthlySavings).toBe(9350);
  });

  it("clamps monthlySavings at the $15000 ceiling", () => {
    const r: RawResolverData = { ...raw, annualIncome: 1_000_000, spendingTotal: 1000, employerMatchPercent: 0 };
    const o = deriveSimInputs(r);
    expect(o.monthlySavings).toBe(15000);
  });

  // ── Age / spending / defaults edge behaviour ────────────────────────────────
  it("derives age from dateOfBirth (floored at 18) when age is absent", () => {
    // 30 years + a 60-day buffer so the 365.25-day divisor floors cleanly to 30
    // (mirrors the client's exact Math.floor(elapsed / 365.25d) formula).
    const dob = new Date(Date.now() - (30 * 365.25 + 60) * 24 * 60 * 60 * 1000);
    const o = deriveSimInputs({ ...raw, age: null, dateOfBirth: dob.toISOString() });
    expect(o.currentAge).toBe(30);
  });

  it("floors dob-derived age at 18", () => {
    const dob = new Date(Date.now() - 5 * 365.25 * 24 * 60 * 60 * 1000);
    const o = deriveSimInputs({ ...raw, age: null, dateOfBirth: dob.toISOString() });
    expect(o.currentAge).toBe(18);
  });

  it("defaults currentAge to 40 with no age or dob", () => {
    const o = deriveSimInputs({ ...raw, age: null, dateOfBirth: null });
    expect(o.currentAge).toBe(40);
  });

  it("defaults monthlySpend to 5000 when spendingTotal is absent/zero", () => {
    expect(deriveSimInputs({ ...raw, spendingTotal: 0 }).monthlySpend).toBe(5000);
    expect(deriveSimInputs({ ...raw, spendingTotal: null }).monthlySpend).toBe(5000);
  });

  it("passes any non-zero positive spend through (no cap, floor at 1)", () => {
    expect(deriveSimInputs({ ...raw, spendingTotal: 99999 }).monthlySpend).toBe(99999);
    expect(deriveSimInputs({ ...raw, spendingTotal: 200 }).monthlySpend).toBe(200);
  });

  it("defaults monthlySavings to 0 when income is absent", () => {
    expect(deriveSimInputs({ ...raw, annualIncome: 0 }).monthlySavings).toBe(0);
    expect(deriveSimInputs({ ...raw, annualIncome: null }).monthlySavings).toBe(0);
  });

  // ── Overrides ───────────────────────────────────────────────────────────────
  it("applies overrides last and changes nothing else", () => {
    const base = deriveSimInputs(raw);
    const overridden = deriveSimInputs(raw, { retirementAge: 40 });
    expect(overridden.retirementAge).toBe(40);
    // Everything except retirementAge is identical.
    expect({ ...overridden, retirementAge: base.retirementAge }).toEqual(base);
  });

  it("lets an override win over the derived value", () => {
    const o = deriveSimInputs(raw, { monthlySpend: 2000, ssMonthly: 0, numSimulations: 500 });
    expect(o.monthlySpend).toBe(2000);
    expect(o.ssMonthly).toBe(0);
    expect(o.numSimulations).toBe(500);
  });
});
