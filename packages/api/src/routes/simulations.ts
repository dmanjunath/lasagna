import { Hono } from "hono";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { getMonteCarloEngine, type AssetAllocation } from "../services/monte-carlo.js";
import { getBacktester } from "../services/backtester.js";

export const simulationsRouter = new Hono<AuthEnv>();
simulationsRouter.use("*", requireAuth);

// Normalize allocation to fractions summing to 1.0
// Input may be percentages (0-100) or fractions (0-1)
function normalizeAllocation(allocation: AssetAllocation): AssetAllocation {
  const total = allocation.usStocks + allocation.intlStocks + allocation.bonds + allocation.reits + allocation.cash;
  if (total === 0) {
    return { usStocks: 0.60, intlStocks: 0, bonds: 0.40, reits: 0, cash: 0 };
  }
  // Convert to fractions summing to 1.0
  return {
    usStocks: allocation.usStocks / total,
    intlStocks: allocation.intlStocks / total,
    bonds: allocation.bonds / total,
    reits: allocation.reits / total,
    cash: allocation.cash / total,
  };
}

const SIMULATION_TIMEOUT_MS = 5000;

simulationsRouter.post("/monte-carlo", async (c) => {
  const body = await c.req.json<{
    allocation: AssetAllocation;
    initialValue: number;
    annualWithdrawal: number;
    years: number;
    simulations?: number;
    includeSamplePaths?: boolean;
    numSamplePaths?: number;
  }>();

  if (!body.initialValue || body.initialValue <= 0) {
    return c.json({ error: "Portfolio value must be greater than zero" }, 400);
  }

  const engine = getMonteCarloEngine();
  const normalizedAllocation = normalizeAllocation(body.allocation);
  const numSimulations = body.simulations || 10000;

  // Run with timeout handling in batches
  const startTime = Date.now();
  let completedSimulations = 0;
  let timedOut = false;
  const BATCH_SIZE = 1000;
  let allResults: any[] = [];

  while (completedSimulations < numSimulations) {
    if (Date.now() - startTime > SIMULATION_TIMEOUT_MS) {
      timedOut = true;
      break;
    }

    const batchSize = Math.min(BATCH_SIZE, numSimulations - completedSimulations);
    const batchResult = engine.run({
      initialBalance: body.initialValue,
      annualWithdrawal: body.annualWithdrawal,
      yearsToSimulate: body.years,
      assetAllocation: normalizedAllocation,
      numSimulations: batchSize,
      includeSamplePaths: body.includeSamplePaths && completedSimulations === 0,
      numSamplePaths: body.numSamplePaths,
    });

    allResults.push(batchResult);
    completedSimulations += batchSize;
  }

  const combinedResult = combineMonteCarloResults(allResults, completedSimulations);

  if (timedOut) {
    return c.json({
      ...combinedResult,
      warning: `Simulation timed out. Results based on ${completedSimulations} of ${numSimulations} simulations.`,
    });
  }

  return c.json(combinedResult);
});

function combineMonteCarloResults(results: any[], totalSimulations: number) {
  if (results.length === 0) return { successRate: 0, percentiles: {}, histogram: [] };
  if (results.length === 1) return results[0];

  const totalSuccesses = results.reduce((sum, r) => sum + (r.successRate * (r.numSimulations || 1000)), 0);
  const successRate = totalSuccesses / totalSimulations;
  const percentiles = results[0].percentiles;

  const histogramMap = new Map<string, { count: number; status: string }>();
  for (const result of results) {
    for (const bucket of result.histogram || []) {
      const existing = histogramMap.get(bucket.bucket);
      if (existing) existing.count += bucket.count;
      else histogramMap.set(bucket.bucket, { count: bucket.count, status: bucket.status });
    }
  }
  const histogram = Array.from(histogramMap.entries()).map(([bucket, data]) => ({ bucket, ...data }));

  return { successRate, percentiles, histogram, paths: results[0].paths };
}

simulationsRouter.post("/backtest", async (c) => {
  const body = await c.req.json<{
    allocation: AssetAllocation;
    initialValue: number;
    annualWithdrawal: number;
    years: number;
  }>();

  if (!body.initialValue || body.initialValue <= 0) {
    return c.json({ error: "Portfolio value must be greater than zero" }, 400);
  }

  const backtester = getBacktester();
  const normalizedAllocation = normalizeAllocation(body.allocation);

  const result = backtester.run({
    initialBalance: body.initialValue,
    annualWithdrawal: body.annualWithdrawal,
    yearsToSimulate: body.years,
    assetAllocation: normalizedAllocation,
    strategy: "constant_dollar",
    strategyParams: { inflationAdjusted: true },
  });

  // Calculate average final value from successful periods
  const successfulPeriods = result.periods.filter(p => p.status === 'success');
  const avgFinalValue = successfulPeriods.length > 0
    ? successfulPeriods.reduce((sum, p) => sum + p.endBalance, 0) / successfulPeriods.length
    : 0;

  return c.json({
    summary: {
      totalPeriods: result.totalPeriods,
      periodsSucceeded: result.successfulPeriods,
      successRate: result.successRate,
      avgFinalValue,
    },
    periods: result.periods,
  });
});
