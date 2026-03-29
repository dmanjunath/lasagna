import { Hono } from "hono";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { getMonteCarloEngine, type AssetAllocation } from "../services/monte-carlo.js";
import { getBacktester } from "../services/backtester.js";

export const simulationsRouter = new Hono<AuthEnv>();
simulationsRouter.use("*", requireAuth);

// Normalize allocation to sum to 100%
function normalizeAllocation(allocation: AssetAllocation): AssetAllocation {
  const total = allocation.usStocks + allocation.intlStocks + allocation.bonds + allocation.reits + allocation.cash;
  if (total === 0) {
    return { usStocks: 60, intlStocks: 0, bonds: 40, reits: 0, cash: 0 };
  }
  if (Math.abs(total - 100) < 0.01) {
    return allocation;
  }
  const scale = 100 / total;
  return {
    usStocks: allocation.usStocks * scale,
    intlStocks: allocation.intlStocks * scale,
    bonds: allocation.bonds * scale,
    reits: allocation.reits * scale,
    cash: allocation.cash * scale,
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

  const engine = getMonteCarloEngine();
  const withdrawalRate = body.annualWithdrawal / body.initialValue;
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
      withdrawalRate,
      yearsToSimulate: body.years,
      assetAllocation: normalizedAllocation,
      inflationAdjusted: true,
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

  const backtester = getBacktester();
  const withdrawalRate = body.annualWithdrawal / body.initialValue;
  const normalizedAllocation = normalizeAllocation(body.allocation);

  const result = backtester.run({
    initialBalance: body.initialValue,
    withdrawalRate,
    yearsToSimulate: body.years,
    assetAllocation: normalizedAllocation,
    inflationAdjusted: true,
  });

  return c.json({
    summary: {
      periodsRun: result.totalPeriods,
      periodsSucceeded: result.successfulPeriods,
      successRate: result.successRate,
    },
    periods: result.periods,
  });
});
