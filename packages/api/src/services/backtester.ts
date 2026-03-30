import { getHistoricalDataService, type Allocation } from "./historical-data.js";
import { computeWithdrawal, type StrategyType, type StrategyParams } from "./withdrawal-strategies.js";

export interface BacktestParams {
  initialBalance: number;
  annualWithdrawal: number;
  yearsToSimulate: number;
  assetAllocation: Allocation;
  strategy?: StrategyType;
  strategyParams?: StrategyParams;
  startYearRange?: { from: number; to: number };
}

export interface YearDetail {
  year: number;
  portfolioValue: number;
  portfolioValueReal: number;
  marketReturn: number;
  withdrawalAmount: number;
  withdrawalAmountReal: number;
  cumulativeInflation: number;
  withdrawalSource?: string;
  notes: string[];
}

export interface BacktestPeriod {
  startYear: number;
  endBalance: number;
  yearsLasted: number;
  status: "success" | "failed" | "close";
  worstDrawdown: number;
  worstYear: number;
  yearByYear: YearDetail[];
}

export interface BacktestResult {
  totalPeriods: number;
  successfulPeriods: number;
  successRate: number;
  periods: BacktestPeriod[];
}

const ASSET_CLASSES = ["usStocks", "intlStocks", "bonds", "reits", "cash"] as const;
type AssetClass = (typeof ASSET_CLASSES)[number];

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
    const strategy: StrategyType = params.strategy ?? "constant_dollar";
    const strategyParams: StrategyParams = params.strategyParams ?? { inflationAdjusted: true };

    // Initialize per-class dollar balances
    const proratedInitial = this.historicalData.prorateAllocation(params.assetAllocation, startYear);
    const balances: Record<AssetClass, number> = {
      usStocks: params.initialBalance * proratedInitial.usStocks,
      intlStocks: params.initialBalance * proratedInitial.intlStocks,
      bonds: params.initialBalance * proratedInitial.bonds,
      reits: params.initialBalance * proratedInitial.reits,
      cash: params.initialBalance * proratedInitial.cash,
    };

    let peakBalance = params.initialBalance;
    let worstDrawdown = 0;
    let worstYear = startYear;
    let yearsLasted = 0;
    let cumulativeInflation = 1.0;
    let previousWithdrawal: number | undefined;

    const yearByYear: YearDetail[] = [];

    for (let year = 0; year < params.yearsToSimulate; year++) {
      const currentYear = startYear + year;

      const returns = this.historicalData.getReturnsForYear(currentYear);
      if (!returns) {
        break;
      }

      // Prorate allocation for this year (handles missing intl/reits data)
      const proratedAlloc = this.historicalData.prorateAllocation(params.assetAllocation, currentYear);

      // Apply per-class returns
      const usReturn = returns.usStocks;
      const intlReturn = returns.intlStocks ?? 0;
      const bondsReturn = returns.bonds;
      const reitsReturn = returns.reits ?? 0;
      const cashReturn = returns.cash;

      balances.usStocks *= (1 + usReturn);
      balances.intlStocks *= (1 + intlReturn);
      balances.bonds *= (1 + bondsReturn);
      balances.reits *= (1 + reitsReturn);
      balances.cash *= (1 + cashReturn);

      const totalBalance = ASSET_CLASSES.reduce((s, k) => s + balances[k], 0);

      // Compute weighted portfolio return
      const prevTotal = totalBalance / (1 + this.weightedReturn(balances, {
        usStocks: usReturn, intlStocks: intlReturn, bonds: bondsReturn, reits: reitsReturn, cash: cashReturn,
      }));
      const marketReturn = prevTotal > 0 ? (totalBalance - prevTotal) / prevTotal : 0;

      // Compute equity return (weighted avg of US + intl stock returns by their pre-return balances)
      const preUs = balances.usStocks / (1 + usReturn);
      const preIntl = balances.intlStocks / (1 + intlReturn);
      const equityTotal = preUs + preIntl;
      const equityReturn = equityTotal > 0
        ? (preUs * usReturn + preIntl * intlReturn) / equityTotal
        : usReturn;

      // Track drawdown
      if (totalBalance > peakBalance) {
        peakBalance = totalBalance;
      }
      const currentDrawdown = (peakBalance - totalBalance) / peakBalance;
      if (currentDrawdown > worstDrawdown) {
        worstDrawdown = currentDrawdown;
        worstYear = currentYear;
      }

      // Build current allocation as dollar amounts for withdrawal context
      const currentAllocation: Record<string, number> = {};
      for (const k of ASSET_CLASSES) {
        currentAllocation[k] = balances[k];
      }

      // Compute withdrawal BEFORE updating cumulative inflation
      // so year 1 uses cumulativeInflation=1.0 (base withdrawal, no adjustment)
      const withdrawalResult = computeWithdrawal(strategy, strategyParams, {
        currentBalance: totalBalance,
        initialBalance: params.initialBalance,
        year: year + 1,
        annualWithdrawal: params.annualWithdrawal,
        cumulativeInflation,
        yearInflationRate: returns.inflation,
        equityReturn,
        currentAllocation,
        previousWithdrawal,
      });

      // Update cumulative inflation AFTER withdrawal (affects next year)
      cumulativeInflation *= (1 + returns.inflation);

      const withdrawalAmount = withdrawalResult.amount;
      previousWithdrawal = withdrawalAmount;

      // Apply withdrawal to balances
      if (strategy === "rules_based" && withdrawalResult.allocationAfterWithdrawal) {
        // Rules-based: use the allocation returned by the strategy (no rebalance)
        for (const k of ASSET_CLASSES) {
          balances[k] = withdrawalResult.allocationAfterWithdrawal[k] ?? 0;
        }
      } else {
        // Other strategies: subtract proportionally, then rebalance to target
        const balanceAfterWithdrawal = totalBalance - withdrawalAmount;
        if (balanceAfterWithdrawal > 0) {
          for (const k of ASSET_CLASSES) {
            balances[k] = balanceAfterWithdrawal * proratedAlloc[k];
          }
        } else {
          for (const k of ASSET_CLASSES) {
            balances[k] = 0;
          }
        }
      }

      const postWithdrawalBalance = ASSET_CLASSES.reduce((s, k) => s + balances[k], 0);

      yearsLasted++;

      yearByYear.push({
        year: currentYear,
        portfolioValue: postWithdrawalBalance,
        portfolioValueReal: postWithdrawalBalance / cumulativeInflation,
        marketReturn,
        withdrawalAmount,
        withdrawalAmountReal: withdrawalAmount / cumulativeInflation,
        cumulativeInflation,
        withdrawalSource: withdrawalResult.source,
        notes: withdrawalResult.notes,
      });

      if (postWithdrawalBalance <= 0) {
        break;
      }
    }

    const finalBalance = ASSET_CLASSES.reduce((s, k) => s + balances[k], 0);

    let status: "success" | "failed" | "close";
    if (yearsLasted >= params.yearsToSimulate && finalBalance > 0) {
      // Survived the full period — but barely if final balance < 50% of starting
      status = finalBalance < params.initialBalance * 0.5 ? "close" : "success";
    } else {
      status = "failed";
    }

    return {
      startYear,
      endBalance: Math.max(0, finalBalance),
      yearsLasted,
      status,
      worstDrawdown,
      worstYear,
      yearByYear,
    };
  }

  /**
   * Compute the weighted return given current (post-return) balances and per-class returns.
   * Used to back-derive the pre-return total for market return calculation.
   */
  private weightedReturn(
    postBalances: Record<AssetClass, number>,
    returns: Record<AssetClass, number>
  ): number {
    let preTotal = 0;
    let growth = 0;
    for (const k of ASSET_CLASSES) {
      const pre = postBalances[k] / (1 + returns[k]);
      preTotal += pre;
      growth += pre * returns[k];
    }
    return preTotal > 0 ? growth / preTotal : 0;
  }
}

let instance: Backtester | null = null;

export function getBacktester(): Backtester {
  if (!instance) {
    instance = new Backtester();
  }
  return instance;
}
