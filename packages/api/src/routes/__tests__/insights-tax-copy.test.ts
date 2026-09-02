import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

/**
 * An action may not price the tax it saves, and the rule holds on the way OUT.
 *
 * The generator drops such an action as it writes, which does nothing for the
 * rows already in the table: a tenant keeps whatever was generated for them
 * until their next run, so "Save $2,790 in taxes" stayed on the tax page for
 * days after the rule shipped. The route applies the same check as it serves,
 * so the copy is unreachable from the moment this deploys.
 *
 * This drives the real route, because the property is what the ROUTE answers
 * with. The two rows asserted here are the ones that were live on the demo
 * household, copied as they were stored.
 *
 * The other half of the property is that the check is tax-scoped: a debt payoff
 * worth "$340/yr" and an employer match worth "$3,400" are real money the user
 * gains, and a filter that took them with it would be a worse bug than the one
 * it fixes.
 */

const TENANT = "00000000-0000-4000-8000-000000000001";

interface InsightRow {
  id: string;
  tenantId: string;
  category: string;
  urgency: string;
  insightType: string | null;
  title: string;
  description: string;
  impact: string | null;
  impactColor: string | null;
  chatPrompt: string | null;
  generatedBy: string;
  createdAt: Date;
  pathStepKey: string | null;
}

const store = { insights: [] as InsightRow[] };

/** A select chain. Only the insights table is read on this path. */
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
    // No path is stored, so every action is served unattached and in the order
    // the SQL gave them. Ordering is asserted by insights-path-order.test.ts.
    query: {
      financialPaths: { findFirst: async () => undefined },
      financialPathSteps: { findMany: async () => [] },
      financialProfiles: { findFirst: async () => undefined },
    },
  },
}));

// The profile is freshly stamped, so the stale backstop never fires. Stubbed
// so a regression there fails loudly instead of quietly paying for a model call.
const generateInsights = vi.fn(async () => 0);
vi.mock("../../lib/insights-engine.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/insights-engine.js")>()),
  generateInsights: () => generateInsights(),
}));
vi.mock("../../lib/profile-resolver.js", () => ({
  readHouseholdProfile: async () => ({ lastActionsGeneratedAt: new Date() }),
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

function storeInsight(row: {
  category: string;
  type: string;
  title: string;
  description?: string;
  impact?: string;
  impactColor?: string | null;
}) {
  store.insights.push({
    id: `insight-${++nextId}`,
    tenantId: TENANT,
    category: row.category,
    urgency: "medium",
    insightType: row.type,
    title: row.title,
    description: row.description ?? "",
    impact: row.impact ?? null,
    impactColor: row.impactColor ?? null,
    chatPrompt: null,
    generatedBy: "ai",
    createdAt: new Date(),
    pathStepKey: null,
  });
}

async function served(): Promise<
  Array<{ title: string; impact: string | null; impactColor: string | null }>
> {
  const res = await app.request("/insights");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    insights: Array<{ title: string; impact: string | null; impactColor: string | null }>;
  };
  return body.insights.map((i) => ({
    title: i.title,
    impact: i.impact,
    impactColor: i.impactColor,
  }));
}

beforeEach(() => {
  store.insights = [];
  nextId = 0;
  generateInsights.mockClear();
});

describe("a stored action that prices a tax saving is not served", () => {
  it("suppresses the HSA row that was live on the tax page", async () => {
    storeInsight({
      category: "tax",
      type: "tax",
      title: "Max your HSA with $7,750 more to save $2,790 in taxes",
      description:
        "You have contributed $800 of the $8,550 married filing jointly limit for the year.",
      impact: "Save $2,790 in taxes",
      impactColor: "green",
    });

    expect(await served()).toEqual([]);
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it("suppresses the 529 row that was live beside it", async () => {
    storeInsight({
      category: "tax",
      type: "tax",
      title: "Fund a NY 529 with $10,000 to cut state tax by $685",
      description: "New York deducts up to $10,000 per year for a married couple filing jointly.",
      impact: "Save $685 in state tax",
      impactColor: "green",
    });

    expect(await served()).toEqual([]);
  });

  it("catches the copy wherever in the row it sits", async () => {
    // The impact label alone is enough, and so is the description alone.
    storeInsight({
      category: "tax",
      type: "tax",
      title: "Open a Roth IRA and contribute $7,000 this year",
      description: "Nothing objectionable here.",
      impact: "$1,200 tax savings",
    });
    storeInsight({
      category: "general",
      type: "general",
      title: "Bunch two years of giving into one",
      description: "Doing it in one year would reduce your tax bill by $2,000.",
      impact: "$30,000 bunched",
    });

    expect(await served()).toEqual([]);
  });
});

describe("the check does not reach past the tax it was written for", () => {
  it("serves a debt payoff with its money figure intact", async () => {
    storeInsight({
      category: "debt",
      type: "debt",
      title: "Pay down your $3,076 card to stop $736/yr in interest",
      description: "The card carries 24.99% APR against $3,076 of balance.",
      impact: "Save $340/yr",
      impactColor: "green",
    });

    expect(await served()).toEqual([
      {
        title: "Pay down your $3,076 card to stop $736/yr in interest",
        impact: "Save $340/yr",
        impactColor: "green",
      },
    ]);
  });

  it("serves an employer match and a tax action that names an amount to act on", async () => {
    storeInsight({
      category: "savings",
      type: "retirement",
      title: "Raise your 401(k) to 4% to claim $3,400/yr in free match",
      impact: "$3,400 match",
      impactColor: "green",
    });
    storeInsight({
      category: "tax",
      type: "tax",
      title: "Put the $8,550 of HSA room you have left to work",
      description: "You have contributed $800 of the $8,550 limit for your filing status.",
      impact: "$7,750 room left",
      impactColor: "amber",
    });

    expect((await served()).map((i) => i.impact)).toEqual(["$3,400 match", "$7,750 room left"]);
  });
});

describe("a tax action is not served in the colour of money gained", () => {
  it("serves a stored green tax row as amber", async () => {
    storeInsight({
      category: "tax",
      type: "tax",
      title: "Put the $8,550 of HSA room you have left to work",
      impact: "$8,550 room left",
      impactColor: "green",
    });

    expect((await served())[0].impactColor).toBe("amber");
  });

  it("coerces on the type tag alone, as the generator does", async () => {
    storeInsight({
      category: "general",
      type: "tax",
      title: "Harvest the $4,200 loss sitting in your brokerage",
      impact: "$4,200 loss",
      impactColor: "green",
    });

    expect((await served())[0].impactColor).toBe("amber");
  });

  it("leaves every other row's colour alone", async () => {
    storeInsight({
      category: "debt",
      type: "debt",
      title: "Pay down your $3,076 card to stop $736/yr in interest",
      impact: "Save $340/yr",
      impactColor: "green",
    });
    storeInsight({
      category: "tax",
      type: "tax",
      title: "File the 1099 you have not reported",
      impact: "$12,400 unreported",
      impactColor: "red",
    });
    storeInsight({
      category: "savings",
      type: "savings",
      title: "Move $200 into your buffer",
      impact: "$200/mo",
      impactColor: null,
    });

    expect((await served()).map((i) => i.impactColor)).toEqual(["green", "red", null]);
  });
});
