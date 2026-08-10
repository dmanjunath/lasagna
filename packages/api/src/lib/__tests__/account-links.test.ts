import { describe, it, expect } from "vitest";
import { validatePropertyLink } from "../account-links.js";

const debt = { type: "loan" };
const credit = { type: "credit" };
const property = { type: "real_estate" };
const checking = { type: "depository" };

describe("validatePropertyLink", () => {
  it("allows loan → property and credit → property", () => {
    expect(validatePropertyLink(debt, property)).toBeNull();
    expect(validatePropertyLink(credit, property)).toBeNull();
  });
  it("allows unlink (null target)", () => {
    expect(validatePropertyLink(debt, null)).toBeNull();
  });
  it("rejects linking FROM a non-debt account", () => {
    expect(validatePropertyLink(property, property)).toMatch(/debt/i);
    expect(validatePropertyLink(checking, property)).toMatch(/debt/i);
  });
  it("rejects a non-property target (including missing = cross-tenant)", () => {
    expect(validatePropertyLink(debt, debt)).toMatch(/property/i);
    expect(validatePropertyLink(debt, undefined)).toMatch(/property/i);
  });
});
