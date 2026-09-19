import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

/**
 * A detected row that only asks you to LOOK is served as one, whatever is stored.
 *
 * Four of the five detected kinds hand money back and say so. The fifth, a
 * category above the household's own trend, has no remedy at all: nothing here
 * gets to say what a household ought to spend on groceries, so the only honest
 * move it offers is to open that month. Its figure is the gap between one month
 * and their usual, which is a magnitude, not a saving.
 *
 * Stored as "Saves $367/mo" with `effort: involved`, it read as the opposite of
 * all of that: a prescriptive savings promise, and months of work, on a row
 * titled "Check what drove Groceries up".
 *
 * Both are derived on the way OUT as well as written correctly on the way in,
 * from the single definition in lib/spend-cuts.ts. These rows are recomputed once
 * a month, so a write-path fix alone would have left the old wording readable for
 * up to a month. The rows asserted here are the ones that were live on the seeded
 * household, copied as they were stored.
 */

const TENANT = "00000000-0000-4000-8000-000000000003";

interface InsightRow {
  id: string;
  tenantId: string;
  producer: string;
  category: string;
  urgency: string;
  effort: string | null;
  insightType: string | null;
  title: string;
  description: string;
  impact: string | null;
  impactColor: string | null;
  chatPrompt: string | null;
  generatedBy: string;
  createdAt: Date;
  pathStepKey: string | null;
  monthlyValue: string | null;
  oneTimeValue: string | null;
  evidence: string | null;
  metadata: unknown;
}

const store = { insights: [] as InsightRow[] };

function selectChain() {
  const self: Record<string, unknown> = {
    from: () => self,
    where: () => self,
    orderBy: () => self,
    limit: () => self,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(store.insights.map((r) => ({ ...r }))).then(res, rej),
  };
  return self;
}

vi.mock("../../lib/db.js", () => ({
  db: {
    select: () => selectChain(),
    query: {
      financialPaths: { findFirst: async () => undefined },
      financialPathSteps: { findMany: async () => [] },
      financialProfiles: { findFirst: async () => undefined },
    },
  },
}));

// Both freshly stamped, so neither producer's backstop fires. Stubbed so a
// regression there fails loudly instead of quietly recomputing.
const generateInsights = vi.fn(async () => 0);
vi.mock("../../lib/insights-engine.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/insights-engine.js")>()),
  generateInsights: () => generateInsights(),
}));
const generateSpendCuts = vi.fn(async () => 0);
vi.mock("../../lib/spend-cuts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/spend-cuts.js")>()),
  generateSpendCuts: () => generateSpendCuts(),
}));
vi.mock("../../lib/profile-resolver.js", () => ({
  readHouseholdProfile: async () => ({
    lastActionsGeneratedAt: new Date(),
    lastSpendCutsGeneratedAt: new Date(),
  }),
}));

import type { AuthEnv } from "../../middleware/auth.js";
import { insightsRoutes } from "../insights.js";

const app = new Hono<AuthEnv>();
app.use("*", async (c, next) => {
  c.set("session", { tenantId: TENANT, userId: "u1" } as AuthEnv["Variables"]["session"]);
  await next();
});
app.route("/insights", insightsRoutes);

let nextId = 0;

/** One detected row, stored exactly as the generator wrote it before the fix. */
function storeDetected(row: {
  kind: string;
  size: string;
  title: string;
  effort: string;
  impact: string;
  monthlyValue?: string | null;
  oneTimeValue?: string | null;
}) {
  store.insights.push({
    id: `insight-${++nextId}`,
    tenantId: TENANT,
    producer: "spend-cuts",
    category: "general",
    urgency: "medium",
    effort: row.effort,
    insightType: "spending",
    title: row.title,
    description: "The figure beside this row is the gap between that month and your usual.",
    impact: row.impact,
    impactColor: "green",
    chatPrompt: null,
    // "system" so the two AI copy guards are not the thing under test here.
    generatedBy: "system",
    createdAt: new Date(),
    pathStepKey: null,
    monthlyValue: row.monthlyValue ?? null,
    oneTimeValue: row.oneTimeValue ?? null,
    evidence: "Groceries was $1,132.50 in August 2026, up 86% on your usual $264.71.",
    // No transaction ids, so nothing is hydrated and no drill is built: neither is
    // what this file is about.
    metadata: { kind: row.kind, size: row.size, txnIds: [] },
  });
}

async function served(): Promise<Array<{ title: string; impact: string | null; effort: string | null }>> {
  const res = await app.request("/insights");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    insights: Array<{ title: string; impact: string | null; effort: string | null }>;
  };
  return body.insights.map((i) => ({ title: i.title, impact: i.impact, effort: i.effort }));
}

beforeEach(() => {
  store.insights = [];
  nextId = 0;
  generateInsights.mockClear();
  generateSpendCuts.mockClear();
});

describe("a category row stored as a saving is served as a magnitude", () => {
  it("relabels the four rows that were live on the seeded household", async () => {
    for (const [category, figure, label] of [
      ["Utilities", "366.76", "Saves $367/mo"],
      ["Software & SaaS", "337.17", "Saves $337/mo"],
      ["Groceries", "228.88", "Saves $229/mo"],
      ["Gas", "213.32", "Saves $213/mo"],
    ] as const) {
      storeDetected({
        kind: "category_above_trend",
        size: "l",
        title: `Check what drove ${category} up`,
        effort: "involved",
        impact: label,
        monthlyValue: figure,
      });
    }

    expect(await served()).toEqual([
      { title: "Check what drove Utilities up", impact: "$367 above usual", effort: "quick" },
      { title: "Check what drove Software & SaaS up", impact: "$337 above usual", effort: "quick" },
      { title: "Check what drove Groceries up", impact: "$229 above usual", effort: "quick" },
      { title: "Check what drove Gas up", impact: "$213 above usual", effort: "quick" },
    ]);
    expect(generateInsights).not.toHaveBeenCalled();
    expect(generateSpendCuts).not.toHaveBeenCalled();
  });

  it("says nothing about saving anywhere in the row", async () => {
    storeDetected({
      kind: "category_above_trend",
      size: "l",
      title: "Check what drove Groceries up",
      effort: "involved",
      impact: "Saves $229/mo",
      monthlyValue: "228.88",
    });

    const [row] = await served();
    expect(row.impact).not.toMatch(/sav/i);
    expect(row.effort).not.toBe("involved");
  });
});

describe("the kinds that do hand money back are untouched", () => {
  it("keeps a monthly saving stated as one, and its effort read off its letter", async () => {
    storeDetected({
      kind: "price_increase",
      size: "s",
      title: "Ask Acme for the rate you were paying before",
      effort: "quick",
      impact: "Saves $3/mo",
      monthlyValue: "2.50",
    });
    storeDetected({
      kind: "duplicate_service",
      size: "m",
      title: "Cancel Songbox and keep Tuneline",
      effort: "moderate",
      impact: "Saves $12/mo",
      monthlyValue: "11.50",
    });

    expect(await served()).toEqual([
      {
        title: "Ask Acme for the rate you were paying before",
        impact: "Saves $3/mo",
        effort: "quick",
      },
      {
        title: "Cancel Songbox and keep Tuneline",
        impact: "Saves $12/mo",
        effort: "moderate",
      },
    ]);
  });

  it("keeps money back once stated once, off the one-off column", async () => {
    storeDetected({
      kind: "one_time_fee",
      size: "s",
      title: "Ask your bank to refund the bank fee",
      effort: "quick",
      impact: "$2,900 back once",
      oneTimeValue: "2900.00",
    });

    expect((await served())[0]).toEqual({
      title: "Ask your bank to refund the bank fee",
      impact: "$2,900 back once",
      effort: "quick",
    });
  });
});
