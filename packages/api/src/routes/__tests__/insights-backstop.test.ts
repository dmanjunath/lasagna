import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

/**
 * Reading the actions page never generates, never waits on a generation, and
 * never opens a transaction.
 *
 * GET /api/insights backs up the scheduled run: a household whose actions are
 * stale used to be regenerated on the read, first awaited inside a
 * transaction, then fire-and-forget after the response. On Cloud Run the CPU
 * goes away with the response, so neither was right. The read now only asks
 * for a refresh, and the scheduled run does it (lib/actions-refresh.ts, whose
 * claim and lock are covered by actions-refresh-db.test.ts).
 */

const TENANT = "00000000-0000-4000-8000-000000000001";
const DAY = 24 * 60 * 60 * 1000;

let profile: Record<string, unknown> = {};

function selectChain() {
  const self: Record<string, unknown> = {
    from: () => self,
    leftJoin: () => self,
    where: () => self,
    orderBy: () => self,
    limit: () => self,
    // Every select answers one row, which is all the accounts probe asks.
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve([{ one: 1 }]).then(res, rej),
  };
  return self;
}

vi.mock("../../lib/db.js", () => ({
  db: {
    select: () => selectChain(),
    transaction: () => {
      throw new Error("the read opened a transaction");
    },
  },
}));

// Generators that never finish: a read that waited on one would never answer.
const generateInsights = vi.fn(() => new Promise<number>(() => {}));
const generateSpendCuts = vi.fn(() => new Promise<number>(() => {}));
vi.mock("../../lib/insights-engine.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/insights-engine.js")>()),
  generateInsights: () => generateInsights(),
}));
vi.mock("../../lib/spend-cuts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/spend-cuts.js")>()),
  generateSpendCuts: () => generateSpendCuts(),
  spendCutsWindow: async () => ({ start: new Date(), end: new Date(), months: 12 }),
  lastSpendCutsPolishAt: async () => null,
}));

/** Stands in for the real write, and sets the field a later read sees. */
const requestActionsRefresh = vi.fn(async () => {
  profile.actionsRefreshRequestedAt = new Date();
});
vi.mock("../../lib/actions-refresh.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/actions-refresh.js")>()),
  requestActionsRefresh: () => requestActionsRefresh(),
}));
vi.mock("../../lib/profile-resolver.js", () => ({ readHouseholdProfile: async () => profile }));
vi.mock("../../lib/path-generator.js", () => ({ readPathSteps: async () => [] }));

import type { AuthEnv } from "../../middleware/auth.js";
import { insightsRoutes } from "../insights.js";

const app = new Hono<AuthEnv>();
app.use("*", async (c, next) => {
  c.set("session", { tenantId: TENANT, userId: "u1" } as AuthEnv["Variables"]["session"]);
  await next();
});
app.route("/insights", insightsRoutes);

const read = async () => (await app.request("/insights")).json() as Promise<{ refreshing: boolean }>;
const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
  generateInsights.mockClear();
  generateSpendCuts.mockClear();
  requestActionsRefresh.mockClear();
  profile = { lastActionsGeneratedAt: ago(2 * DAY), lastSpendCutsGeneratedAt: ago(2 * DAY) };
});

describe("a stale read asks for a refresh and answers at once", () => {
  it("answers without starting either generator", async () => {
    const body = await read();
    expect(body.refreshing).toBe(true);
    expect(requestActionsRefresh).toHaveBeenCalledTimes(1);
    expect(generateInsights).not.toHaveBeenCalled();
    expect(generateSpendCuts).not.toHaveBeenCalled();
  });

  it("asks once, however many reads arrive together", async () => {
    // Every read sees the request the first one wrote, so none asks again,
    // and none of them generates.
    await read();
    const bodies = await Promise.all(Array.from({ length: 5 }, read));
    expect(bodies.every((b) => b.refreshing)).toBe(true);
    expect(requestActionsRefresh).toHaveBeenCalledTimes(1);
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it("asks, quietly, when only the spend cuts are stale", async () => {
    // The page promises new actions, so a free spend-cuts recompute is not
    // reported as a refresh.
    profile.lastActionsGeneratedAt = new Date();
    expect((await read()).refreshing).toBe(false);
    expect(requestActionsRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not ask, and is not refreshing, when both are fresh", async () => {
    profile = { lastActionsGeneratedAt: new Date(), lastSpendCutsGeneratedAt: new Date() };
    expect((await read()).refreshing).toBe(false);
    expect(requestActionsRefresh).not.toHaveBeenCalled();
  });

  it("still answers when the request cannot be written", async () => {
    requestActionsRefresh.mockImplementationOnce(async () => {
      throw new Error("db down");
    });
    const res = await app.request("/insights");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { refreshing: boolean }).refreshing).toBe(false);
  });
});
