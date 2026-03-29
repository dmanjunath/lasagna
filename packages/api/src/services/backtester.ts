import { getHistoricalDataService, type Allocation } from "./historical-data.js";

export interface BacktestParams {
  initialBalance: number;
  withdrawalRate: number;
  yearsToSimulate: number;
  assetAllocation: Allocation;
  inflationAdjusted: boolean;
  startYearRange?: { from: number; to: number };
}

export interface BacktestPeriod {
  startYear: number;
  endBalance: number;
  yearsLasted: number;
  status: "success" | "failed" | "close";
  worstDrawdown: number;
  worstYear: number;
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
    const fromYear = params.startYearRange?.from ?? startYear;
    const toYear = params.startYearRange?.to ?? endYear - params.yearsToSimulate;

    const periods: BacktestPeriod[] = [];

    for (let year = fromYear; year <= toYear; year++) {
      const period = this.simulatePeriod(params, year);
      periods.push(period);
    }

    const successfulPeriods = periods.filter((p) => p.status === "success").length;

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
    let worstYear = startYear;
    let yearsLasted = 0;

    for (let year = 0; year < params.yearsToSimulate; year++) {
      const currentYear = startYear + year;

      // Get portfolio return using prorated allocation
      const portfolioReturn = this.historicalData.calculatePortfolioReturn(
        params.assetAllocation,
        currentYear
      );

      if (portfolioReturn === null) {
        break;
      }

      balance = balance * (1 + portfolioReturn);

      // Track drawdown
      if (balance > peakBalance) {
        peakBalance = balance;
      }
      const currentDrawdown = (peakBalance - balance) / peakBalance;
      if (currentDrawdown > worstDrawdown) {
        worstDrawdown = currentDrawdown;
        worstYear = currentYear;
      }

      // Withdraw
      balance -= annualWithdrawal;
      yearsLasted++;

      if (balance <= 0) {
        break;
      }
    }

    let status: "success" | "failed" | "close";
    if (yearsLasted >= params.yearsToSimulate && balance > 0) {
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
      worstYear,
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
