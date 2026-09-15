import { describe, it, expect, beforeEach } from "vitest";
import { authHeaders } from "../api.js";

/**
 * Inside the native shell the WebView origin is capacitor://localhost, so the
 * httpOnly session cookie never reaches the API. These headers are the only
 * credential such a call has — a request that ships without them gets a 401,
 * which is how chat broke in the installed app while mobile web kept working.
 */
const TOKEN_KEY = "lasagna_native_token";

/** Stubs the globals authHeaders reads: window.Capacitor and localStorage. */
function stubShell(nativePlatform: boolean, token: string | null) {
  (globalThis as unknown as Record<string, unknown>).window = {
    Capacitor: { isNativePlatform: () => nativePlatform },
  };
  const store = new Map<string, string>();
  if (token) store.set(TOKEN_KEY, token);
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
}

describe("authHeaders", () => {
  beforeEach(() => stubShell(false, null));

  it("sends the Bearer token and the native client marker inside the shell", () => {
    stubShell(true, "a-stored-session-token");
    expect(authHeaders()).toEqual({
      "x-lasagna-client": "native",
      Authorization: "Bearer a-stored-session-token",
    });
  });

  // The web build authenticates with the session cookie. Adding anything here
  // would change every existing web request, so it has to stay empty.
  it("sends nothing on the web, where the cookie carries the session", () => {
    stubShell(false, "a-stored-session-token");
    expect(authHeaders()).toEqual({});
  });

  // A native shell that hasn't stored a token yet (or had it cleared on sign
  // out) must not send an empty Authorization header.
  it("omits Authorization in the shell when no token is stored", () => {
    stubShell(true, null);
    expect(authHeaders()).toEqual({ "x-lasagna-client": "native" });
  });
});
