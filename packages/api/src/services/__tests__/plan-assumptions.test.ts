import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the builders regeneratePlan orchestrates ─────────────────────────────
// regeneratePlan re-runs the SAME builders the create path uses. Here we mock
// them so the harness is tested in isolation (no DB, no LLM): we assert what
// overrides each builder RECEIVES and that regeneratePlan assembles a new,
// non-corrupting document from their results.
const buildRetirementReadiness = vi.fn();
const buildWhatIfSection = vi.fn();
const buildNarrativeSection = vi.fn();
const resolvePersonContext = vi.fn();
const toCompactGrounding = vi.fn((..._a: unknown[]) => ({ mock: "grounding" }));

vi.mock("../retirement-readiness.js", () => ({
  buildRetirementReadiness: (...a: unknown[]) => buildRetirementReadiness(...a),
}));
vi.mock("../what-if-section.js", () => ({
  buildWhatIfSection: (...a: unknown[]) => buildWhatIfSection(...a),
}));
vi.mock("../narrative-section.js", () => ({
  buildNarrativeSection: (...a: unknown[]) => buildNarrativeSection(...a),
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
    // and the flat expected-return.
    expect(buildRetirementReadiness).toHaveBeenCalledWith(
      "t1",
      "u1",
      { ssMonthly: 0, retirementAge: 60 },
      0.06,
    );
    // What-ifs get the SAME base overrides + flat return, plus the fresh success rate.
    expect(buildWhatIfSection).toHaveBeenCalledWith(
      "t1",
      "u1",
      71,
      { ssMonthly: 0, retirementAge: 60 },
      0.06,
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
});
