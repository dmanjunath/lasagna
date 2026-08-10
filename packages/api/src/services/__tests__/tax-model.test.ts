import { describe, it, expect } from "vitest";
import * as tax from "../tax-model.js";

describe("tax-model (2025)", () => {
  it("standard deduction by filing status", () => {
    expect(tax.standardDeduction("single")).toBe(15_000);
    expect(tax.standardDeduction("married_joint")).toBe(30_000);
  });
  it("ordinary tax is progressive", () => {
    // single, $50,000 taxable: 10%*11,925 + 12%*(48,475-11,925) + 22%*(50,000-48,475)
    // = 1,192.5 + 4,386 + 335.5 = 5,914
    expect(Math.round(tax.ordinaryTax(50_000, "single"))).toBe(5_914);
    expect(tax.ordinaryTax(0, "single")).toBe(0);
  });
  it("0% LTCG ceiling is headroom under the bracket top", () => {
    // single, $30k ordinary taxable → 48,350 - 30,000 = 18,350 of gains at 0%
    expect(tax.zeroLtcgCeiling(30_000, "single")).toBe(18_350);
    expect(tax.zeroLtcgCeiling(60_000, "single")).toBe(0); // already above
  });
  it("LTCG stacks above ordinary income", () => {
    // single, ordinary taxable 30k, realize 30k gain: 18,350 at 0%, 11,650 at 15% = 1,747.5
    expect(Math.round(tax.ltcgTax(30_000, 30_000, "single"))).toBe(1_748);
  });
  it("Social Security taxability follows the 50/85 rule", () => {
    const ss = 24_000;
    expect(tax.taxableSocialSecurity(ss, 0, "single")).toBe(0);        // provisional 12k < 25k base
    expect(tax.taxableSocialSecurity(ss, 80_000, "single")).toBe(Math.round(ss * 0.85)); // far above → 85% cap
  });
  it("Roth conversion room fills to a bracket top", () => {
    // single, 30k ordinary taxable, fill to top of 12% bracket (48,475): 18,475
    expect(tax.rothConversionRoom(30_000, "single", 12)).toBe(18_475);
  });
  it("72(t) SEPP annual is a positive fraction of balance", () => {
    const amt = tax.sepp72tAnnual(1_000_000, 45);
    expect(amt).toBeGreaterThan(30_000);
    expect(amt).toBeLessThan(60_000);
  });

  // Regression cases across filing statuses / bands (independently hand-computed).
  it("ordinary tax across filing statuses", () => {
    // MFJ $120k: 0.10*23,850 + 0.12*(96,950-23,850) + 0.22*(120,000-96,950) = 16,228
    expect(Math.round(tax.ordinaryTax(120_000, "married_joint"))).toBe(16_228);
    // HoH $70k: 1,700 + 0.12*(64,850-17,000) + 0.22*(70,000-64,850) = 8,575
    expect(Math.round(tax.ordinaryTax(70_000, "head_of_household"))).toBe(8_575);
  });
  it("LTCG spans all three bands (0/15/20)", () => {
    // single, ordinary 40k, gain 600k: 8,350 @0 + 485,050 @15 + 106,600 @20 = 94,077.5
    expect(Math.round(tax.ltcgTax(600_000, 40_000, "single"))).toBe(94_078);
    // ordinary already above the 15% ceiling → entire gain at 20%
    expect(Math.round(tax.ltcgTax(100_000, 600_000, "single"))).toBe(20_000);
  });
  it("Social Security middle (50%) and upper (85%) tiers", () => {
    // provisional 30k (between 25k base and 34k second): min(2,500, 10,000) = 2,500
    expect(tax.taxableSocialSecurity(20_000, 20_000, "single")).toBe(2_500);
    // provisional 40k (above second): 0.85*(40k-34k) + min(0.5*20k, 4,500) = 5,100 + 4,500 = 9,600
    expect(tax.taxableSocialSecurity(20_000, 30_000, "single")).toBe(9_600);
  });
  it("zeroLtcgCeiling + rothConversionRoom for married_joint", () => {
    expect(tax.zeroLtcgCeiling(50_000, "married_joint")).toBe(46_700);
    expect(tax.rothConversionRoom(100_000, "married_joint", 22)).toBe(106_700);
  });
  it("toFilingStatus maps aliases and defaults safely", () => {
    expect(tax.toFilingStatus("qualifying_widow")).toBe("married_joint");
    expect(tax.toFilingStatus(null)).toBe("single");
    expect(tax.toFilingStatus("nonsense")).toBe("single");
  });
});
