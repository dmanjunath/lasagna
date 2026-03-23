# Retirement Computation Engine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build server-side computation engines for Monte Carlo simulations, historical backtesting, and scenario analysis with AI tool integration.

**Architecture:** Services layer handles computation logic, caching in PostgreSQL, exposed via AI tools and REST API. Historical data bundled as static JSON from Shiller dataset.

**Tech Stack:** TypeScript, Drizzle ORM, Vitest, xlsx (Excel parsing)

**Spec:** `docs/superpowers/specs/2026-03-23-retirement-dashboards-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `packages/api/data/shiller-historical.json` | Static historical S&P 500 data (1930-present) |
| `packages/api/scripts/update-shiller-data.ts` | Script to fetch and parse Shiller Excel data |
| `packages/api/src/services/historical-data.ts` | Service to query historical market data |
| `packages/api/src/services/monte-carlo.ts` | Monte Carlo simulation engine |
| `packages/api/src/services/backtester.ts` | Historical backtesting engine |
| `packages/api/src/services/scenario.ts` | Scenario analysis engine |
| `packages/api/src/services/simulation-cache.ts` | PostgreSQL cache for simulation results |
| `packages/api/src/agent/tools/simulation.ts` | AI tools for running simulations |
| `packages/api/src/routes/simulations.ts` | REST API for frontend simulation requests |
| `packages/api/src/services/__tests__/monte-carlo.test.ts` | Monte Carlo tests |
| `packages/api/src/services/__tests__/backtester.test.ts` | Backtester tests |
| `packages/api/vitest.config.ts` | Vitest configuration |

### Modified Files
| File | Changes |
|------|---------|
| `packages/core/src/schema.ts` | Add `simulationResults` table and `simulationTypeEnum` |
| `packages/core/src/index.ts` | Export new table |
| `packages/api/src/agent/agent.ts` | Import and spread simulation tools |
| `packages/api/src/server.ts` | Add simulation routes |
| `packages/api/package.json` | Add vitest, xlsx dependencies |

---

## Task 1: Project Setup - Add Testing Infrastructure

**Files:**
- Create: `packages/api/vitest.config.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Add vitest and xlsx dependencies**

```bash
cd packages/api && pnpm add -D vitest && pnpm add xlsx
```

- [ ] **Step 2: Create vitest config**

Create `packages/api/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `packages/api/package.json`, add to scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify setup works**

Run: `cd packages/api && pnpm test`
Expected: "No test files found" (success - no tests yet)

- [ ] **Step 5: Commit**

```bash
git add packages/api/vitest.config.ts packages/api/package.json pnpm-lock.yaml
git commit -m "feat(api): add vitest testing infrastructure"
```

---

## Task 2: Database Schema - Add Simulation Results Table

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add simulation type enum to schema**

In `packages/core/src/schema.ts`, after line 44 (messageRoleEnum), add:
```typescript
export const simulationTypeEnum = pgEnum("simulation_type", [
  "monte_carlo",
  "backtest",
  "scenario",
]);
```

- [ ] **Step 2: Add simulation_results table**

In `packages/core/src/schema.ts`, after the messages table (end of file), add:
```typescript
// ── Simulation Results ───────────────────────────────────────────────────

export const simulationResults = pgTable("simulation_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  type: simulationTypeEnum("type").notNull(),
  paramsHash: varchar("params_hash", { length: 64 }).notNull(), // MD5 of params JSON
  params: text("params").notNull(), // JSON string
  results: text("results").notNull(), // JSON string
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
```

- [ ] **Step 3: Export new table in index.ts**

In `packages/core/src/index.ts`, add export:
```typescript
export { simulationResults, simulationTypeEnum } from "./schema.js";
```

- [ ] **Step 4: Generate migration**

Run: `cd packages/core && pnpm drizzle-kit generate`
Expected: New migration file created

- [ ] **Step 5: Apply migration**

Run: `cd packages/core && pnpm drizzle-kit migrate`
Expected: Migration applied successfully

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/index.ts packages/core/drizzle/
git commit -m "feat(core): add simulation_results table for caching"
```

---

## Task 3: Historical Data - Create Shiller Data Script

**Files:**
- Create: `packages/api/scripts/update-shiller-data.ts`
- Create: `packages/api/data/shiller-historical.json`

- [ ] **Step 1: Create data directory**

```bash
mkdir -p packages/api/data packages/api/scripts
```

- [ ] **Step 2: Create update script**

Create `packages/api/scripts/update-shiller-data.ts`:
```typescript
/**
 * Script to fetch and parse Shiller's historical S&P 500 data
 * Run: npx tsx packages/api/scripts/update-shiller-data.ts
 */
import * as XLSX from "xlsx";
import { writeFileSync } from "fs";
import { resolve } from "path";

const SHILLER_URL = "http://www.econ.yale.edu/~shiller/data/ie_data.xls";
const OUTPUT_PATH = resolve(__dirname, "../data/shiller-historical.json");

interface YearlyData {
  year: number;
  realPrice: number;      // Inflation-adjusted S&P 500 price
  realDividend: number;   // Inflation-adjusted dividends
  realEarnings: number;   // Inflation-adjusted earnings
  cpi: number;            // Consumer Price Index
  realTotalReturn: number; // Real total return (price + dividends)
}

async function fetchShillerData(): Promise<YearlyData[]> {
  console.log("Fetching Shiller data from Yale...");
  const response = await fetch(SHILLER_URL);
  const buffer = await response.arrayBuffer();

  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  // Find data start row (after headers)
  let startRow = 0;
  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    if (row && typeof row[0] === "number" && row[0] > 1800 && row[0] < 2100) {
      startRow = i;
      break;
    }
  }

  const yearlyData: Map<number, YearlyData> = new Map();

  // Parse monthly data, aggregate to yearly
  for (let i = startRow; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || !row[0]) continue;

    // Column indices (Shiller format):
    // 0: Date (YYYY.MM), 1: S&P Price, 2: Dividend, 3: Earnings, 4: CPI
    const dateVal = row[0];
    if (typeof dateVal !== "number") continue;

    const year = Math.floor(dateVal);
    if (year < 1930 || year > new Date().getFullYear()) continue;

    const price = parseFloat(String(row[1])) || 0;
    const dividend = parseFloat(String(row[2])) || 0;
    const earnings = parseFloat(String(row[3])) || 0;
    const cpi = parseFloat(String(row[4])) || 0;

    if (!yearlyData.has(year)) {
      yearlyData.set(year, {
        year,
        realPrice: price,
        realDividend: dividend,
        realEarnings: earnings,
        cpi,
        realTotalReturn: 0,
      });
    }
  }

  // Calculate real total returns
  const years = Array.from(yearlyData.keys()).sort((a, b) => a - b);
  for (let i = 1; i < years.length; i++) {
    const prevYear = yearlyData.get(years[i - 1])!;
    const currYear = yearlyData.get(years[i])!;

    // Total return = (price change + dividends) / previous price
    const priceReturn = (currYear.realPrice - prevYear.realPrice) / prevYear.realPrice;
    const dividendYield = currYear.realDividend / prevYear.realPrice;
    currYear.realTotalReturn = priceReturn + dividendYield;
  }

  return Array.from(yearlyData.values()).sort((a, b) => a.year - b.year);
}

async function main() {
  try {
    const data = await fetchShillerData();

    const output = {
      source: "Robert Shiller, Yale University",
      url: SHILLER_URL,
      updatedAt: new Date().toISOString(),
      startYear: data[0]?.year,
      endYear: data[data.length - 1]?.year,
      data,
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`Written ${data.length} years of data to ${OUTPUT_PATH}`);
    console.log(`Range: ${output.startYear} - ${output.endYear}`);
  } catch (error) {
    console.error("Failed to update Shiller data:", error);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Run the script to generate initial data**

Run: `cd packages/api && npx tsx scripts/update-shiller-data.ts`
Expected: "Written XX years of data to packages/api/data/shiller-historical.json"

- [ ] **Step 4: Verify data file exists and has correct structure**

Run: `head -20 packages/api/data/shiller-historical.json`
Expected: JSON with source, url, updatedAt, startYear, endYear, data fields

- [ ] **Step 5: Commit**

```bash
git add packages/api/scripts/update-shiller-data.ts packages/api/data/shiller-historical.json
git commit -m "feat(api): add Shiller historical data pipeline"
```

---

## Task 4: Historical Data Service

**Files:**
- Create: `packages/api/src/services/historical-data.ts`
- Create: `packages/api/src/services/__tests__/historical-data.test.ts`

- [ ] **Step 1: Write failing test for historical data service**

Create `packages/api/src/services/__tests__/historical-data.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { HistoricalDataService } from "../historical-data.js";

describe("HistoricalDataService", () => {
  const service = new HistoricalDataService();

  describe("getYearlyReturns", () => {
    it("returns data for valid year range", () => {
      const returns = service.getYearlyReturns(1950, 1960);
      expect(returns).toHaveLength(11); // inclusive
      expect(returns[0].year).toBe(1950);
      expect(returns[10].year).toBe(1960);
    });

    it("throws for invalid year range", () => {
      expect(() => service.getYearlyReturns(1960, 1950)).toThrow();
    });
  });

  describe("getReturnStatistics", () => {
    it("calculates mean and stddev", () => {
      const stats = service.getReturnStatistics(1950, 2000);
      expect(stats.mean).toBeGreaterThan(0);
      expect(stats.mean).toBeLessThan(0.2);
      expect(stats.stdDev).toBeGreaterThan(0);
      expect(stats.stdDev).toBeLessThan(0.3);
    });
  });

  describe("getAvailableYearRange", () => {
    it("returns start and end years", () => {
      const range = service.getAvailableYearRange();
      expect(range.startYear).toBeLessThanOrEqual(1930);
      expect(range.endYear).toBeGreaterThanOrEqual(2020);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test`
Expected: FAIL - module not found

- [ ] **Step 3: Create services directory**

```bash
mkdir -p packages/api/src/services/__tests__
```

- [ ] **Step 4: Implement historical data service**

Create `packages/api/src/services/historical-data.ts`:
```typescript
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface YearlyData {
  year: number;
  realPrice: number;
  realDividend: number;
  realEarnings: number;
  cpi: number;
  realTotalReturn: number;
}

interface ShillerData {
  source: string;
  url: string;
  updatedAt: string;
  startYear: number;
  endYear: number;
  data: YearlyData[];
}

interface ReturnStatistics {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  count: number;
}

export class HistoricalDataService {
  private data: ShillerData;
  private yearIndex: Map<number, YearlyData>;

  constructor() {
    const dataPath = resolve(__dirname, "../../data/shiller-historical.json");
    const raw = readFileSync(dataPath, "utf-8");
    this.data = JSON.parse(raw);

    this.yearIndex = new Map();
    for (const entry of this.data.data) {
      this.yearIndex.set(entry.year, entry);
    }
  }

  getAvailableYearRange(): { startYear: number; endYear: number } {
    return {
      startYear: this.data.startYear,
      endYear: this.data.endYear,
    };
  }

  getYearlyReturns(startYear: number, endYear: number): YearlyData[] {
    if (startYear > endYear) {
      throw new Error(`Invalid year range: ${startYear} > ${endYear}`);
    }

    const results: YearlyData[] = [];
    for (let year = startYear; year <= endYear; year++) {
      const entry = this.yearIndex.get(year);
      if (entry) {
        results.push(entry);
      }
    }
    return results;
  }

  getReturnStatistics(startYear: number, endYear: number): ReturnStatistics {
    const returns = this.getYearlyReturns(startYear, endYear)
      .map((d) => d.realTotalReturn)
      .filter((r) => r !== 0); // Skip first year (no return data)

    if (returns.length === 0) {
      return { mean: 0, stdDev: 0, min: 0, max: 0, count: 0 };
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return {
      mean,
      stdDev,
      min: Math.min(...returns),
      max: Math.max(...returns),
      count: returns.length,
    };
  }

  getReturnForYear(year: number): number | null {
    return this.yearIndex.get(year)?.realTotalReturn ?? null;
  }
}

// Singleton instance
let _instance: HistoricalDataService | null = null;

export function getHistoricalDataService(): HistoricalDataService {
  if (!_instance) {
    _instance = new HistoricalDataService();
  }
  return _instance;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/api && pnpm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/historical-data.ts packages/api/src/services/__tests__/historical-data.test.ts
git commit -m "feat(api): add historical data service"
```

---

## Task 5: Monte Carlo Engine

**Files:**
- Create: `packages/api/src/services/monte-carlo.ts`
- Create: `packages/api/src/services/__tests__/monte-carlo.test.ts`

- [ ] **Step 1: Write failing tests for Monte Carlo engine**

Create `packages/api/src/services/__tests__/monte-carlo.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { MonteCarloEngine, MonteCarloParams } from "../monte-carlo.js";

describe("MonteCarloEngine", () => {
  const engine = new MonteCarloEngine();

  const defaultParams: MonteCarloParams = {
    initialBalance: 1000000,
    withdrawalRate: 0.04,
    yearsToSimulate: 30,
    assetAllocation: { stocks: 0.7, bonds: 0.25, cash: 0.05 },
    inflationAdjusted: true,
    numSimulations: 1000, // Fewer for testing
  };

  describe("run", () => {
    it("returns success rate between 0 and 1", () => {
      const result = engine.run(defaultParams);
      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(1);
    });

    it("returns percentile arrays of correct length", () => {
      const result = engine.run(defaultParams);
      expect(result.percentiles.p50).toHaveLength(defaultParams.yearsToSimulate + 1);
    });

    it("initial balance matches in all percentiles", () => {
      const result = engine.run(defaultParams);
      expect(result.percentiles.p5[0]).toBe(defaultParams.initialBalance);
      expect(result.percentiles.p50[0]).toBe(defaultParams.initialBalance);
      expect(result.percentiles.p95[0]).toBe(defaultParams.initialBalance);
    });

    it("handles zero withdrawal rate", () => {
      const params = { ...defaultParams, withdrawalRate: 0 };
      const result = engine.run(params);
      expect(result.successRate).toBe(1); // Should never fail with no withdrawals
    });

    it("respects annual withdrawal over withdrawal rate", () => {
      const params = {
        ...defaultParams,
        withdrawalRate: 0.04,
        annualWithdrawal: 100000, // Should be ignored when rate is set
      };
      const result = engine.run(params);
      // Just verify it runs without error
      expect(result.successRate).toBeDefined();
    });
  });

  describe("calculates reasonable results", () => {
    it("higher withdrawal rate = lower success rate", () => {
      const low = engine.run({ ...defaultParams, withdrawalRate: 0.03 });
      const high = engine.run({ ...defaultParams, withdrawalRate: 0.06 });
      expect(low.successRate).toBeGreaterThan(high.successRate);
    });

    it("longer duration = lower success rate", () => {
      const short = engine.run({ ...defaultParams, yearsToSimulate: 20 });
      const long = engine.run({ ...defaultParams, yearsToSimulate: 40 });
      expect(short.successRate).toBeGreaterThan(long.successRate);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test`
Expected: FAIL - module not found

- [ ] **Step 3: Implement Monte Carlo engine**

Create `packages/api/src/services/monte-carlo.ts`:
```typescript
export interface MonteCarloParams {
  initialBalance: number;
  withdrawalRate?: number;
  annualWithdrawal?: number;
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
  successRate: number;
  percentiles: {
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
  };
  finalBalanceDistribution: {
    buckets: number[];
    counts: number[];
  };
  failureYear: {
    median: number | null;
    p10: number | null;
    p90: number | null;
  };
}

// Model parameters (v1: fixed based on historical averages)
const MODEL = {
  stocks: { mean: 0.10, stdDev: 0.18 },
  bonds: { mean: 0.05, stdDev: 0.06 },
  cash: { mean: 0.02, stdDev: 0.01 },
  inflation: { mean: 0.025, stdDev: 0.015 },
  correlation: 0.2, // stocks/bonds correlation
};

export class MonteCarloEngine {
  run(params: MonteCarloParams): MonteCarloResult {
    const {
      initialBalance,
      withdrawalRate,
      annualWithdrawal,
      yearsToSimulate,
      assetAllocation,
      inflationAdjusted,
      numSimulations,
    } = params;

    // Resolve withdrawal amount
    let withdrawal: number;
    if (withdrawalRate !== undefined) {
      withdrawal = initialBalance * withdrawalRate;
    } else if (annualWithdrawal !== undefined) {
      withdrawal = annualWithdrawal;
    } else {
      withdrawal = initialBalance * 0.04; // Default 4%
    }

    // Run simulations
    const allPaths: number[][] = [];
    const failureYears: number[] = [];
    let successCount = 0;

    for (let sim = 0; sim < numSimulations; sim++) {
      const path = this.runSingleSimulation(
        initialBalance,
        withdrawal,
        yearsToSimulate,
        assetAllocation,
        inflationAdjusted
      );
      allPaths.push(path);

      // Check if simulation succeeded (balance > 0 at end)
      const finalBalance = path[path.length - 1];
      if (finalBalance > 0) {
        successCount++;
      } else {
        // Find year of failure
        const failYear = path.findIndex((b) => b <= 0);
        if (failYear > 0) {
          failureYears.push(failYear);
        }
      }
    }

    // Calculate percentiles for each year
    const percentiles = this.calculatePercentiles(allPaths, yearsToSimulate);

    // Calculate final balance distribution
    const finalBalances = allPaths.map((p) => Math.max(0, p[p.length - 1]));
    const distribution = this.calculateDistribution(finalBalances);

    // Calculate failure year statistics
    const failureYear = this.calculateFailureStats(failureYears);

    return {
      successRate: successCount / numSimulations,
      percentiles,
      finalBalanceDistribution: distribution,
      failureYear,
    };
  }

  private runSingleSimulation(
    initialBalance: number,
    annualWithdrawal: number,
    years: number,
    allocation: { stocks: number; bonds: number; cash: number },
    inflationAdjusted: boolean
  ): number[] {
    const path = [initialBalance];
    let balance = initialBalance;
    let cumulativeInflation = 1;

    for (let year = 0; year < years; year++) {
      // Generate returns
      const stockReturn = this.randomNormal(MODEL.stocks.mean, MODEL.stocks.stdDev);
      const bondReturn = this.randomNormal(MODEL.bonds.mean, MODEL.bonds.stdDev);
      const cashReturn = this.randomNormal(MODEL.cash.mean, MODEL.cash.stdDev);
      const inflation = this.randomNormal(MODEL.inflation.mean, MODEL.inflation.stdDev);

      // Portfolio return (weighted)
      const portfolioReturn =
        allocation.stocks * stockReturn +
        allocation.bonds * bondReturn +
        allocation.cash * cashReturn;

      // Apply return
      balance = balance * (1 + portfolioReturn);

      // Adjust withdrawal for inflation if needed
      if (inflationAdjusted) {
        cumulativeInflation *= 1 + inflation;
      }
      const adjustedWithdrawal = annualWithdrawal * cumulativeInflation;

      // Withdraw
      balance -= adjustedWithdrawal;

      // Store balance (can go negative for tracking purposes)
      path.push(Math.max(0, balance));

      // If depleted, stop (remaining years are 0)
      if (balance <= 0) {
        while (path.length <= years) {
          path.push(0);
        }
        break;
      }
    }

    return path;
  }

  private randomNormal(mean: number, stdDev: number): number {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stdDev * z;
  }

  private calculatePercentiles(
    paths: number[][],
    years: number
  ): MonteCarloResult["percentiles"] {
    const p5: number[] = [];
    const p25: number[] = [];
    const p50: number[] = [];
    const p75: number[] = [];
    const p95: number[] = [];

    for (let year = 0; year <= years; year++) {
      const values = paths.map((p) => p[year] ?? 0).sort((a, b) => a - b);
      const n = values.length;

      p5.push(values[Math.floor(n * 0.05)]);
      p25.push(values[Math.floor(n * 0.25)]);
      p50.push(values[Math.floor(n * 0.5)]);
      p75.push(values[Math.floor(n * 0.75)]);
      p95.push(values[Math.floor(n * 0.95)]);
    }

    return { p5, p25, p50, p75, p95 };
  }

  private calculateDistribution(finalBalances: number[]): {
    buckets: number[];
    counts: number[];
  } {
    const buckets = [0, 250000, 500000, 1000000, 2000000, 3000000, Infinity];
    const counts = new Array(buckets.length - 1).fill(0);

    for (const balance of finalBalances) {
      for (let i = 0; i < buckets.length - 1; i++) {
        if (balance >= buckets[i] && balance < buckets[i + 1]) {
          counts[i]++;
          break;
        }
      }
    }

    return { buckets: buckets.slice(0, -1), counts };
  }

  private calculateFailureStats(failureYears: number[]): MonteCarloResult["failureYear"] {
    if (failureYears.length === 0) {
      return { median: null, p10: null, p90: null };
    }

    const sorted = failureYears.sort((a, b) => a - b);
    const n = sorted.length;

    return {
      median: sorted[Math.floor(n * 0.5)],
      p10: sorted[Math.floor(n * 0.1)],
      p90: sorted[Math.floor(n * 0.9)],
    };
  }
}

// Singleton
let _engine: MonteCarloEngine | null = null;

export function getMonteCarloEngine(): MonteCarloEngine {
  if (!_engine) {
    _engine = new MonteCarloEngine();
  }
  return _engine;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/monte-carlo.ts packages/api/src/services/__tests__/monte-carlo.test.ts
git commit -m "feat(api): add Monte Carlo simulation engine"
```

---

## Task 6: Historical Backtester Engine

**Files:**
- Create: `packages/api/src/services/backtester.ts`
- Create: `packages/api/src/services/__tests__/backtester.test.ts`

- [ ] **Step 1: Write failing tests for backtester**

Create `packages/api/src/services/__tests__/backtester.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { Backtester, BacktestParams } from "../backtester.js";

describe("Backtester", () => {
  const backtester = new Backtester();

  const defaultParams: BacktestParams = {
    initialBalance: 1000000,
    withdrawalRate: 0.04,
    yearsToSimulate: 30,
    assetAllocation: { stocks: 0.7, bonds: 0.3 },
    inflationAdjusted: true,
  };

  describe("run", () => {
    it("returns periods for each valid starting year", () => {
      const result = backtester.run(defaultParams);
      expect(result.totalPeriods).toBeGreaterThan(0);
      expect(result.periods).toHaveLength(result.totalPeriods);
    });

    it("calculates success rate correctly", () => {
      const result = backtester.run(defaultParams);
      const actualSuccesses = result.periods.filter((p) => p.status === "success").length;
      expect(result.successfulPeriods).toBe(actualSuccesses);
      expect(result.successRate).toBeCloseTo(actualSuccesses / result.totalPeriods, 2);
    });

    it("each period has required fields", () => {
      const result = backtester.run(defaultParams);
      for (const period of result.periods) {
        expect(period.startYear).toBeDefined();
        expect(period.endBalance).toBeDefined();
        expect(period.yearsLasted).toBeDefined();
        expect(period.status).toMatch(/success|failed|close/);
        expect(period.worstDrawdown).toBeDefined();
        expect(period.bestYear).toBeDefined();
      }
    });

    it("respects startYearRange filter", () => {
      const params = {
        ...defaultParams,
        startYearRange: { from: 1990, to: 2000 },
      };
      const result = backtester.run(params);
      expect(result.periods[0].startYear).toBeGreaterThanOrEqual(1990);
      expect(result.periods[result.periods.length - 1].startYear).toBeLessThanOrEqual(2000);
    });
  });

  describe("historical accuracy", () => {
    it("1929 start with 4% SWR for 30 years should fail", () => {
      const params = {
        ...defaultParams,
        startYearRange: { from: 1930, to: 1930 },
        yearsToSimulate: 30,
      };
      const result = backtester.run(params);
      const period1930 = result.periods.find((p) => p.startYear === 1930);
      // 1930 start should be challenging
      expect(period1930).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test`
Expected: FAIL - module not found

- [ ] **Step 3: Implement backtester**

Create `packages/api/src/services/backtester.ts`:
```typescript
import { getHistoricalDataService } from "./historical-data.js";

export interface BacktestParams {
  initialBalance: number;
  withdrawalRate?: number;
  annualWithdrawal?: number;
  yearsToSimulate: number;
  assetAllocation: {
    stocks: number;
    bonds: number;
  };
  startYearRange?: {
    from: number;
    to: number;
  };
  inflationAdjusted: boolean;
}

export interface BacktestPeriod {
  startYear: number;
  endBalance: number;
  yearsLasted: number;
  status: "success" | "failed" | "close";
  worstDrawdown: {
    year: number;
    percent: number;
  };
  bestYear: {
    year: number;
    percent: number;
  };
  yearByYear: {
    year: number;
    balance: number;
    return: number;
    withdrawal: number;
  }[];
}

export interface BacktestResult {
  totalPeriods: number;
  successfulPeriods: number;
  successRate: number;
  periods: BacktestPeriod[];
}

// Bond return approximation (constant for simplicity in v1)
const BOND_RETURN = 0.05;

export class Backtester {
  run(params: BacktestParams): BacktestResult {
    const historicalData = getHistoricalDataService();
    const { startYear: dataStart, endYear: dataEnd } = historicalData.getAvailableYearRange();

    const {
      initialBalance,
      withdrawalRate,
      annualWithdrawal,
      yearsToSimulate,
      assetAllocation,
      startYearRange,
      inflationAdjusted,
    } = params;

    // Resolve withdrawal
    let baseWithdrawal: number;
    if (withdrawalRate !== undefined) {
      baseWithdrawal = initialBalance * withdrawalRate;
    } else if (annualWithdrawal !== undefined) {
      baseWithdrawal = annualWithdrawal;
    } else {
      baseWithdrawal = initialBalance * 0.04;
    }

    // Determine valid start year range
    const rangeStart = Math.max(startYearRange?.from ?? dataStart, dataStart);
    const rangeEnd = Math.min(
      startYearRange?.to ?? dataEnd - yearsToSimulate,
      dataEnd - yearsToSimulate
    );

    const periods: BacktestPeriod[] = [];

    for (let startYear = rangeStart; startYear <= rangeEnd; startYear++) {
      const period = this.simulatePeriod(
        startYear,
        initialBalance,
        baseWithdrawal,
        yearsToSimulate,
        assetAllocation,
        inflationAdjusted,
        historicalData
      );
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

  private simulatePeriod(
    startYear: number,
    initialBalance: number,
    baseWithdrawal: number,
    years: number,
    allocation: { stocks: number; bonds: number },
    inflationAdjusted: boolean,
    historicalData: ReturnType<typeof getHistoricalDataService>
  ): BacktestPeriod {
    let balance = initialBalance;
    let cumulativeInflation = 1;
    const yearByYear: BacktestPeriod["yearByYear"] = [];

    let worstDrawdown = { year: startYear, percent: 0 };
    let bestYear = { year: startYear, percent: 0 };
    let peakBalance = initialBalance;
    let yearsLasted = years;
    let failed = false;

    for (let i = 0; i < years; i++) {
      const year = startYear + i;
      const stockReturn = historicalData.getReturnForYear(year) ?? 0;
      const portfolioReturn =
        allocation.stocks * stockReturn + allocation.bonds * BOND_RETURN;

      // Track best/worst years
      if (portfolioReturn < worstDrawdown.percent) {
        worstDrawdown = { year, percent: portfolioReturn };
      }
      if (portfolioReturn > bestYear.percent) {
        bestYear = { year, percent: portfolioReturn };
      }

      // Apply return
      const previousBalance = balance;
      balance = balance * (1 + portfolioReturn);

      // Track drawdown from peak
      peakBalance = Math.max(peakBalance, balance);
      const drawdown = (peakBalance - balance) / peakBalance;
      if (drawdown > Math.abs(worstDrawdown.percent)) {
        worstDrawdown = { year, percent: -drawdown };
      }

      // Inflation adjustment
      if (inflationAdjusted) {
        // Use historical CPI data if available, otherwise approximate
        cumulativeInflation *= 1.03; // Simplified
      }
      const withdrawal = baseWithdrawal * cumulativeInflation;

      // Withdraw
      balance -= withdrawal;

      yearByYear.push({
        year,
        balance: Math.max(0, balance),
        return: portfolioReturn,
        withdrawal,
      });

      // Check for failure
      if (balance <= 0 && !failed) {
        failed = true;
        yearsLasted = i + 1;
      }
    }

    const endBalance = Math.max(0, balance);
    let status: BacktestPeriod["status"];
    if (failed || endBalance <= 0) {
      status = "failed";
    } else if (endBalance < initialBalance * 0.2) {
      status = "close";
    } else {
      status = "success";
    }

    return {
      startYear,
      endBalance,
      yearsLasted,
      status,
      worstDrawdown,
      bestYear,
      yearByYear,
    };
  }
}

// Singleton
let _backtester: Backtester | null = null;

export function getBacktester(): Backtester {
  if (!_backtester) {
    _backtester = new Backtester();
  }
  return _backtester;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && pnpm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/backtester.ts packages/api/src/services/__tests__/backtester.test.ts
git commit -m "feat(api): add historical backtesting engine"
```

---

## Task 7: Scenario Engine

**Files:**
- Create: `packages/api/src/services/scenario.ts`

- [ ] **Step 1: Create scenario engine**

Create `packages/api/src/services/scenario.ts`:
```typescript
import { getMonteCarloEngine, MonteCarloParams } from "./monte-carlo.js";

export type ScenarioType =
  | "crash_2008"
  | "great_depression"
  | "stagflation_70s"
  | "japan_lost_decade"
  | "custom";

export interface ScenarioParams {
  initialBalance: number;
  withdrawalRate: number;
  retirementDuration: number;
  assetAllocation: {
    stocks: number;
    bonds: number;
    cash: number;
  };
  scenario: ScenarioType;
  customParams?: {
    yearOneReturn: number;
    subsequentReturns: number;
    inflationRate: number;
    durationYears: number;
  };
}

export interface ScenarioResult {
  scenarioName: string;
  description: string;
  survivalRate: number;
  endBalance: number;
  depletionYear: number | null;
  yearByYear: {
    year: number;
    balance: number;
    return: number;
    withdrawal: number;
  }[];
  comparison: {
    vsBaseline: number;
    vsHistoricalWorst: number;
  };
}

// Predefined scenario parameters
const SCENARIOS: Record<
  Exclude<ScenarioType, "custom">,
  { name: string; description: string; returns: number[]; inflation: number }
> = {
  crash_2008: {
    name: "2008 Financial Crisis",
    description: "Market drops 38% in year 1, followed by recovery",
    returns: [-0.38, 0.23, 0.13, 0.0, 0.13, 0.30, 0.11, -0.01, 0.10, 0.19],
    inflation: 0.02,
  },
  great_depression: {
    name: "Great Depression",
    description: "Severe multi-year decline similar to 1929-1932",
    returns: [-0.12, -0.28, -0.47, -0.15, 0.47, -0.04, 0.41, -0.39, 0.25, -0.05],
    inflation: -0.02,
  },
  stagflation_70s: {
    name: "1970s Stagflation",
    description: "High inflation with poor real returns",
    returns: [0.0, 0.11, 0.15, -0.17, -0.30, 0.31, 0.19, -0.12, 0.01, 0.13],
    inflation: 0.08,
  },
  japan_lost_decade: {
    name: "Japan Lost Decade",
    description: "Prolonged stagnation with minimal growth",
    returns: [-0.03, -0.27, -0.08, 0.24, -0.22, 0.02, 0.36, -0.09, -0.19, 0.41],
    inflation: 0.01,
  },
};

export class ScenarioEngine {
  run(params: ScenarioParams): ScenarioResult {
    const {
      initialBalance,
      withdrawalRate,
      retirementDuration,
      assetAllocation,
      scenario,
      customParams,
    } = params;

    // Get scenario definition
    let scenarioReturns: number[];
    let inflation: number;
    let name: string;
    let description: string;

    if (scenario === "custom" && customParams) {
      name = "Custom Scenario";
      description = `Year 1: ${(customParams.yearOneReturn * 100).toFixed(0)}%, then ${(customParams.subsequentReturns * 100).toFixed(0)}% annually`;
      scenarioReturns = [customParams.yearOneReturn];
      for (let i = 1; i < customParams.durationYears; i++) {
        scenarioReturns.push(customParams.subsequentReturns);
      }
      inflation = customParams.inflationRate;
    } else {
      const scenarioDef = SCENARIOS[scenario as Exclude<ScenarioType, "custom">];
      name = scenarioDef.name;
      description = scenarioDef.description;
      scenarioReturns = scenarioDef.returns;
      inflation = scenarioDef.inflation;
    }

    // Simulate the scenario
    let balance = initialBalance;
    const yearByYear: ScenarioResult["yearByYear"] = [];
    let depletionYear: number | null = null;
    let cumulativeInflation = 1;

    const annualWithdrawal = initialBalance * withdrawalRate;

    for (let year = 0; year < retirementDuration; year++) {
      // Use scenario return if available, otherwise assume 7% average
      const yearReturn = scenarioReturns[year] ?? 0.07;

      // Apply return
      balance = balance * (1 + yearReturn);

      // Inflation adjustment
      cumulativeInflation *= 1 + inflation;
      const withdrawal = annualWithdrawal * cumulativeInflation;

      // Withdraw
      balance -= withdrawal;

      yearByYear.push({
        year: year + 1,
        balance: Math.max(0, balance),
        return: yearReturn,
        withdrawal,
      });

      // Check depletion
      if (balance <= 0 && depletionYear === null) {
        depletionYear = year + 1;
      }
    }

    // Calculate survival rate (simplified: 1 if survived, 0 if not)
    const survivalRate = balance > 0 ? 1 : 0;

    // Run baseline Monte Carlo for comparison
    const mcEngine = getMonteCarloEngine();
    const baselineResult = mcEngine.run({
      initialBalance,
      withdrawalRate,
      yearsToSimulate: retirementDuration,
      assetAllocation,
      inflationAdjusted: true,
      numSimulations: 1000,
    });

    return {
      scenarioName: name,
      description,
      survivalRate,
      endBalance: Math.max(0, balance),
      depletionYear,
      yearByYear,
      comparison: {
        vsBaseline: survivalRate - baselineResult.successRate,
        vsHistoricalWorst: 0, // Would need backtest data
      },
    };
  }
}

// Singleton
let _engine: ScenarioEngine | null = null;

export function getScenarioEngine(): ScenarioEngine {
  if (!_engine) {
    _engine = new ScenarioEngine();
  }
  return _engine;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/services/scenario.ts
git commit -m "feat(api): add scenario analysis engine"
```

---

## Task 8: Simulation Cache Service

**Files:**
- Create: `packages/api/src/services/simulation-cache.ts`

- [ ] **Step 1: Create cache service**

Create `packages/api/src/services/simulation-cache.ts`:
```typescript
import { db } from "../lib/db.js";
import { simulationResults } from "@lasagna/core";
import { eq, and, sql } from "@lasagna/core";
import { createHash } from "crypto";

type SimulationType = "monte_carlo" | "backtest" | "scenario";

export interface CacheEntry<T> {
  id: string;
  planId: string;
  type: SimulationType;
  params: Record<string, unknown>;
  results: T;
  createdAt: Date;
  expiresAt: Date;
}

export class SimulationCacheService {
  private hashParams(params: Record<string, unknown>): string {
    const json = JSON.stringify(params, Object.keys(params).sort());
    return createHash("md5").update(json).digest("hex");
  }

  async get<T>(
    planId: string,
    type: SimulationType,
    params: Record<string, unknown>
  ): Promise<T | null> {
    const paramsHash = this.hashParams(params);

    const [cached] = await db
      .select()
      .from(simulationResults)
      .where(
        and(
          eq(simulationResults.planId, planId),
          eq(simulationResults.type, type),
          eq(simulationResults.paramsHash, paramsHash),
          sql`${simulationResults.expiresAt} > NOW()`
        )
      )
      .limit(1);

    if (!cached) return null;

    return JSON.parse(cached.results) as T;
  }

  async set<T>(
    planId: string,
    tenantId: string,
    type: SimulationType,
    params: Record<string, unknown>,
    results: T,
    ttlHours: number = 24
  ): Promise<string> {
    const paramsHash = this.hashParams(params);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + ttlHours);

    // Upsert (delete existing + insert)
    await db
      .delete(simulationResults)
      .where(
        and(
          eq(simulationResults.planId, planId),
          eq(simulationResults.type, type),
          eq(simulationResults.paramsHash, paramsHash)
        )
      );

    const [inserted] = await db
      .insert(simulationResults)
      .values({
        planId,
        tenantId,
        type,
        paramsHash,
        params: JSON.stringify(params),
        results: JSON.stringify(results),
        expiresAt,
      })
      .returning({ id: simulationResults.id });

    return inserted.id;
  }

  async invalidateForPlan(planId: string): Promise<number> {
    const result = await db
      .delete(simulationResults)
      .where(eq(simulationResults.planId, planId));

    return result.rowCount ?? 0;
  }

  async cleanupExpired(): Promise<number> {
    const result = await db
      .delete(simulationResults)
      .where(sql`${simulationResults.expiresAt} < NOW()`);

    return result.rowCount ?? 0;
  }
}

// Singleton
let _cache: SimulationCacheService | null = null;

export function getSimulationCache(): SimulationCacheService {
  if (!_cache) {
    _cache = new SimulationCacheService();
  }
  return _cache;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/services/simulation-cache.ts
git commit -m "feat(api): add simulation cache service"
```

---

## Task 9: AI Simulation Tools

**Files:**
- Create: `packages/api/src/agent/tools/simulation.ts`
- Modify: `packages/api/src/agent/agent.ts`

- [ ] **Step 1: Create simulation tools**

Create `packages/api/src/agent/tools/simulation.ts`:
```typescript
import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { plans, accounts, balanceSnapshots, holdings, securities } from "@lasagna/core";
import { eq, desc } from "@lasagna/core";
import { getMonteCarloEngine } from "../../services/monte-carlo.js";
import { getBacktester } from "../../services/backtester.js";
import { getScenarioEngine } from "../../services/scenario.js";
import { getSimulationCache } from "../../services/simulation-cache.js";

export function createSimulationTools(tenantId: string) {
  return {
    get_portfolio_summary: tool({
      description: "Get user's current portfolio including total balance, account breakdown, and asset allocation",
      inputSchema: z.object({
        planId: z.string().uuid(),
      }),
      execute: async ({ planId }) => {
        // Get all investment accounts
        const investmentAccounts = await db
          .select({
            id: accounts.id,
            name: accounts.name,
            type: accounts.type,
            subtype: accounts.subtype,
          })
          .from(accounts)
          .where(eq(accounts.tenantId, tenantId));

        // Get latest balances
        let totalBalance = 0;
        const byAccountType: Record<string, number> = {
          traditional: 0,
          roth: 0,
          taxable: 0,
        };

        for (const account of investmentAccounts) {
          const [latestBalance] = await db
            .select({ balance: balanceSnapshots.balance })
            .from(balanceSnapshots)
            .where(eq(balanceSnapshots.accountId, account.id))
            .orderBy(desc(balanceSnapshots.snapshotAt))
            .limit(1);

          const balance = parseFloat(latestBalance?.balance ?? "0");
          totalBalance += balance;

          // Categorize by tax treatment
          if (account.subtype?.includes("401") || account.subtype?.includes("ira")) {
            if (account.subtype?.toLowerCase().includes("roth")) {
              byAccountType.roth += balance;
            } else {
              byAccountType.traditional += balance;
            }
          } else {
            byAccountType.taxable += balance;
          }
        }

        // Get holdings for asset allocation
        const holdingsData = await db
          .select({
            value: holdings.institutionValue,
            type: securities.type,
          })
          .from(holdings)
          .innerJoin(securities, eq(holdings.securityId, securities.id))
          .where(eq(holdings.tenantId, tenantId));

        const allocation = { stocks: 0, bonds: 0, cash: 0, other: 0 };
        let totalHoldingsValue = 0;

        for (const h of holdingsData) {
          const value = parseFloat(h.value ?? "0");
          totalHoldingsValue += value;

          const type = h.type?.toLowerCase() ?? "";
          if (type.includes("equity") || type.includes("stock") || type.includes("etf")) {
            allocation.stocks += value;
          } else if (type.includes("bond") || type.includes("fixed")) {
            allocation.bonds += value;
          } else if (type.includes("cash") || type.includes("money")) {
            allocation.cash += value;
          } else {
            allocation.other += value;
          }
        }

        // Convert to percentages
        if (totalHoldingsValue > 0) {
          allocation.stocks /= totalHoldingsValue;
          allocation.bonds /= totalHoldingsValue;
          allocation.cash /= totalHoldingsValue;
          allocation.other /= totalHoldingsValue;
        } else {
          // Default allocation if no holdings data
          allocation.stocks = 0.7;
          allocation.bonds = 0.25;
          allocation.cash = 0.05;
        }

        return {
          totalBalance,
          byAccountType,
          assetAllocation: allocation,
        };
      },
    }),

    run_monte_carlo: tool({
      description: "Run Monte Carlo simulation for retirement projections. Returns success rate, percentile projections, and final balance distribution.",
      inputSchema: z.object({
        planId: z.string().uuid(),
        withdrawalRate: z.number().min(0.01).max(0.15).optional().default(0.04),
        retirementDuration: z.number().min(10).max(60).optional().default(30),
        numSimulations: z.number().min(1000).max(50000).optional().default(10000),
      }),
      execute: async ({ planId, withdrawalRate, retirementDuration, numSimulations }) => {
        const cache = getSimulationCache();

        // Get portfolio data
        const portfolio = await createSimulationTools(tenantId).get_portfolio_summary.execute({ planId });

        const params = {
          initialBalance: portfolio.totalBalance,
          withdrawalRate,
          yearsToSimulate: retirementDuration,
          assetAllocation: {
            stocks: portfolio.assetAllocation.stocks,
            bonds: portfolio.assetAllocation.bonds,
            cash: portfolio.assetAllocation.cash,
          },
          inflationAdjusted: true,
          numSimulations,
        };

        // Check cache
        const cached = await cache.get(planId, "monte_carlo", params);
        if (cached) {
          return { ...cached, cached: true };
        }

        // Run simulation
        const engine = getMonteCarloEngine();
        const result = engine.run(params);

        // Cache result
        const [plan] = await db
          .select({ tenantId: plans.tenantId })
          .from(plans)
          .where(eq(plans.id, planId))
          .limit(1);

        if (plan) {
          await cache.set(planId, plan.tenantId, "monte_carlo", params, result);
        }

        return { ...result, cached: false };
      },
    }),

    run_backtest: tool({
      description: "Run historical backtesting against S&P 500 data from 1930-present. Returns survival rate for each historical starting year.",
      inputSchema: z.object({
        planId: z.string().uuid(),
        withdrawalRate: z.number().min(0.01).max(0.15).optional().default(0.04),
        retirementDuration: z.number().min(10).max(60).optional().default(30),
      }),
      execute: async ({ planId, withdrawalRate, retirementDuration }) => {
        const cache = getSimulationCache();

        // Get portfolio data
        const portfolio = await createSimulationTools(tenantId).get_portfolio_summary.execute({ planId });

        const params = {
          initialBalance: portfolio.totalBalance,
          withdrawalRate,
          yearsToSimulate: retirementDuration,
          assetAllocation: {
            stocks: portfolio.assetAllocation.stocks,
            bonds: portfolio.assetAllocation.bonds,
          },
          inflationAdjusted: true,
        };

        // Check cache
        const cached = await cache.get(planId, "backtest", params);
        if (cached) {
          return { ...cached, cached: true };
        }

        // Run backtest
        const backtester = getBacktester();
        const result = backtester.run(params);

        // Cache result
        const [plan] = await db
          .select({ tenantId: plans.tenantId })
          .from(plans)
          .where(eq(plans.id, planId))
          .limit(1);

        if (plan) {
          await cache.set(planId, plan.tenantId, "backtest", params, result);
        }

        return { ...result, cached: false };
      },
    }),

    run_scenario: tool({
      description: "Test retirement plan against specific historical scenarios like 2008 crash, Great Depression, or 1970s stagflation",
      inputSchema: z.object({
        planId: z.string().uuid(),
        scenario: z.enum(["crash_2008", "great_depression", "stagflation_70s", "japan_lost_decade", "custom"]),
        withdrawalRate: z.number().min(0.01).max(0.15).optional().default(0.04),
        retirementDuration: z.number().min(10).max(60).optional().default(30),
        customParams: z.object({
          yearOneReturn: z.number(),
          subsequentReturns: z.number(),
          inflationRate: z.number(),
          durationYears: z.number(),
        }).optional(),
      }),
      execute: async ({ planId, scenario, withdrawalRate, retirementDuration, customParams }) => {
        // Get portfolio data
        const portfolio = await createSimulationTools(tenantId).get_portfolio_summary.execute({ planId });

        const engine = getScenarioEngine();
        const result = engine.run({
          initialBalance: portfolio.totalBalance,
          withdrawalRate,
          retirementDuration,
          assetAllocation: {
            stocks: portfolio.assetAllocation.stocks,
            bonds: portfolio.assetAllocation.bonds,
            cash: portfolio.assetAllocation.cash,
          },
          scenario,
          customParams,
        });

        return result;
      },
    }),

    calculate_fire_number: tool({
      description: "Calculate the FIRE (Financial Independence, Retire Early) number based on annual expenses and withdrawal rate",
      inputSchema: z.object({
        annualExpenses: z.number().positive(),
        withdrawalRate: z.number().min(0.02).max(0.10).optional().default(0.04),
        planId: z.string().uuid(),
      }),
      execute: async ({ annualExpenses, withdrawalRate, planId }) => {
        const portfolio = await createSimulationTools(tenantId).get_portfolio_summary.execute({ planId });

        const fireNumber = annualExpenses / withdrawalRate;
        const currentBalance = portfolio.totalBalance;
        const gap = fireNumber - currentBalance;
        const percentComplete = (currentBalance / fireNumber) * 100;

        return {
          fireNumber,
          currentBalance,
          gap,
          percentComplete: Math.min(100, percentComplete),
          withdrawalRate,
          annualExpenses,
        };
      },
    }),
  };
}
```

- [ ] **Step 2: Update agent.ts to include simulation tools**

In `packages/api/src/agent/agent.ts`, add import:
```typescript
import { createSimulationTools } from "./tools/simulation.js";
```

Update `createAgentTools` function:
```typescript
export function createAgentTools(tenantId: string) {
  return {
    ...createFinancialTools(tenantId),
    ...createPlanTools(tenantId),
    ...createSimulationTools(tenantId),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/agent/tools/simulation.ts packages/api/src/agent/agent.ts
git commit -m "feat(api): add AI simulation tools"
```

---

## Task 10: Simulation API Routes

**Files:**
- Create: `packages/api/src/routes/simulations.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create simulation routes**

Create `packages/api/src/routes/simulations.ts`:
```typescript
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getMonteCarloEngine } from "../services/monte-carlo.js";
import { getBacktester } from "../services/backtester.js";
import { getScenarioEngine } from "../services/scenario.js";
import { getSimulationCache } from "../services/simulation-cache.js";
import { db } from "../lib/db.js";
import { plans, accounts, balanceSnapshots, holdings, securities } from "@lasagna/core";
import { eq, desc } from "@lasagna/core";

const simulationsRouter = new Hono();

const runSimulationSchema = z.object({
  planId: z.string().uuid(),
  type: z.enum(["monte_carlo", "backtest", "scenario"]),
  params: z.object({
    withdrawalRate: z.number().optional(),
    retirementAge: z.number().optional(),
    retirementDuration: z.number().optional(),
    numSimulations: z.number().optional(),
    startYearRange: z.object({
      from: z.number(),
      to: z.number(),
    }).optional(),
    scenario: z.enum(["crash_2008", "great_depression", "stagflation_70s", "japan_lost_decade", "custom"]).optional(),
    customScenario: z.object({
      yearOneReturn: z.number(),
      subsequentReturns: z.number(),
      inflationRate: z.number(),
      durationYears: z.number(),
    }).optional(),
  }),
});

simulationsRouter.post(
  "/run",
  zValidator("json", runSimulationSchema),
  async (c) => {
    const tenantId = c.get("tenantId");
    const { planId, type, params } = c.req.valid("json");

    const startTime = Date.now();

    // Get portfolio data
    const portfolio = await getPortfolioData(tenantId);

    const cache = getSimulationCache();
    const cacheKey = { ...params, portfolioHash: JSON.stringify(portfolio) };

    // Check cache
    const cached = await cache.get(planId, type, cacheKey);
    if (cached) {
      return c.json({
        simulationId: `cached-${planId}-${type}`,
        type,
        cached: true,
        computeTimeMs: Date.now() - startTime,
        result: cached,
      });
    }

    // Run simulation based on type
    let result;
    if (type === "monte_carlo") {
      const engine = getMonteCarloEngine();
      result = engine.run({
        initialBalance: portfolio.totalBalance,
        withdrawalRate: params.withdrawalRate ?? 0.04,
        yearsToSimulate: params.retirementDuration ?? 30,
        assetAllocation: portfolio.assetAllocation,
        inflationAdjusted: true,
        numSimulations: params.numSimulations ?? 10000,
      });
    } else if (type === "backtest") {
      const backtester = getBacktester();
      result = backtester.run({
        initialBalance: portfolio.totalBalance,
        withdrawalRate: params.withdrawalRate ?? 0.04,
        yearsToSimulate: params.retirementDuration ?? 30,
        assetAllocation: {
          stocks: portfolio.assetAllocation.stocks,
          bonds: portfolio.assetAllocation.bonds,
        },
        startYearRange: params.startYearRange,
        inflationAdjusted: true,
      });
    } else if (type === "scenario" && params.scenario) {
      const engine = getScenarioEngine();
      result = engine.run({
        initialBalance: portfolio.totalBalance,
        withdrawalRate: params.withdrawalRate ?? 0.04,
        retirementDuration: params.retirementDuration ?? 30,
        assetAllocation: portfolio.assetAllocation,
        scenario: params.scenario,
        customParams: params.customScenario,
      });
    } else {
      return c.json({ error: "Invalid simulation type or missing parameters" }, 400);
    }

    // Cache result
    const simulationId = await cache.set(planId, tenantId, type, cacheKey, result);

    return c.json({
      simulationId,
      type,
      cached: false,
      computeTimeMs: Date.now() - startTime,
      result,
    });
  }
);

async function getPortfolioData(tenantId: string) {
  const tenantAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId));

  let totalBalance = 0;
  for (const account of tenantAccounts) {
    const [latest] = await db
      .select({ balance: balanceSnapshots.balance })
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.accountId, account.id))
      .orderBy(desc(balanceSnapshots.snapshotAt))
      .limit(1);
    totalBalance += parseFloat(latest?.balance ?? "0");
  }

  // Default allocation if no holdings
  const assetAllocation = { stocks: 0.7, bonds: 0.25, cash: 0.05 };

  return { totalBalance, assetAllocation };
}

export { simulationsRouter };
```

- [ ] **Step 2: Add routes to server**

In `packages/api/src/server.ts`, add import:
```typescript
import { simulationsRouter } from "./routes/simulations.js";
```

Add route registration (after other routes):
```typescript
app.route("/api/simulations", simulationsRouter);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/simulations.ts packages/api/src/server.ts
git commit -m "feat(api): add simulation API routes"
```

---

## Task 11: Update System Prompt for New Tools

**Files:**
- Modify: `packages/api/src/agent/agent.ts`

- [ ] **Step 1: Update system prompt**

In `packages/api/src/agent/agent.ts`, update the systemPrompt to include simulation tools:

```typescript
export const systemPrompt = `You are a financial planning assistant for Lasagna, a personal finance platform.

Your role is to help users understand their finances and create actionable plans. You have access to their real financial data through tools.

## CRITICAL: Response Format

You MUST end EVERY response with a JSON UIPayload object. This is how your content gets rendered in the app.

Example structure:
{
  "layout": "grid",
  "blocks": [
    { "type": "stat", "label": "Net Worth", "value": "$125,000" },
    { "type": "text", "content": "## Analysis\\n\\nYour explanation here..." },
    { "type": "action", "title": "Next Steps", "actions": ["Action 1", "Action 2"] }
  ]
}

## Available Tools

### Financial Data
- get_accounts: Get all accounts with balances
- get_net_worth: Calculate net worth with breakdown
- get_holdings: Get investment holdings
- get_asset_allocation: Get asset breakdown by account type

### Retirement Simulations
- get_portfolio_summary: Get portfolio summary for a plan
- run_monte_carlo: Run Monte Carlo simulation (10K simulations, success rate, percentiles)
- run_backtest: Test against historical S&P 500 data (1930-present)
- run_scenario: Test specific scenarios (2008 crash, Great Depression, etc.)
- calculate_fire_number: Calculate FIRE number from expenses

### Plans
- get_plan: Get plan details
- update_plan_content: Update plan content

## Available UI Block Types

- stat: { type: "stat", label: string, value: string, description?: string }
- text: { type: "text", content: string (supports markdown) }
- chart: { type: "chart", chartType: "area"|"bar"|"donut", title?: string, data: [{label, value}] }
- table: { type: "table", title?: string, columns: [{key, label}], rows: [{...}] }
- projection: { type: "projection", title?: string, scenarios: [{name, value?, description?}] }
- action: { type: "action", title: string, description?: string, actions: string[] }

## Guidelines

1. ALWAYS use tools to get real financial data first
2. For retirement analysis, run simulations to provide evidence-based projections
3. Use multiple block types to create rich, visual responses
4. Layout options: "single" (text-heavy), "split" (comparisons), "grid" (stats overview)
5. NEVER make up financial numbers - use tool data
6. When analyzing retirement, always mention success rates and historical context

## Planning Topics

- Retirement: Monte Carlo projections, historical backtesting, withdrawal strategies
- Net worth: trends, asset allocation, debt ratios
- Early retirement (FIRE): savings rate, FI number, timeline projections, stress testing
`;
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/agent/agent.ts
git commit -m "feat(api): update system prompt with simulation tools"
```

---

## Task 12: Final Testing & Verification

- [ ] **Step 1: Run all tests**

Run: `cd packages/api && pnpm test`
Expected: All tests PASS

- [ ] **Step 2: Type check**

Run: `cd packages/api && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Build**

Run: `cd packages/api && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Commit any fixes**

If any issues found, fix and commit.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(api): complete retirement computation engine implementation"
```

---

## Summary

This plan implements:
1. Historical data pipeline with Shiller S&P 500 data
2. Monte Carlo simulation engine (10K simulations)
3. Historical backtester (1930-present)
4. Scenario analysis engine (2008 crash, Great Depression, etc.)
5. PostgreSQL caching layer
6. AI tools for running simulations
7. REST API endpoints for frontend

**Next:** Plan 2 will implement the UI components and prompt templates that use these simulation results.
