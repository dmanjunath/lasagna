import { describe, it, expect } from "vitest";
import { shouldLock, LOCK_GRACE_MS } from "../biometric-lock.js";

describe("shouldLock", () => {
  const now = 1_000_000;
  it("never locks when disabled", () => {
    expect(shouldLock({ enabled: false, backgroundedAt: null, now })).toBe(false);
  });
  it("locks on cold start (no background timestamp)", () => {
    expect(shouldLock({ enabled: true, backgroundedAt: null, now })).toBe(true);
  });
  it("does not lock within the grace period", () => {
    expect(shouldLock({ enabled: true, backgroundedAt: now - LOCK_GRACE_MS + 1000, now })).toBe(false);
  });
  it("locks after the grace period", () => {
    expect(shouldLock({ enabled: true, backgroundedAt: now - LOCK_GRACE_MS - 1, now })).toBe(true);
  });
});
