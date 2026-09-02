import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";

/**
 * In a hosted deployment a portfolio action states general allocation guidance
 * rather than the reader's own holdings and figures, and the rule holds on the
 * way OUT.
 *
 * The generator drops such an action as it writes, which does nothing for the
 * rows already in the table: on the day the flag is turned on, every portfolio
 * row stored for every household was written under the old prompt, and each one
 * stays readable until that household regenerates, which is a daily cron away
 * at best and up to 48 hours at worst. The route applies the same check as it
 * serves, so the copy is unreachable from the moment this deploys.
 *
 * The second half of the file is the more important one. A self-hosted
 * deployment is unaffected, so every row suppressed above must come back
 * untouched with the flag unset. A filter that ran unconditionally would empty
 * the portfolio lens for every self-hosted install in the world, and it would
 * do it silently, because a reader with no actions renders nothing at all.
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
  dismissed: Date | null;
  actedOn: Date | null;
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

// The holdings this household owns. Real, so the ticker and the fund name in
// the rows below are matched against something rather than against a shape.
const DEFAULT_HELD = {
  tickers: ["VTSAX", "PG"],
  names: ["Procter & Gamble Co.", "Vanguard Total Stock Market ETF"],
};
// A household whose holdings are also a card network, a shop, a phone and a
// charge card. Every consumer brand in the index is one of these.
const BRAND_HELD = {
  tickers: ["V", "TGT", "AAPL", "AXP"],
  names: ["Visa Inc.", "Target Corporation", "Apple Inc.", "American Express Company"],
};
const heldSecurityNames = vi.fn(async () => DEFAULT_HELD);

// The profile is freshly stamped, so the stale backstop never fires. Stubbed
// so a regression there fails loudly instead of quietly paying for a model call.
const generateInsights = vi.fn(async () => 0);
vi.mock("../../lib/insights-engine.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/insights-engine.js")>()),
  generateInsights: () => generateInsights(),
  heldSecurityNames: () => heldSecurityNames(),
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
  title: string;
  description?: string;
  impact?: string;
  category?: string;
  type?: string;
}) {
  store.insights.push({
    id: `insight-${++nextId}`,
    tenantId: TENANT,
    category: row.category ?? "portfolio",
    urgency: "medium",
    insightType: row.type ?? "portfolio",
    title: row.title,
    description: row.description ?? "",
    impact: row.impact ?? null,
    impactColor: "amber",
    chatPrompt: null,
    generatedBy: "ai",
    createdAt: new Date(),
    dismissed: new Date(),
    actedOn: null,
    pathStepKey: null,
  });
}

async function servedTitles(path = "/insights"): Promise<string[]> {
  const res = await app.request(path);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { insights: Array<{ title: string }> };
  return body.insights.map((i) => i.title);
}

/** The four actions the portfolio lens produced before the rule existed. */
const PERSONALIZED = [
  {
    title: "Move about 30% into international funds to diversify",
    description: "Your portfolio is 92% US against a 70% benchmark.",
    impact: "92% US",
  },
  {
    title: "Trim Procter & Gamble from 32% to under 10% to cut single-stock risk",
    description: "One holding is 32% of the brokerage.",
    impact: "$192,000 equity",
  },
  {
    title: "Rebalance to a 70/30 split to match your age",
    description: "You hold 4% in bonds at age 41.",
    impact: "4% bonds",
  },
  {
    title: "Harvest the $4,200 loss in VTSAX",
    description: "The lot is worth less than it cost.",
    impact: "$4,200 loss",
    category: "tax",
    type: "tax",
  },
];

/** The same four triggers, written as this deployment writes them. */
const GENERAL = [
  {
    title: "The recommended stock allocation is about 70 percent US to 30 percent international",
    description:
      "A globally diversified stock allocation holds roughly a third of it outside the US. Open the Portfolio page to see how the split compares.",
    impact: "70/30 guideline",
  },
  {
    title: "A single holding above 10 percent of a portfolio is generally considered concentrated",
    description:
      "Concentration ties a large share of a portfolio to the results of one company. Open the Portfolio page to see the weight of the largest position.",
    impact: "10% guideline",
  },
  {
    title: "Bonds should make up 20 percent of a balanced portfolio",
    description:
      "A common rule of thumb raises the bond share with age. Open the Portfolio page to see the current bond share.",
    impact: "20% bonds",
  },
  {
    title:
      "Realized losses in a taxable account offset capital gains, and up to $3,000 of ordinary income a year",
    description:
      "Selling a position worth less than it cost turns a paper loss into one that offsets gains. Open the Portfolio page to see which positions sit below their cost basis.",
    impact: "$3,000 limit",
    category: "tax",
    type: "tax",
  },
];

/** Actions from every other lens, which the rule never touches. */
const OTHER_LENSES = [
  {
    title: "Raise your 401(k) to 4% to claim $3,400/yr in free match",
    description: "Your employer matches the first 4% and you contribute 1%.",
    impact: "$3,400 match",
    category: "savings",
    type: "retirement",
  },
  {
    title: "Pay down your $3,076 card to stop $736/yr in interest",
    description: "The card carries 24.99% APR against $3,076 of balance.",
    impact: "$736/yr interest",
    category: "debt",
    type: "debt",
  },
  {
    title: "Invest $33,290 of idle cash to earn about $998/yr more",
    description: "Cash above six months of expenses earns the savings rate, not the market's.",
    impact: "$33,290 idle",
    category: "savings",
    type: "savings",
  },
];

/**
 * Rows a run of the rule over every stored action suppressed without cause.
 * Each belongs to a lens the rule must never touch, and each was matched on an
 * account noun sitting near a figure: a household with a card and a brokerage
 * writes these sentences in every action it has.
 */
const OTHER_LENSES_WITH_A_BROKERAGE = [
  {
    title: "Invest $56,632 of idle cash to earn about $1,700/yr more",
    description:
      "The excess earns about 5% in cash against an expected 8% market return in your brokerage. Moving it into a broad market index fund captures a 3% spread.",
    impact: "Earn $1,700/yr more",
    category: "savings",
    type: "savings",
  },
  {
    title: "Pay down your $12,662 Credit Card to stop $3,163/yr in interest",
    description:
      "At 24.99% APR this balance costs $263/mo in interest. Clearing it eliminates the highest-cost debt in your portfolio and frees up $263/mo for other goals.",
    impact: "Save $3,163/yr",
    category: "debt",
    type: "debt",
  },
  {
    title: "Credit card at 24.99% APR costs $736/yr in interest",
    description:
      "This is a guaranteed -25% return on money that could be earning 8% in your brokerage.",
    impact: "Save $736/yr",
    category: "debt",
    type: "debt",
  },
  {
    title: "Add interest rate and payment for your $375k Mortgage",
    description:
      "Knowing the rate decides whether extra principal beats investing. If below 4%, investing the difference in your 401(k) or taxable brokerage likely yields more over time.",
    impact: "Unlock payoff strategy",
    category: "debt",
    type: "debt",
  },
  {
    title: "Contribute $7,000 to a Roth IRA for tax-free growth",
    description:
      "You are below the phase-out limit and can contribute the full annual amount. Your brokerage balance of $15,629 suggests room to fund this.",
    impact: "Build tax-free retirement",
    category: "tax",
    type: "tax",
  },
  {
    title: "Invest your $21,029 HSA balance to unlock triple tax advantage",
    description:
      "The account is funded but sitting in cash. Invest it in a low-cost broad market index fund to grow tax-free for decades.",
    impact: "Grow $21k tax-free",
    category: "tax",
    type: "tax",
  },
];

/**
 * Actions from other lenses written as a percentage that moved, or as a share
 * of a tax-advantaged container. Both shapes read like a reweighting and are
 * not one: the first is a contribution, withholding, savings or spending rate,
 * the second is a balance sitting in cash. The employer-match action is the
 * most repeated action the product has.
 */
const OTHER_LENSES_WRITTEN_IN_PERCENT = [
  {
    title: "Raise your 401(k) contribution from 3% to 6% to capture the full employer match",
    description: "Your employer matches the first 6% and you contribute 3%.",
    impact: "$3,400 match",
    category: "savings",
    type: "retirement",
  },
  {
    title: "Increase your withholding from 12% to 15% to avoid an underpayment penalty",
    description: "Last year's return came up short against the safe-harbour amount.",
    impact: "Avoid a penalty",
    category: "tax",
    type: "tax",
  },
  {
    title: "Raise your savings rate from 12% to 15% of income",
    description: "Three more points of income closes the gap to the retirement target.",
    impact: "15% savings rate",
    category: "savings",
    type: "savings",
  },
  {
    title: "Move your savings from 0.01% to 4.5% by switching to a high-yield account",
    description: "The balance sits in an account paying almost nothing.",
    impact: "Earn $1,100/yr more",
    category: "savings",
    type: "savings",
  },
  {
    title: "Reduce dining out from 18% to 12% of your monthly spending",
    description: "Restaurants ran $612 last month against a $372 average.",
    impact: "$240/mo",
    category: "general",
    type: "spending",
  },
  {
    title: "Put 100% of your HSA into investments instead of cash",
    description: "The account is funded and every dollar of it sits in cash.",
    impact: "Grow $21k tax-free",
    category: "tax",
    type: "tax",
  },
  {
    title: "Only 12% of your IRA is invested, and the rest sits in cash",
    description: "Cash in a retirement account earns the sweep rate, not the market's.",
    impact: "Invest the balance",
    category: "tax",
    type: "tax",
  },
];

/** The same holdings a household owns, named where they are the merchant. */
const BRAND_LENSES = [
  {
    title: "Pay down your Visa card to stop $736/yr in interest",
    description: "The card carries 24.99% APR against $3,076 of balance.",
    impact: "$736/yr interest",
    category: "debt",
    type: "debt",
  },
  {
    title: "Cut $240/mo at Target by switching to a list",
    description: "Trips to Target ran $612 last month against a $372 average.",
    impact: "$240/mo",
    category: "general",
    type: "spending",
  },
  {
    title: "Your American Express card carries $4,100 at 22% APR",
    description: "The balance costs $75/mo in interest.",
    impact: "$900/yr interest",
    category: "debt",
    type: "debt",
  },
  {
    title: "Turn on Apple Pay round-ups to save $50/mo",
    description: "Round-ups on card spending build the buffer without a transfer.",
    impact: "$600/yr",
    category: "savings",
    type: "savings",
  },
];

beforeEach(() => {
  store.insights = [];
  nextId = 0;
  generateInsights.mockClear();
  heldSecurityNames.mockClear();
  heldSecurityNames.mockImplementation(async () => DEFAULT_HELD);
});

describe("HOSTED_MODE=true", () => {
  beforeEach(() => {
    process.env.HOSTED_MODE = "true";
  });
  afterEach(() => {
    delete process.env.HOSTED_MODE;
  });

  it("serves none of the four personalized portfolio actions", async () => {
    PERSONALIZED.forEach(storeInsight);
    expect(await servedTitles()).toEqual([]);
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it("serves all four of the general ones", async () => {
    GENERAL.forEach(storeInsight);
    expect(await servedTitles()).toEqual(GENERAL.map((g) => g.title));
  });

  it("keeps the lens alive: the general rows survive beside the suppressed ones", async () => {
    [...PERSONALIZED, ...GENERAL].forEach(storeInsight);
    expect(await servedTitles()).toEqual(GENERAL.map((g) => g.title));
  });

  it("leaves every other lens untouched", async () => {
    OTHER_LENSES.forEach(storeInsight);
    expect(await servedTitles()).toEqual(OTHER_LENSES.map((o) => o.title));
  });

  it("keeps every other lens of a household that owns a brokerage", async () => {
    OTHER_LENSES_WITH_A_BROKERAGE.forEach(storeInsight);
    expect(await servedTitles()).toEqual(OTHER_LENSES_WITH_A_BROKERAGE.map((o) => o.title));
  });

  it("keeps every other lens written as a percentage that moved", async () => {
    OTHER_LENSES_WRITTEN_IN_PERCENT.forEach(storeInsight);
    expect(await servedTitles()).toEqual(OTHER_LENSES_WRITTEN_IN_PERCENT.map((o) => o.title));
  });

  it("still suppresses those same shapes once the percentage is an allocation", async () => {
    [
      {
        title: "Shift your bond allocation from 4% to 20%",
        description: "The mix is far from the guideline.",
        impact: "20% bonds",
      },
      {
        title: "Only 12% of your IRA sits in bonds",
        description: "The rest is in US equities.",
        impact: "12% bonds",
      },
    ].forEach(storeInsight);
    expect(await servedTitles()).toEqual([]);
  });

  it("suppresses a prescribed reweighting that names no asset class", async () => {
    // None of these names a slice of a portfolio and none names a security this
    // household holds, so the allocation rule is the whole of what catches
    // them. Each was served by a predicate that required an asset class beside
    // the move.
    [
      { title: "Trim your largest position from 24% to under 10% to reduce single-name risk" },
      { title: "Reduce your top holding from 28% to 10% to cut idiosyncratic risk" },
      { title: "Rebalance your account from 95% to 70% by selling the winners" },
      { title: "Trim your single largest fund from 32% to under 10%" },
      { title: "Trim it from 32% to under 10%" },
    ].forEach(storeInsight);
    expect(await servedTitles()).toEqual([]);
  });

  it("keeps the debt and spending actions of a household that holds the brands", async () => {
    heldSecurityNames.mockImplementation(async () => BRAND_HELD);
    BRAND_LENSES.forEach(storeInsight);
    expect(await servedTitles()).toEqual(BRAND_LENSES.map((b) => b.title));
  });

  it("still suppresses the same brand named as a position", async () => {
    heldSecurityNames.mockImplementation(async () => BRAND_HELD);
    storeInsight({
      title: "Trim Visa from 25% to under 10% to cut single-stock risk",
      description: "One position is a quarter of the account.",
      impact: "10% guideline",
    });
    // The same action with no figure anywhere in it, so the held name is the
    // whole of what suppresses it.
    storeInsight({ title: "Sell down your Visa position and reinvest the proceeds" });
    expect(await servedTitles()).toEqual([]);
  });

  it("suppresses the dismissed rows the history list serves too", async () => {
    [...PERSONALIZED, ...OTHER_LENSES].forEach(storeInsight);
    expect(await servedTitles("/insights/history")).toEqual(OTHER_LENSES.map((o) => o.title));
  });
});

describe("HOSTED_MODE unset — a self-hosted deployment is unaffected", () => {
  beforeEach(() => {
    delete process.env.HOSTED_MODE;
  });

  it("serves every personalized portfolio action unchanged", async () => {
    PERSONALIZED.forEach(storeInsight);
    expect(await servedTitles()).toEqual(PERSONALIZED.map((p) => p.title));
  });

  it("serves the general ones too, so nothing is lost either way", async () => {
    [...PERSONALIZED, ...GENERAL].forEach(storeInsight);
    expect(await servedTitles()).toEqual([...PERSONALIZED, ...GENERAL].map((r) => r.title));
  });

  it("never pays for the holdings query", async () => {
    PERSONALIZED.forEach(storeInsight);
    await servedTitles();
    expect(heldSecurityNames).not.toHaveBeenCalled();
  });

  it("serves the history list unchanged", async () => {
    PERSONALIZED.forEach(storeInsight);
    expect(await servedTitles("/insights/history")).toEqual(PERSONALIZED.map((p) => p.title));
  });
});
