import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the builders regeneratePlan orchestrates ─────────────────────────────
// regeneratePlan re-runs the SAME builders the create path uses. Here we mock
// them so the harness is tested in isolation (no DB, no LLM): we assert what
// overrides each builder RECEIVES and that regeneratePlan assembles a new,
// non-corrupting document from their results.
const buildRetirementReadiness = vi.fn();
const buildWhatIfSection = vi.fn();
const buildNarrativeSection = vi.fn();
const buildFinancialSnapshot = vi.fn();
const resolvePersonContext = vi.fn();
const toCompactGrounding = vi.fn((..._a: unknown[]) => ({ mock: "grounding" }));
// The sale path fetches accounts to compute the net-equity reclassification.
// A home worth 600k with a 400k linked mortgage → 200k net equity.
const fetchAccountsWithBalances = vi.fn(async (..._a: unknown[]) => [
  { id: "home", type: "real_estate", name: "Primary Residence", rawBalance: 600000, propertyAccountId: null },
  { id: "home-loan", type: "loan", name: "Home Mortgage", rawBalance: -400000, propertyAccountId: "home" },
]);

vi.mock("../retirement-readiness.js", () => ({
  buildRetirementReadiness: (...a: unknown[]) => buildRetirementReadiness(...a),
}));
vi.mock("../what-if-section.js", () => ({
  buildWhatIfSection: (...a: unknown[]) => buildWhatIfSection(...a),
}));
vi.mock("../narrative-section.js", () => ({
  buildNarrativeSection: (...a: unknown[]) => buildNarrativeSection(...a),
}));
vi.mock("../financial-snapshot.js", () => ({
  buildFinancialSnapshot: (...a: unknown[]) => buildFinancialSnapshot(...a),
}));
vi.mock("../../lib/account-balances.js", () => ({
  fetchAccountsWithBalances: (...a: unknown[]) => fetchAccountsWithBalances(...a),
}));
vi.mock("../plan-grounding.js", () => ({
  resolvePersonContext: (...a: unknown[]) => resolvePersonContext(...a),
  toCompactGrounding: (...a: unknown[]) => toCompactGrounding(...a),
}));

import { deriveSimOverrides, regeneratePlan } from "../plan-assumptions.js";

// ── deriveSimOverrides — the crux of how each assumption threads to the sim ───
describe("deriveSimOverrides", () => {
  it("null / empty assumptions → no overrides, no flat return", () => {
    expect(deriveSimOverrides(null)).toEqual({ overrides: {}, flatReturn: undefined });
    expect(deriveSimOverrides({})).toEqual({ overrides: {}, flatReturn: undefined });
  });

  it("includeSocialSecurity:false → ssMonthly:0 (wins over the derived estimate)", () => {
    expect(deriveSimOverrides({ includeSocialSecurity: false })).toEqual({
      overrides: { ssMonthly: 0 },
      flatReturn: undefined,
    });
  });

  it("includeSocialSecurity:true → NO ssMonthly override (the derived estimate stands)", () => {
    // Reversal: restoring SS must not force any value; the sim recomputes it.
    expect(deriveSimOverrides({ includeSocialSecurity: true })).toEqual({
      overrides: {},
      flatReturn: undefined,
    });
  });

  it("retirementAge / monthlySpend → direct Partial<SimInputs> overrides", () => {
    expect(deriveSimOverrides({ retirementAge: 60, monthlySpend: 8000 })).toEqual({
      overrides: { retirementAge: 60, monthlySpend: 8000 },
      flatReturn: undefined,
    });
  });

  it("expectedReturn → flatReturn (the engine has no scalar return)", () => {
    expect(deriveSimOverrides({ expectedReturn: 0.06 })).toEqual({
      overrides: {},
      flatReturn: 0.06,
    });
  });

  it("combines all four into one override set", () => {
    expect(
      deriveSimOverrides({
        includeSocialSecurity: false,
        retirementAge: 62,
        monthlySpend: 7000,
        expectedReturn: 0.05,
      }),
    ).toEqual({
      overrides: { ssMonthly: 0, retirementAge: 62, monthlySpend: 7000 },
      flatReturn: 0.05,
    });
  });
});

// ── regeneratePlan — threads the overrides through + stays non-corrupting ─────
const BASE_SECTIONS = {
  snapshot: { section: "snapshot", netWorth: 380000 },
  portfolio: { section: "portfolio", totalValue: 500000 },
  retirement: { section: "retirement", computed: true, successRate: 88 },
  suggestions: { section: "suggestions", items: [{ title: "keep me" }] },
  narrative: { section: "narrative", executiveSummary: "old summary", themes: [] },
} as unknown as Parameters<typeof regeneratePlan>[2]["sections"];

beforeEach(() => {
  vi.clearAllMocks();
  resolvePersonContext.mockResolvedValue({ socialSecurity: null });
  toCompactGrounding.mockReturnValue({ mock: "grounding" });
});

describe("regeneratePlan", () => {
  it("threads the assumption-derived overrides into every rebuilt section", async () => {
    buildRetirementReadiness.mockResolvedValue({ section: "retirement", computed: true, successRate: 71 });
    buildWhatIfSection.mockResolvedValue({ section: "what_ifs", baseSuccessRate: 71, scenarios: [] });
    buildNarrativeSection.mockResolvedValue({ section: "narrative", executiveSummary: "new", themes: [] });

    const assumptions = { includeSocialSecurity: false as const, retirementAge: 60, expectedReturn: 0.06 };
    await regeneratePlan("t1", "u1", { title: "My Plan", sections: BASE_SECTIONS }, assumptions);

    // Retirement readiness gets the direct overrides (ssMonthly:0, retirementAge)
    // and the flat expected-return. No sale → extraInvestable (5th arg) is undefined.
    expect(buildRetirementReadiness).toHaveBeenCalledWith(
      "t1",
      "u1",
      { ssMonthly: 0, retirementAge: 60 },
      0.06,
      undefined,
    );
    // What-ifs get the SAME base overrides + flat return, plus the fresh success rate.
    expect(buildWhatIfSection).toHaveBeenCalledWith(
      "t1",
      "u1",
      71,
      { ssMonthly: 0, retirementAge: 60 },
      0.06,
      undefined,
    );
    // The person context the narrative grounds on is resolved WITH the assumptions
    // (so income_sources reflects the SS exclusion, not a benefit).
    expect(resolvePersonContext).toHaveBeenCalledWith("t1", "u1", assumptions);
    // The grounding is also built WITH the assumptions, so its appliedAssumptions
    // summary lets the narrative frame the SS exclusion as a chosen scenario.
    expect(toCompactGrounding).toHaveBeenCalledWith(
      "pending",
      "My Plan",
      expect.anything(),
      { socialSecurity: null },
      assumptions,
    );
  });

  it("swaps in the fresh sections while preserving unaffected ones (snapshot / portfolio / suggestions)", async () => {
    buildRetirementReadiness.mockResolvedValue({ section: "retirement", computed: true, successRate: 71 });
    buildWhatIfSection.mockResolvedValue({ section: "what_ifs", baseSuccessRate: 71, scenarios: [] });
    buildNarrativeSection.mockResolvedValue({ section: "narrative", executiveSummary: "new summary", themes: [] });

    const { sections } = await regeneratePlan(
      "t1",
      "u1",
      { title: "My Plan", sections: BASE_SECTIONS },
      { retirementAge: 60 },
    );

    // Rebuilt sections carry the fresh values.
    expect((sections.retirement as { successRate: number }).successRate).toBe(71);
    expect(sections.whatIfs).toBeDefined();
    expect((sections.narrative as { executiveSummary: string }).executiveSummary).toBe("new summary");
    // Unaffected sections carry through verbatim.
    expect(sections.snapshot).toEqual(BASE_SECTIONS.snapshot);
    expect(sections.portfolio).toEqual(BASE_SECTIONS.portfolio);
    expect(sections.suggestions).toEqual(BASE_SECTIONS.suggestions);
  });

  it("does not run what-ifs when the base projection is not computable", async () => {
    buildRetirementReadiness.mockResolvedValue({ section: "retirement", computed: false, successRate: 0 });
    buildNarrativeSection.mockResolvedValue(null);

    const { sections } = await regeneratePlan(
      "t1",
      "u1",
      { title: "My Plan", sections: BASE_SECTIONS },
      { retirementAge: 60 },
    );
    expect(buildWhatIfSection).not.toHaveBeenCalled();
    expect(sections.whatIfs).toBeUndefined();
  });

  it("keeps the previous narrative when the LLM regen returns null (never drops the section)", async () => {
    buildRetirementReadiness.mockResolvedValue({ section: "retirement", computed: true, successRate: 71 });
    buildWhatIfSection.mockResolvedValue({ section: "what_ifs", baseSuccessRate: 71, scenarios: [] });
    buildNarrativeSection.mockResolvedValue(null); // LLM hiccup

    const { sections } = await regeneratePlan(
      "t1",
      "u1",
      { title: "My Plan", sections: BASE_SECTIONS },
      { retirementAge: 60 },
    );
    // Falls back to the stored narrative rather than dropping it.
    expect((sections.narrative as { executiveSummary: string }).executiveSummary).toBe("old summary");
  });

  it("survives a narrative regen THROW without failing the whole regeneration", async () => {
    buildRetirementReadiness.mockResolvedValue({ section: "retirement", computed: true, successRate: 71 });
    buildWhatIfSection.mockResolvedValue({ section: "what_ifs", baseSuccessRate: 71, scenarios: [] });
    buildNarrativeSection.mockRejectedValue(new Error("model boom"));

    const { sections } = await regeneratePlan(
      "t1",
      "u1",
      { title: "My Plan", sections: BASE_SECTIONS },
      { retirementAge: 60 },
    );
    // Retirement + what-ifs still swapped in; narrative falls back to the old one.
    expect((sections.retirement as { successRate: number }).successRate).toBe(71);
    expect((sections.narrative as { executiveSummary: string }).executiveSummary).toBe("old summary");
  });

  it("a property sale threads the SAME net equity to the sim AND rebuilds the snapshot", async () => {
    buildRetirementReadiness.mockResolvedValue({ section: "retirement", computed: true, successRate: 80 });
    buildWhatIfSection.mockResolvedValue({ section: "what_ifs", baseSuccessRate: 80, scenarios: [] });
    buildNarrativeSection.mockResolvedValue({ section: "narrative", executiveSummary: "new", themes: [] });
    buildFinancialSnapshot.mockResolvedValue({ section: "snapshot", netWorth: 380000, soldProperties: [{ id: "home", name: "Primary Residence", netEquity: 200000 }] });

    const { sections } = await regeneratePlan(
      "t1",
      "u1",
      { title: "My Plan", sections: BASE_SECTIONS },
      { soldPropertyAccountIds: ["home"] },
    );

    // Net equity (600k − 400k = 200k) is the 5th arg (extraInvestable) to the sim
    // builders — the SAME number reaches readiness and what-ifs so they can't drift.
    expect(buildRetirementReadiness).toHaveBeenCalledWith("t1", "u1", {}, undefined, 200000);
    expect(buildWhatIfSection).toHaveBeenCalledWith("t1", "u1", 80, {}, undefined, 200000);
    // And the snapshot is rebuilt with the same sale adjustment (netEquity 200k).
    expect(buildFinancialSnapshot).toHaveBeenCalledWith(
      "t1",
      "u1",
      expect.objectContaining({ netEquity: 200000, excludedAccountIds: ["home", "home-loan"] }),
    );
    // The freshly-built snapshot (carrying soldProperties) is swapped in.
    expect((sections.snapshot as { soldProperties: unknown[] }).soldProperties).toHaveLength(1);
  });

  it("no sale → snapshot carries through verbatim and no extraInvestable is passed", async () => {
    buildRetirementReadiness.mockResolvedValue({ section: "retirement", computed: true, successRate: 71 });
    buildWhatIfSection.mockResolvedValue({ section: "what_ifs", baseSuccessRate: 71, scenarios: [] });
    buildNarrativeSection.mockResolvedValue({ section: "narrative", executiveSummary: "new", themes: [] });

    const { sections } = await regeneratePlan(
      "t1",
      "u1",
      { title: "My Plan", sections: BASE_SECTIONS },
      { retirementAge: 60 },
    );
    // No sale → the snapshot builder is never called; the stored snapshot stands.
    expect(buildFinancialSnapshot).not.toHaveBeenCalled();
    expect(sections.snapshot).toEqual(BASE_SECTIONS.snapshot);
    // extraInvestable (5th arg) is undefined for a scalar-only change.
    expect(buildRetirementReadiness).toHaveBeenCalledWith("t1", "u1", { retirementAge: 60 }, undefined, undefined);
  });

  it("reversing a sale (stored snapshot carried soldProperties, no sale now) rebuilds the plain snapshot", async () => {
    buildRetirementReadiness.mockResolvedValue({ section: "retirement", computed: true, successRate: 96 });
    buildWhatIfSection.mockResolvedValue({ section: "what_ifs", baseSuccessRate: 96, scenarios: [] });
    buildNarrativeSection.mockResolvedValue({ section: "narrative", executiveSummary: "new", themes: [] });
    // The plain, restored snapshot the builder returns after the reversal.
    buildFinancialSnapshot.mockResolvedValue({ section: "snapshot", netWorth: 380000 });

    // Stored snapshot still bears the sold-property marker from the prior sale.
    const soldSections = {
      ...BASE_SECTIONS,
      snapshot: { section: "snapshot", netWorth: 380000, soldProperties: [{ id: "home", name: "Home", netEquity: 200000 }] },
    } as unknown as typeof BASE_SECTIONS;

    const { sections } = await regeneratePlan("t1", "u1", { title: "My Plan", sections: soldSections }, null);

    // The snapshot is rebuilt with a NULL adjustment (no reclassification), so the
    // sold marker is gone and no extraInvestable reaches the sim.
    expect(buildFinancialSnapshot).toHaveBeenCalledWith("t1", "u1", undefined);
    expect(sections.snapshot).not.toHaveProperty("soldProperties");
    expect(buildRetirementReadiness).toHaveBeenCalledWith("t1", "u1", {}, undefined, undefined);
  });
});
