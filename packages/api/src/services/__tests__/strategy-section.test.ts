import { describe, it, expect, vi, beforeEach } from "vitest";

// buildStrategySection's only side effects are the structured model call and
// usage logging. Mock the model + telemetry, and stub the agent/activity
// modules so importing doesn't pull a real provider or DB connection.
const generateObject = vi.fn();
// Verification runs on the frontier tier, which does structured output through a
// forced tool call (generateText), not a JSON response format. Mocking only
// generateObject would let every verification fail into the medium-tier fallback
// and still pass — exactly the hole that hid a broken frontier route before.
const generateText = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
  generateText: (...args: unknown[]) => generateText(...args),
}));
vi.mock("../../lib/activity.js", () => ({ logLlmUsage: vi.fn(), actualLlmCostUsd: () => undefined }));
vi.mock("../../agent/index.js", () => ({
  // Echo the tier back as the model id so a test can assert WHICH tier ran.
  getModel: (level: string) => ({ modelId: level }) as never,
  getModelSlug: () => "anthropic/claude-sonnet-4.5",
}));
// The llm boundary (lib/llm.ts) builds the tenant alias map before every call —
// a DB read. Stub the scrubber with identity fns so no DB is touched and the
// prompts/objects pass through unchanged.
vi.mock("../../lib/pii-scrubber.js", () => ({
  buildAliasMap: async () => ({ forward: new Map(), reverse: new Map() }),
  scrub: (x: unknown) => x,
  descrub: (x: unknown) => x,
  descrubObject: (x: unknown) => x,
}));

import { buildStrategySection, nextVerifyLevel, type FrontierBudget } from "../strategy-section.js";
import { buildScheduleGrounding } from "../plan-grounding.js";
import type { CompactPlanGrounding } from "../plan-grounding.js";
import type { ScheduleSection, ScheduleRow, ScheduleFlags } from "../retirement-schedule.js";

const okUsage = { inputTokens: 300, outputTokens: 1200 };

// Reset the model mock with a well-formed default for calls beyond the queued
// `Once` values (the verifier/adjudicator sweeps): an empty verdict object.
// Without it the exhausted queue resolves `undefined`, which throws inside the
// llm boundary and trips generateObjectWithFallback's frontier→medium fallback,
// double-counting the verifier call.
/** A frontier tool-mode result carrying `object` as the forced tool call's input. */
const asToolCall = (object: unknown) => ({
  toolCalls: [{ toolName: "emit_result", input: object }],
  finishReason: "tool-calls",
  usage: okUsage,
});

const resetModel = () => {
  generateObject.mockReset();
  generateObject.mockResolvedValue({ object: { verdicts: [], upheld: [] }, usage: okUsage });
  generateText.mockReset();
  generateText.mockResolvedValue(asToolCall({ verdicts: [], upheld: [] }));
};

// Minimal grounding fixture.
const grounding: CompactPlanGrounding = {
  planId: "plan-abc",
  title: "Early Retirement Plan",
  snapshot: {
    netWorth: 1800000,
    totalAssets: 2100000,
    totalDebt: 300000,
    monthlySpend: 7000,
    age: 50,
    annualIncome: 200000,
  },
  portfolio: {
    totalValue: 1200000,
    allocation: [
      { name: "US Stocks", weight: 80, value: 960000 },
      { name: "Bonds", weight: 20, value: 240000 },
    ],
  },
  retirement: {
    computed: true,
    verdict: "on_track",
    successRate: 82,
    targetSuccess: 85,
    retirementAge: 55,
    planThroughAge: 90,
    medianLastsToAge: 88,
    blendedExpectedReturn: 0.06,
    socialSecurity: { monthlyBenefit: 2800, claimAge: 67 },
    recommendedStrategy: "guardrails",
    methods: [
      {
        strategy: "guardrails",
        label: "Guardrails",
        successRate: 82,
        medianLastsToAge: 88,
        recommended: true,
      },
    ],
    drawdownOrder: [{ bucket: "taxable", label: "Taxable", balance: 400000 }],
  },
  goals: null,
  person: null,
  appliedAssumptions: null,
  schedule: null,
};

// A well-formed model response.
const fullObject = {
  situationHeadline:
    "Retiring at 55 opens a 4-year bridge before penalty-free access to tax-deferred accounts at 59, and your taxable bucket holds $400,000 to cover it.",
  watchouts: [
    {
      title: "Bridge coverage",
      detail: "The 4-year bridge from 55 to 59 draws on the $400,000 taxable bucket before deferred accounts unlock.",
    },
    {
      title: "Sequence-of-returns risk",
      detail: "An 80% equity weight in the first years of retirement amplifies the impact of a market downturn on the plan.",
    },
  ],
  strategies: [
    {
      title: "Draw taxable first",
      detail: "Spend from the $400,000 taxable bucket through the bridge years, keeping deferred accounts compounding.",
      quantifiedImpact: "Covers the 4-year bridge gap from the $400,000 taxable bucket.",
    },
    {
      title: "Tax-free LTCG harvesting",
      detail: "In early retirement, realize long-term gains up to the 0% ceiling, allowing tax-free portfolio rebalancing.",
    },
  ],
  explore: [
    {
      title: "TIPS ladder for sequence protection",
      detail: "A 5-year TIPS ladder funded from the taxable bucket shields the plan from the worst early-retirement drawdowns.",
    },
    {
      title: "Geographic arbitrage",
      detail: "Relocating to a no-state-income-tax state could meaningfully reduce the annual tax drag during conversion years.",
    },
  ],
};

beforeEach(() => {
  resetModel();
});

describe("buildStrategySection", () => {
  it("returns null (never throws) when both model attempts fail", async () => {
    generateObject.mockRejectedValue(new Error("model timeout"));
    await expect(buildStrategySection("tenant-1", "user-1", grounding)).resolves.toBeNull();
    // Both attempts should have been tried.
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("trims strings, drops empty-title/detail items, and returns a valid StrategySection", async () => {
    generateObject.mockResolvedValue({
      object: {
        situationHeadline: "  Headline with whitespace.  ",
        watchouts: [
          { title: "  Valid watchout  ", detail: "  Some detail.  " },
          { title: "", detail: "Missing title -- should be dropped." },
          { title: "Empty detail", detail: "" },
        ],
        strategies: [
          { title: "  Good strategy  ", detail: "  Solid detail.  ", quantifiedImpact: "  +$7,000 per year  " },
          { title: "  No impact strategy  ", detail: "No quantified impact." },
        ],
        explore: [
          { title: "  Good explore  ", detail: "  Directional idea.  " },
        ],
      },
      usage: okUsage,
    });

    const result = await buildStrategySection("tenant-1", "user-1", grounding);

    expect(result).not.toBeNull();
    expect(result!.section).toBe("strategy");

    // Headline trimmed.
    expect(result!.situationHeadline).toBe("Headline with whitespace.");

    // Watchouts: only the valid one survives; empty-title and empty-detail are dropped.
    expect(result!.watchouts).toHaveLength(1);
    expect(result!.watchouts[0].title).toBe("Valid watchout");
    expect(result!.watchouts[0].detail).toBe("Some detail.");

    // Strategies: both survive (trimmed); quantifiedImpact trimmed on first, absent on second.
    expect(result!.strategies).toHaveLength(2);
    expect(result!.strategies[0].title).toBe("Good strategy");
    expect(result!.strategies[0].quantifiedImpact).toBe("+$7,000 per year");
    expect(result!.strategies[1].title).toBe("No impact strategy");
    expect(result!.strategies[1].quantifiedImpact).toBeUndefined();

    // Explore trimmed.
    expect(result!.explore).toHaveLength(1);
    expect(result!.explore[0].title).toBe("Good explore");

    expect(result!.generatedAt).toBeTruthy();
  });

  it("returns null when all arrays are empty and headline is empty", async () => {
    generateObject.mockResolvedValue({
      object: {
        situationHeadline: "   ",
        watchouts: [],
        strategies: [],
        explore: [],
      },
      usage: okUsage,
    });

    const result = await buildStrategySection("tenant-1", "user-1", grounding);
    expect(result).toBeNull();
  });

  it("rules out a step the reader's plan left out, exactly as chat does", async () => {
    generateObject.mockResolvedValueOnce({ object: fullObject, usage: okUsage });
    await buildStrategySection("tenant-1", "user-1", grounding);

    // Both lists sit off the path, and the report used to rule out only the one
    // the person set aside. A step their own plan decided against could then be
    // recommended back to them in the same document that shows the plan.
    const system = generateObject.mock.calls[0][0].system as string;
    expect(system).toContain("notApplicable");
    expect(system).toContain("leftOut");
    expect(system).toContain("never propose one as a move");
  });

  it("returns null on first failure then succeeds on second attempt", async () => {
    generateObject
      .mockRejectedValueOnce(new Error("transient error"))
      .mockResolvedValueOnce({ object: fullObject, usage: okUsage });

    const result = await buildStrategySection("tenant-1", "user-1", grounding);
    expect(result).not.toBeNull();
    expect(result!.section).toBe("strategy");
    expect(result!.situationHeadline).toContain("55");
    // parse-retry (2) on the draft; the verifier is a frontier tool call (1).
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// buildScheduleGrounding unit tests (no mock needed — pure function)
// ---------------------------------------------------------------------------

/** Build a minimal ScheduleRow for testing. */
function makeRow(age: number, phase: ScheduleRow["phase"]): ScheduleRow {
  const bucket = { start: 0, growth: 0, contribution: 0, withdrawal: 0, end: 0 };
  return {
    age,
    year: age - 50,
    phase,
    buckets: { taxable: bucket, deferred: bucket, roth: bucket, hsa: bucket },
    accounts: [],
    realEstate: null,
    spendTarget: 0,
    guaranteedIncome: { socialSecurity: 0, rental: 0, other: 0 },
    portfolioWithdrawal: 0,
    ordinaryIncome: 0,
    ltcgRealized: 0,
    estimatedTax: 0,
    taxFreeWithdrawal: 0,
    totalPortfolio: 500000,
    netWorth: 500000,
    shortfall: 0,
  };
}

const testFlags: ScheduleFlags = {
  bridge: { fromAge: 55, toAge: 58, covered: true, shortfallTotal: 0 },
  firstShortfallAge: null,
  coastFi: { deferredPlusRothAt59: 800000, deferredPlusRothAtEnd: 400000 },
  taxFreeCapacityAtRetirement: 89250,
  realEstateEquityAtRetirement: 300000,
  rmd: { firstAge: 73, firstAmount: 45000 },
  endingPortfolio: 200000,
  endingNetWorth: 200000,
  depleted: false,
};

const testAssumptions: ScheduleSection["assumptions"] = {
  blendedReturn: 0.06,
  reAppreciation: 0.03,
  dividendYield: 0.018,
  costBasisRatio: 0.5,
  filingStatus: "single",
  taxYear: 2025,
};

describe("buildScheduleGrounding", () => {
  it("returns null when computed is false", () => {
    const schedule: ScheduleSection = {
      section: "schedule",
      computed: false,
      rows: [],
      flags: testFlags,
      assumptions: testAssumptions,
      generatedAt: new Date().toISOString(),
    };
    expect(buildScheduleGrounding(schedule)).toBeNull();
  });

  it("returns null when rows array is empty even if computed is true", () => {
    const schedule: ScheduleSection = {
      section: "schedule",
      computed: true,
      rows: [],
      flags: testFlags,
      assumptions: testAssumptions,
      generatedAt: new Date().toISOString(),
    };
    expect(buildScheduleGrounding(schedule)).toBeNull();
  });

  it("curates only the key ages from the full rows array", () => {
    // Build rows from age 50 to 90: accumulation 50-54, retirement 55-90.
    const rows: ScheduleRow[] = [];
    for (let age = 50; age <= 90; age++) {
      rows.push(makeRow(age, age < 55 ? "accumulation" : "retirement"));
    }
    const schedule: ScheduleSection = {
      section: "schedule",
      computed: true,
      rows,
      flags: testFlags,
      assumptions: testAssumptions,
      generatedAt: new Date().toISOString(),
    };

    const result = buildScheduleGrounding(schedule);
    expect(result).not.toBeNull();

    // Flags and assumptions pass through unchanged.
    expect(result!.flags).toBe(testFlags);
    expect(result!.assumptions).toBe(testAssumptions);

    // Only the curated ages appear: retire=55, retire+5=60, retire+10=65, 59, 73, last=90.
    // Deduplicated and only those present in the rows array.
    const returnedAges = result!.rows.map((r) => r.age);
    const wantedAges = new Set([55, 60, 65, 59, 73, 90]);
    for (const age of returnedAges) {
      expect(wantedAges.has(age)).toBe(true);
    }
    // No duplicates.
    expect(returnedAges.length).toBe(new Set(returnedAges).size);
    // All rows that exist in both wantedAges and the source are present.
    for (const age of wantedAges) {
      if (rows.some((r) => r.age === age)) {
        expect(returnedAges).toContain(age);
      }
    }
  });

  it("does not include ages absent from the source rows", () => {
    // Rows from 60-70 only — age 59, 55 are absent.
    const rows: ScheduleRow[] = [];
    for (let age = 60; age <= 70; age++) {
      rows.push(makeRow(age, "retirement"));
    }
    const schedule: ScheduleSection = {
      section: "schedule",
      computed: true,
      rows,
      flags: testFlags,
      assumptions: testAssumptions,
      generatedAt: new Date().toISOString(),
    };

    const result = buildScheduleGrounding(schedule);
    expect(result).not.toBeNull();
    const returnedAges = result!.rows.map((r) => r.age);
    // 59 and 55 don't exist in rows — must not appear.
    expect(returnedAges).not.toContain(59);
    expect(returnedAges).not.toContain(55);
    // 60 (retire), 65 (retire+5), 70 (last) should be present.
    expect(returnedAges).toContain(60);
    expect(returnedAges).toContain(65);
    expect(returnedAges).toContain(70);
  });
});

describe("grounded-figure gate", () => {
  beforeEach(() => resetModel());

  const good = {
    situationHeadline: "You retire at 55 with $1.2M invested.",
    watchouts: [{ title: "Sequence risk", detail: "Your first years draw on $400,000 of taxable money." }],
    strategies: [{ title: "Drawdown order", detail: "Spend the $400,000 taxable first." }],
    explore: [{ title: "Bond ladder", detail: "Cover early years without selling stocks." }],
  };

  it("passes fully-grounded output through with a single call", async () => {
    generateObject.mockResolvedValueOnce({ object: good, usage: okUsage });
    const res = await buildStrategySection("t1", "u1", grounding);
    expect(res).not.toBeNull();
    // draft (1); the adversarial verifier is a frontier tool call (1).
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(res!.strategies).toHaveLength(1);
  });

  it("retries once with violations named, then drops still-ungrounded items", async () => {
    const bad = {
      ...good,
      strategies: [
        { title: "Drawdown order", detail: "Spend the $400,000 taxable first." },
        { title: "Made up", detail: "This saves you $99,999,999 every year." },
      ],
    };
    // First draft has the ungrounded figure; the corrective pass returns it again.
    generateObject.mockResolvedValueOnce({ object: bad, usage: okUsage });
    generateObject.mockResolvedValueOnce({ object: bad, usage: okUsage });
    const res = await buildStrategySection("t1", "u1", grounding);
    // draft + corrective (2); verifier is a frontier tool call (1).
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(generateText).toHaveBeenCalledTimes(1);
    // Corrective prompt names the violation.
    const secondPrompt = (generateObject.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain("$99,999,999");
    // The offending item is dropped; the grounded one survives.
    expect(res!.strategies.map((s) => s.title)).toEqual(["Drawdown order"]);
  });

  it("drops prose containing internal field identifiers", async () => {
    const leaky = {
      ...good,
      watchouts: [{ title: "Leak", detail: "Your taxFreeWithdrawal stays high." }],
    };
    generateObject.mockResolvedValueOnce({ object: leaky, usage: okUsage });
    generateObject.mockResolvedValueOnce({ object: leaky, usage: okUsage });
    const res = await buildStrategySection("t1", "u1", grounding);
    expect(res!.watchouts).toHaveLength(0);
    expect(res!.strategies).toHaveLength(1); // rest intact
  });
});

describe("figure-allowance classes", () => {
  beforeEach(() => resetModel());

  it("allows round prescriptions, sums of grounded numbers, and IRS constants", async () => {
    const ok = {
      situationHeadline: "You hold $1.2M invested.",
      watchouts: [],
      strategies: [
        // $640,000 = sum of grounded 400,000 (drawdownOrder) + 240,000 (bonds)
        { title: "Combined", detail: "Your taxable plus bonds total roughly $640,000." },
        // round prescriptive amount
        { title: "Ladder", detail: "Convert $30,000 per year to Roth." },
        // IRS constant
        { title: "IRA", detail: "Contribute the $7,000 IRA maximum." },
      ],
      explore: [],
    };
    generateObject.mockResolvedValueOnce({ object: ok, usage: okUsage });
    const res = await buildStrategySection("t1", "u1", grounding);
    expect(generateObject).toHaveBeenCalledTimes(1); // no corrective pass; draft only
    expect(generateText).toHaveBeenCalledTimes(1); // verifier
    expect(res!.strategies).toHaveLength(3);
  });
});

describe("adversarial verifier", () => {
  beforeEach(() => resetModel());

  const draft = {
    situationHeadline: "You retire at 55 with $1.2M invested.",
    watchouts: [{ title: "Sequence risk", detail: "Early drawdowns on $400,000 of taxable money." }],
    strategies: [
      { title: "Good", detail: "Spend the $400,000 taxable first." },
      { title: "Bad math", detail: "Convert $30,000 per year." },
    ],
    explore: [{ title: "Bond ladder", detail: "Cover early years without selling stocks." }],
  };

  it("verifies on the frontier tier as a forced tool call, without falling back", async () => {
    generateObject.mockResolvedValueOnce({ object: draft, usage: okUsage }); // draft
    await buildStrategySection("t1", "u1", grounding);

    // The frontier Opus routes reject a JSON response format, so the schema has
    // to ride as one forced tool call. Assert the shape, the tier, and — most
    // importantly — that the medium-tier fallback never ran: a fallback here
    // means the reader is looking at the medium tier's verdict, not Opus's.
    expect(generateText).toHaveBeenCalledTimes(1);
    const call = generateText.mock.calls[0][0] as {
      model: { modelId: string };
      tools: Record<string, { inputSchema: unknown }>;
      toolChoice: unknown;
    };
    expect(call.model.modelId).toBe("frontier");
    expect(Object.keys(call.tools)).toEqual(["emit_result"]);
    expect(call.toolChoice).toEqual({ type: "tool", toolName: "emit_result" });
    expect(generateObject).toHaveBeenCalledTimes(1); // the draft, and nothing else
  });

  it("drops items the verifier rejects, keeps the rest", async () => {
    generateObject.mockResolvedValueOnce({ object: draft, usage: okUsage }); // draft (grounded)
    generateText.mockResolvedValueOnce(
      asToolCall({ verdicts: [{ key: "s1", ok: false, errorClass: "duration_mismatch", reason: "duration inconsistent" }] }),
    ); // verifier
    generateText.mockResolvedValueOnce(
      asToolCall({ upheld: [{ key: "s1", uphold: true }] }),
    ); // adjudicator upholds
    const res = await buildStrategySection("t1", "u1", grounding);
    expect(res!.strategies.map((s) => s.title)).toEqual(["Good"]);
    expect(res!.watchouts).toHaveLength(1);
  });

  it("fails open when the verifier call errors on BOTH tiers", async () => {
    generateObject.mockResolvedValueOnce({ object: draft, usage: okUsage });
    // Frontier attempt and the medium-tier fallback behind it both fail.
    generateText.mockRejectedValue(new Error("verifier down"));
    generateObject.mockRejectedValue(new Error("verifier down"));
    const res = await buildStrategySection("t1", "u1", grounding);
    expect(res!.strategies).toHaveLength(2); // nothing dropped
  });
});

describe("adjudication of verifier rejections", () => {
  beforeEach(() => resetModel());
  const draft = {
    situationHeadline: "You retire at 55 with $1.2M invested.",
    watchouts: [],
    strategies: [{ title: "Fine", detail: "Spend the $400,000 taxable first." }],
    explore: [],
  };

  it("keeps content when the adjudicator overturns a rejection", async () => {
    generateObject.mockResolvedValueOnce({ object: draft, usage: okUsage }); // draft
    generateText.mockResolvedValueOnce(
      asToolCall({ verdicts: [{ key: "s0", ok: false, errorClass: "wrong_figure", reason: "bogus complaint" }] }),
    ); // verifier over-fires
    generateText.mockResolvedValueOnce(
      asToolCall({ upheld: [{ key: "s0", uphold: false }] }),
    ); // adjudicator overturns
    const res = await buildStrategySection("t1", "u1", grounding);
    expect(res!.strategies).toHaveLength(1);
  });

  it("sends self-negating rejections to the adjudicator instead of discarding them", async () => {
    generateObject.mockResolvedValueOnce({ object: draft, usage: okUsage }); // draft
    generateText.mockResolvedValueOnce(
      asToolCall({ verdicts: [{ key: "s0", ok: false, errorClass: "wrong_figure", reason: "off by 0.5% which is correct rounding, so the item is actually fine" }] }),
    ); // verifier (self-negating reason — still a real rejection to vet)
    generateText.mockResolvedValueOnce(
      asToolCall({ upheld: [{ key: "s0", uphold: false }] }),
    ); // adjudicator overturns it
    const res = await buildStrategySection("t1", "u1", grounding);
    expect(res!.strategies).toHaveLength(1);
    expect(generateObject).toHaveBeenCalledTimes(1); // draft
    expect(generateText).toHaveBeenCalledTimes(2); // verifier + adjudicator
  });
});

describe("frontier escalation ceiling", () => {
  beforeEach(() => resetModel());

  it("escalates every call one plan legitimately makes", () => {
    const budget: FrontierBudget = { used: 0 };
    // A plan generates one strategy section, verified by one sweep plus one
    // adjudication. Both must reach the frontier tier.
    expect(nextVerifyLevel(budget)).toBe("frontier");
    expect(nextVerifyLevel(budget)).toBe("frontier");
    expect(budget.used).toBe(2);
  });

  it("degrades to the medium tier past the ceiling instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const budget: FrontierBudget = { used: 0 };
    const tiers = Array.from({ length: 7 }, () => nextVerifyLevel(budget));
    expect(tiers).toEqual([
      "frontier",
      "frontier",
      "frontier",
      "frontier",
      "medium",
      "medium",
      "medium",
    ]);
    warn.mockRestore();
  });

  it("logs loudly when it trips", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const budget: FrontierBudget = { used: 4 };
    expect(nextVerifyLevel(budget)).toBe("medium");
    expect(String(warn.mock.calls[0]?.[0])).toContain("frontier verification ceiling reached");
    expect(String(warn.mock.calls[0]?.[0])).toContain("ceiling 4");
    warn.mockRestore();
  });

  it("stops charging the budget once it has degraded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const budget: FrontierBudget = { used: 0 };
    for (let i = 0; i < 20; i++) nextVerifyLevel(budget);
    expect(budget.used).toBe(4);
    warn.mockRestore();
  });

  it("gives each plan generation a fresh budget", async () => {
    const draft = {
      situationHeadline: "You retire at 55 with $1.2M invested.",
      watchouts: [],
      strategies: [{ title: "Good", detail: "Spend the $400,000 taxable first." }],
      explore: [],
    };
    // Two separate plan generations. The second must still reach the frontier
    // tier: the ceiling bounds ONE plan, it is not a process-wide quota that
    // silently downgrades every plan after the first.
    for (let run = 0; run < 2; run++) {
      generateObject.mockResolvedValueOnce({ object: draft, usage: okUsage });
      await buildStrategySection("t1", "u1", grounding);
    }
    const tiers = generateText.mock.calls.map(
      (c) => (c[0] as { model: { modelId: string } }).model.modelId,
    );
    expect(tiers).toEqual(["frontier", "frontier"]);
  });
});
