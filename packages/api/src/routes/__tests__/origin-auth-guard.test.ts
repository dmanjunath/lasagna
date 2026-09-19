import { describe, it, expect, vi, beforeAll } from "vitest";

// Same top-level env the other server.ts integration tests need (plaid.ts and
// session.ts read these at import time).
process.env.PLAID_CLIENT_ID ??= "test-plaid-client";
process.env.PLAID_SECRET ??= "test-plaid-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-0123456789ab";

// Enforcing mode, so the guard actually rejects rather than just logging.
const SECRET = "cf-origin-secret-0123456789abcdef";
process.env.ORIGIN_AUTH_SECRET = SECRET;
process.env.ORIGIN_AUTH_ENFORCE = "true";

vi.mock("../../lib/db.js", () => ({
  db: { query: { users: { findFirst: vi.fn(async () => undefined) } } },
}));

let app: typeof import("../../server.js").app;
beforeAll(async () => {
  ({ app } = await import("../../server.js"));
});

const hit = (path: string, init: RequestInit = {}) =>
  app.request(`http://localhost${path}`, init);

describe("origin auth guard (enforcing)", () => {
  it("blocks an /api request that did not come through Cloudflare", async () => {
    // This is the run.app bypass. 403 before auth even runs.
    const res = await hit("/api/accounts");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Direct origin access is not allowed" });
  });

  it("lets the same request through when Cloudflare's header is present", async () => {
    const res = await hit("/api/accounts", { headers: { "x-origin-auth": SECRET } });
    // Reaches auth, which rejects it for having no session — the point is that
    // it is no longer a 403 from the origin guard.
    expect(res.status).toBe(401);
  });

  it("blocks a wrong secret", async () => {
    const res = await hit("/api/accounts", { headers: { "x-origin-auth": "wrong" } });
    expect(res.status).toBe(403);
  });

  it("leaves /api/health reachable for uptime checks", async () => {
    const res = await hit("/api/health");
    expect(res.status).toBe(200);
  });

  it("leaves CORS preflight alone", async () => {
    const res = await hit("/api/accounts", {
      method: "OPTIONS",
      headers: {
        Origin: "https://app.lasagnafi.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status).not.toBe(403);
  });

  it("does NOT guard /cron — Cloud Scheduler calls run.app directly", async () => {
    // Its own shared-secret guard answers instead. A 403 here would mean the
    // origin guard had swallowed the request and broken the nightly jobs.
    const res = await hit("/cron/sync", { method: "POST" });
    expect([401, 503]).toContain(res.status);
  });

  it("still guards the webhook paths, which do arrive via Cloudflare", async () => {
    const res = await hit("/api/plaid/webhook", { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
  });
});
