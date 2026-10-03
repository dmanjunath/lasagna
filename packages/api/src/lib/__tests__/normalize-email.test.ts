import { describe, it, expect } from "vitest";
import { isValidEmail, normalizeEmail } from "../normalize-email.js";

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

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("bob@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@mail.example.co.uk")).toBe(true);
    expect(isValidEmail("a@b.co")).toBe(true);
  });

  it("rejects a bare word, which is what signup used to accept", () => {
    // A user with the email "abc" reached the users table through POST
    // /api/auth/signup, which checked presence and nothing else.
    expect(isValidEmail("abc")).toBe(false);
  });

  it("rejects an address missing either side of the @, or the dot after it", () => {
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("bob@")).toBe(false);
    expect(isValidEmail("bob@example")).toBe(false);
    expect(isValidEmail("bob@.com")).toBe(false);
    expect(isValidEmail("bob@example.")).toBe(false);
  });

  it("rejects more than one @", () => {
    expect(isValidEmail("bob@example@com.org")).toBe(false);
  });

  it("rejects whitespace anywhere, and the empty string normalizeEmail returns", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("bo b@example.com")).toBe(false);
    expect(isValidEmail("bob@exa mple.com")).toBe(false);
    // normalizeEmail only trims the ENDS, so an inner space still has to fail here.
    expect(isValidEmail(normalizeEmail("  bob @example.com  "))).toBe(false);
  });

  it("passes what normalizeEmail hands it, so the two compose", () => {
    expect(isValidEmail(normalizeEmail("  Bob@Example.Com "))).toBe(true);
    expect(isValidEmail(normalizeEmail(null))).toBe(false);
  });
});
