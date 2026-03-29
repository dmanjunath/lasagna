/**
 * Monte Carlo simulation engine for retirement planning.
 * Simulates portfolio performance over time with stochastic returns.
 */

export interface AssetAllocation {
  usStocks: number;
  intlStocks: number;
  bonds: number;
  reits: number;
  cash: number;
}

export interface MonteCarloParams {
  initialBalance: number;
  withdrawalRate: number; // Annual withdrawal as percentage of initial balance
  yearsToSimulate: number;
  assetAllocation: AssetAllocation;
  inflationAdjusted: boolean;
  numSimulations: number;
  includeSamplePaths?: boolean; // Whether to include sample paths for spaghetti chart
  numSamplePaths?: number; // Number of sample paths to include (default: 10)
}

export interface HistogramBucket {
  bucket: number; // Final balance bucket value (e.g., 0, 500000, 1000000, etc.)
  count: number; // Number of simulations in this bucket
  status: 'success' | 'close' | 'failure'; // Classification based on success criteria
}

export interface MonteCarloResult {
  successRate: number; // Percentage of simulations where portfolio didn't run out
  percentiles: {
    p5: number[]; // 5th percentile balance over time
    p25: number[]; // 25th percentile balance over time
    p50: number[]; // Median balance over time
    p75: number[]; // 75th percentile balance over time
    p95: number[]; // 95th percentile balance over time
  };
  finalBalanceDistribution: {
    mean: number;
    median: number;
    stdDev: number;
  };
  failureStats: {
    avgYearsUntilFailure: number | null; // Null if no failures
    medianYearsUntilFailure: number | null;
  };
  histogram: HistogramBucket[]; // Distribution of final balances in buckets
  samplePaths?: number[][]; // Optional sample paths for spaghetti visualization
}

// Historical market data-based models (simplified)
const MODEL = {
  usStocks: { mean: 0.10, stdDev: 0.18 }, // 10% avg return, 18% volatility
  intlStocks: { mean: 0.08, stdDev: 0.20 }, // 8% avg return, 20% volatility
  bonds: { mean: 0.05, stdDev: 0.07 }, // 5% avg return, 7% volatility
  reits: { mean: 0.09, stdDev: 0.22 }, // 9% avg return, 22% volatility
  cash: { mean: 0.02, stdDev: 0.01 }, // 2% avg return, 1% volatility
  inflation: { mean: 0.03, stdDev: 0.01 }, // 3% avg inflation, 1% volatility
};

export class MonteCarloEngine {
  /**
   * Run Monte Carlo simulation with given parameters
   */
  run(params: MonteCarloParams): MonteCarloResult {
    const simulations: number[][] = [];
    const failureYears: number[] = [];
    let successCount = 0;

    // Run all simulations
    for (let i = 0; i < params.numSimulations; i++) {
      const simulation = this.runSingleSimulation(params);
      simulations.push(simulation);

      // Check if simulation succeeded (balance never went to zero)
      const failed = simulation.some((balance) => balance <= 0);
      if (!failed) {
        successCount++;
      } else {
        // Find year of failure
        const failureYear = simulation.findIndex((balance) => balance <= 0);
        if (failureYear !== -1) {
          failureYears.push(failureYear);
        }
      }
    }

    // Calculate success rate
    const successRate = successCount / params.numSimulations;

    // Calculate percentiles for each year
    const percentiles = this.calculatePercentiles(
      simulations,
      params.yearsToSimulate
    );

    // Calculate final balance distribution
    const finalBalances = simulations.map((sim) => sim[sim.length - 1]);
    const distribution = this.calculateDistribution(finalBalances);

    // Calculate failure statistics
    const failureStats = this.calculateFailureStats(failureYears);

    // Calculate histogram
    const histogram = this.calculateHistogram(
      finalBalances,
      params.initialBalance
    );

    // Get sample paths if requested
    let samplePaths: number[][] | undefined;
    if (params.includeSamplePaths) {
      const numPaths = params.numSamplePaths || 10;
      samplePaths = this.selectSamplePaths(simulations, numPaths);
    }

    return {
      successRate,
      percentiles,
      finalBalanceDistribution: distribution,
      failureStats,
      histogram,
      samplePaths,
    };
  }

  /**
   * Run a single simulation path
   */
  private runSingleSimulation(params: MonteCarloParams): number[] {
    const balances: number[] = [params.initialBalance];
    let currentBalance = params.initialBalance;
    const annualWithdrawal = params.initialBalance * params.withdrawalRate;

    for (let year = 1; year <= params.yearsToSimulate; year++) {
      // Generate random returns for each asset class
      const usStocksReturn = this.randomNormal(
        MODEL.usStocks.mean,
        MODEL.usStocks.stdDev
      );
      const intlStocksReturn = this.randomNormal(
        MODEL.intlStocks.mean,
        MODEL.intlStocks.stdDev
      );
      const bondsReturn = this.randomNormal(MODEL.bonds.mean, MODEL.bonds.stdDev);
      const reitsReturn = this.randomNormal(MODEL.reits.mean, MODEL.reits.stdDev);
      const cashReturn = this.randomNormal(MODEL.cash.mean, MODEL.cash.stdDev);

      // Calculate weighted portfolio return
      const portfolioReturn =
        usStocksReturn * params.assetAllocation.usStocks +
        intlStocksReturn * params.assetAllocation.intlStocks +
        bondsReturn * params.assetAllocation.bonds +
        reitsReturn * params.assetAllocation.reits +
        cashReturn * params.assetAllocation.cash;

      // Apply return to current balance
      currentBalance *= 1 + portfolioReturn;

      // Calculate withdrawal amount (adjusted for inflation if needed)
      let withdrawal = annualWithdrawal;
      if (params.inflationAdjusted) {
        const inflation = this.randomNormal(
          MODEL.inflation.mean,
          MODEL.inflation.stdDev
        );
        // Compound inflation over years
        withdrawal = annualWithdrawal * Math.pow(1 + inflation, year);
      }

      // Subtract withdrawal
      currentBalance -= withdrawal;

      // Ensure balance doesn't go negative
      currentBalance = Math.max(0, currentBalance);

      balances.push(currentBalance);
    }

    return balances;
  }

  /**
   * Generate random number from normal distribution using Box-Muller transform
   */
  private randomNormal(mean: number, stdDev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stdDev * z0;
  }

  /**
   * Calculate percentiles across all simulations for each year
   */
  private calculatePercentiles(
    simulations: number[][],
    years: number
  ): MonteCarloResult["percentiles"] {
    const p5: number[] = [];
    const p25: number[] = [];
    const p50: number[] = [];
    const p75: number[] = [];
    const p95: number[] = [];

    for (let year = 0; year <= years; year++) {
      const balancesAtYear = simulations
        .map((sim) => sim[year])
        .sort((a, b) => a - b);

      p5.push(this.percentile(balancesAtYear, 0.05));
      p25.push(this.percentile(balancesAtYear, 0.25));
      p50.push(this.percentile(balancesAtYear, 0.5));
      p75.push(this.percentile(balancesAtYear, 0.75));
      p95.push(this.percentile(balancesAtYear, 0.95));
    }

    return { p5, p25, p50, p75, p95 };
  }

  /**
   * Calculate percentile value from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    const index = Math.floor(sorted.length * p);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  /**
   * Calculate distribution statistics
   */
  private calculateDistribution(
    values: number[]
  ): MonteCarloResult["finalBalanceDistribution"] {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];

    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);

    return { mean, median, stdDev };
  }

  /**
   * Calculate failure statistics
   */
  private calculateFailureStats(
    failureYears: number[]
  ): MonteCarloResult["failureStats"] {
    if (failureYears.length === 0) {
      return {
        avgYearsUntilFailure: null,
        medianYearsUntilFailure: null,
      };
    }

    const sorted = [...failureYears].sort((a, b) => a - b);
    const avg =
      failureYears.reduce((sum, year) => sum + year, 0) / failureYears.length;
    const median = sorted[Math.floor(sorted.length / 2)];

    return {
      avgYearsUntilFailure: avg,
      medianYearsUntilFailure: median,
    };
  }

  /**
   * Calculate histogram buckets from final balances
   */
  private calculateHistogram(
    finalBalances: number[],
    initialBalance: number
  ): HistogramBucket[] {
    // Determine bucket size based on initial balance (e.g., 10% of initial balance)
    const bucketSize = Math.ceil(initialBalance * 0.1);

    // Find max balance to determine number of buckets
    const maxBalance = Math.max(...finalBalances);
    const numBuckets = Math.ceil(maxBalance / bucketSize) + 1;

    // Initialize buckets
    const buckets: Map<number, number> = new Map();
    for (let i = 0; i <= numBuckets; i++) {
      buckets.set(i * bucketSize, 0);
    }

    // Count simulations in each bucket
    for (const balance of finalBalances) {
      const bucketIndex = Math.floor(balance / bucketSize);
      const bucketValue = bucketIndex * bucketSize;
      buckets.set(bucketValue, (buckets.get(bucketValue) || 0) + 1);
    }

    // Convert to array and classify status
    const histogram: HistogramBucket[] = [];
    for (const [bucket, count] of buckets) {
      if (count === 0) continue; // Skip empty buckets

      let status: 'success' | 'close' | 'failure';
      if (bucket === 0) {
        status = 'failure';
      } else if (bucket < initialBalance * 0.5) {
        status = 'close';
      } else {
        status = 'success';
      }

      histogram.push({ bucket, count, status });
    }

    return histogram.sort((a, b) => a.bucket - b.bucket);
  }

  /**
   * Select sample paths for spaghetti visualization
   */
  private selectSamplePaths(
    simulations: number[][],
    numPaths: number
  ): number[][] {
    // Select evenly spaced simulations to get a representative sample
    const step = Math.max(1, Math.floor(simulations.length / numPaths));
    const paths: number[][] = [];

    for (let i = 0; i < numPaths && i * step < simulations.length; i++) {
      paths.push(simulations[i * step]);
    }

    return paths;
  }
}

// Singleton instance
let monteCarloEngineInstance: MonteCarloEngine | null = null;

export function getMonteCarloEngine(): MonteCarloEngine {
  if (!monteCarloEngineInstance) {
    monteCarloEngineInstance = new MonteCarloEngine();
  }
  return monteCarloEngineInstance;
}
