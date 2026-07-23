/**
 * Unified retirement Monte Carlo.
 *
 * Combines, in a single server-side simulation:
 *  - per-asset-class stochastic returns + annual rebalancing (from the existing
 *    server engine `monte-carlo.ts` `runSingleSimulation`), and
 *  - the accumulation phase + Social Security / guaranteed-income netting +
 *    plan-derived horizon (from the client engine `retirement-engine.ts`
 *    `buildBands`).
 *
 * Reuses the shared capital-market assumptions, withdrawal strategies, and
 * seeded RNG rather than duplicating them.
 */

import {
  ASSET_CLASSES,
  MARKET_MODEL,
  blendedExpectedReturn,
  type AssetAllocation,
} from "./market-assumptions.js";
import {
  computeWithdrawal,
  type StrategyType,
  type StrategyParams,
  type WithdrawalContext,
} from "./withdrawal-strategies.js";
import { makeRng, DEFAULT_SEED } from "./monte-carlo.js";

export interface SimInputs {
  currentAge: number;
  retirementAge: number;
  planThroughAge: number;
  startingBalance: number;
  monthlySavings: number;
  monthlySpend: number;
  strategy: StrategyType;
  strategyParams?: StrategyParams;
  ssMonthly: number;
  ssClaimAge: number;
  otherMonthly: number;
  otherStartAge: number;
  allocation: AssetAllocation;
  inflationAdjusted: boolean;
  numSimulations: number;
  seed?: number;
}

export interface SimResult {
  successRate: number; // 0..1
  percentiles: {
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
  }; // index 0 = currentAge
  medianLastsToAge: number | null; // first age where p50 <= 0, else null
  finalBalanceDistribution: { mean: number; median: number; stdDev: number };
  blendedExpectedReturn: number; // from blendedExpectedReturn(allocation)
  horizonYears: number; // planThroughAge - currentAge
}

/**
 * Box-Muller normal draw, matching both engines:
 *   z = sqrt(-2 ln u1) * cos(2π u2); draw = mean + stdDev * z.
 * Uses two rng() calls (u1, u2).
 */
function randomNormal(mean: number, stdDev: number, rng: () => number): number {
  const u1 = rng();
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + stdDev * z0;
}

const CASH_GROWTH_RATE = 0.015; // fixed, mirrors monte-carlo.ts cash special-case

function percentile(sorted: number[], p: number): number {
  const index = Math.floor(sorted.length * p);
  return sorted[Math.min(index, sorted.length - 1)];
}

export function runRetirementSim(inputs: SimInputs): SimResult {
  const {
    currentAge,
    retirementAge,
    planThroughAge,
    startingBalance,
    monthlySavings,
    monthlySpend,
    strategy,
    strategyParams,
    ssMonthly,
    ssClaimAge,
    otherMonthly,
    otherStartAge,
    allocation,
    inflationAdjusted,
    numSimulations,
    seed,
  } = inputs;

  const horizon = planThroughAge - currentAge; // horizon+1 recorded points
  const params: StrategyParams = strategyParams ?? { inflationAdjusted: true };
  const isRulesBased = strategy === "rules_based";

  // Normalize the allocation to sum to 1 (matches blendedExpectedReturn's guard).
  const allocSum = ASSET_CLASSES.reduce((acc, cls) => acc + allocation[cls], 0);
  const allocDivisor = allocSum > 0 ? allocSum : 1;
  const targetAllocation: Record<string, number> = {};
  for (const cls of ASSET_CLASSES) {
    targetAllocation[cls] = allocation[cls] / allocDivisor;
  }

  const annualSavings = monthlySavings * 12;
  const annualSpend = monthlySpend * 12;
  const annualSs = ssMonthly * 12;
  const annualOther = otherMonthly * 12;

  // One rng shared across all paths and all draws — matches both engines.
  const rng = makeRng(seed ?? DEFAULT_SEED);

  // allPaths[run][yearIndex] = total balance at the START of that year.
  const allPaths: number[][] = [];
  let successCount = 0;

  for (let run = 0; run < numSimulations; run++) {
    // Per-class dollar balances, seeded from the normalized target allocation.
    const balanceByClass: Record<string, number> = {};
    for (const cls of ASSET_CLASSES) {
      balanceByClass[cls] = startingBalance * targetAllocation[cls];
    }

    const path: number[] = [];
    let failed = false;

    // Inflation is only accumulated across retirement years, mirroring buildBands:
    // baseWd starts at annualSpend and grows by (1+inflation) each retirement
    // year *after* the first, and cumInfl tracks that same growth.
    let baseWd = annualSpend;
    let cumInfl = 1;
    let retireValue = 0; // portfolio balance at the start of retirement
    let previousWithdrawal: number | undefined;

    for (let age = currentAge; age <= planThroughAge; age++) {
      // Record total balance at the START of this year (before any mutation),
      // exactly like buildBands pushes path[yr] before mutating.
      let total = 0;
      for (const cls of ASSET_CLASSES) total += balanceByClass[cls];
      path.push(Math.max(0, Math.round(total)));

      // ── Returns ──────────────────────────────────────────────────────────
      const returns: Record<string, number> = {};
      for (const cls of ASSET_CLASSES) {
        let r: number;
        if (cls === "cash") {
          r = CASH_GROWTH_RATE; // fixed, no random draw
        } else {
          r = randomNormal(MARKET_MODEL[cls].mean, MARKET_MODEL[cls].stdDev, rng);
        }
        returns[cls] = r;
        balanceByClass[cls] *= 1 + r;
      }

      // Draw this year's inflation (consumes rng even when unused, to keep the
      // stream aligned with the per-class draws above — mirrors both engines).
      const yearInflationRate = randomNormal(
        MARKET_MODEL.inflation.mean,
        MARKET_MODEL.inflation.stdDev,
        rng,
      );

      // Total after growth.
      let currentBalance = 0;
      for (const cls of ASSET_CLASSES) currentBalance += balanceByClass[cls];

      if (age < retirementAge) {
        // ── Accumulation ─────────────────────────────────────────────────
        // Add this year's savings, then rebalance to the target allocation.
        currentBalance += annualSavings;
        for (const cls of ASSET_CLASSES) {
          balanceByClass[cls] = currentBalance * targetAllocation[cls];
        }
        continue;
      }

      // ── Withdrawal ───────────────────────────────────────────────────────
      if (age === retirementAge) retireValue = currentBalance;

      // Grow the spend target and cumulative inflation on retirement years
      // after the first (mirrors buildBands).
      if (inflationAdjusted && age > retirementAge) {
        baseWd *= 1 + MARKET_MODEL.inflation.mean;
        cumInfl *= 1 + MARKET_MODEL.inflation.mean;
      }
      const spendNeed = baseWd;

      // Guaranteed income (nominal), grown by the same cumulative inflation.
      const ssNom = age >= ssClaimAge ? annualSs : 0;
      const otherNom = age >= otherStartAge ? annualOther : 0;
      const giBase = ssNom + otherNom;
      const gi = inflationAdjusted ? giBase * cumInfl : giBase;
      const netNeed = Math.max(0, spendNeed - gi);

      // Equity return = balance-weighted US + intl stock returns after growth.
      const usBalance = balanceByClass.usStocks;
      const intlBalance = balanceByClass.intlStocks;
      const equityTotal = usBalance + intlBalance;
      const equityReturn =
        equityTotal > 0
          ? (returns.usStocks * usBalance + returns.intlStocks * intlBalance) /
            equityTotal
          : 0;

      const currentAllocation: Record<string, number> = {};
      for (const cls of ASSET_CLASSES) currentAllocation[cls] = balanceByClass[cls];

      // The server strategies apply inflation growth internally via
      // ctx.cumulativeInflation. We already grew the spend need into this
      // year's frame (netNeed), so pass cumulativeInflation = 1 and feed the
      // already-netted, already-grown need as annualWithdrawal. For
      // constant_dollar this yields min(netNeed, balance); for the others it
      // uses netNeed as the base with cumulativeInflation neutralized.
      const ctx: WithdrawalContext = {
        currentBalance,
        initialBalance: retireValue,
        year: age - retirementAge + 1,
        annualWithdrawal: netNeed,
        cumulativeInflation: 1,
        yearInflationRate,
        equityReturn,
        currentAllocation,
        previousWithdrawal,
      };

      const result = computeWithdrawal(strategy, params, ctx);
      const withdrawalAmount = result.amount;
      previousWithdrawal = withdrawalAmount;

      if (isRulesBased && result.allocationAfterWithdrawal) {
        for (const cls of ASSET_CLASSES) {
          balanceByClass[cls] = result.allocationAfterWithdrawal[cls] ?? 0;
        }
      } else {
        // Withdraw proportionally, floor total at 0, then rebalance to target.
        if (currentBalance > 0) {
          for (const cls of ASSET_CLASSES) {
            balanceByClass[cls] -=
              (balanceByClass[cls] / currentBalance) * withdrawalAmount;
          }
        }
        currentBalance -= withdrawalAmount;
        currentBalance = Math.max(0, currentBalance);
        for (const cls of ASSET_CLASSES) {
          balanceByClass[cls] = currentBalance * targetAllocation[cls];
        }
      }

      // Recompute total, flooring each class at 0.
      let newTotal = 0;
      for (const cls of ASSET_CLASSES) {
        balanceByClass[cls] = Math.max(0, balanceByClass[cls]);
        newTotal += balanceByClass[cls];
      }

      if (newTotal <= 0 && !failed) failed = true;
    }

    allPaths.push(path);
    if (!failed) successCount++;
  }

  const successRate = successCount / numSimulations;

  // Percentiles per recorded year index (0..horizon).
  const p5: number[] = [];
  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  const p95: number[] = [];
  for (let yr = 0; yr <= horizon; yr++) {
    const vals = allPaths.map((p) => p[yr]).sort((a, b) => a - b);
    p5.push(percentile(vals, 0.05));
    p25.push(percentile(vals, 0.25));
    p50.push(percentile(vals, 0.5));
    p75.push(percentile(vals, 0.75));
    p95.push(percentile(vals, 0.95));
  }

  // First age where the median crosses <= 0.
  let medianLastsToAge: number | null = null;
  for (let yr = 0; yr <= horizon; yr++) {
    if (p50[yr] <= 0) {
      medianLastsToAge = currentAge + yr;
      break;
    }
  }

  // Final-balance distribution from the last recorded year.
  const finals = allPaths.map((p) => p[p.length - 1]);
  const mean = finals.reduce((s, v) => s + v, 0) / finals.length;
  const sortedFinals = [...finals].sort((a, b) => a - b);
  const median = sortedFinals[Math.floor(sortedFinals.length / 2)];
  const variance =
    finals.reduce((s, v) => s + (v - mean) ** 2, 0) / finals.length;
  const stdDev = Math.sqrt(variance);

  return {
    successRate,
    percentiles: { p5, p25, p50, p75, p95 },
    medianLastsToAge,
    finalBalanceDistribution: { mean, median, stdDev },
    blendedExpectedReturn: blendedExpectedReturn(allocation),
    horizonYears: horizon,
  };
}
