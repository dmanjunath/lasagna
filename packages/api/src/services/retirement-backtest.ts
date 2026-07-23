/**
 * Server-side historical backtest — the server twin of the dashboard's
 * historical mode.
 *
 * Ports, keyed off the unified `SimInputs`:
 *  - `runBacktest` from the client engine `retirement-engine.ts` (the 2-asset
 *    equity/bond historical model with accumulation + withdrawal phases), and
 *  - the cohort-envelope computation `histBands` from `retirement-v2.tsx`
 *    (percentile bands across start-year cohorts, in real / today's dollars),
 *    plus `histRate` (survival % across cohorts).
 *
 * It reuses the shared server `computeWithdrawal` (withdrawal-strategies.ts)
 * exactly the way `runRetirementSim` does. `constant_dollar` reproduces the
 * client backtest exactly; the other strategies are best-effort (see notes on
 * each phase below).
 */

import {
  SP500_RETURNS,
  BOND_RETURNS,
  CPI_INFLATION,
  LAST_HISTORICAL_YEAR,
} from "./historical-returns.js";
import { ASSET_CLASSES } from "./market-assumptions.js";
import {
  computeWithdrawal,
  type StrategyParams,
  type WithdrawalContext,
} from "./withdrawal-strategies.js";
import type { SimInputs } from "./retirement-sim.js";

export interface BacktestSummary {
  successRate: number; // 0..1 across start-years
  startYearCount: number;
  firstStartYear: number; // the first accumulation start year (e.g. 1928)
  cohortBands: {
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
  }; // real (today's) dollars, index 0 = currentAge; p5/p95 hold the 10th/90th
  horizonYears: number; // planThroughAge - currentAge
}

// Fallback returns/inflation for years outside the tables — mirrors the client
// `runBacktest` (?? 0.07 stocks, ?? 0.04 bonds, ?? 0.03 CPI). In practice the
// start-year enumeration guarantees every year is in-range, so these never fire.
const FALLBACK_STOCK = 0.07;
const FALLBACK_BOND = 0.04;
const FALLBACK_CPI = 0.03;

/**
 * equityFraction derived from the 5-class allocation, matching the dashboard's
 * `derivedEquity` / `customEquityPct`: equity = (usStocks + intlStocks + reits)
 * / total; the remainder (bonds + cash) is the "bond" sleeve of the 2-asset
 * historical model.
 */
function deriveEquityFraction(allocation: SimInputs["allocation"]): number {
  const total = ASSET_CLASSES.reduce((s, cls) => s + allocation[cls], 0);
  if (total <= 0) return 0;
  return (allocation.usStocks + allocation.intlStocks + allocation.reits) / total;
}

/**
 * Guaranteed-income schedule in first-retirement-year (real) dollars, indexed by
 * withdrawal-year (0 = first retirement year). Mirrors the dashboard's
 * `makeGiArray` (minus the dashboard-only spending "smile", which is not part of
 * SimInputs): SS applies once age ≥ ssClaimAge, other income once age ≥
 * otherStartAge. The engine grows each entry by its own CPI factor.
 */
function buildGuaranteedIncome(inputs: SimInputs, horizon: number): number[] | undefined {
  const annualSs = inputs.ssMonthly * 12;
  const annualOther = inputs.otherMonthly * 12;
  if (annualSs <= 0 && annualOther <= 0) return undefined;
  return Array.from({ length: horizon }, (_, i) => {
    const age = inputs.retirementAge + i;
    let gi = 0;
    if (annualSs > 0 && age >= inputs.ssClaimAge) gi += annualSs;
    if (annualOther > 0 && age >= inputs.otherStartAge) gi += annualOther;
    return gi;
  });
}

interface CohortRun {
  survived: boolean;
  // Aligned per-year balances in real (today's) dollars, index 0 = currentAge.
  // path[0] = startingBalance; then one entry per simulated year.
  realPath: number[];
}

/**
 * Run one start-year cohort: accumulation then withdrawal, returning survival +
 * the aligned real-dollar path (already deflated the way histBands expects).
 * Reproduces the client `runBacktest`; the withdrawal step routes through the
 * server `computeWithdrawal` exactly as `runRetirementSim` does.
 */
function runCohort(
  startYear: number,
  accumulationYears: number,
  retirementHorizon: number,
  inputs: SimInputs,
  equityFraction: number,
  annualSavings: number,
  annualWithdrawal: number,
  guaranteedIncomeByYear: number[] | undefined,
  strategy: SimInputs["strategy"],
  params: StrategyParams,
): CohortRun {
  const { inflationAdjusted } = inputs;
  let value = inputs.startingBalance;
  // realPath[0] = starting balance (accumulation years carry cumulativeInflation
  // = 1, so they are undeflated in the engine frame — matching histBands).
  const realPath: number[] = [value];

  // ── Accumulation phase ──────────────────────────────────────────────────────
  for (let i = 0; i < accumulationYears; i++) {
    const yr = startYear + i;
    const stockRet = SP500_RETURNS[yr] ?? FALLBACK_STOCK;
    const bondRet = BOND_RETURNS[yr] ?? FALLBACK_BOND;
    const blended = equityFraction * stockRet + (1 - equityFraction) * bondRet;
    value = value * (1 + blended) + annualSavings;
    realPath.push(Math.round(value)); // cumulativeInflation = 1 in accumulation
  }

  // ── Withdrawal phase ────────────────────────────────────────────────────────
  const retireStartYear = startYear + accumulationYears;
  const retireValue = value;
  let cumulativeInflation = 1;
  let baseWithdrawal = annualWithdrawal;
  let previousWithdrawal: number | undefined;
  let prevBlended = 0;
  let survived = true;

  for (let i = 0; i < retirementHorizon; i++) {
    const yr = retireStartYear + i;
    const stockRet = SP500_RETURNS[yr] ?? FALLBACK_STOCK;
    const bondRet = BOND_RETURNS[yr] ?? FALLBACK_BOND;
    const blended = equityFraction * stockRet + (1 - equityFraction) * bondRet;
    const yearInflation = CPI_INFLATION[yr] ?? FALLBACK_CPI;
    if (i > 0) {
      cumulativeInflation *= 1 + yearInflation;
      if (inflationAdjusted) baseWithdrawal *= 1 + yearInflation;
    }

    // Guaranteed-income netting — identical to the client backtest and to
    // runRetirementSim: net portfolio need = max(0, spend need − guaranteed
    // income), both grown into this year's nominal frame.
    const giBase = guaranteedIncomeByYear?.[i] ?? 0;
    const gi = inflationAdjusted ? giBase * cumulativeInflation : giBase;
    const netBase = gi > 0 ? Math.max(0, baseWithdrawal - gi) : baseWithdrawal;

    // Route through the shared server strategy. As in runRetirementSim, we have
    // already grown netBase into this year's frame, so pass cumulativeInflation
    // = 1 and feed the netted, grown need as annualWithdrawal. For
    // constant_dollar this yields min(netBase, value) — exactly the client
    // model, which never withdraws more than the balance before the depletion
    // check. The other strategies are best-effort (they read currentBalance /
    // previousWithdrawal / equityReturn from this same 2-asset frame).
    const ctx: WithdrawalContext = {
      currentBalance: value,
      initialBalance: retireValue,
      year: i + 1,
      annualWithdrawal: netBase,
      cumulativeInflation: 1,
      yearInflationRate: i > 0 && inflationAdjusted ? yearInflation : 0,
      equityReturn: prevBlended,
      currentAllocation: {},
      previousWithdrawal,
    };
    const withdrawal = computeWithdrawal(strategy, params, ctx).amount;
    previousWithdrawal = withdrawal;
    prevBlended = blended;

    value = (value - withdrawal) * (1 + blended);

    // Deflate this withdrawal year's end balance to the engine's real frame
    // (÷ cumulativeInflation), matching histBands' path construction.
    realPath.push(Math.round(Math.max(0, value) / cumulativeInflation));

    if (value <= 0) {
      survived = false;
      break;
    }
  }

  return { survived, realPath };
}

export function runRetirementBacktest(inputs: SimInputs): BacktestSummary {
  const { currentAge, retirementAge, planThroughAge } = inputs;

  const accumulationYears = Math.max(0, retirementAge - currentAge);
  // retirementHorizon mirrors the client: lifeHorizon = max(1, lifeExp - retire).
  const retirementHorizon = Math.max(1, planThroughAge - retirementAge);
  const horizonYears = planThroughAge - currentAge;

  const equityFraction = deriveEquityFraction(inputs.allocation);
  const annualSavings = inputs.monthlySavings * 12;
  const annualWithdrawal = inputs.monthlySpend * 12;
  const guaranteedIncomeByYear = buildGuaranteedIncome(inputs, retirementHorizon);
  const strategy = inputs.strategy;
  const params: StrategyParams = inputs.strategyParams ?? { inflationAdjusted: true };

  // Enumerate every start-year whose full accumulation+withdrawal window fits in
  // the tables: 1928 .. LAST_HISTORICAL_YEAR − (accYears + horizon). Mirrors the
  // client's `maxStart = 2024 - (accYears + lifeHorizon)`.
  const firstStartYear = 1928;
  const maxStartYear = LAST_HISTORICAL_YEAR - (accumulationYears + retirementHorizon);

  const cohorts: CohortRun[] = [];
  for (let yr = firstStartYear; yr <= maxStartYear; yr++) {
    cohorts.push(
      runCohort(
        yr,
        accumulationYears,
        retirementHorizon,
        inputs,
        equityFraction,
        annualSavings,
        annualWithdrawal,
        guaranteedIncomeByYear,
        strategy,
        params,
      ),
    );
  }

  const startYearCount = cohorts.length;
  const survivors = cohorts.filter((c) => c.survived).length;
  const successRate = startYearCount > 0 ? survivors / startYearCount : 0;

  // ── Cohort envelope (histBands) ─────────────────────────────────────────────
  // Aligned length: one point per age from currentAge..planThroughAge inclusive
  // (matches the client's L = max(2, lifeExp - currentAge + 1)).
  const L = Math.max(2, horizonYears + 1);

  const paths = cohorts.map((c) => {
    // realPath is already in the engine's real frame (accumulation years at
    // cumulativeInflation = 1, withdrawal years ÷ their cumulative CPI) — the
    // client histBands does NOT apply an extra flat deflator. Just pad depleted
    // cohorts at $0 out to length L.
    const path = c.realPath.slice();
    while (path.length < L) path.push(0);
    return path.slice(0, L);
  });

  const q = (vals: number[], pct: number) => vals[Math.floor((pct / 100) * (vals.length - 1))];
  const cohortBands = {
    p5: [] as number[],
    p25: [] as number[],
    p50: [] as number[],
    p75: [] as number[],
    p95: [] as number[],
  };
  for (let i = 0; i < L; i++) {
    const vals = paths.map((p) => p[i]).sort((a, b) => a - b);
    cohortBands.p5.push(q(vals, 10)); // outer band = 10th–90th across cohorts
    cohortBands.p25.push(q(vals, 25));
    cohortBands.p50.push(q(vals, 50));
    cohortBands.p75.push(q(vals, 75));
    cohortBands.p95.push(q(vals, 90));
  }

  return {
    successRate,
    startYearCount,
    firstStartYear,
    cohortBands,
    horizonYears,
  };
}
