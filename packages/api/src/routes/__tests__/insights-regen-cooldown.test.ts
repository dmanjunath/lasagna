import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

/**
 * The read side of the regeneration brake.
 *
 * GET /insights regenerates synchronously when the household's recorded
 * generation attempt is older than REGEN_STALE_MS, as a backstop for a stalled
 * scheduler. That marker is now written whether generation SUCCEEDED or FAILED
 * (see insights-regen-loop.test.ts), so this window doubles as the cooldown
 * between two attempts.
 *
 * What these hold is the half that costs money: a read whose recorded attempt
 * is inside the window must not call the model. It used to, on every single
 * read, because a failed generation left the marker unwritten and the household
 * permanently stale.
 */

const TENANT = "00000000-0000-4000-8000-000000000001";

/** What readHouseholdProfile reports, set per test. */
let lastAttempt: Date | null = null;
/** Whether the household has any accounts at all. */
let accountRows: Array<{ one: number }> = [{ one: 1 }];

function selectChain(rows: unknown[]) {
  const self: Record<string, unknown> = {
    from: () => self,
    where: () => self,
    orderBy: () => self,
    limit: () => self,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej),
  };
  return self;
}

// The route reads active insights first, then (only when stale) the accounts
// probe. Both go through db.select(); the probe is the one that passes a
// projection, which is how they are told apart here.
vi.mock("../../lib/db.js", () => ({
  db: {
    select: (projection?: unknown) => selectChain(projection ? accountRows : []),
    transaction: async (fn: (tx: unknown) => Promise<boolean>) =>
      fn({ execute: async () => [{ locked: true }] }),
  },
}));

const generateInsights = vi.fn(async () => 0);
vi.mock("../../lib/insights-engine.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/insights-engine.js")>()),
  generateInsights: (...args: unknown[]) => generateInsights(...(args as [])),
}));
vi.mock("../../lib/profile-resolver.js", () => ({
  readHouseholdProfile: async () => ({ lastActionsGeneratedAt: lastAttempt }),
}));
vi.mock("../../lib/path-generator.js", () => ({ readPathSteps: async () => [] }));

import type { AuthEnv } from "../../middleware/auth.js";
import { insightsRoutes } from "../insights.js";

const app = new Hono<AuthEnv>();
app.use("*", async (c, next) => {
  c.set("session", { tenantId: TENANT, userId: "u1" } as AuthEnv["Variables"]["session"]);
  await next();
});
app.route("/insights", insightsRoutes);

const read = () => app.request("/insights");
const agoMs = (ms: number) => new Date(Date.now() - ms);
const HOURS = 60 * 60 * 1000;

beforeEach(() => {
  generateInsights.mockClear();
  accountRows = [{ one: 1 }];
  lastAttempt = null;
});

describe("a read inside the cooldown does not regenerate", () => {
  it("does not call the model when the last attempt was minutes ago", async () => {
    lastAttempt = agoMs(5 * 60 * 1000);

    expect((await read()).status).toBe(200);

    expect(generateInsights).not.toHaveBeenCalled();
  });

  it("does not call the model an hour after a failed attempt", async () => {
    // The shape of the leak: generation failed, the attempt was recorded, and
    // the person keeps navigating. Every one of these reads used to pay.
    lastAttempt = agoMs(1 * HOURS);

    for (let i = 0; i < 20; i++) expect((await read()).status).toBe(200);

    expect(generateInsights).not.toHaveBeenCalled();
  });

  it("regenerates exactly once when the window has actually passed", async () => {
    lastAttempt = agoMs(49 * HOURS);

    expect((await read()).status).toBe(200);

    expect(generateInsights).toHaveBeenCalledTimes(1);
  });

  it("regenerates for a household that has never been generated for", async () => {
    lastAttempt = null;

    expect((await read()).status).toBe(200);

    expect(generateInsights).toHaveBeenCalledTimes(1);
  });

  it("never regenerates for a household with no accounts", async () => {
    lastAttempt = null;
    accountRows = [];

    expect((await read()).status).toBe(200);

    expect(generateInsights).not.toHaveBeenCalled();
  });
});
