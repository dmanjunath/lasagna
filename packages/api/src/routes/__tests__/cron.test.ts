import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// Plaid client is built at module top-level in plaid.ts and reads these
// required env vars; set them so the REAL server.ts can be imported here.
process.env.PLAID_CLIENT_ID ??= "test-plaid-client";
process.env.PLAID_SECRET ??= "test-plaid-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-0123456789ab";

// Mock the cron work functions so the guard test never does real
// sync/LLM/DB work — we only assert the shared-secret guard behavior.
const runSyncAll = vi.fn(async (_proOnly?: boolean) => ({ succeeded: 0, failed: 0, recovered: 0 }));
const runDailyInsights = vi.fn(async () => ({ succeeded: 0, failed: 0, recovered: 0 }));

vi.mock("../../lib/cron.js", () => ({
  runSyncAll: (proOnly?: boolean) => runSyncAll(proOnly),
  runDailyInsights: () => runDailyInsights(),
  startCronJobs: vi.fn(),
}));

// db.js is imported transitively by server.ts routes; stub it so no live DB is
// needed just to build the app.
vi.mock("../../lib/db.js", () => ({ db: { query: {} } }));

let app: typeof import("../../server.js").app;

beforeAll(async () => {
  ({ app } = await import("../../server.js"));
});

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("/cron shared-secret guard", () => {
  it("returns 503 when CRON_SECRET is unset (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    const res = await app.request("/cron/sync", { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "cron secret not configured" });
    expect(runSyncAll).not.toHaveBeenCalled();
  });

  it("returns 401 with a missing X-Cron-Secret header", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    const res = await app.request("/cron/sync", { method: "POST" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
    expect(runSyncAll).not.toHaveBeenCalled();
  });

  it("returns 401 with a wrong X-Cron-Secret header", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    const res = await app.request("/cron/sync", {
      method: "POST",
      headers: { "X-Cron-Secret": "nope" },
    });
    expect(res.status).toBe(401);
    expect(runSyncAll).not.toHaveBeenCalled();
  });

  it("passes the guard with the correct secret and runs sync (proOnly from query)", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    const res = await app.request("/cron/sync?proOnly=true", {
      method: "POST",
      headers: { "X-Cron-Secret": "s3cret-value" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, succeeded: 0, failed: 0, recovered: 0 });
    expect(runSyncAll).toHaveBeenCalledWith(true);
  });

  it("defaults proOnly to false when the query param is absent", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    const res = await app.request("/cron/sync", {
      method: "POST",
      headers: { "X-Cron-Secret": "s3cret-value" },
    });
    expect(res.status).toBe(200);
    expect(runSyncAll).toHaveBeenCalledWith(false);
  });

  it("passes the guard and runs the insights job on POST /cron/insights", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    const res = await app.request("/cron/insights", {
      method: "POST",
      headers: { "X-Cron-Secret": "s3cret-value" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(runDailyInsights).toHaveBeenCalledTimes(1);
  });
});
