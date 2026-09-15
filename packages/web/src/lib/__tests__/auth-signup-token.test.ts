import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Inside the native shell the WebView origin is capacitor://localhost, so the
 * httpOnly session cookie never survives — the token in the auth response is
 * the only credential the app has. login and the passkey flow store it; signup
 * used to drop it, which left a brand-new account 401ing on every call.
 */
vi.mock("../api.js", () => ({
  api: {
    signup: vi.fn(),
    // The provider fetches /me on mount. SSR never runs effects, but keep it
    // defined so a stray call can't reach the network.
    me: vi.fn(() => Promise.reject(new Error("signed out"))),
  },
}));

import { api } from "../api.js";
import { AuthProvider, useAuth } from "../auth.js";

const TOKEN_KEY = "lasagna_native_token"; // packages/web/src/lib/native.ts
const HINT_KEY = "lf_auth_hint";

const USER = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "new-signup@example.com",
  name: "New Signup",
  role: "owner",
  onboardingStage: "profile",
  isAdmin: false,
  isDemo: false,
  hasAcceptedTerms: true,
  hasPassword: true,
  lastLoginAt: null,
  notifyDaily: true,
  notifyBills: true,
  notifyWeeklyEmail: true,
};
const TENANT = { id: "00000000-0000-0000-0000-000000000001", name: "Household", plan: "free" };

/** Stubs the globals the provider and native.ts read: window and localStorage. */
function stubShell(nativePlatform: boolean) {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as Record<string, unknown>).window = {
    Capacitor: { isNativePlatform: () => nativePlatform },
    localStorage: storage,
  };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  return store;
}

/** Renders the provider and hands back the auth API a page component would get. */
function mountAuth(): ReturnType<typeof useAuth> {
  let captured: ReturnType<typeof useAuth> | null = null;
  function Probe() {
    captured = useAuth();
    return null;
  }
  renderToStaticMarkup(createElement(AuthProvider, null, createElement(Probe)));
  if (!captured) throw new Error("AuthProvider did not render its children");
  return captured;
}

describe("signup", () => {
  beforeEach(() => {
    (api.signup as Mock).mockReset();
  });

  it("stores the returned token in the native shell", async () => {
    const store = stubShell(true);
    (api.signup as Mock).mockResolvedValue({ user: USER, tenant: TENANT, token: "a-signup-session-token" });

    await mountAuth().signup("new-signup@example.com", "SyntheticPass123!");

    expect(store.get(TOKEN_KEY)).toBe("a-signup-session-token");
  });

  // The web build authenticates with the session cookie the response set, and
  // the API doesn't hand a token to a non-native client. Nothing may change.
  it("stores nothing on the web and still commits the session", async () => {
    const store = stubShell(false);
    (api.signup as Mock).mockResolvedValue({ user: USER, tenant: TENANT });

    const result = await mountAuth().signup("new-signup@example.com", "SyntheticPass123!");

    expect(result).toBeNull();
    expect(store.has(TOKEN_KEY)).toBe(false);
    expect(JSON.parse(store.get(HINT_KEY) ?? "{}").user.email).toBe("new-signup@example.com");
  });

  // Belt and braces: even handed a token, the web build must not start storing
  // one — every request there would otherwise carry a second credential.
  it("ignores a token on the web", async () => {
    const store = stubShell(false);
    (api.signup as Mock).mockResolvedValue({ user: USER, tenant: TENANT, token: "a-signup-session-token" });

    await mountAuth().signup("new-signup@example.com", "SyntheticPass123!");

    expect(store.has(TOKEN_KEY)).toBe(false);
  });

  // WorkOS mode verifies by emailed code, so signup has no session yet. The
  // credential arrives from /auth/verify-email and verify-email.tsx stores it.
  it("stores nothing when the account still needs email verification", async () => {
    const store = stubShell(true);
    (api.signup as Mock).mockResolvedValue({ needsVerification: true, email: "new-signup@example.com" });

    const result = await mountAuth().signup("new-signup@example.com", "SyntheticPass123!");

    expect(result).toEqual({ needsVerification: true, email: "new-signup@example.com" });
    expect(store.has(TOKEN_KEY)).toBe(false);
  });
});
