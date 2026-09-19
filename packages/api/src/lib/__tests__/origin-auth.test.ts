import { describe, it, expect } from "vitest";
import { checkOriginAuth } from "../origin-auth.js";

const SECRET = "s".repeat(48);
const check = (o: Partial<Parameters<typeof checkOriginAuth>[0]>) =>
  checkOriginAuth({
    method: "POST",
    path: "/api/accounts",
    provided: SECRET,
    expected: SECRET,
    ...o,
  });

describe("checkOriginAuth", () => {
  it("is off entirely until the secret is configured", () => {
    // Fail-open by default: the header can be deployed before Cloudflare is
    // sending it, without taking the API down in between.
    expect(check({ expected: undefined, provided: undefined })).toBe("disabled");
    expect(check({ expected: "", provided: undefined })).toBe("disabled");
  });

  it("accepts a request carrying the right secret", () => {
    expect(check({})).toBe("ok");
  });

  it("flags a request that never went through Cloudflare", () => {
    // The bypass this exists for: hitting the run.app URL directly.
    expect(check({ provided: undefined })).toBe("unfronted");
  });

  it("flags a wrong or stale secret", () => {
    expect(check({ provided: "x".repeat(48) })).toBe("unfronted");
    expect(check({ provided: "" })).toBe("unfronted");
  });

  it("does not accept a secret of a different length", () => {
    expect(check({ provided: SECRET.slice(0, 20) })).toBe("unfronted");
    expect(check({ provided: SECRET + "extra" })).toBe("unfronted");
  });

  it("exempts CORS preflight", () => {
    // A preflight carries no credentials and no body. Rejecting it would make
    // the browser block the real request before it is ever sent.
    expect(check({ method: "OPTIONS", provided: undefined })).toBe("exempt");
  });

  it("exempts the health endpoint", () => {
    // Uptime checks and Cloud Run probes hit this directly, not through
    // Cloudflare. It returns no user data.
    expect(check({ method: "GET", path: "/api/health", provided: undefined })).toBe("exempt");
  });

  it("does not exempt paths that merely start like health", () => {
    expect(check({ method: "GET", path: "/api/healthz", provided: undefined })).toBe("unfronted");
    expect(check({ method: "GET", path: "/api/health/secrets", provided: undefined })).toBe("unfronted");
  });

  it("still checks the webhook paths", () => {
    // Stripe and Plaid post to api.lasagnafi.com, so they come through
    // Cloudflare and do carry the header. They are not exempt.
    expect(check({ path: "/api/plaid/webhook", provided: undefined })).toBe("unfronted");
    expect(check({ path: "/api/billing/webhook", provided: SECRET })).toBe("ok");
  });
});
