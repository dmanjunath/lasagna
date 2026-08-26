import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SimInputs, SimResult } from "../retirement-sim.js";
import type { AccountWithBalance } from "../../lib/account-balances.js";

// Stub the resolver + the canonical sim so the readiness builder is exercised
// against fixtures — we assert it REUSES these (no re-implemented projection).
const resolveSimInputs = vi.fn<(t: string, u: string) => Promise<SimInputs>>();
vi.mock("../resolve-sim-inputs.js", () => ({
  resolveSimInputs: (t: string, u: string) => resolveSimInputs(t, u),
}));

const runRetirementSim = vi.fn<(i: SimInputs) => SimResult>();
vi.mock("../retirement-sim.js", () => ({
  runRetirementSim: (i: SimInputs) => runRetirementSim(i),
}));

const fetchAccountsWithBalances = vi.fn<(t: string) => Promise<AccountWithBalance[]>>();
vi.mock("../../lib/account-balances.js", () => ({
  fetchAccountsWithBalances: (t: string) => fetchAccountsWithBalances(t),
}));

import {
  buildRetirementReadiness,
  buildPathReadiness,
  resetPathReadinessCache,
} from "../retirement-readiness.js";

const INPUTS: SimInputs = {
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

// A 51-point percentile series (age 40 → 90), rising then falling, that never
// hits zero — median lasts through the plan.
function series(base: number): number[] {
  return Array.from({ length: 51 }, (_, i) => base + i * 1000);
}

// Give each strategy a distinct success rate so we can assert the "optimal"
// pick. constant_dollar (the resolved strategy) gets the primary result.
function resultFor(strategy: SimInputs["strategy"]): SimResult {
  const rates: Record<string, number> = {
    constant_dollar: 0.9,
    guardrails: 0.95, // highest surviving → recommended
    percent_of_portfolio: 0.8,
    rules_based: 0.7,
  };
  return {
    successRate: rates[strategy],
    percentiles: {
      p5: series(400_000),
      p25: series(450_000),
      p50: series(500_000),
      p75: series(600_000),
      p95: series(700_000),
    },
    medianLastsToAge: null,
    finalBalanceDistribution: { mean: 1_000_000, median: 950_000, stdDev: 100_000 },
    blendedExpectedReturn: 0.062,
    horizonYears: 50,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPathReadinessCache();
  resolveSimInputs.mockResolvedValue(INPUTS);
  runRetirementSim.mockImplementation((i) => resultFor(i.strategy));
  fetchAccountsWithBalances.mockResolvedValue([]);
});

describe("buildRetirementReadiness", () => {
  it("reuses resolveSimInputs + runRetirementSim, and reconciles the verdict with TARGET_SUCCESS=85", async () => {
    const section = await buildRetirementReadiness("tenant-1", "user-a");

    expect(resolveSimInputs).toHaveBeenCalledWith("tenant-1", "user-a");
    // 90% success ≥ 85% target → on track (same threshold /retirement uses).
    expect(section.successRate).toBe(90);
    expect(section.targetSuccess).toBe(85);
    expect(section.verdict).toBe("on_track");
    expect(section.blendedExpectedReturn).toBe(0.062);
  });

  it("maps success below the threshold to the same tiers as the dashboard", async () => {
    // 80% → needs attention (≥70, <85).
    runRetirementSim.mockImplementation(() => ({ ...resultFor("constant_dollar"), successRate: 0.8 }));
    let s = await buildRetirementReadiness("t", "u");
    expect(s.verdict).toBe("needs_attention");

    // 60% → at risk (<70).
    runRetirementSim.mockImplementation(() => ({ ...resultFor("constant_dollar"), successRate: 0.6 }));
    s = await buildRetirementReadiness("t", "u");
    expect(s.verdict).toBe("at_risk");
  });

  it("populates the growth series from the sim percentiles, segmented at retirement", async () => {
    const section = await buildRetirementReadiness("t", "u");

    // One point per recorded year (age 40 → 90), index 0 = currentAge.
    expect(section.growth).toHaveLength(51);
    expect(section.growth[0]).toMatchObject({ age: 40, phase: "accumulation" });
    expect(section.growth[0].median).toBe(500_000); // straight from p50[0]
    // Split at retirementAge 65.
    expect(section.growth.find((g) => g.age === 64)?.phase).toBe("accumulation");
    expect(section.growth.find((g) => g.age === 65)?.phase).toBe("retirement");
    expect(section.growth[section.growth.length - 1].age).toBe(90);
  });

  it("compares all four methods and marks the highest-success surviving strategy optimal", async () => {
    const section = await buildRetirementReadiness("t", "u");

    expect(section.methods).toHaveLength(4);
    const guardrails = section.methods.find((m) => m.strategy === "guardrails")!;
    expect(guardrails.successRate).toBe(95);
    // guardrails survives (medianLastsToAge null) with the highest rate → optimal.
    expect(section.recommendedStrategy).toBe("guardrails");
    expect(guardrails.recommended).toBe(true);
    expect(section.methods.filter((m) => m.recommended)).toHaveLength(1);
  });

  it("builds the drawdown order in tax-treatment sequence from investable accounts", async () => {
    fetchAccountsWithBalances.mockResolvedValue([
      { type: "depository", subtype: "checking", rawBalance: 20_000 },
      { type: "investment", subtype: "401k", rawBalance: 300_000 },
      { type: "investment", subtype: "roth ira", rawBalance: 80_000 },
      { type: "loan", subtype: "mortgage", rawBalance: 250_000 }, // excluded
    ] as AccountWithBalance[]);

    const section = await buildRetirementReadiness("t", "u");

    // taxable (checking) → tax-deferred (401k) → roth, in that order.
    expect(section.drawdownOrder.map((u) => u.bucket)).toEqual(["taxable", "deferred", "roth"]);
    expect(section.drawdownOrder.find((u) => u.bucket === "taxable")!.balance).toBe(20_000);
    expect(section.drawdownOrder.find((u) => u.bucket === "deferred")!.balance).toBe(300_000);
    expect(section.drawdownOrder.find((u) => u.bucket === "roth")!.balance).toBe(80_000);
  });

  it("returns an un-computed section (no sim run) when there's no investable balance", async () => {
    resolveSimInputs.mockResolvedValue({ ...INPUTS, startingBalance: 0 });

    const section = await buildRetirementReadiness("t", "u");

    expect(section.computed).toBe(false);
    expect(runRetirementSim).not.toHaveBeenCalled();
    expect(section.growth).toEqual([]);
    expect(section.methods).toEqual([]);
  });
});

// ── The path's read of the same verdict ──────────────────────────────────────

describe("buildPathReadiness", () => {
  it("reaches the same verdict as the plan document, for a fraction of the runs", async () => {
    const plan = await buildRetirementReadiness("t", "u");
    runRetirementSim.mockClear();

    const path = await buildPathReadiness("t", "u", 10_000);

    expect(path!.verdict).toBe(plan.verdict);
    expect(path!.successRate).toBe(plan.successRate);
    expect(path!.targetSuccess).toBe(plan.targetSuccess);
    // The plan runs one simulation per withdrawal method. On track, the path
    // runs exactly one.
    expect(runRetirementSim).toHaveBeenCalledTimes(1);
    expect(path!.simRuns).toBe(1);
  });

  it("returns nothing at all when there is no balance to project", async () => {
    resolveSimInputs.mockResolvedValue({ ...INPUTS, startingBalance: 0 });
    expect(await buildPathReadiness("t", "u", 10_000)).toBeNull();
  });

  it("solves for a contribution only when the verdict is short of target", async () => {
    // 60% at what they save now, clearing the target at anything more.
    runRetirementSim.mockImplementation((i) => ({
      ...resultFor("constant_dollar"),
      successRate: i.monthlySavings > INPUTS.monthlySavings ? 0.9 : 0.6,
    }));

    const readiness = await buildPathReadiness("t", "u", 10_000);
    expect(readiness!.verdict).toBe("at_risk");
    expect(readiness!.requiredMonthlySavings).toBeGreaterThan(INPUTS.monthlySavings);
    expect(readiness!.requiredSuccessRate).toBe(90);
  });

  it("serves a second read from cache without running the simulation again", async () => {
    await buildPathReadiness("t", "u", 10_000);
    runRetirementSim.mockClear();

    const cached = await buildPathReadiness("t", "u", 10_000);
    expect(runRetirementSim).not.toHaveBeenCalled();
    expect(cached!.simRuns).toBe(0);
    expect(cached!.verdict).toBe("on_track");
  });

  it("re-runs the moment the inputs behind it change", async () => {
    await buildPathReadiness("t", "u", 10_000);
    resolveSimInputs.mockResolvedValue({ ...INPUTS, startingBalance: 900_000 });
    runRetirementSim.mockClear();

    const fresh = await buildPathReadiness("t", "u", 10_000);
    expect(runRetirementSim).toHaveBeenCalledTimes(1);
    expect(fresh!.simRuns).toBe(1);
  });

  it("keeps one household's answer out of another's", async () => {
    await buildPathReadiness("t", "u", 10_000);
    runRetirementSim.mockClear();

    await buildPathReadiness("t", "other-user", 10_000);
    expect(runRetirementSim).toHaveBeenCalledTimes(1);
  });
});
