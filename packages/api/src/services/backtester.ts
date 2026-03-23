import { getHistoricalDataService } from "./historical-data.js";

const BOND_RETURN = 0.05;

export interface BacktestParams {
  initialBalance: number;
  withdrawalRate: number;
  yearsToSimulate: number;
  assetAllocation: { stocks: number; bonds: number };
  inflationAdjusted: boolean;
  startYearRange?: { from: number; to: number };
}

export interface BacktestPeriod {
  startYear: number;
  endBalance: number;
  yearsLasted: number;
  status: "success" | "failed" | "close";
  worstDrawdown: number;
  bestYear: { year: number; return: number };
}

export interface BacktestResult {
  totalPeriods: number;
  successfulPeriods: number;
  successRate: number;
  periods: BacktestPeriod[];
}

export class Backtester {
  private historicalData = getHistoricalDataService();

  run(params: BacktestParams): BacktestResult {
    const { startYear, endYear } = this.historicalData.getAvailableYearRange();

    // Determine the range of starting years
    const fromYear = params.startYearRange?.from ?? startYear;
    const toYear = params.startYearRange?.to ?? endYear - params.yearsToSimulate;

    const periods: BacktestPeriod[] = [];

    for (let year = fromYear; year <= toYear; year++) {
      const period = this.simulatePeriod(params, year);
      periods.push(period);
    }

    const successfulPeriods = periods.filter(p => p.status === "success").length;

    return {
      totalPeriods: periods.length,
      successfulPeriods,
      successRate: periods.length > 0 ? successfulPeriods / periods.length : 0,
      periods,
    };
  }

  private simulatePeriod(params: BacktestParams, startYear: number): BacktestPeriod {
    let balance = params.initialBalance;
    const annualWithdrawal = params.initialBalance * params.withdrawalRate;
    let peakBalance = balance;
    let worstDrawdown = 0;
    let bestYearReturn = -Infinity;
    let bestYear = { year: startYear, return: 0 };

    let yearsLasted = 0;

    for (let year = 0; year < params.yearsToSimulate; year++) {
      const currentYear = startYear + year;

      // Get historical stock return for this year
      const stockReturn = this.historicalData.getReturnForYear(currentYear);

      // If we don't have data for this year, stop simulation
      if (stockReturn === null) {
        break;
      }

      // Calculate portfolio return based on allocation
      const portfolioReturn =
        params.assetAllocation.stocks * stockReturn +
        params.assetAllocation.bonds * BOND_RETURN;

      // Apply return to balance
      balance = balance * (1 + portfolioReturn);

      // Track best year
      if (portfolioReturn > bestYearReturn) {
        bestYearReturn = portfolioReturn;
        bestYear = { year: currentYear, return: portfolioReturn };
      }

      // Withdraw after growth
      balance -= annualWithdrawal;

      // Track drawdown
      if (balance > peakBalance) {
        peakBalance = balance;
      }
      const currentDrawdown = (peakBalance - balance) / peakBalance;
      if (currentDrawdown > worstDrawdown) {
        worstDrawdown = currentDrawdown;
      }

      yearsLasted++;

      // Check if portfolio is depleted
      if (balance <= 0) {
        break;
      }
    }

    // Determine status
    let status: "success" | "failed" | "close";
    if (yearsLasted >= params.yearsToSimulate) {
      status = "success";
    } else if (yearsLasted >= params.yearsToSimulate * 0.9) {
      status = "close";
    } else {
      status = "failed";
    }

    return {
      startYear,
      endBalance: Math.max(0, balance),
      yearsLasted,
      status,
      worstDrawdown,
      bestYear,
    };
  }
}

let instance: Backtester | null = null;

export function getBacktester(): Backtester {
  if (!instance) {
    instance = new Backtester();
  }
  return instance;
}
