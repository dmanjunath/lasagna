import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

/**
 * The line between the free regeneration and the paid one.
 *
 * Two questions used to share financial_profiles.last_spend_cuts_generated_at:
 * "are these figures from a previous month", which the free read backstop asks
 * and answers, and "did this household recently trigger the paid rewrite",
 * which the refresh throttle asks. So the backstop firing on a stale set locked
 * the household out of the rewrite for six hours, having pressed nothing.
 *
 * The throttle now reads the model-call ledger instead, through
 * lastSpendCutsPolishAt. What these hold: a free run leaves the paid path open,
 * a paid one closes it, and a paid attempt that FAILED closes it too, so a
 * broken model path cannot be pressed over and over.
 *
 * Driven against routes/insights.ts, which owns both producers now. The actions
 * marker is kept fresh throughout so the OTHER (paid, model) backstop never
 * fires: the two are separate markers and separate transactions, and nothing
 * here is allowed to bill a model call.
 */

const TENANT = "00000000-0000-4000-8000-000000000001";

/** The spend-cuts freshness marker, as readHouseholdProfile reports it. */
let lastGeneratedAt: Date | null = null;
/**
 * The paid marker: the household's last spend-cuts model call, as the ledger
 * would report it. Only a polish run writes one, which is the whole point.
 */
let lastPolishAt: Date | null = null;
let hasAccounts = true;

/**
 * A select chain that knows which table it reads, because the route asks two
 * questions of the database directly: the stored rows, and whether this
 * household has any accounts at all.
 */
function selectChain() {
  let table: unknown = null;
  const self: Record<string, unknown> = {
    from: (t: unknown) => {
      table = t;
      return self;
    },
    leftJoin: () => self,
    where: () => self,
    orderBy: () => self,
    limit: () => self,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(table === accounts && hasAccounts ? [{ one: 1 }] : []).then(res, rej),
  };
  return self;
}

vi.mock("../../lib/db.js", () => ({
  db: {
    select: () => selectChain(),
    transaction: async (fn: (tx: unknown) => Promise<boolean>) =>
      fn({ execute: async () => [{ locked: true }] }),
  },
}));

/**
 * Stands in for the real generator, and mirrors the one fact this file is
 * about: a polish run reaches lib/llm.ts, which records the call from a
 * `finally`, so the paid marker moves whether the run then succeeds or throws.
 * A free run makes no model call and records nothing.
 */
const generateSpendCuts = vi.fn(async (_tenantId: string, options?: { polish?: boolean }) => {
  if (options?.polish) lastPolishAt = new Date();
  lastGeneratedAt = new Date();
  return 3;
});

vi.mock("../../lib/spend-cuts.js", () => ({
  generateSpendCuts: (...args: unknown[]) =>
    generateSpendCuts(...(args as [string, { polish?: boolean } | undefined])),
  lastSpendCutsPolishAt: async () => lastPolishAt,
  spendCutsWindow: async () => ({
    start: new Date("2025-09-01T00:00:00Z"),
    end: new Date("2026-09-01T00:00:00Z"),
    months: 12,
  }),
  spendCutTotals: () => ({ monthly: 0, oneTime: 0 }),
  statesUnknownFigure: () => false,
  claimsRecurrence: () => false,
  SPEND_CUTS_PRODUCER: "spend-cuts",
}));

// The paid model backstop. Stubbed so a regression that lets it fire here shows
// up as a failed expectation rather than as a bill.
const generateInsights = vi.fn(async () => 0);
vi.mock("../../lib/insights-engine.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/insights-engine.js")>()),
  generateInsights: () => generateInsights(),
}));
vi.mock("../../lib/path-generator.js", () => ({ readPathSteps: async () => [] }));
vi.mock("../../lib/profile-resolver.js", () => ({
  readHouseholdProfile: async () => ({
    // Fresh, so the 48h paid backstop never fires in this file.
    lastActionsGeneratedAt: new Date(),
    lastSpendCutsGeneratedAt: lastGeneratedAt,
  }),
}));

import { accounts } from "@lasagna/core";
import type { AuthEnv } from "../../middleware/auth.js";
import { insightsRoutes } from "../insights.js";

const app = new Hono<AuthEnv>();
app.use("*", async (c, next) => {
  c.set("session", { tenantId: TENANT, userId: "u1" } as AuthEnv["Variables"]["session"]);
  await next();
});
app.route("/insights", insightsRoutes);

const read = () => app.request("/insights");
const press = () => app.request("/insights/refresh-spend-cuts", { method: "POST" });
const HOURS = 60 * 60 * 1000;
const agoMs = (ms: number) => new Date(Date.now() - ms);
/** A generation from a previous month, which is what makes a set stale. */
const lastMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
};

beforeEach(() => {
  generateSpendCuts.mockClear();
  generateInsights.mockClear();
  lastGeneratedAt = null;
  lastPolishAt = null;
  hasAccounts = true;
});

describe("a free regeneration leaves the paid refresh open", () => {
  it("regenerates a stale set without polish, and does not throttle the press after it", async () => {
    lastGeneratedAt = lastMonth();

    const body = (await (await read()).json()) as {
      lastSpendCutsGeneratedAt: string | null;
      lastPolishAttemptAt: string | null;
    };

    // The backstop ran, for free. And the paid one did not run at all.
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
    expect(generateSpendCuts.mock.calls[0]?.[1]?.polish).toBeFalsy();
    expect(generateInsights).not.toHaveBeenCalled();
    // And it moved the freshness marker only. This is the measured defect: the
    // page used to read the throttle off the field above and print
    // "Next in 6h" over a dimmed button.
    expect(body.lastSpendCutsGeneratedAt).not.toBeNull();
    expect(body.lastPolishAttemptAt).toBeNull();

    expect((await press()).status).toBe(200);
    expect(generateSpendCuts.mock.calls[1]?.[1]?.polish).toBe(true);
  });

  it("does not throttle the press when the figures were worked out minutes ago for free", async () => {
    // Fresh set, so no backstop, and nobody has paid for a rewrite yet.
    lastGeneratedAt = agoMs(5 * 60 * 1000);

    expect((await press()).status).toBe(200);
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
  });

  it("skips the backstop entirely for a household with no accounts", async () => {
    lastGeneratedAt = lastMonth();
    hasAccounts = false;

    const res = await read();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ hasAccounts: false });
    expect(generateSpendCuts).not.toHaveBeenCalled();
  });
});

describe("a paid regeneration closes the throttle", () => {
  it("refuses a second press inside the window", async () => {
    expect((await press()).status).toBe(200);

    const second = await press();
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "throttled" });
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
  });

  it("refuses every press inside the window, however many are made", async () => {
    lastPolishAt = agoMs(1 * HOURS);

    for (let i = 0; i < 20; i++) expect((await press()).status).toBe(429);

    expect(generateSpendCuts).not.toHaveBeenCalled();
  });

  it("offers it again once the window has passed", async () => {
    lastPolishAt = agoMs(6 * HOURS + 1000);

    expect((await press()).status).toBe(200);
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
  });

  it("reports the paid marker to the page, so the button dims before the press", async () => {
    lastPolishAt = agoMs(1 * HOURS);
    lastGeneratedAt = agoMs(1 * HOURS);

    const body = (await (await read()).json()) as { lastPolishAttemptAt: string | null };

    expect(body.lastPolishAttemptAt).toBe(lastPolishAt.toISOString());
  });
});

describe("a paid attempt that failed still closes the throttle", () => {
  it("cannot be pressed twice, so a broken model path is not billed on repeat", async () => {
    // The shape of it: the model call is recorded from a `finally` in
    // lib/llm.ts, and something after it throws.
    generateSpendCuts.mockImplementationOnce(async () => {
      lastPolishAt = new Date();
      throw new Error("write failed after the model call");
    });

    expect((await press()).status).toBe(502);

    for (let i = 0; i < 5; i++) expect((await press()).status).toBe(429);
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
  });
});

/**
 * The refresh path is one segment, so it cannot be read as an action id. If it
 * ever collided with /:id/*, a press would 400 on the uuid guard instead of
 * regenerating.
 */
describe("the refresh path does not collide with the per-action routes", () => {
  it("reaches the generator rather than the id guard", async () => {
    expect((await press()).status).toBe(200);
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
  });

  it("answers 400 rather than 500 on a malformed action id", async () => {
    const res = await app.request("/insights/not-a-uuid/dismiss", { method: "POST" });
    expect(res.status).toBe(400);
  });
});
