import { describe, it, expect } from "vitest";
import { normalizeEmail } from "../normalize-email.js";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Bob@X.Com ")).toBe("bob@x.com");
    expect(normalizeEmail("ALICE@EXAMPLE.ORG")).toBe("alice@example.org");
  });

  it("is idempotent", () => {
    expect(normalizeEmail(normalizeEmail("Bob@X.Com"))).toBe("bob@x.com");
  });

  it("tolerates null/undefined/empty so callers can normalize before validating", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail("   ")).toBe("");
  });
});
