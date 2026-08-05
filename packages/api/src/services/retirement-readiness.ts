/**
 * Builds the "Retirement Readiness" section of a Financial Plan document — the
 * analytical heart of the plan. It answers "am I on track to retire at my
 * desired age?", shows projected asset growth across accumulation / retirement /
 * end-of-life, and for the drawdown phase surfaces the optimal drawdown ORDER
 * (which accounts to spend first) plus a METHOD comparison (4% / guardrails /
 * percent-of-portfolio / rules-based) with ONE recommended optimal.
 *
 * This section is computed once at plan-create time and stored in the document
 * JSON — it is NOT recomputed on every view.
 *
 * REUSES THE CANONICAL /retirement ENGINE — no second simulator:
 *  - resolveSimInputs → the same SimInputs the dashboard + chat agent start from
 *  - runRetirementSim → the on-track verdict AND the projected-growth curve
 *  - computeWithdrawal (via re-running runRetirementSim per StrategyType) → the
 *    drawdown METHOD comparison
 * The drawdown ORDER mirrors the retirement page's "drawdown by account" tax-
 * treatment liquidation sequence (taxable → tax-deferred → Roth → HSA).
 */

import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import { resolveSimInputs } from "./resolve-sim-inputs.js";
import { runRetirementSim } from "./retirement-sim.js";
import type { StrategyType } from "./withdrawal-strategies.js";

// "On track" threshold for the verdict — the SAME value /retirement uses
// (retirement-v2.tsx:20 `TARGET_SUCCESS = 85`, verdict tiers at retirement-v2.tsx:1739).
// INVARIANT: keep in lockstep with retirement-v2.tsx so the plan's verdict
// reconciles with the dashboard for identical inputs.
const TARGET_SUCCESS = 85;

export type ReadinessVerdict = "on_track" | "needs_attention" | "at_risk";

// Same three-tier mapping as retirement-v2.tsx:1739 (prob is successRate as a
// percentage): >= 85 → on track, >= 70 → needs attention, else at risk.
function verdictFor(successPct: number): ReadinessVerdict {
  if (successPct >= TARGET_SUCCESS) return "on_track";
  if (successPct >= 70) return "needs_attention";
  return "at_risk";
}

export interface GrowthPoint {
  age: number;
  /** Median projected balance at the START of this age (today's-dollar nominal). */
  median: number;
  p25: number;
  p75: number;
  /** "accumulation" before retirementAge, "retirement" at/after it. */
  phase: "accumulation" | "retirement";
}

export interface MethodComparison {
  strategy: StrategyType;
  label: string;
  successRate: number; // 0..100
  /** First age the median path depletes, or null if it lasts through the plan. */
  medianLastsToAge: number | null;
  recommended: boolean;
}

export interface DrawdownOrderUnit {
  /** Tax-treatment bucket that drives the liquidation order. */
  bucket: "taxable" | "deferred" | "roth" | "hsa";
  label: string;
  balance: number;
}

export interface RetirementReadinessSection {
  section: "retirement";
  /** True only when there's enough data to run a meaningful projection. */
  computed: boolean;
  currentAge: number;
  retirementAge: number;
  planThroughAge: number;
  successRate: number; // 0..100, from runRetirementSim on the resolved inputs
  targetSuccess: number; // the TARGET_SUCCESS threshold, for the verdict band
  verdict: ReadinessVerdict;
  medianLastsToAge: number | null;
  blendedExpectedReturn: number; // decimal, from runRetirementSim
  growth: GrowthPoint[];
  methods: MethodComparison[];
  /** Recommended drawdown METHOD (highest-success surviving strategy). */
  recommendedStrategy: StrategyType;
  drawdownOrder: DrawdownOrderUnit[];
  generatedAt: string;
}

// The four withdrawal methods the engine supports, in the order the comparison
// is presented. rules_based needs no user-tuned params here — computeWithdrawal
// falls back to its own defaults for each.
const METHOD_META: Array<{ strategy: StrategyType; label: string }> = [
  { strategy: "constant_dollar", label: "4% rule (constant dollar)" },
  { strategy: "guardrails", label: "Guardrails" },
  { strategy: "percent_of_portfolio", label: "Percent of portfolio" },
  { strategy: "rules_based", label: "Rules-based" },
];

// Tax-treatment liquidation order + labels, mirroring retirement-v2.tsx's
// drawdown-by-account default (taxable → tax-deferred → Roth → HSA).
const BUCKET_ORDER = ["taxable", "deferred", "roth", "hsa"] as const;
type Bucket = (typeof BUCKET_ORDER)[number];
const BUCKET_LABELS: Record<Bucket, string> = {
  taxable: "Taxable",
  deferred: "Tax-deferred",
  roth: "Roth",
  hsa: "HSA",
};

// Classify a Plaid account into its tax-treatment bucket, matching the
// retirement page's classifyKind → KIND_BUCKET mapping (retirement-v2.tsx:611).
// Only the bucket (not the granular kind) is needed for the ORDER breakdown.
function classifyBucket(type: string, subtype: string | null | undefined): Bucket {
  const st = ` ${(subtype || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const has = (...words: string[]) => words.some((w) => st.includes(` ${w} `));
  if (has("hsa", "health reimbursement arrangement")) return "hsa";
  if (type === "investment") {
    if (has("roth 401k")) return "roth";
    if (has("roth")) return "roth";
  }
  return "taxable"; // checking/savings/brokerage/etc. and tax-deferred handled below
}

// The deferred (pre-tax) subtypes, matched the same way retirement-v2 does.
function isDeferred(type: string, subtype: string | null | undefined): boolean {
  if (type !== "investment") return false;
  const st = ` ${(subtype || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const has = (...words: string[]) => words.some((w) => st.includes(` ${w} `));
  if (has("roth")) return false; // roth is its own bucket
  return has("401k", "401a", "403b", "457b", "457", "ira", "sep", "simple", "keogh", "sarsep", "pension", "retirement", "profit sharing plan", "annuity");
}

function bucketFor(type: string, subtype: string | null | undefined): Bucket {
  const base = classifyBucket(type, subtype);
  if (base !== "taxable") return base; // hsa / roth already decided
  return isDeferred(type, subtype) ? "deferred" : "taxable";
}

/**
 * Build the drawdown ORDER: the tenant's investable accounts grouped into the
 * tax-treatment liquidation sequence, one unit per non-empty bucket. Mirrors the
 * retirement page's "drawdown by account" default ordering (taxable first).
 */
function buildDrawdownOrder(
  accts: Array<{ type: string; subtype: string | null; rawBalance: number }>,
): DrawdownOrderUnit[] {
  const INVESTABLE = new Set(["investment", "depository"]);
  const sums: Record<Bucket, number> = { taxable: 0, deferred: 0, roth: 0, hsa: 0 };
  for (const a of accts) {
    if (!INVESTABLE.has(a.type)) continue;
    if (!(a.rawBalance > 0)) continue;
    sums[bucketFor(a.type, a.subtype)] += a.rawBalance;
  }
  return BUCKET_ORDER.filter((b) => sums[b] > 0).map((b) => ({
    bucket: b,
    label: BUCKET_LABELS[b],
    balance: Math.round(sums[b]),
  }));
}

/**
 * "Optimal" drawdown-method heuristic: prefer the highest-success-rate strategy
 * whose MEDIAN path does NOT deplete before the plan-through age (medianLastsToAge
 * === null); tie-break on higher success. If NO strategy survives the median to
 * plan-through, fall back to the plain highest-success strategy. This matches the
 * spirit of the retirement page — a plan you can't outlive, then the best odds.
 */
function pickRecommended(methods: MethodComparison[]): StrategyType {
  const surviving = methods.filter((m) => m.medianLastsToAge === null);
  const pool = surviving.length > 0 ? surviving : methods;
  return pool.reduce((best, m) => (m.successRate > best.successRate ? m : best), pool[0]).strategy;
}

export async function buildRetirementReadiness(
  tenantId: string,
  userId: string,
): Promise<RetirementReadinessSection> {
  const inputs = await resolveSimInputs(tenantId, userId);
  const accts = await fetchAccountsWithBalances(tenantId);
  const drawdownOrder = buildDrawdownOrder(accts);
  const generatedAt = new Date().toISOString();

  // Not enough to project on: no investable balance to grow/draw down. Return an
  // un-computed section so the plan renders an empty state instead of a bogus
  // 0-dollar sim.
  const computed = inputs.startingBalance > 0;
  if (!computed) {
    return {
      section: "retirement",
      computed: false,
      currentAge: inputs.currentAge,
      retirementAge: inputs.retirementAge,
      planThroughAge: inputs.planThroughAge,
      successRate: 0,
      targetSuccess: TARGET_SUCCESS,
      verdict: "at_risk",
      medianLastsToAge: null,
      blendedExpectedReturn: 0,
      growth: [],
      methods: [],
      recommendedStrategy: "constant_dollar",
      drawdownOrder,
      generatedAt,
    };
  }

  // ── On-track verdict + projected-growth curve (the resolved-strategy run) ────
  const primary = runRetirementSim(inputs);
  const successRate = Math.round(primary.successRate * 100);

  // Projected-growth series straight from the sim's percentiles — index 0 =
  // currentAge — segmented at retirementAge. NOT a re-implemented projection.
  const { p25, p50, p75 } = primary.percentiles;
  const growth: GrowthPoint[] = p50.map((median, i) => {
    const age = inputs.currentAge + i;
    return {
      age,
      median,
      p25: p25[i],
      p75: p75[i],
      phase: age < inputs.retirementAge ? "accumulation" : "retirement",
    };
  });

  // ── Drawdown METHOD comparison — re-run the SAME engine per strategy ────────
  // Each run swaps only the withdrawal strategy; computeWithdrawal supplies each
  // method's own default params. Identical inputs otherwise, so the numbers stay
  // comparable and reconcile with /retirement's strategy switch.
  const methodsRaw = METHOD_META.map(({ strategy, label }) => {
    const res =
      strategy === inputs.strategy
        ? primary
        : runRetirementSim({ ...inputs, strategy });
    return {
      strategy,
      label,
      successRate: Math.round(res.successRate * 100),
      medianLastsToAge: res.medianLastsToAge,
      recommended: false,
    };
  });
  const recommendedStrategy = pickRecommended(methodsRaw);
  const methods = methodsRaw.map((m) => ({
    ...m,
    recommended: m.strategy === recommendedStrategy,
  }));

  return {
    section: "retirement",
    computed: true,
    currentAge: inputs.currentAge,
    retirementAge: inputs.retirementAge,
    planThroughAge: inputs.planThroughAge,
    successRate,
    targetSuccess: TARGET_SUCCESS,
    verdict: verdictFor(successRate),
    medianLastsToAge: primary.medianLastsToAge,
    blendedExpectedReturn: primary.blendedExpectedReturn,
    growth,
    methods,
    recommendedStrategy,
    drawdownOrder,
    generatedAt,
  };
}
