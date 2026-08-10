import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SimInputs, SimResult } from "../retirement-sim.js";

// Stub the resolver + the canonical sim so the what-if builder is exercised
// against fixtures — we assert it REUSES these (same engine as the base) and
// applies the overrides correctly.
const resolveSimInputs =
  vi.fn<(t: string, u: string, o?: Partial<SimInputs>, f?: number) => Promise<SimInputs>>();
vi.mock("../resolve-sim-inputs.js", () => ({
  resolveSimInputs: (t: string, u: string, o?: Partial<SimInputs>, f?: number) =>
    resolveSimInputs(t, u, o, f),
}));

const runRetirementSim = vi.fn<(i: SimInputs) => SimResult>();
vi.mock("../retirement-sim.js", () => ({
  runRetirementSim: (i: SimInputs) => runRetirementSim(i),
}));

import { buildWhatIfSection } from "../what-if-section.js";

const BASE_INPUTS: SimInputs = {
  currentAge: 40,
  retirementAge: 65,
  planThroughAge: 90,
  startingBalance: 500_000,
  monthlySavings: 2000,
  monthlySpend: 5000,
  strategy: "constant_dollar",
  ssMonthly: 2000,
  ssClaimAge: 67,
  otherMonthly: 0,
  otherStartAge: 65,
  allocation: { usStocks: 0.6, intlStocks: 0.1, bonds: 0.2, reits: 0.05, cash: 0.05 },
  inflationAdjusted: true,
  numSimulations: 500,
};

function simResult(successRate: number): SimResult {
  return {
    successRate,
    percentiles: { p5: [], p25: [], p50: [], p75: [], p95: [] },
    medianLastsToAge: null,
    finalBalanceDistribution: { mean: 0, median: 0, stdDev: 0 },
    blendedExpectedReturn: 0.062,
    horizonYears: 50,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Empty overrides → the resolved base inputs (used to read base age/spend and
  // to reconcile with the stored success rate). Overridden per-test as needed.
  resolveSimInputs.mockImplementation(async (_t, _u, _o, _f) => BASE_INPUTS);
  runRetirementSim.mockImplementation(() => simResult(0.85));
});

describe("buildWhatIfSection", () => {
  it("reproduces the passed base success rate: deltas are computed against it", async () => {
    // Base run (empty overrides) resolves BASE_INPUTS; every scenario sim also
    // returns 85% → each delta vs the passed base (85) is 0.
    const section = await buildWhatIfSection("tenant-1", "user-a", 85);

    // First resolve call is the base read: no active assumptions → empty base
    // overrides (equivalent to no overrides) and no flat return.
    expect(resolveSimInputs.mock.calls[0][0]).toBe("tenant-1");
    expect(resolveSimInputs.mock.calls[0][1]).toBe("user-a");
    expect(resolveSimInputs.mock.calls[0][2]).toEqual({});
    expect(resolveSimInputs.mock.calls[0][3]).toBeUndefined();
    expect(section.baseSuccessRate).toBe(85);
    expect(section.section).toBe("what_ifs");
    for (const s of section.scenarios) {
      expect(s.successRate).toBe(85);
      expect(s.deltaVsBase).toBe(0); // 85 − 85
    }
  });

  it("builds 'retire earlier' and 'spend more' with correct overrides + deltas", async () => {
    // Distinct success rates keyed off the override so we can pin each scenario.
    runRetirementSim.mockImplementation((i) => {
      if (i.retirementAge === 62) return simResult(0.73); // retire 3 earlier
      if (i.monthlySpend === 6000) return simResult(0.71); // spend 20% more
      if (i.retirementAge === 68) return simResult(0.93); // retire 3 later
      return simResult(0.85);
    });
    // Echo the override into the resolved inputs so the sim sees it.
    resolveSimInputs.mockImplementation(async (_t, _u, o) => ({ ...BASE_INPUTS, ...o }));

    const section = await buildWhatIfSection("t", "u", 85);

    const earlier = section.scenarios.find((s) => s.overrides.retirementAge === 62)!;
    expect(earlier.label).toContain("earlier");
    expect(earlier.successRate).toBe(73);
    expect(earlier.deltaVsBase).toBe(-12); // 73 − 85

    const spend = section.scenarios.find((s) => s.overrides.monthlySpend === 6000)!;
    expect(spend.label).toBe("Spend 20% more");
    expect(spend.successRate).toBe(71);
    expect(spend.deltaVsBase).toBe(-14); // 71 − 85

    const later = section.scenarios.find((s) => s.overrides.retirementAge === 68)!;
    expect(later.successRate).toBe(93);
    expect(later.deltaVsBase).toBe(8); // 93 − 85
  });

  it("clamps the retire-earlier age to at least a year out and relabels", async () => {
    // currentAge 63, retirementAge 65 → 3-years-earlier (62) is in the past;
    // clamp to 64 (current age + 1) and label with the actual age used.
    resolveSimInputs.mockImplementation(async (_t, _u, o) => ({
      ...BASE_INPUTS,
      currentAge: 63,
      ...o,
    }));

    const section = await buildWhatIfSection("t", "u", 85);

    const earlier = section.scenarios.find((s) => s.overrides.retirementAge === 64)!;
    expect(earlier).toBeDefined();
    expect(earlier.label).toBe("Retire at 64");
  });

  it("skips the retire-earlier scenario when the clamp leaves no room before the base age", async () => {
    // currentAge 34, retirementAge 35 → clamped earlier age (35) is not before
    // the base retirement age, so the scenario is dropped entirely.
    resolveSimInputs.mockImplementation(async (_t, _u, o) => ({
      ...BASE_INPUTS,
      currentAge: 34,
      retirementAge: 35,
      ...o,
    }));

    const section = await buildWhatIfSection("t", "u", 85);

    expect(section.scenarios.some((s) => s.label.toLowerCase().includes("earlier") || s.label.startsWith("Retire at"))).toBe(false);
    expect(section.scenarios.some((s) => s.label === "Spend 20% more")).toBe(true);
    expect(section.scenarios.some((s) => s.overrides.retirementAge === 38)).toBe(true); // retire later survives
  });

  it("skips a scenario whose sim throws without failing the build", async () => {
    resolveSimInputs.mockImplementation(async (_t, _u, o) => ({ ...BASE_INPUTS, ...o }));
    runRetirementSim.mockImplementation((i) => {
      if (i.monthlySpend === 6000) throw new Error("sim blew up");
      return simResult(0.85);
    });

    const section = await buildWhatIfSection("t", "u", 85);

    // The "spend more" scenario is dropped; the others survive.
    expect(section.scenarios.some((s) => s.overrides.monthlySpend === 6000)).toBe(false);
    expect(section.scenarios.length).toBeGreaterThanOrEqual(2);
  });
});
