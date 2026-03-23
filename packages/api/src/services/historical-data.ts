import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface YearlyData {
  year: number;
  realPrice: number;
  realDividend: number;
  realEarnings: number;
  cpi: number;
  realTotalReturn: number;
}

export interface HistoricalDataset {
  source: string;
  url: string;
  updatedAt: string;
  startYear: number;
  endYear: number;
  data: YearlyData[];
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

  constructor() {
    const dataPath = join(__dirname, "../../data/shiller-historical.json");
    const rawData = readFileSync(dataPath, "utf-8");
    this.dataset = JSON.parse(rawData);
  }

  getAvailableYearRange(): { startYear: number; endYear: number } {
    return {
      startYear: this.dataset.startYear,
      endYear: this.dataset.endYear,
    };
  }

  getYearlyReturns(startYear: number, endYear: number): YearlyData[] {
    if (startYear > endYear) {
      throw new Error("Start year must be less than or equal to end year");
    }

    return this.dataset.data.filter(
      (d) => d.year >= startYear && d.year <= endYear
    );
  }

  getReturnStatistics(startYear: number, endYear: number): ReturnStatistics {
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

  getReturnForYear(year: number): number | null {
    const yearData = this.dataset.data.find((d) => d.year === year);
    return yearData ? yearData.realTotalReturn : null;
  }
}

let instance: HistoricalDataService | null = null;

export function getHistoricalDataService(): HistoricalDataService {
  if (!instance) {
    instance = new HistoricalDataService();
  }
  return instance;
}
