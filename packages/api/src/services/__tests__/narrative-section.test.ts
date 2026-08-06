import { describe, it, expect, vi, beforeEach } from "vitest";

// buildNarrativeSection's only side effects are the structured model call and
// usage logging. Mock the model + telemetry, and stub the agent/activity
// modules so importing doesn't pull a real provider or DB connection.
const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
vi.mock("../../lib/activity.js", () => ({ logLlmUsage: vi.fn() }));
vi.mock("../../agent/index.js", () => ({
  getModel: () => ({}) as never,
  getModelSlug: () => "anthropic/claude-sonnet-4.5",
}));

import { buildNarrativeSection } from "../narrative-section.js";
import type { CompactPlanGrounding } from "../plan-grounding.js";

const okUsage = { inputTokens: 200, outputTokens: 800 };

// A grounding fixture carrying real, distinctive figures — including Social
// Security, rental income, and real-estate equity — so we can assert the exact
// numbers reach the model prompt.
const grounding: CompactPlanGrounding = {
  planId: "plan-777",
  title: "Retirement Plan",
  snapshot: {
    netWorth: 1250000,
    totalAssets: 1600000,
    totalDebt: 350000,
    monthlySpend: 8400,
    age: 52,
    annualIncome: 240000,
  },
  portfolio: {
    totalValue: 900000,
    allocation: [
      { name: "US Stocks", weight: 72, value: 648000 },
      { name: "Bonds", weight: 28, value: 252000 },
    ],
  },
  retirement: {
    computed: true,
    verdict: "on_track",
    successRate: 88,
    targetSuccess: 85,
    retirementAge: 62,
    planThroughAge: 92,
    medianLastsToAge: 92,
    blendedExpectedReturn: 0.058,
    socialSecurity: { monthlyBenefit: 3100, claimAge: 67 },
    recommendedStrategy: "guardrails",
    methods: [
      {
        strategy: "guardrails",
        label: "Guardrails",
        successRate: 88,
        medianLastsToAge: 92,
        recommended: true,
      },
    ],
    drawdownOrder: [{ bucket: "taxable", label: "Taxable", balance: 300000 }],
  },
  goals: null,
  person: {
    realEstate: {
      properties: [
        {
          name: "Rental Duplex",
          value: 540000,
          mortgage: 190000,
          equity: 350000,
          monthlyRent: 2600,
          annualInsurance: 2200,
          annualMaintenance: 3800,
          annualRent: 31200,
          annualCarryingCosts: 6000,
          netAnnualRent: 25200,
        },
      ],
      totalValue: 540000,
      totalMortgage: 190000,
      totalEquity: 350000,
      totalMonthlyRent: 2600,
      totalAnnualRent: 31200,
      totalAnnualCarryingCosts: 6000,
      totalNetAnnualRent: 25200,
      unlinkedMortgageTotal: 0,
    },
    socialSecurity: { monthlyBenefit: 3100, claimAge: 67 },
    guaranteedIncome: [{ source: "Rental income", monthly: 2600 }],
    demographics: {
      filingStatus: "married_jointly",
      stateOfResidence: "TX",
      dependentCount: 1,
      riskTolerance: "moderate",
      employmentType: "self_employed",
    },
    topSpendingCategories: [{ name: "Housing", total: 4100 }],
    goals: [],
    taxDocumentSummary: null,
    portfolioBasis: null,
  },
  appliedAssumptions: null,
};

// A well-formed model response covering every fixed theme key.
const fullObject = {
  executiveSummary:
    "You are on track with a net worth of $1,250,000 and an 88% success rate.\n\nRetiring at 62 keeps your money lasting to age 92.",
  themes: [
    { key: "situation", heading: "Where you stand", body: "Net worth is $1,250,000 against $350,000 of debt." },
    { key: "retirement_readiness", heading: "On track", body: "An 88% success rate clears your 85% target." },
    {
      key: "income_sources",
      heading: "How retirement gets funded",
      body: "Social Security adds $3,100 per month starting at age 67. Your rental duplex throws off $2,600 per month and carries $350,000 of equity. No pension is on file, so portfolio withdrawals cover the rest.",
    },
    { key: "risks_opportunities", heading: "Risks", body: "A 72% US stock weight concentrates sequence risk." },
    { key: "recommendations", heading: "Next moves", body: "Trim equity toward your target allocation." },
    { key: "whatifs", heading: "Trade-offs", body: "Working to 65 lifts the odds further." },
  ],
};

beforeEach(() => {
  generateObject.mockReset();
});

describe("buildNarrativeSection", () => {
  it("passes the plan's real grounding figures into the prompt and stores the summary + themes", async () => {
    generateObject.mockResolvedValue({ object: fullObject, usage: okUsage });

    const result = await buildNarrativeSection("tenant-1", "user-1", grounding);

    // (a) the grounding figures reach the model prompt.
    expect(generateObject).toHaveBeenCalledTimes(1);
    const callArg = generateObject.mock.calls[0][0] as { prompt: string; system: string };
    expect(callArg.prompt).toContain("1250000"); // net worth
    expect(callArg.prompt).toContain("plan-777"); // plan id
    expect(callArg.prompt).toContain("3100"); // SS monthly benefit
    expect(callArg.prompt).toContain("2600"); // monthly rent
    expect(callArg.prompt).toContain("350000"); // real-estate equity
    // The system prompt grounds it and requires the SS / real-estate / pension coverage.
    expect(callArg.system).toMatch(/NEVER invent a number/i);
    expect(callArg.system).toMatch(/Social Security/i);
    expect(callArg.system).toMatch(/no pension/i);

    // (b) the returned executiveSummary + themes are stored.
    expect(result).not.toBeNull();
    expect(result!.section).toBe("narrative");
    expect(result!.executiveSummary).toContain("$1,250,000");
    expect(result!.themes).toHaveLength(6);
    expect(result!.themes.map((t) => t.key)).toEqual([
      "situation",
      "retirement_readiness",
      "income_sources",
      "risks_opportunities",
      "recommendations",
      "whatifs",
    ]);
    // income_sources body discusses SS + rental + equity.
    const income = result!.themes.find((t) => t.key === "income_sources")!;
    expect(income.body).toMatch(/Social Security/i);
    expect(income.body).toMatch(/rental/i);
    expect(income.body).toMatch(/equity/i);
    expect(result!.generatedAt).toBeTruthy();
  });

  it("drops unknown/duplicate theme keys and re-orders to the fixed sequence", async () => {
    generateObject.mockResolvedValue({
      object: {
        executiveSummary: "Summary.",
        themes: [
          { key: "whatifs", heading: "W", body: "whatifs body" },
          { key: "made_up", heading: "X", body: "should be dropped" },
          { key: "situation", heading: "S", body: "situation body" },
          { key: "situation", heading: "S2", body: "duplicate should be dropped" },
        ],
      },
      usage: okUsage,
    });

    const result = await buildNarrativeSection("tenant-1", "user-1", grounding);
    expect(result).not.toBeNull();
    // Unknown "made_up" gone; duplicate "situation" collapsed; fixed order applied.
    expect(result!.themes.map((t) => t.key)).toEqual(["situation", "whatifs"]);
  });

  it("returns null (never throws) when the model call fails, so plan-create still succeeds", async () => {
    generateObject.mockRejectedValue(new Error("model timeout"));
    // The call must resolve to null rather than reject — plan-create depends on
    // this so an LLM hiccup can never fail plan creation.
    await expect(buildNarrativeSection("tenant-1", "user-1", grounding)).resolves.toBeNull();
  });
});
