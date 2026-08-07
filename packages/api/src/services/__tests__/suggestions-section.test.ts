import { describe, it, expect, vi, beforeEach } from "vitest";

// buildSuggestionsSection's only side effects are the structured model call and
// usage logging. Mock the model + telemetry, and stub the agent/activity
// modules so importing doesn't pull a real provider or DB connection.
const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
vi.mock("../../lib/activity.js", () => ({ logLlmUsage: vi.fn() }));
vi.mock("../../agent/index.js", () => ({
  getModel: () => ({}) as never,
  getModelSlug: () => "anthropic/claude-sonnet-4.5",
}));

import { buildSuggestionsSection } from "../suggestions-section.js";
import type { CompactPlanGrounding } from "../plan-grounding.js";

const okUsage = { inputTokens: 100, outputTokens: 60 };

// A grounding fixture carrying real, distinctive figures so we can assert the
// exact numbers reach the model prompt.
const grounding: CompactPlanGrounding = {
  planId: "plan-123",
  title: "Retirement Plan",
  snapshot: {
    netWorth: 812345,
    totalAssets: 900000,
    totalDebt: 87655,
    monthlySpend: 6200,
    age: 47,
    annualIncome: 185000,
  },
  portfolio: {
    totalValue: 640000,
    allocation: [
      { name: "US Stocks", weight: 78.5, value: 502400 },
      { name: "Bonds", weight: 21.5, value: 137600 },
    ],
  },
  retirement: {
    computed: true,
    verdict: "needs_attention",
    successRate: 74,
    targetSuccess: 85,
    retirementAge: 60,
    planThroughAge: 92,
    medianLastsToAge: 88,
    blendedExpectedReturn: 0.062,
    socialSecurity: { monthlyBenefit: 2800, claimAge: 67 },
    recommendedStrategy: "guardrails",
    methods: [
      {
        strategy: "guardrails",
        label: "Guardrails",
        successRate: 74,
        medianLastsToAge: 88,
        recommended: true,
      },
    ],
    drawdownOrder: [
      { bucket: "taxable", label: "Taxable", balance: 220000 },
      { bucket: "deferred", label: "Tax-deferred", balance: 380000 },
    ],
  },
  goals: null,
  person: {
    realEstate: {
      properties: [
        {
          id: "prop-primary-1",
          name: "Primary Residence",
          value: 620000,
          mortgage: 310000,
          equity: 310000,
          monthlyRent: null,
          annualInsurance: null,
          annualMaintenance: null,
          annualRent: null,
          annualCarryingCosts: 0,
          netAnnualRent: null,
        },
      ],
      totalValue: 620000,
      totalMortgage: 310000,
      totalEquity: 310000,
      totalMonthlyRent: 0,
      totalAnnualRent: 0,
      totalAnnualCarryingCosts: 0,
      totalNetAnnualRent: 0,
      unlinkedMortgageTotal: 0,
    },
    socialSecurity: { monthlyBenefit: 2800, claimAge: 67 },
    guaranteedIncome: [],
    demographics: {
      filingStatus: "married_jointly",
      stateOfResidence: "CA",
      dependentCount: 2,
      riskTolerance: "moderate",
      employmentType: "w2",
    },
    topSpendingCategories: [{ name: "Housing", total: 3200 }],
    goals: [],
    taxDocumentSummary: null,
    portfolioBasis: null,
    soldProperties: [],
  },
  appliedAssumptions: null,
};

beforeEach(() => {
  generateObject.mockReset();
});

describe("buildSuggestionsSection", () => {
  it("passes the plan's real grounding figures into the model prompt and stores the returned items", async () => {
    generateObject.mockResolvedValue({
      object: {
        items: [
          {
            title: "Rebalance toward bonds",
            rationale: "Your portfolio is 78.5% US Stocks; trimming toward target lowers sequence risk.",
            impact: "Reduces drawdown in a bad first decade",
            category: "Portfolio",
          },
          {
            title: "Consider Roth conversions",
            rationale: "With $380k tax-deferred, converting in low-income years before age 60 spreads the tax hit.",
          },
        ],
      },
      usage: okUsage,
    });

    const result = await buildSuggestionsSection("tenant-1", "user-1", grounding);

    // (a) the grounding figures reach the model prompt.
    expect(generateObject).toHaveBeenCalledTimes(1);
    const callArg = generateObject.mock.calls[0][0] as { prompt: string; system: string };
    expect(callArg.prompt).toContain("812345"); // net worth
    expect(callArg.prompt).toContain("78.5"); // US stock weight
    expect(callArg.prompt).toContain("380000"); // tax-deferred balance
    expect(callArg.prompt).toContain("plan-123"); // plan id from grounding
    // (a2) the enriched person context reaches the prompt too.
    expect(callArg.prompt).toContain("310000"); // real-estate equity
    expect(callArg.prompt).toContain("married_jointly"); // demographics filing status
    // The system prompt instructs it to ground on the provided figures only.
    expect(callArg.system).toMatch(/NEVER invent a number/i);

    // (b) the returned structured items are stored.
    expect(result).not.toBeNull();
    expect(result!.section).toBe("suggestions");
    expect(result!.items).toHaveLength(2);
    expect(result!.items[0]).toMatchObject({
      title: "Rebalance toward bonds",
      impact: "Reduces drawdown in a bad first decade",
      category: "Portfolio",
    });
    // Optional fields absent on the model output stay undefined, not empty strings.
    expect(result!.items[1].impact).toBeUndefined();
    expect(result!.items[1].category).toBeUndefined();
    expect(result!.generatedAt).toBeTruthy();
  });

  it("drops items missing a title or rationale and returns null when none survive", async () => {
    generateObject.mockResolvedValue({
      object: { items: [{ title: "", rationale: "no title so dropped" }] },
      usage: okUsage,
    });
    const result = await buildSuggestionsSection("tenant-1", "user-1", grounding);
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the model call fails, so plan-create still succeeds", async () => {
    generateObject.mockRejectedValue(new Error("model timeout"));
    // The call must resolve to null rather than reject — plan-create depends on
    // this so an LLM hiccup can never fail plan creation.
    await expect(buildSuggestionsSection("tenant-1", "user-1", grounding)).resolves.toBeNull();
  });
});
