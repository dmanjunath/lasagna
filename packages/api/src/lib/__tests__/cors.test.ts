import { describe, it, expect } from "vitest";
import { resolveCorsOrigin } from "../cors.js";

const ALLOWED = ["https://app.lasagnafi.com"];

describe("resolveCorsOrigin", () => {
  it("always allows the native shells", () => {
    expect(resolveCorsOrigin("capacitor://localhost", ALLOWED, false)).toBe("capacitor://localhost");
    expect(resolveCorsOrigin("https://localhost", ALLOWED, false)).toBe("https://localhost");
  });

  it("allows the configured web origin in production", () => {
    expect(resolveCorsOrigin("https://app.lasagnafi.com", ALLOWED, false)).toBe("https://app.lasagnafi.com");
  });

  it("does NOT reflect trycloudflare or localhost in production", () => {
    expect(resolveCorsOrigin("https://evil-tunnel.trycloudflare.com", ALLOWED, false)).toBeUndefined();
    expect(resolveCorsOrigin("http://localhost:5173", ALLOWED, false)).toBeUndefined();
  });

  it("reflects dev tunnels only in dev", () => {
    expect(resolveCorsOrigin("http://localhost:5173", ALLOWED, true)).toBe("http://localhost:5173");
    expect(resolveCorsOrigin("https://x.trycloudflare.com", ALLOWED, true)).toBe("https://x.trycloudflare.com");
  });

  it("rejects unknown origins in both modes", () => {
    expect(resolveCorsOrigin("https://evil.com", ALLOWED, false)).toBeUndefined();
    expect(resolveCorsOrigin("https://evil.com", ALLOWED, true)).toBeUndefined();
  });
});
