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

import { TARGET_SUCCESS, verdictFor, type ReadinessVerdict } from "@lasagna/core/retirement-verdict";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import { resolveSimInputs } from "./resolve-sim-inputs.js";
import { runRetirementSim } from "./retirement-sim.js";
import type { SimInputs } from "./retirement-sim.js";
import type { StrategyType } from "./withdrawal-strategies.js";
import { BUCKET_ORDER, BUCKET_LABELS, bucketFor, type Bucket } from "./account-buckets.js";

// "On track" is defined once, in @lasagna/core, and re-exported here so every
// caller of this service keeps reading it from one place. The retirement page
// imports the same module, so the two surfaces cannot judge the same success
// rate differently.
export {
  TARGET_SUCCESS,
  verdictFor,
  verdictLabel,
  type ReadinessVerdict,
} from "@lasagna/core/retirement-verdict";

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
  // Plan-change overrides (retirement age, monthly spend, ssMonthly:0 for a
  // Social Security exclusion) and a flat expected-return decimal, threaded into
  // the resolved sim inputs so the readiness verdict reconciles with the change.
  overrides?: Partial<SimInputs>,
  flatReturn?: number,
  // Extra investable dollars (reinvested property-sale net equity) folded into
  // the sim's starting balance, so the verdict reflects the sale.
  extraInvestable?: number,
): Promise<RetirementReadinessSection> {
  const inputs = await resolveSimInputs(tenantId, userId, overrides, flatReturn, extraInvestable);
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

// ── The financial path's read of the same verdict ────────────────────────────

/**
 * Is this household on track to retire, and if not, what would it take?
 *
 * The financial path asks a narrower question than the plan document, so this
 * runs ONE simulation for the verdict instead of the four the method comparison
 * needs. Everything else is shared: the same `resolveSimInputs`, the same
 * `runRetirementSim`, the same `TARGET_SUCCESS` and the same `verdictFor`. There
 * is one definition of "on track" and both surfaces read it, so the path and the
 * plan can never state different verdicts for the same inputs.
 *
 * When the verdict is short of target it solves for the monthly retirement
 * saving that reaches it, by re-running the same engine against `monthlySavings`.
 * The answer returned is always a contribution we actually simulated and saw
 * clear the threshold, never an extrapolation.
 */
export interface PathReadiness {
  /** 0..100, from one run of the resolved inputs. */
  successRate: number;
  targetSuccess: number;
  verdict: ReadinessVerdict;
  currentAge: number;
  retirementAge: number;
  /** What is going in each month today, from the resolved inputs. */
  currentMonthlySavings: number;
  /** The monthly saving that reaches the target. Null when nothing in reach does. */
  requiredMonthlySavings: number | null;
  /** The rate that saving produced, from the run that found it. */
  requiredSuccessRate: number | null;
  /**
   * The median projected balance of the invested pot at each age from
   * `currentAge`. Index 0 is today, straight off the run that set the verdict.
   *
   * It is here because the path has to say WHEN a retirement-sized pot is
   * reached, and this simulation has already answered it: it compounds the
   * balance and the contributions at the household's own blended return.
   * Dividing what is left to find by what goes in each month credits none of
   * that growth, and put one household's retirement target 21 years further out
   * than this same engine's verdict on the same screen.
   */
  medianByAge: number[];
  /** Simulations this read cost. 0 on a cache hit. */
  simRuns: number;
}

/** Solved contributions are reported to the nearest $50. */
const SOLVE_STEP = 50;
/**
 * Hard cap on refinement runs, so a solve can never cost an unbounded number of
 * sims. A bisection halves the bracket every run, so 21 covers a bracket over
 * two million $50 steps wide: far past any monthly income, which is what bounds
 * the bracket in practice. It is a backstop, not the thing that ends the search.
 */
const SOLVE_MAX_ITERATIONS = 21;

function successPct(inputs: SimInputs, monthlySavings: number): number {
  return Math.round(runRetirementSim({ ...inputs, monthlySavings }).successRate * 100);
}

/**
 * The smallest monthly saving on a $50 grid that reaches `TARGET_SUCCESS`.
 *
 * It is the smallest one, not merely one that works. The bisection runs to
 * convergence — until the bracket is a single $50 step wide — so the figure it
 * lands on is the boundary itself: `hi` cleared the target and `hi - $50` did
 * not. That matters because the bracket's upper end is the household's income,
 * an input with nothing to do with the answer. Stopping the search early made
 * the quoted contribution move with it, so the same retirement inputs named
 * $2,900, $2,950 or $3,000 depending on what the person earned.
 *
 * Both ends sit on the $50 grid so every probe does too: `lo` rounds DOWN from
 * what they save now (which we already know falls short, and less than that
 * falls shorter), and `hi` rounds UP from the ceiling.
 *
 * `hi` only ever moves to a contribution we ran and saw clear the threshold, so
 * the figure returned is measured rather than interpolated. Null when even the
 * ceiling falls short: there is then no honest number to name.
 */
export function solveMonthlySavings(
  inputs: SimInputs,
  ceiling: number,
): { monthlySavings: number | null; successRate: number | null; runs: number } {
  // Work in $50 steps rather than dollars, so the bracket converges on the grid
  // the answer is reported on instead of drifting off it as it narrows.
  let lo = Math.floor(inputs.monthlySavings / SOLVE_STEP);
  let hi = Math.ceil(ceiling / SOLVE_STEP);
  if (!(hi > lo)) return { monthlySavings: null, successRate: null, runs: 0 };

  let runs = 1;
  let hiPct = successPct(inputs, hi * SOLVE_STEP);
  if (hiPct < TARGET_SUCCESS) return { monthlySavings: null, successRate: null, runs };

  for (let i = 0; i < SOLVE_MAX_ITERATIONS && hi - lo > 1; i++) {
    const mid = Math.floor((lo + hi) / 2);
    runs++;
    const pct = successPct(inputs, mid * SOLVE_STEP);
    if (pct >= TARGET_SUCCESS) {
      hi = mid;
      hiPct = pct;
    } else {
      lo = mid;
    }
  }
  return { monthlySavings: hi * SOLVE_STEP, successRate: hiPct, runs };
}

// One readiness read per set of inputs, held in process.
//
// The path endpoint builds the path on every request, and a Monte Carlo is
// thousands of times the cost of the rest of it. The key is the resolved SimInputs themselves, so a hit is only ever
// returned for a household whose balances, profile and spending are byte-for-
// byte what the cached answer was computed from — a stale verdict is not
// reachable. The TTL exists to bound memory, not correctness.
const READINESS_TTL_MS = 15 * 60 * 1000;
const READINESS_CACHE_MAX = 500;
const readinessCache = new Map<
  string,
  { fingerprint: string; expiresAt: number; value: PathReadiness }
>();

/** Drops every cached readiness read. For tests. */
export function resetPathReadinessCache(): void {
  readinessCache.clear();
}

export async function buildPathReadiness(
  tenantId: string,
  userId: string,
  /** The most they could put away in a month. Their gross monthly income. */
  ceiling: number,
): Promise<PathReadiness | null> {
  const inputs = await resolveSimInputs(tenantId, userId);

  // Nothing invested is nothing to project: the plan document draws an empty
  // state here rather than a 0-dollar simulation, and the path prunes instead.
  if (!(inputs.startingBalance > 0)) return null;

  const cacheKey = `${tenantId}:${userId}`;
  const fingerprint = JSON.stringify(inputs) + `|${Math.round(ceiling)}`;
  const hit = readinessCache.get(cacheKey);
  if (hit && hit.fingerprint === fingerprint && hit.expiresAt > Date.now()) {
    return { ...hit.value, simRuns: 0 };
  }

  const projection = runRetirementSim(inputs);
  const successRate = Math.round(projection.successRate * 100);
  const verdict = verdictFor(successRate);

  const solved =
    verdict === "on_track"
      ? { monthlySavings: null, successRate: null, runs: 0 }
      : solveMonthlySavings(inputs, ceiling);

  const value: PathReadiness = {
    successRate,
    targetSuccess: TARGET_SUCCESS,
    verdict,
    currentAge: inputs.currentAge,
    retirementAge: inputs.retirementAge,
    currentMonthlySavings: Math.round(inputs.monthlySavings),
    requiredMonthlySavings: solved.monthlySavings,
    requiredSuccessRate: solved.successRate,
    medianByAge: projection.percentiles.p50,
    simRuns: 1 + solved.runs,
  };

  if (readinessCache.size >= READINESS_CACHE_MAX) readinessCache.clear();
  readinessCache.set(cacheKey, {
    fingerprint,
    expiresAt: Date.now() + READINESS_TTL_MS,
    value,
  });
  return value;
}
