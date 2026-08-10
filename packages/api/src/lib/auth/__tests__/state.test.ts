import { describe, it, expect } from "vitest";
import { createOauthState, statesMatch, OAUTH_STATE_COOKIE } from "../state.js";

describe("oauth state", () => {
  it("generates a non-empty hex string", () => {
    expect(createOauthState()).toMatch(/^[0-9a-f]{32}$/);
  });
  it("matches equal, rejects unequal/empty", () => {
    const s = createOauthState();
    expect(statesMatch(s, s)).toBe(true);
    expect(statesMatch(s, createOauthState())).toBe(false);
    expect(statesMatch(s, undefined)).toBe(false);
    expect(statesMatch(undefined, undefined)).toBe(false);
  });
  it("exposes the cookie name", () => {
    expect(OAUTH_STATE_COOKIE).toBe("lasagna_oauth_state");
  });
});
