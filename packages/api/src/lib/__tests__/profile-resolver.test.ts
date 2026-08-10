import { describe, it, expect } from "vitest";
import {
  resolveProfile,
  splitProfileInput,
  HOUSEHOLD_FIELDS,
  PERSONAL_FIELDS,
  type HouseholdProfileRow,
  type PersonalProfileRow,
} from "../profile-resolver.js";

// A household row carries the tenant-shared fields (+ bookkeeping we ignore here).
const household: HouseholdProfileRow = {
  filingStatus: "married_joint",
  stateOfResidence: "CA",
  dependentCount: 2,
};

// A personal row carries the per-user fields.
const personal: PersonalProfileRow = {
  dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
  annualIncome: "120000.00",
  employmentType: "w2",
  riskTolerance: "moderate",
  retirementAge: 65,
  employerMatch: "4.00",
  hasHDHP: true,
  isPSLFEligible: false,
};

describe("resolveProfile", () => {
  it("merges household + personal into the GET /financial-profile response shape", () => {
    const resolved = resolveProfile(household, personal);
    // Personal fields come from `personal`
    expect(resolved.dateOfBirth).toEqual(personal.dateOfBirth);
    expect(resolved.annualIncome).toBe(120000);
    expect(resolved.employmentType).toBe("w2");
    expect(resolved.riskTolerance).toBe("moderate");
    expect(resolved.retirementAge).toBe(65);
    expect(resolved.employerMatchPercent).toBe(4);
    expect(resolved.hasHDHP).toBe(true);
    expect(resolved.isPSLFEligible).toBe(false);
    // Household fields come from `household`
    expect(resolved.filingStatus).toBe("married_joint");
    expect(resolved.stateOfResidence).toBe("CA");
    expect(resolved.dependentCount).toBe(2);
  });

  it("derives age from the personal dateOfBirth", () => {
    // 30 years + a small buffer so the 365.25-day production formula lands
    // cleanly on 30 rather than 29 due to leap-day fractions.
    const dob = new Date(Date.now() - 30.5 * 365.25 * 24 * 60 * 60 * 1000);
    const resolved = resolveProfile(household, { ...personal, dateOfBirth: dob });
    expect(resolved.age).toBe(30);
  });

  it("returns null age when no dateOfBirth", () => {
    const resolved = resolveProfile(household, { ...personal, dateOfBirth: null });
    expect(resolved.age).toBeNull();
    expect(resolved.dateOfBirth).toBeNull();
  });

  it("nulls out personal fields when the personal row is missing", () => {
    const resolved = resolveProfile(household, null);
    expect(resolved.dateOfBirth).toBeNull();
    expect(resolved.age).toBeNull();
    expect(resolved.annualIncome).toBeNull();
    expect(resolved.employmentType).toBeNull();
    expect(resolved.riskTolerance).toBeNull();
    expect(resolved.retirementAge).toBeNull();
    expect(resolved.employerMatchPercent).toBeNull();
    expect(resolved.hasHDHP).toBeNull();
    expect(resolved.isPSLFEligible).toBeNull();
    // Household fields still resolve
    expect(resolved.filingStatus).toBe("married_joint");
    expect(resolved.stateOfResidence).toBe("CA");
    expect(resolved.dependentCount).toBe(2);
  });

  it("nulls out household fields when the household row is missing", () => {
    const resolved = resolveProfile(null, personal);
    expect(resolved.filingStatus).toBeNull();
    expect(resolved.stateOfResidence).toBeNull();
    expect(resolved.dependentCount).toBeNull();
    // Personal still resolves
    expect(resolved.annualIncome).toBe(120000);
  });
});

describe("splitProfileInput", () => {
  it("routes household fields to householdValues and personal fields to personalValues", () => {
    const { householdValues, personalValues } = splitProfileInput({
      dateOfBirth: "1990-01-01",
      annualIncome: 100000,
      filingStatus: "single",
      stateOfResidence: "NY",
      employmentType: "self_employed",
      riskTolerance: "aggressive",
      retirementAge: 60,
      employerMatchPercent: 3,
      dependentCount: 1,
      hasHDHP: false,
      isPSLFEligible: true,
    });

    // Household table gets exactly the three household fields.
    expect(householdValues.filingStatus).toBe("single");
    expect(householdValues.stateOfResidence).toBe("NY");
    expect(householdValues.dependentCount).toBe(1);
    expect(householdValues).not.toHaveProperty("annualIncome");
    expect(householdValues).not.toHaveProperty("dateOfBirth");

    // Personal table gets everything else (in db-column form).
    expect(personalValues.dateOfBirth).toEqual(new Date("1990-01-01"));
    expect(personalValues.annualIncome).toBe("100000");
    expect(personalValues.employmentType).toBe("self_employed");
    expect(personalValues.riskTolerance).toBe("aggressive");
    expect(personalValues.retirementAge).toBe(60);
    expect(personalValues.employerMatch).toBe("3");
    expect(personalValues.hasHDHP).toBe(false);
    expect(personalValues.isPSLFEligible).toBe(true);
    expect(personalValues).not.toHaveProperty("filingStatus");
  });

  it("only includes fields present in the body (undefined is skipped, null kept)", () => {
    const { householdValues, personalValues } = splitProfileInput({
      annualIncome: null,
      filingStatus: null,
    });
    expect(personalValues).toHaveProperty("annualIncome", null);
    expect(householdValues).toHaveProperty("filingStatus", null);
    expect(personalValues).not.toHaveProperty("dateOfBirth");
    expect(householdValues).not.toHaveProperty("stateOfResidence");
  });

  it("HOUSEHOLD_FIELDS and PERSONAL_FIELDS are the fixed, disjoint classification", () => {
    expect([...HOUSEHOLD_FIELDS].sort()).toEqual(
      ["dependentCount", "filingStatus", "stateOfResidence"].sort(),
    );
    expect([...PERSONAL_FIELDS].sort()).toEqual(
      [
        "annualIncome",
        "dateOfBirth",
        "employerMatch",
        "employmentType",
        "hasHDHP",
        "isPSLFEligible",
        "retirementAge",
        "riskTolerance",
      ].sort(),
    );
  });
});
