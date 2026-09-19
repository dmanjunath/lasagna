import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

/**
 * A model-written row may not open with an observation, and may not price
 * something it cannot see. Both rules hold on the way OUT.
 *
 * The remedies on a detected row are deterministic and never model-written, for
 * one reason: a model inventing a third party's pricing tells the reader
 * something false about a real company. The written rows have no such producer
 * behind them, only a prompt, and the prompt was not enough. Two rows were live
 * and served when this was written, both copied here as they were stored:
 *
 *   - "Review the $14,047 rental property maintenance spike in August", urgency
 *     high, over a body saying "no action needed". Rule 3 bans the word by name.
 *   - "If these are high-APR cards (15-25%), you're potentially paying
 *     $700-$1,400/yr in interest." Rule 3's last line bans putting a rate or a
 *     price on somebody else's product, because there is no data behind either.
 *
 * Neither existing guard could reach them. `pricesTaxSaving` is tax-scoped by
 * construction, and the detector's figure guard only asks whether a number
 * appears in that row's own receipt, which an invented rate on a card nobody
 * described is not: it is not a number about this household at all.
 *
 * So the route applies both as it serves, and the offending rows become
 * unreachable the moment this deploys, with no regeneration and nothing deleted.
 *
 * The other half of the property, and the half worth more, is what still
 * serves: a percentage computed from the household's own transactions is
 * descriptive and allowed, and so is a move from one of their figures to
 * another. A guard that took those would be a worse bug than the one it fixes.
 *
 * This drives the real route, because the property is what the ROUTE answers
 * with.
 */

const TENANT = "00000000-0000-4000-8000-000000000002";

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
    query: {
      financialPaths: { findFirst: async () => undefined },
      financialPathSteps: { findMany: async () => [] },
      financialProfiles: { findFirst: async () => undefined },
    },
  },
}));

// Freshly stamped, so the stale backstop never fires. Stubbed so a regression
// there fails loudly instead of quietly paying for a model call.
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
  category?: string;
  type?: string;
  urgency?: string;
  title: string;
  description?: string;
  impact?: string;
}) {
  store.insights.push({
    id: `insight-${++nextId}`,
    tenantId: TENANT,
    category: row.category ?? "general",
    urgency: row.urgency ?? "medium",
    insightType: row.type ?? "general",
    title: row.title,
    description: row.description ?? "",
    impact: row.impact ?? null,
    impactColor: null,
    chatPrompt: null,
    generatedBy: "ai",
    createdAt: new Date(),
    pathStepKey: null,
  });
}

async function servedTitles(): Promise<string[]> {
  const res = await app.request("/insights");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { insights: Array<{ title: string }> };
  return body.insights.map((i) => i.title);
}

beforeEach(() => {
  store.insights = [];
  nextId = 0;
  generateInsights.mockClear();
});

describe("a stored row whose title only observes is not served", () => {
  it("suppresses the rental maintenance row that was live in the top band", async () => {
    storeInsight({
      type: "spending",
      urgency: "high",
      title: "Review the $14,047 rental property maintenance spike in August",
      description:
        "August maintenance ran far above the months around it. If this was a one-time capital improvement, no action needed.",
      impact: "$14,047 spike",
    });

    expect(await servedTitles()).toEqual([]);
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it("suppresses the other words for the same non-move", async () => {
    for (const title of [
      "Consider opening a high yield savings account",
      "Look into your subscription charges",
      "Monitor your dining spending next month",
      "Keep an eye on your credit utilisation",
    ]) {
      storeInsight({ title, description: "Why it matters." });
    }

    expect(await servedTitles()).toEqual([]);
  });

  it("serves a title that names a move, even when the word appears later in it", async () => {
    storeInsight({
      title: "Cancel the card you review every statement",
      description: "It bills every month and nothing uses it.",
      impact: "$12/mo",
    });

    expect(await servedTitles()).toEqual(["Cancel the card you review every statement"]);
  });
});

describe("a stored row that prices something it cannot see is not served", () => {
  it("suppresses the card row that invented both a rate and a cost", async () => {
    storeInsight({
      category: "debt",
      type: "debt",
      title: "Pay down your two highest card balances",
      description:
        "If these are high-APR cards (15-25%), you're potentially paying $700-$1,400/yr in interest.",
      impact: "$6,200 balance",
    });

    expect(await servedTitles()).toEqual([]);
  });

  it("suppresses a rate span on its own, and a money span on its own", async () => {
    storeInsight({
      category: "debt",
      type: "debt",
      title: "Move the balance to a cheaper card",
      description: "Balance transfer cards charge interest of 18-24% once the promotion ends.",
    });
    storeInsight({
      category: "savings",
      type: "savings",
      title: "Open a high yield savings account",
      description: "A year of your emergency fund there is worth $400 to $900 more than it earns now.",
    });

    expect(await servedTitles()).toEqual([]);
  });
});

describe("the guards do not reach the household's own figures", () => {
  it("serves a descriptive percentage computed from their own transactions", async () => {
    storeInsight({
      type: "spending",
      title: "Cap dining near $39 after it jumped 129% to $89",
      description: "Dining ran 129% above your own usual month, $89 against $39.",
      impact: "$50/mo",
    });

    expect(await servedTitles()).toEqual(["Cap dining near $39 after it jumped 129% to $89"]);
  });

  it("serves a move from one of their figures to another, rate word and all", async () => {
    storeInsight({
      category: "savings",
      type: "savings",
      title: "Raise your savings rate from 12% to 15% of income",
      description: "Your savings rate sat at 12% last month against a 15% target you set.",
    });
    storeInsight({
      category: "savings",
      type: "savings",
      title: "Move your savings from 0.01% to 4.5% by switching to a high-yield account",
      description: "The account holding your cash pays 0.01%.",
    });

    expect(await servedTitles()).toEqual([
      "Raise your savings rate from 12% to 15% of income",
      "Move your savings from 0.01% to 4.5% by switching to a high-yield account",
    ]);
  });

  it("serves a row naming two real amounts in one sentence", async () => {
    storeInsight({
      category: "debt",
      type: "debt",
      title: "Pay down your $3,076 card to stop $736/yr in interest",
      description: "The card carries 24.99% APR against $3,076 of balance.",
      impact: "$3,076 balance",
    });

    expect(await servedTitles()).toEqual([
      "Pay down your $3,076 card to stop $736/yr in interest",
    ]);
  });

  it("serves an amount followed by a count, which is not a span", async () => {
    // "to" is also how a count is named. Demanding the currency on both sides of
    // it is what keeps this sentence out of the money-span rule.
    storeInsight({
      category: "savings",
      type: "savings",
      title: "Move $5,000 to 3 different funds",
      description: "Splitting the cash across 3 funds spreads it further than one.",
    });

    expect(await servedTitles()).toEqual(["Move $5,000 to 3 different funds"]);
  });

  it("serves general allocation guidance written as a percentage range", async () => {
    storeInsight({
      category: "portfolio",
      type: "portfolio",
      title: "A globally diversified stock allocation holds 60-70% of it in the US",
      description: "Holding a third of the stocks outside the US spreads the risk across more than one economy.",
      impact: "70/30 guideline",
    });

    expect(await servedTitles()).toEqual([
      "A globally diversified stock allocation holds 60-70% of it in the US",
    ]);
  });
});
