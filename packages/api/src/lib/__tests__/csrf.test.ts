import { describe, it, expect } from "vitest";
import { blocksAsCsrf } from "../csrf.js";

const ALLOWED = ["https://app.lasagnafi.com"];
const prod = (o: Partial<Parameters<typeof blocksAsCsrf>[0]>) =>
  blocksAsCsrf({
    method: "POST",
    origin: undefined,
    hasSessionCookie: true,
    allowedOrigins: ALLOWED,
    isDev: false,
    ...o,
  });

describe("blocksAsCsrf", () => {
  it("blocks the attack this exists for: cross-site write carrying the cookie", () => {
    // Reproduces the verified finding — a foreign origin POSTing with only the
    // session cookie, using a simple content type to skip the CORS preflight.
    expect(prod({ origin: "https://evil.example.com" })).toBe(true);
  });

  it("blocks every unsafe method from a foreign origin", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(prod({ method, origin: "https://evil.example.com" })).toBe(true);
    }
  });

  it("allows the real web app", () => {
    expect(prod({ origin: "https://app.lasagnafi.com" })).toBe(false);
  });

  it("allows the native shells, which post with a Bearer token", () => {
    expect(prod({ origin: "capacitor://localhost" })).toBe(false);
    expect(prod({ origin: "https://localhost" })).toBe(false);
  });

  it("never blocks safe methods, even from a foreign origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(prod({ method, origin: "https://evil.example.com" })).toBe(false);
    }
  });

  it("never blocks a request that carries no session cookie", () => {
    // Stripe and Plaid webhooks, and any Bearer client. They have no ambient
    // credential for a browser to attach, so they are not a CSRF vector.
    expect(prod({ hasSessionCookie: false, origin: "https://stripe.com" })).toBe(false);
    expect(prod({ hasSessionCookie: false, origin: undefined })).toBe(false);
  });

  it("allows a cookie-bearing write with no Origin header", () => {
    // Non-browser clients (curl, server-to-server) omit Origin. Browsers always
    // send it on a cross-site write, so absence is not an attack path — and
    // rejecting it would break local tooling.
    expect(prod({ origin: undefined })).toBe(false);
  });

  it("does not trust a dev-only origin in production", () => {
    expect(prod({ origin: "http://localhost:5173" })).toBe(true);
    expect(prod({ origin: "https://evil.trycloudflare.com" })).toBe(true);
  });

  it("allows dev origins in dev", () => {
    expect(prod({ origin: "http://localhost:5173", isDev: true })).toBe(false);
    expect(prod({ origin: "https://x.trycloudflare.com", isDev: true })).toBe(false);
  });

  it("is case-insensitive about the method", () => {
    expect(prod({ method: "post", origin: "https://evil.example.com" })).toBe(true);
    expect(prod({ method: "get", origin: "https://evil.example.com" })).toBe(false);
  });
});
