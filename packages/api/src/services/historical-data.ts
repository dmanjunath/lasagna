import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface YearlyReturns {
  year: number;
  usStocks: number;
  bonds: number;
  cash: number;
  intlStocks: number | null;
  reits: number | null;
  inflation: number;
}

export interface Allocation {
  usStocks: number;
  intlStocks: number;
  bonds: number;
  reits: number;
  cash: number;
}

export interface HistoricalDataset {
  source: string;
  url: string;
  updatedAt: string;
  startYear: number;
  endYear: number;
  data: YearlyReturns[];
}

// Legacy interfaces for backward compatibility
export interface YearlyData {
  year: number;
  realPrice: number;
  realDividend: number;
  realEarnings: number;
  cpi: number;
  realTotalReturn: number;
}

export interface ReturnStatistics {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
}

export class HistoricalDataService {
  private dataset: HistoricalDataset;
  private legacyDataset?: {
    source: string;
    url: string;
    updatedAt: string;
    startYear: number;
    endYear: number;
    data: YearlyData[];
  };

  constructor() {
    const dataPath = join(__dirname, "../../data/historical-returns.json");
    const rawData = readFileSync(dataPath, "utf-8");
    this.dataset = JSON.parse(rawData);
  }

  getAvailableYearRange(): { startYear: number; endYear: number } {
    return {
      startYear: this.dataset.startYear,
      endYear: this.dataset.endYear,
    };
  }

  getReturnsForYear(year: number): YearlyReturns | null {
    return this.dataset.data.find((d) => d.year === year) ?? null;
  }

  getReturnForYear(year: number): number | null {
    const data = this.getReturnsForYear(year);
    return data ? data.usStocks : null;
  }

  /**
   * Prorate allocation when some asset classes have no data for a given year.
   * Redistributes missing allocations proportionally to available asset classes.
   */
  prorateAllocation(allocation: Allocation, year: number): Allocation {
    const returns = this.getReturnsForYear(year);
    if (!returns) return allocation;

    const hasIntl = returns.intlStocks !== null;
    const hasReits = returns.reits !== null;

    if (hasIntl && hasReits) {
      return allocation;
    }

    // Calculate how much to redistribute
    let toRedistribute = 0;
    if (!hasIntl) toRedistribute += allocation.intlStocks;
    if (!hasReits) toRedistribute += allocation.reits;

    // Calculate available allocation (assets with data)
    const availableAllocation =
      allocation.usStocks +
      allocation.bonds +
      allocation.cash +
      (hasIntl ? allocation.intlStocks : 0) +
      (hasReits ? allocation.reits : 0);

    if (availableAllocation === 0) {
      // Edge case: all available allocations are zero
      return {
        usStocks: 1,
        intlStocks: 0,
        bonds: 0,
        reits: 0,
        cash: 0,
      };
    }

    // Redistribute proportionally
    const result: Allocation = {
      usStocks: allocation.usStocks + (allocation.usStocks / availableAllocation) * toRedistribute,
      intlStocks: hasIntl ? allocation.intlStocks : 0,
      bonds: allocation.bonds + (allocation.bonds / availableAllocation) * toRedistribute,
      reits: hasReits ? allocation.reits : 0,
      cash: allocation.cash + (allocation.cash / availableAllocation) * toRedistribute,
    };

    return result;
  }

  calculatePortfolioReturn(allocation: Allocation, year: number): number | null {
    const returns = this.getReturnsForYear(year);
    if (!returns) return null;

    const proratedAlloc = this.prorateAllocation(allocation, year);

    return (
      proratedAlloc.usStocks * returns.usStocks +
      proratedAlloc.intlStocks * (returns.intlStocks ?? 0) +
      proratedAlloc.bonds * returns.bonds +
      proratedAlloc.reits * (returns.reits ?? 0) +
      proratedAlloc.cash * returns.cash
    );
  }

  // Legacy methods for backward compatibility with Shiller data
  getYearlyReturns(startYear: number, endYear: number): YearlyData[] {
    if (!this.legacyDataset) {
      throw new Error("Legacy Shiller data not loaded. This method is deprecated.");
    }

    if (startYear > endYear) {
      throw new Error("Start year must be less than or equal to end year");
    }

    return this.legacyDataset.data.filter(
      (d) => d.year >= startYear && d.year <= endYear
    );
  }

  getReturnStatistics(startYear: number, endYear: number): ReturnStatistics {
    if (!this.legacyDataset) {
      throw new Error("Legacy Shiller data not loaded. This method is deprecated.");
    }

    const data = this.getYearlyReturns(startYear, endYear);
    const returns = data.map((d) => d.realTotalReturn);

    if (returns.length === 0) {
      return { mean: 0, stdDev: 0, min: 0, max: 0, count: 0 };
    }

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) /
      returns.length;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...returns);
    const max = Math.max(...returns);

    return {
      mean,
      stdDev,
      min,
      max,
      count: returns.length,
    };
  }
}

let instance: HistoricalDataService | null = null;

export function getHistoricalDataService(): HistoricalDataService {
  if (!instance) {
    instance = new HistoricalDataService();
  }
  return instance;
}
