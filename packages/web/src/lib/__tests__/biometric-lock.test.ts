import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldLock,
  LOCK_GRACE_MS,
  isLockEnabled,
  setLockEnabled,
  isSetupPrompted,
  setSetupPrompted,
  clearFaceIdOnSignOut,
} from "../biometric-lock.js";

describe("shouldLock", () => {
  const now = 1_000_000;
  const signedIn = true;
  it("never locks when disabled", () => {
    expect(shouldLock({ enabled: false, signedIn, backgroundedAt: null, now })).toBe(false);
  });
  it("locks on cold start (no background timestamp)", () => {
    expect(shouldLock({ enabled: true, signedIn, backgroundedAt: null, now })).toBe(true);
  });
  it("does not lock within the grace period", () => {
    expect(shouldLock({ enabled: true, signedIn, backgroundedAt: now - LOCK_GRACE_MS + 1000, now })).toBe(false);
  });
  it("locks after the grace period", () => {
    expect(shouldLock({ enabled: true, signedIn, backgroundedAt: now - LOCK_GRACE_MS - 1, now })).toBe(true);
  });

  // The lock protects a signed-in session's pixels. With no session the only
  // thing behind it is the login screen, and a cancelled Face ID would strand
  // the user there with no way to sign in.
  it("never locks when signed out, even on cold start", () => {
    expect(shouldLock({ enabled: true, signedIn: false, backgroundedAt: null, now })).toBe(false);
  });
  it("never locks when signed out, even past the grace period", () => {
    expect(shouldLock({ enabled: true, signedIn: false, backgroundedAt: now - LOCK_GRACE_MS - 1, now })).toBe(false);
  });
});

describe("clearFaceIdOnSignOut", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    };
  });

  it("turns the app lock off", () => {
    setLockEnabled(true);
    clearFaceIdOnSignOut();
    expect(isLockEnabled()).toBe(false);
  });

  // Without this the next sign-in (a different account, or the same one) never
  // sees the one-time offer again and Face ID stays silently off.
  it("re-arms the one-time setup offer", () => {
    setSetupPrompted(true);
    clearFaceIdOnSignOut();
    expect(isSetupPrompted()).toBe(false);
  });

  // The passkey still exists server-side and "Sign in with Face ID" is how the
  // user gets back in — clearing it would make signing in harder, not safer.
  it("leaves the passkey sign-in hint alone", () => {
    localStorage.setItem("lasagna_passkey_registered", "1");
    clearFaceIdOnSignOut();
    expect(localStorage.getItem("lasagna_passkey_registered")).toBe("1");
  });
});
