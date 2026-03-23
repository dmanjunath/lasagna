/**
 * Monte Carlo simulation engine for retirement planning.
 * Simulates portfolio performance over time with stochastic returns.
 */

export interface MonteCarloParams {
  initialBalance: number;
  withdrawalRate: number; // Annual withdrawal as percentage of initial balance
  yearsToSimulate: number;
  assetAllocation: {
    stocks: number;
    bonds: number;
    cash: number;
  };
  inflationAdjusted: boolean;
  numSimulations: number;
}

export interface MonteCarloResult {
  successRate: number; // Percentage of simulations where portfolio didn't run out
  percentiles: {
    p5: number[]; // 5th percentile balance over time
    p50: number[]; // Median balance over time
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
}

// Historical market data-based models (simplified)
const MODEL = {
  stocks: { mean: 0.10, stdDev: 0.18 }, // 10% avg return, 18% volatility
  bonds: { mean: 0.05, stdDev: 0.07 }, // 5% avg return, 7% volatility
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

    return {
      successRate,
      percentiles,
      finalBalanceDistribution: distribution,
      failureStats,
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
      const stockReturn = this.randomNormal(
        MODEL.stocks.mean,
        MODEL.stocks.stdDev
      );
      const bondReturn = this.randomNormal(MODEL.bonds.mean, MODEL.bonds.stdDev);
      const cashReturn = this.randomNormal(MODEL.cash.mean, MODEL.cash.stdDev);

      // Calculate weighted portfolio return
      const portfolioReturn =
        stockReturn * params.assetAllocation.stocks +
        bondReturn * params.assetAllocation.bonds +
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
    const p50: number[] = [];
    const p95: number[] = [];

    for (let year = 0; year <= years; year++) {
      const balancesAtYear = simulations
        .map((sim) => sim[year])
        .sort((a, b) => a - b);

      p5.push(this.percentile(balancesAtYear, 0.05));
      p50.push(this.percentile(balancesAtYear, 0.5));
      p95.push(this.percentile(balancesAtYear, 0.95));
    }

    return { p5, p50, p95 };
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
}

// Singleton instance
let monteCarloEngineInstance: MonteCarloEngine | null = null;

export function getMonteCarloEngine(): MonteCarloEngine {
  if (!monteCarloEngineInstance) {
    monteCarloEngineInstance = new MonteCarloEngine();
  }
  return monteCarloEngineInstance;
}
