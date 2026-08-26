import { describe, it, expect } from "vitest";
import {
  resolveGoalTarget,
  resolveGoalDeadline,
  parseGoalDetails,
  dateAtAge,
  type GoalDetails,
} from "@lasagna/core";

describe("resolveGoalTarget", () => {
  it("prices a home purchase from the price, the down payment and closing costs", () => {
    const details: GoalDetails = {
      kind: "home_purchase",
      homePrice: 450_000,
      downPaymentPct: 20,
      includeClosingCosts: true,
      closingCostPct: 3,
      byAge: 30,
      byDate: null,
    };
    expect(resolveGoalTarget("home_purchase", details)).toEqual({
      target: 103_500,
      derivation: "20% of $450,000 plus 3% closing costs.",
    });
  });

  it("drops closing costs from the home target when they are not included", () => {
    const details: GoalDetails = {
      kind: "home_purchase",
      homePrice: 450_000,
      downPaymentPct: 20,
      includeClosingCosts: false,
      closingCostPct: 3,
      byAge: null,
      byDate: "2029-03-01",
    };
    expect(resolveGoalTarget("home_purchase", details)).toEqual({
      target: 90_000,
      derivation: "20% of $450,000.",
    });
  });

  it("prices a car at the down payment, or the full price when paying cash", () => {
    const financed: GoalDetails = {
      kind: "car",
      vehiclePrice: 32_000,
      payCash: false,
      downPaymentPct: 15,
      byAge: null,
      byDate: null,
    };
    expect(resolveGoalTarget("car", financed)).toEqual({
      target: 4_800,
      derivation: "15% of $32,000.",
    });

    const cash: GoalDetails = { ...financed, payCash: true, downPaymentPct: null };
    expect(resolveGoalTarget("car", cash)).toEqual({
      target: 32_000,
      derivation: "The full price of $32,000.",
    });
  });

  it("prices education at the annual cost times the number of years", () => {
    const details: GoalDetails = {
      kind: "education",
      annualCost: 30_000,
      years: 4,
      startYear: 2032,
    };
    expect(resolveGoalTarget("education", details)).toEqual({
      target: 120_000,
      derivation: "4 years at $30,000 a year.",
    });
  });

  it("prices retirement at 25 times the target annual income", () => {
    const details: GoalDetails = {
      kind: "retirement",
      targetAge: 62,
      targetAnnualIncome: 80_000,
    };
    expect(resolveGoalTarget("retirement", details)).toEqual({
      target: 2_000_000,
      derivation: "25 times $80,000 a year (the 4% rule).",
    });
  });

  it("prices an emergency fund at the months times the spend it was priced from", () => {
    const details: GoalDetails = {
      kind: "emergency_fund",
      months: 6,
      monthlySpendUsed: 4_200,
    };
    expect(resolveGoalTarget("emergency_fund", details)).toEqual({
      target: 25_200,
      derivation: "6 months at $4,200 a month, your average spending over the last 3 months.",
    });
  });

  it("refuses to price details that belong to another category", () => {
    const home: GoalDetails = {
      kind: "home_purchase",
      homePrice: 450_000,
      downPaymentPct: 20,
      includeClosingCosts: true,
      closingCostPct: 3,
      byAge: null,
      byDate: null,
    };
    expect(resolveGoalTarget("car", home)).toBeNull();
  });

  it("has no target without details", () => {
    expect(resolveGoalTarget("home_purchase", null)).toBeNull();
  });

  it("has no target when a percent zeroes it out", () => {
    const details: GoalDetails = {
      kind: "home_purchase",
      homePrice: 450_000,
      downPaymentPct: 0,
      includeClosingCosts: false,
      closingCostPct: 3,
      byAge: null,
      byDate: null,
    };
    expect(resolveGoalTarget("home_purchase", details)).toBeNull();
  });
});

describe("resolveGoalDeadline", () => {
  it("turns a target age into the date that birthday lands on", () => {
    expect(dateAtAge("1994-06-15", 30)).toBe("2024-06-15");
  });

  it("uses the explicit date when the user picked one", () => {
    const details: GoalDetails = {
      kind: "car",
      vehiclePrice: 32_000,
      payCash: true,
      downPaymentPct: null,
      byAge: null,
      byDate: "2028-04-01",
    };
    expect(resolveGoalDeadline(details, "1994-06-15")).toBe("2028-04-01");
  });

  it("has no deadline for a by-age goal when the birth date is unknown", () => {
    const details: GoalDetails = {
      kind: "home_purchase",
      homePrice: 450_000,
      downPaymentPct: 20,
      includeClosingCosts: true,
      closingCostPct: 3,
      byAge: 30,
      byDate: null,
    };
    expect(resolveGoalDeadline(details, null)).toBeNull();
  });

  it("lands an education goal on the September its school year starts", () => {
    const details: GoalDetails = {
      kind: "education",
      annualCost: 30_000,
      years: 4,
      startYear: 2032,
    };
    expect(resolveGoalDeadline(details, null)).toBe("2032-09-01");
  });

  it("gives an emergency fund no deadline", () => {
    const details: GoalDetails = { kind: "emergency_fund", months: 6, monthlySpendUsed: 4_200 };
    expect(resolveGoalDeadline(details, "1994-06-15")).toBeNull();
  });
});

describe("parseGoalDetails", () => {
  const homeDetails = {
    kind: "home_purchase",
    homePrice: 450_000,
    downPaymentPct: 20,
    includeClosingCosts: true,
    closingCostPct: 3,
    byAge: 30,
    byDate: null,
  };

  it("accepts details that match the goal's category", () => {
    const result = parseGoalDetails("home_purchase", homeDetails);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.details?.kind).toBe("home_purchase");
  });

  it("rejects details whose kind does not match the goal's category", () => {
    const result = parseGoalDetails("car", homeDetails);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not match goal category");
  });

  it("rejects details on a category that does not take them", () => {
    const result = parseGoalDetails("vacation", homeDetails);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does not take details");
  });

  it("rejects a malformed blob", () => {
    const result = parseGoalDetails("home_purchase", { kind: "home_purchase", homePrice: "lots" });
    expect(result.ok).toBe(false);
  });

  it("rejects a percent outside 0 to 100", () => {
    const result = parseGoalDetails("home_purchase", { ...homeDetails, downPaymentPct: 140 });
    expect(result.ok).toBe(false);
  });

  it("rejects details that resolve to nothing", () => {
    const result = parseGoalDetails("home_purchase", {
      ...homeDetails,
      downPaymentPct: 0,
      includeClosingCosts: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("above zero");
  });

  it("treats absent details as no details", () => {
    expect(parseGoalDetails("vacation", undefined)).toEqual({ ok: true, details: null });
    expect(parseGoalDetails("home_purchase", null)).toEqual({ ok: true, details: null });
  });
});
