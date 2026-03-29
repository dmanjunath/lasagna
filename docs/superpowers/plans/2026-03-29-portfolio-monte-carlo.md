# Portfolio Composition & Probability of Success Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two interconnected pages: Portfolio Composition (shows aggregated holdings with ticker normalization) and Probability of Success (Monte Carlo + historical backtesting using actual portfolio allocation).

**Architecture:** Shared ticker-to-category mapping in core package. Backend services for portfolio aggregation and extended simulation engines (5 asset classes instead of 3). Frontend pages with drill-down hierarchy visualization and interactive parameter sliders.

**Tech Stack:** Hono (API), Drizzle (DB), React, Recharts, TypeScript, Vitest

---

## File Structure

### New Files
```
packages/core/src/
  ticker-categories.ts              # Shared ticker → category mapping

packages/api/src/
  services/portfolio-aggregator.ts  # Ticker normalization + grouping logic
  routes/portfolio.ts               # GET /api/portfolio/composition

packages/api/data/
  historical-returns.json           # Extended 1928-2024 multi-asset returns

packages/web/src/
  pages/portfolio-composition.tsx   # Portfolio composition page
  pages/probability-of-success.tsx  # Monte Carlo + backtest page
  lib/ticker-mapping.ts             # Re-export of core ticker mapping for frontend
  components/charts/stacked-bar-chart.tsx   # Horizontal stacked bar
  components/charts/treemap-chart.tsx       # Treemap visualization
  components/charts/fan-chart.tsx           # Percentile fan chart
  components/charts/histogram-chart.tsx     # End value distribution
  components/charts/rolling-periods-chart.tsx # Backtest bar chart
```

### Modified Files
```
packages/api/src/services/monte-carlo.ts      # Add 5 asset classes, p25/p75, sample paths
packages/api/src/services/backtester.ts       # Add 5 asset classes, proration
packages/api/src/services/historical-data.ts  # Load extended dataset
packages/api/src/routes/simulations.ts        # Update request/response types
packages/api/src/server.ts                    # Register portfolio routes
packages/web/src/components/layout/sidebar.tsx # Add Analysis section
packages/web/src/App.tsx                       # Add new routes
packages/web/src/lib/api.ts                    # Add API client methods
```

---

## Task 1: Ticker Categories Mapping (Core)

**Files:**
- Create: `packages/core/src/ticker-categories.ts`
- Create: `packages/core/src/__tests__/ticker-categories.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/ticker-categories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getTickerCategory,
  ASSET_CLASS_COLORS,
  type AssetClass,
  type SubCategory
} from '../ticker-categories';

describe('ticker-categories', () => {
  describe('getTickerCategory', () => {
    it('returns US Stocks / Total Market for VTI', () => {
      const result = getTickerCategory('VTI');
      expect(result).toEqual({
        assetClass: 'US Stocks',
        subCategory: 'Total Market',
        color: '#4ade80',
      });
    });

    it('returns US Stocks / S&P 500 for VOO', () => {
      const result = getTickerCategory('VOO');
      expect(result).toEqual({
        assetClass: 'US Stocks',
        subCategory: 'S&P 500',
        color: '#4ade80',
      });
    });

    it('returns International Stocks / Developed for VEA', () => {
      const result = getTickerCategory('VEA');
      expect(result).toEqual({
        assetClass: 'International Stocks',
        subCategory: 'Developed',
        color: '#60a5fa',
      });
    });

    it('returns Bonds / Total Bond for BND', () => {
      const result = getTickerCategory('BND');
      expect(result).toEqual({
        assetClass: 'Bonds',
        subCategory: 'Total Bond',
        color: '#f59e0b',
      });
    });

    it('returns REITs / US REITs for VNQ', () => {
      const result = getTickerCategory('VNQ');
      expect(result).toEqual({
        assetClass: 'REITs',
        subCategory: 'US REITs',
        color: '#8b5cf6',
      });
    });

    it('returns Cash / Money Market for VMFXX', () => {
      const result = getTickerCategory('VMFXX');
      expect(result).toEqual({
        assetClass: 'Cash',
        subCategory: 'Money Market',
        color: '#ec4899',
      });
    });

    it('returns Other / Unknown for unmapped ticker', () => {
      const result = getTickerCategory('UNKNOWN123');
      expect(result).toEqual({
        assetClass: 'Other',
        subCategory: 'Unknown',
        color: '#a8a29e',
      });
    });

    it('handles lowercase tickers', () => {
      const result = getTickerCategory('vti');
      expect(result.assetClass).toBe('US Stocks');
    });
  });

  describe('ASSET_CLASS_COLORS', () => {
    it('has correct colors for all asset classes', () => {
      expect(ASSET_CLASS_COLORS['US Stocks']).toBe('#4ade80');
      expect(ASSET_CLASS_COLORS['International Stocks']).toBe('#60a5fa');
      expect(ASSET_CLASS_COLORS['Bonds']).toBe('#f59e0b');
      expect(ASSET_CLASS_COLORS['REITs']).toBe('#8b5cf6');
      expect(ASSET_CLASS_COLORS['Cash']).toBe('#ec4899');
      expect(ASSET_CLASS_COLORS['Other']).toBe('#a8a29e');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && pnpm test ticker-categories`
Expected: FAIL with "Cannot find module '../ticker-categories'"

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/ticker-categories.ts`:

```typescript
export type AssetClass =
  | 'US Stocks'
  | 'International Stocks'
  | 'Bonds'
  | 'REITs'
  | 'Cash'
  | 'Other';

export type SubCategory = string;

export interface TickerCategory {
  assetClass: AssetClass;
  subCategory: SubCategory;
  color: string;
}

export const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  'US Stocks': '#4ade80',
  'International Stocks': '#60a5fa',
  'Bonds': '#f59e0b',
  'REITs': '#8b5cf6',
  'Cash': '#ec4899',
  'Other': '#a8a29e',
};

// Ticker → [AssetClass, SubCategory]
const TICKER_MAP: Record<string, [AssetClass, SubCategory]> = {
  // US Stocks - Total Market
  VTI: ['US Stocks', 'Total Market'],
  VTSAX: ['US Stocks', 'Total Market'],
  ITOT: ['US Stocks', 'Total Market'],
  SWTSX: ['US Stocks', 'Total Market'],
  FSKAX: ['US Stocks', 'Total Market'],
  FZROX: ['US Stocks', 'Total Market'],
  VTSMX: ['US Stocks', 'Total Market'],

  // US Stocks - S&P 500
  VOO: ['US Stocks', 'S&P 500'],
  VFIAX: ['US Stocks', 'S&P 500'],
  SPY: ['US Stocks', 'S&P 500'],
  IVV: ['US Stocks', 'S&P 500'],
  FXAIX: ['US Stocks', 'S&P 500'],
  SWPPX: ['US Stocks', 'S&P 500'],
  VFINX: ['US Stocks', 'S&P 500'],

  // US Stocks - Growth
  VUG: ['US Stocks', 'Growth'],
  VIGAX: ['US Stocks', 'Growth'],
  VOOG: ['US Stocks', 'Growth'],
  IWF: ['US Stocks', 'Growth'],
  SCHG: ['US Stocks', 'Growth'],
  QQQ: ['US Stocks', 'Growth'],
  QQQM: ['US Stocks', 'Growth'],

  // US Stocks - Value
  VTV: ['US Stocks', 'Value'],
  VVIAX: ['US Stocks', 'Value'],
  VOOV: ['US Stocks', 'Value'],
  IWD: ['US Stocks', 'Value'],
  SCHV: ['US Stocks', 'Value'],

  // US Stocks - Small Cap
  VB: ['US Stocks', 'Small Cap'],
  VSMAX: ['US Stocks', 'Small Cap'],
  IJR: ['US Stocks', 'Small Cap'],
  SCHA: ['US Stocks', 'Small Cap'],
  VBR: ['US Stocks', 'Small Cap'],
  VISVX: ['US Stocks', 'Small Cap'],

  // US Stocks - Mid Cap
  VO: ['US Stocks', 'Mid Cap'],
  VIMAX: ['US Stocks', 'Mid Cap'],
  IJH: ['US Stocks', 'Mid Cap'],
  SCHM: ['US Stocks', 'Mid Cap'],

  // US Stocks - Dividend
  VYM: ['US Stocks', 'Dividend'],
  VHYAX: ['US Stocks', 'Dividend'],
  SCHD: ['US Stocks', 'Dividend'],
  DVY: ['US Stocks', 'Dividend'],

  // International Stocks - Developed
  VEA: ['International Stocks', 'Developed'],
  EFA: ['International Stocks', 'Developed'],
  IEFA: ['International Stocks', 'Developed'],
  SWISX: ['International Stocks', 'Developed'],

  // International Stocks - Emerging
  VWO: ['International Stocks', 'Emerging'],
  VEMAX: ['International Stocks', 'Emerging'],
  IEMG: ['International Stocks', 'Emerging'],
  EEM: ['International Stocks', 'Emerging'],
  SCHE: ['International Stocks', 'Emerging'],

  // International Stocks - Total International
  VXUS: ['International Stocks', 'Total International'],
  VTIAX: ['International Stocks', 'Total International'],
  IXUS: ['International Stocks', 'Total International'],
  FZILX: ['International Stocks', 'Total International'],

  // Bonds - Total Bond
  BND: ['Bonds', 'Total Bond'],
  VBTLX: ['Bonds', 'Total Bond'],
  AGG: ['Bonds', 'Total Bond'],
  SCHZ: ['Bonds', 'Total Bond'],
  FXNAX: ['Bonds', 'Total Bond'],

  // Bonds - Corporate
  VCIT: ['Bonds', 'Corporate'],
  LQD: ['Bonds', 'Corporate'],
  VCLT: ['Bonds', 'Corporate'],

  // Bonds - Government
  VGIT: ['Bonds', 'Government'],
  GOVT: ['Bonds', 'Government'],
  IEF: ['Bonds', 'Government'],
  TLT: ['Bonds', 'Government'],
  VGLT: ['Bonds', 'Government'],

  // Bonds - TIPS
  VTIP: ['Bonds', 'TIPS'],
  TIP: ['Bonds', 'TIPS'],
  SCHP: ['Bonds', 'TIPS'],
  VAIPX: ['Bonds', 'TIPS'],

  // Bonds - Municipal
  VTEB: ['Bonds', 'Municipal'],
  MUB: ['Bonds', 'Municipal'],
  VWITX: ['Bonds', 'Municipal'],

  // REITs - US
  VNQ: ['REITs', 'US REITs'],
  VGSLX: ['REITs', 'US REITs'],
  IYR: ['REITs', 'US REITs'],
  SCHH: ['REITs', 'US REITs'],
  FREL: ['REITs', 'US REITs'],

  // REITs - International
  VNQI: ['REITs', 'International REITs'],
  VGRLX: ['REITs', 'International REITs'],

  // Cash - Money Market
  VMFXX: ['Cash', 'Money Market'],
  SPAXX: ['Cash', 'Money Market'],
  FDRXX: ['Cash', 'Money Market'],
  SWVXX: ['Cash', 'Money Market'],

  // Cash - Short Term
  VGSH: ['Cash', 'Short-Term'],
  SHY: ['Cash', 'Short-Term'],
  BIL: ['Cash', 'Short-Term'],
  SGOV: ['Cash', 'Short-Term'],
};

export function getTickerCategory(ticker: string): TickerCategory {
  const upperTicker = ticker.toUpperCase();
  const mapping = TICKER_MAP[upperTicker];

  if (mapping) {
    const [assetClass, subCategory] = mapping;
    return {
      assetClass,
      subCategory,
      color: ASSET_CLASS_COLORS[assetClass],
    };
  }

  return {
    assetClass: 'Other',
    subCategory: 'Unknown',
    color: ASSET_CLASS_COLORS['Other'],
  };
}

export function getTickerCategoryWithFallback(
  ticker: string,
  securityType?: string
): TickerCategory {
  const upperTicker = ticker.toUpperCase();
  const mapping = TICKER_MAP[upperTicker];

  if (mapping) {
    const [assetClass, subCategory] = mapping;
    return {
      assetClass,
      subCategory,
      color: ASSET_CLASS_COLORS[assetClass],
    };
  }

  // Use security type as fallback sub-category
  const subCategory = securityType || 'Unknown';
  return {
    assetClass: 'Other',
    subCategory,
    color: ASSET_CLASS_COLORS['Other'],
  };
}
```

- [ ] **Step 4: Export from index**

Modify `packages/core/src/index.ts` to add:

```typescript
export * from "./ticker-categories.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && pnpm test ticker-categories`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ticker-categories.ts packages/core/src/__tests__/ticker-categories.test.ts packages/core/src/index.ts
git commit -m "feat(core): add ticker-to-category mapping for portfolio aggregation"
```

---

## Task 2: Extended Historical Data

**Files:**
- Create: `packages/api/data/historical-returns.json`
- Modify: `packages/api/src/services/historical-data.ts`
- Modify: `packages/api/src/services/__tests__/historical-data.test.ts`

- [ ] **Step 1: Create the extended historical returns data file**

Create `packages/api/data/historical-returns.json` with structure:

```json
{
  "source": "NYU Stern Damodaran, MSCI, NAREIT",
  "url": "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html",
  "updatedAt": "2024-12-01",
  "startYear": 1928,
  "endYear": 2024,
  "assetClasses": ["usStocks", "bonds", "cash", "intlStocks", "reits"],
  "data": [
    {
      "year": 1928,
      "usStocks": 0.4381,
      "bonds": 0.0084,
      "cash": 0.0308,
      "inflation": -0.0116,
      "intlStocks": null,
      "reits": null
    },
    {
      "year": 1929,
      "usStocks": -0.0830,
      "bonds": 0.0420,
      "cash": 0.0316,
      "inflation": 0.0058,
      "intlStocks": null,
      "reits": null
    }
  ]
}
```

Note: The full dataset needs to be populated with actual historical data. For MVP, include years 1928-2024 with:
- US Stocks (S&P 500 total return)
- Bonds (10-year Treasury)
- Cash (T-Bills)
- International Stocks (null before 1970, MSCI EAFE after)
- REITs (null before 1972, NAREIT after)

- [ ] **Step 2: Write test for extended historical data service**

Update `packages/api/src/services/__tests__/historical-data.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getHistoricalDataService } from '../historical-data';

describe('HistoricalDataService', () => {
  const service = getHistoricalDataService();

  describe('getAvailableYearRange', () => {
    it('returns 1928 as start year', () => {
      const { startYear } = service.getAvailableYearRange();
      expect(startYear).toBe(1928);
    });
  });

  describe('getReturnsForYear', () => {
    it('returns all asset class returns for a year', () => {
      const returns = service.getReturnsForYear(2020);
      expect(returns).toHaveProperty('usStocks');
      expect(returns).toHaveProperty('bonds');
      expect(returns).toHaveProperty('cash');
      expect(returns).toHaveProperty('intlStocks');
      expect(returns).toHaveProperty('reits');
    });

    it('returns null for intlStocks before 1970', () => {
      const returns = service.getReturnsForYear(1960);
      expect(returns?.intlStocks).toBeNull();
    });

    it('returns null for reits before 1972', () => {
      const returns = service.getReturnsForYear(1970);
      expect(returns?.reits).toBeNull();
    });
  });

  describe('prorateAllocation', () => {
    it('prorates when intl and reits are null', () => {
      const allocation = {
        usStocks: 0.5,
        intlStocks: 0.2,
        bonds: 0.2,
        reits: 0.05,
        cash: 0.05,
      };
      const result = service.prorateAllocation(allocation, 1960);

      // intl + reits (25%) redistributed to us + bonds (70%)
      // us: 0.5 + (0.5/0.7 * 0.25) ≈ 0.679
      // bonds: 0.2 + (0.2/0.7 * 0.25) ≈ 0.271
      expect(result.usStocks + result.bonds + result.cash).toBeCloseTo(1);
      expect(result.intlStocks).toBe(0);
      expect(result.reits).toBe(0);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/api && pnpm test historical-data`
Expected: FAIL

- [ ] **Step 4: Update historical data service implementation**

Modify `packages/api/src/services/historical-data.ts`:

```typescript
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

export class HistoricalDataService {
  private dataset: HistoricalDataset;

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
}

let instance: HistoricalDataService | null = null;

export function getHistoricalDataService(): HistoricalDataService {
  if (!instance) {
    instance = new HistoricalDataService();
  }
  return instance;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/api && pnpm test historical-data`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/api/data/historical-returns.json packages/api/src/services/historical-data.ts packages/api/src/services/__tests__/historical-data.test.ts
git commit -m "feat(api): extend historical data service with 5 asset classes and proration"
```

---

## Task 3: Extend Monte Carlo Engine

**Files:**
- Modify: `packages/api/src/services/monte-carlo.ts`
- Modify: `packages/api/src/services/__tests__/monte-carlo.test.ts`

- [ ] **Step 1: Write failing tests for extended Monte Carlo**

Update `packages/api/src/services/__tests__/monte-carlo.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MonteCarloEngine } from '../monte-carlo';

describe('MonteCarloEngine', () => {
  const engine = new MonteCarloEngine();

  describe('run with 5 asset classes', () => {
    it('accepts 5-asset allocation', () => {
      const result = engine.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 30,
        assetAllocation: {
          usStocks: 0.4,
          intlStocks: 0.2,
          bonds: 0.3,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: true,
        numSimulations: 100,
      });

      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(1);
    });

    it('returns p25 and p75 percentiles', () => {
      const result = engine.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 10,
        assetAllocation: {
          usStocks: 0.6,
          intlStocks: 0,
          bonds: 0.4,
          reits: 0,
          cash: 0,
        },
        inflationAdjusted: false,
        numSimulations: 100,
      });

      expect(result.percentiles.p25).toBeDefined();
      expect(result.percentiles.p75).toBeDefined();
      expect(result.percentiles.p25.length).toBe(11); // year 0 to 10
      expect(result.percentiles.p75.length).toBe(11);
    });

    it('returns sample paths for spaghetti visualization', () => {
      const result = engine.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 10,
        assetAllocation: {
          usStocks: 0.6,
          intlStocks: 0.1,
          bonds: 0.2,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: false,
        numSimulations: 100,
        includeSamplePaths: true,
        numSamplePaths: 50,
      });

      expect(result.samplePaths).toBeDefined();
      expect(result.samplePaths!.length).toBeLessThanOrEqual(50);
    });

    it('returns histogram buckets', () => {
      const result = engine.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 10,
        assetAllocation: {
          usStocks: 0.6,
          intlStocks: 0.1,
          bonds: 0.2,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: false,
        numSimulations: 100,
      });

      expect(result.histogram).toBeDefined();
      expect(result.histogram.length).toBeGreaterThan(0);
      expect(result.histogram[0]).toHaveProperty('bucket');
      expect(result.histogram[0]).toHaveProperty('count');
      expect(result.histogram[0]).toHaveProperty('status');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test monte-carlo`
Expected: FAIL

- [ ] **Step 3: Update Monte Carlo implementation**

Rewrite `packages/api/src/services/monte-carlo.ts` with extended functionality:

```typescript
/**
 * Monte Carlo simulation engine for retirement planning.
 * Supports 5 asset classes with stochastic returns.
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
  withdrawalRate: number;
  yearsToSimulate: number;
  assetAllocation: AssetAllocation;
  inflationAdjusted: boolean;
  numSimulations: number;
  includeSamplePaths?: boolean;
  numSamplePaths?: number;
}

export interface HistogramBucket {
  bucket: string;
  count: number;
  status: 'success' | 'close' | 'failure';
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
    mean: number;
    median: number;
    stdDev: number;
  };
  failureStats: {
    avgYearsUntilFailure: number | null;
    medianYearsUntilFailure: number | null;
  };
  histogram: HistogramBucket[];
  samplePaths?: number[][];
}

// Asset class return models (mean, stdDev)
const ASSET_MODELS = {
  usStocks: { mean: 0.10, stdDev: 0.18 },
  intlStocks: { mean: 0.08, stdDev: 0.20 },
  bonds: { mean: 0.05, stdDev: 0.07 },
  reits: { mean: 0.09, stdDev: 0.22 },
  cash: { mean: 0.02, stdDev: 0.01 },
  inflation: { mean: 0.03, stdDev: 0.01 },
};

export class MonteCarloEngine {
  run(params: MonteCarloParams): MonteCarloResult {
    const simulations: number[][] = [];
    const failureYears: number[] = [];
    let successCount = 0;

    for (let i = 0; i < params.numSimulations; i++) {
      const simulation = this.runSingleSimulation(params);
      simulations.push(simulation);

      const failed = simulation.some((balance) => balance <= 0);
      if (!failed) {
        successCount++;
      } else {
        const failureYear = simulation.findIndex((balance) => balance <= 0);
        if (failureYear !== -1) {
          failureYears.push(failureYear);
        }
      }
    }

    const successRate = successCount / params.numSimulations;
    const percentiles = this.calculatePercentiles(simulations, params.yearsToSimulate);
    const finalBalances = simulations.map((sim) => sim[sim.length - 1]);
    const distribution = this.calculateDistribution(finalBalances);
    const failureStats = this.calculateFailureStats(failureYears);
    const histogram = this.calculateHistogram(finalBalances, params.initialBalance);

    const result: MonteCarloResult = {
      successRate,
      percentiles,
      finalBalanceDistribution: distribution,
      failureStats,
      histogram,
    };

    if (params.includeSamplePaths) {
      const numPaths = Math.min(params.numSamplePaths || 50, simulations.length);
      result.samplePaths = this.selectSamplePaths(simulations, numPaths);
    }

    return result;
  }

  private runSingleSimulation(params: MonteCarloParams): number[] {
    const balances: number[] = [params.initialBalance];
    let currentBalance = params.initialBalance;
    const annualWithdrawal = params.initialBalance * params.withdrawalRate;

    for (let year = 1; year <= params.yearsToSimulate; year++) {
      const portfolioReturn = this.generatePortfolioReturn(params.assetAllocation);
      currentBalance *= 1 + portfolioReturn;

      let withdrawal = annualWithdrawal;
      if (params.inflationAdjusted) {
        const inflation = this.randomNormal(
          ASSET_MODELS.inflation.mean,
          ASSET_MODELS.inflation.stdDev
        );
        withdrawal = annualWithdrawal * Math.pow(1 + inflation, year);
      }

      currentBalance -= withdrawal;
      currentBalance = Math.max(0, currentBalance);
      balances.push(currentBalance);
    }

    return balances;
  }

  private generatePortfolioReturn(allocation: AssetAllocation): number {
    const usReturn = this.randomNormal(ASSET_MODELS.usStocks.mean, ASSET_MODELS.usStocks.stdDev);
    const intlReturn = this.randomNormal(ASSET_MODELS.intlStocks.mean, ASSET_MODELS.intlStocks.stdDev);
    const bondReturn = this.randomNormal(ASSET_MODELS.bonds.mean, ASSET_MODELS.bonds.stdDev);
    const reitReturn = this.randomNormal(ASSET_MODELS.reits.mean, ASSET_MODELS.reits.stdDev);
    const cashReturn = this.randomNormal(ASSET_MODELS.cash.mean, ASSET_MODELS.cash.stdDev);

    return (
      usReturn * allocation.usStocks +
      intlReturn * allocation.intlStocks +
      bondReturn * allocation.bonds +
      reitReturn * allocation.reits +
      cashReturn * allocation.cash
    );
  }

  private randomNormal(mean: number, stdDev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stdDev * z0;
  }

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

  private percentile(sorted: number[], p: number): number {
    const index = Math.floor(sorted.length * p);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  private calculateDistribution(values: number[]): MonteCarloResult["finalBalanceDistribution"] {
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return { mean, median, stdDev };
  }

  private calculateFailureStats(failureYears: number[]): MonteCarloResult["failureStats"] {
    if (failureYears.length === 0) {
      return { avgYearsUntilFailure: null, medianYearsUntilFailure: null };
    }
    const sorted = [...failureYears].sort((a, b) => a - b);
    const avg = failureYears.reduce((sum, year) => sum + year, 0) / failureYears.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    return { avgYearsUntilFailure: avg, medianYearsUntilFailure: median };
  }

  private calculateHistogram(finalBalances: number[], initialBalance: number): HistogramBucket[] {
    const buckets: HistogramBucket[] = [];
    const maxValue = Math.max(...finalBalances) * 1.1;
    const bucketSize = maxValue / 10;

    for (let i = 0; i < 10; i++) {
      const min = i * bucketSize;
      const max = (i + 1) * bucketSize;
      const count = finalBalances.filter((b) => b >= min && b < max).length;

      // Status based on balance relative to initial
      let status: 'success' | 'close' | 'failure';
      if (min >= initialBalance * 0.5) {
        status = 'success';
      } else if (min >= initialBalance * 0.1) {
        status = 'close';
      } else {
        status = 'failure';
      }

      buckets.push({
        bucket: min < 1000 ? `$${min.toFixed(0)}` : `$${(min / 1000).toFixed(0)}K`,
        count,
        status,
      });
    }

    return buckets;
  }

  private selectSamplePaths(simulations: number[][], numPaths: number): number[][] {
    // Select evenly distributed paths
    const step = Math.max(1, Math.floor(simulations.length / numPaths));
    const paths: number[][] = [];
    for (let i = 0; i < simulations.length && paths.length < numPaths; i += step) {
      paths.push(simulations[i]);
    }
    return paths;
  }
}

let monteCarloEngineInstance: MonteCarloEngine | null = null;

export function getMonteCarloEngine(): MonteCarloEngine {
  if (!monteCarloEngineInstance) {
    monteCarloEngineInstance = new MonteCarloEngine();
  }
  return monteCarloEngineInstance;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm test monte-carlo`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/monte-carlo.ts packages/api/src/services/__tests__/monte-carlo.test.ts
git commit -m "feat(api): extend Monte Carlo engine with 5 asset classes, p25/p75, histogram, sample paths"
```

---

## Task 4: Extend Backtester

**Files:**
- Modify: `packages/api/src/services/backtester.ts`
- Modify: `packages/api/src/services/__tests__/backtester.test.ts`

- [ ] **Step 1: Write failing tests for extended backtester**

Update `packages/api/src/services/__tests__/backtester.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Backtester } from '../backtester';

describe('Backtester', () => {
  const backtester = new Backtester();

  describe('run with 5 asset classes', () => {
    it('accepts 5-asset allocation', () => {
      const result = backtester.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 30,
        assetAllocation: {
          usStocks: 0.5,
          intlStocks: 0.2,
          bonds: 0.2,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: true,
      });

      expect(result.totalPeriods).toBeGreaterThan(0);
      expect(result.successRate).toBeGreaterThanOrEqual(0);
      expect(result.successRate).toBeLessThanOrEqual(1);
    });

    it('returns period details with worstDrawdown', () => {
      const result = backtester.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 20,
        assetAllocation: {
          usStocks: 0.6,
          intlStocks: 0.1,
          bonds: 0.2,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: false,
      });

      expect(result.periods.length).toBeGreaterThan(0);
      expect(result.periods[0]).toHaveProperty('startYear');
      expect(result.periods[0]).toHaveProperty('endBalance');
      expect(result.periods[0]).toHaveProperty('status');
      expect(result.periods[0]).toHaveProperty('worstDrawdown');
    });

    it('handles proration for early years', () => {
      const result = backtester.run({
        initialBalance: 1000000,
        withdrawalRate: 0.04,
        yearsToSimulate: 10,
        assetAllocation: {
          usStocks: 0.3,
          intlStocks: 0.3,
          bonds: 0.3,
          reits: 0.05,
          cash: 0.05,
        },
        inflationAdjusted: false,
        startYearRange: { from: 1960, to: 1970 },
      });

      // Should still run even though intl/reits have no data
      expect(result.totalPeriods).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test backtester`
Expected: FAIL

- [ ] **Step 3: Update backtester implementation**

Rewrite `packages/api/src/services/backtester.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm test backtester`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/backtester.ts packages/api/src/services/__tests__/backtester.test.ts
git commit -m "feat(api): extend backtester with 5 asset classes and allocation proration"
```

---

## Task 5: Portfolio Aggregator Service

**Files:**
- Create: `packages/api/src/services/portfolio-aggregator.ts`
- Create: `packages/api/src/services/__tests__/portfolio-aggregator.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/api/src/services/__tests__/portfolio-aggregator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { aggregatePortfolio } from '../portfolio-aggregator';

describe('portfolio-aggregator', () => {
  describe('aggregatePortfolio', () => {
    it('groups holdings by asset class and sub-category', () => {
      const holdings = [
        { ticker: 'VTI', value: 50000, shares: 200, name: 'Vanguard Total Stock', account: 'Vanguard IRA', costBasis: 40000 },
        { ticker: 'VTSAX', value: 30000, shares: 300, name: 'Vanguard Total Stock Admiral', account: 'Fidelity 401k', costBasis: 25000 },
        { ticker: 'BND', value: 20000, shares: 250, name: 'Vanguard Total Bond', account: 'Vanguard IRA', costBasis: 19000 },
      ];

      const result = aggregatePortfolio(holdings);

      expect(result.totalValue).toBe(100000);
      expect(result.assetClasses.length).toBe(2); // US Stocks, Bonds

      const usStocks = result.assetClasses.find(a => a.name === 'US Stocks');
      expect(usStocks).toBeDefined();
      expect(usStocks!.value).toBe(80000);
      expect(usStocks!.subCategories.length).toBe(1); // Total Market
      expect(usStocks!.subCategories[0].name).toBe('Total Market');
      expect(usStocks!.subCategories[0].holdings.length).toBe(2);
    });

    it('calculates percentages correctly', () => {
      const holdings = [
        { ticker: 'VTI', value: 60000, shares: 200, name: 'VTI', account: 'Test', costBasis: null },
        { ticker: 'BND', value: 40000, shares: 500, name: 'BND', account: 'Test', costBasis: null },
      ];

      const result = aggregatePortfolio(holdings);

      const usStocks = result.assetClasses.find(a => a.name === 'US Stocks')!;
      expect(usStocks.percentage).toBe(60);

      const bonds = result.assetClasses.find(a => a.name === 'Bonds')!;
      expect(bonds.percentage).toBe(40);
    });

    it('places unmapped tickers in Other category', () => {
      const holdings = [
        { ticker: 'UNKNOWN123', value: 10000, shares: 100, name: 'Unknown Stock', account: 'Test', costBasis: null },
      ];

      const result = aggregatePortfolio(holdings);

      const other = result.assetClasses.find(a => a.name === 'Other');
      expect(other).toBeDefined();
      expect(other!.value).toBe(10000);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm test portfolio-aggregator`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `packages/api/src/services/portfolio-aggregator.ts`:

```typescript
import { getTickerCategory, ASSET_CLASS_COLORS, type AssetClass } from "@lasagna/core";

export interface HoldingInput {
  ticker: string;
  value: number;
  shares: number;
  name: string;
  account: string;
  costBasis: number | null;
  securityType?: string;
}

export interface Holding {
  ticker: string;
  name: string;
  shares: number;
  value: number;
  costBasis: number | null;
  account: string;
}

export interface SubCategory {
  name: string;
  value: number;
  percentage: number;
  holdings: Holding[];
}

export interface AssetClassGroup {
  name: string;
  value: number;
  percentage: number;
  color: string;
  subCategories: SubCategory[];
}

export interface PortfolioComposition {
  totalValue: number;
  assetClasses: AssetClassGroup[];
}

export function aggregatePortfolio(holdings: HoldingInput[]): PortfolioComposition {
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  if (totalValue === 0) {
    return { totalValue: 0, assetClasses: [] };
  }

  // Group by asset class -> sub-category -> holdings
  const assetClassMap = new Map<string, Map<string, Holding[]>>();

  for (const holding of holdings) {
    const category = getTickerCategory(holding.ticker);

    if (!assetClassMap.has(category.assetClass)) {
      assetClassMap.set(category.assetClass, new Map());
    }

    const subCategoryMap = assetClassMap.get(category.assetClass)!;
    if (!subCategoryMap.has(category.subCategory)) {
      subCategoryMap.set(category.subCategory, []);
    }

    subCategoryMap.get(category.subCategory)!.push({
      ticker: holding.ticker,
      name: holding.name,
      shares: holding.shares,
      value: holding.value,
      costBasis: holding.costBasis,
      account: holding.account,
    });
  }

  // Build structured result
  const assetClasses: AssetClassGroup[] = [];

  for (const [assetClassName, subCategoryMap] of assetClassMap) {
    const subCategories: SubCategory[] = [];
    let assetClassValue = 0;

    for (const [subCategoryName, holdingsList] of subCategoryMap) {
      const subCategoryValue = holdingsList.reduce((sum, h) => sum + h.value, 0);
      assetClassValue += subCategoryValue;

      subCategories.push({
        name: subCategoryName,
        value: subCategoryValue,
        percentage: (subCategoryValue / totalValue) * 100,
        holdings: holdingsList.sort((a, b) => b.value - a.value),
      });
    }

    assetClasses.push({
      name: assetClassName,
      value: assetClassValue,
      percentage: (assetClassValue / totalValue) * 100,
      color: ASSET_CLASS_COLORS[assetClassName as AssetClass] || ASSET_CLASS_COLORS['Other'],
      subCategories: subCategories.sort((a, b) => b.value - a.value),
    });
  }

  // Sort asset classes by value descending
  assetClasses.sort((a, b) => b.value - a.value);

  return { totalValue, assetClasses };
}

/**
 * Extract allocation percentages for simulation
 */
export function extractAllocation(composition: PortfolioComposition): {
  usStocks: number;
  intlStocks: number;
  bonds: number;
  reits: number;
  cash: number;
} {
  const findPercentage = (name: string) => {
    const assetClass = composition.assetClasses.find(a => a.name === name);
    return assetClass ? assetClass.percentage / 100 : 0;
  };

  return {
    usStocks: findPercentage('US Stocks'),
    intlStocks: findPercentage('International Stocks'),
    bonds: findPercentage('Bonds'),
    reits: findPercentage('REITs'),
    cash: findPercentage('Cash'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm test portfolio-aggregator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/portfolio-aggregator.ts packages/api/src/services/__tests__/portfolio-aggregator.test.ts
git commit -m "feat(api): add portfolio aggregator service for ticker normalization"
```

---

## Task 6: Portfolio API Route

**Files:**
- Create: `packages/api/src/routes/portfolio.ts`
- Modify: `packages/api/src/server.ts`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Create portfolio route**

Create `packages/api/src/routes/portfolio.ts`:

```typescript
import { Hono } from "hono";
import { eq, desc, holdings, securities, accounts } from "@lasagna/core";
import { db } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { aggregatePortfolio, extractAllocation, type HoldingInput } from "../services/portfolio-aggregator.js";

export const portfolioRoutes = new Hono<AuthEnv>();
portfolioRoutes.use("*", requireAuth);

portfolioRoutes.get("/composition", async (c) => {
  const session = c.get("session");

  // Get latest holdings with securities info
  const rows = await db.query.holdings.findMany({
    where: eq(holdings.tenantId, session.tenantId),
    orderBy: desc(holdings.snapshotAt),
  });

  // Deduplicate by taking most recent snapshot per security+account
  const latestHoldings = new Map<string, typeof rows[0]>();
  for (const row of rows) {
    const key = `${row.accountId}-${row.securityId}`;
    if (!latestHoldings.has(key)) {
      latestHoldings.set(key, row);
    }
  }

  // Enrich with security and account info
  const holdingsInput: HoldingInput[] = [];

  for (const h of latestHoldings.values()) {
    const sec = await db.query.securities.findFirst({
      where: eq(securities.id, h.securityId),
    });
    const acct = await db.query.accounts.findFirst({
      where: eq(accounts.id, h.accountId),
    });

    if (sec && acct) {
      holdingsInput.push({
        ticker: sec.tickerSymbol || 'UNKNOWN',
        value: parseFloat(h.institutionValue || '0'),
        shares: parseFloat(h.quantity || '0'),
        name: sec.name || sec.tickerSymbol || 'Unknown Security',
        account: acct.name,
        costBasis: h.costBasis ? parseFloat(h.costBasis) : null,
        securityType: sec.type || undefined,
      });
    }
  }

  const composition = aggregatePortfolio(holdingsInput);

  return c.json(composition);
});

portfolioRoutes.get("/allocation", async (c) => {
  const session = c.get("session");

  // Reuse composition logic
  const compositionResponse = await portfolioRoutes.request(
    new Request(`http://localhost/composition`),
    { session }
  );

  // Simplified: just return allocation percentages
  const rows = await db.query.holdings.findMany({
    where: eq(holdings.tenantId, session.tenantId),
    orderBy: desc(holdings.snapshotAt),
  });

  const latestHoldings = new Map<string, typeof rows[0]>();
  for (const row of rows) {
    const key = `${row.accountId}-${row.securityId}`;
    if (!latestHoldings.has(key)) {
      latestHoldings.set(key, row);
    }
  }

  const holdingsInput: HoldingInput[] = [];

  for (const h of latestHoldings.values()) {
    const sec = await db.query.securities.findFirst({
      where: eq(securities.id, h.securityId),
    });
    const acct = await db.query.accounts.findFirst({
      where: eq(accounts.id, h.accountId),
    });

    if (sec && acct) {
      holdingsInput.push({
        ticker: sec.tickerSymbol || 'UNKNOWN',
        value: parseFloat(h.institutionValue || '0'),
        shares: parseFloat(h.quantity || '0'),
        name: sec.name || sec.tickerSymbol || 'Unknown Security',
        account: acct.name,
        costBasis: h.costBasis ? parseFloat(h.costBasis) : null,
      });
    }
  }

  const composition = aggregatePortfolio(holdingsInput);
  const allocation = extractAllocation(composition);

  return c.json({
    allocation,
    totalValue: composition.totalValue,
  });
});
```

- [ ] **Step 2: Register route in server.ts**

Add to `packages/api/src/server.ts`:

```typescript
import { portfolioRoutes } from "./routes/portfolio.js";
// ... existing imports

// Add after other routes
app.route("/api/portfolio", portfolioRoutes);
```

- [ ] **Step 3: Add API client methods**

Add to `packages/web/src/lib/api.ts`:

```typescript
// Portfolio
getPortfolioComposition: () =>
  request<{
    totalValue: number;
    assetClasses: Array<{
      name: string;
      value: number;
      percentage: number;
      color: string;
      subCategories: Array<{
        name: string;
        value: number;
        percentage: number;
        holdings: Array<{
          ticker: string;
          name: string;
          shares: number;
          value: number;
          costBasis: number | null;
          account: string;
        }>;
      }>;
    }>;
  }>("/portfolio/composition"),

getPortfolioAllocation: () =>
  request<{
    allocation: {
      usStocks: number;
      intlStocks: number;
      bonds: number;
      reits: number;
      cash: number;
    };
    totalValue: number;
  }>("/portfolio/allocation"),
```

- [ ] **Step 4: Test manually**

Run: `pnpm dev`
Test: `curl http://localhost:3000/api/portfolio/composition` (with auth)

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/portfolio.ts packages/api/src/server.ts packages/web/src/lib/api.ts
git commit -m "feat(api): add portfolio composition and allocation endpoints"
```

---

## Task 7: Stacked Bar Chart Component

**Files:**
- Create: `packages/web/src/components/charts/stacked-bar-chart.tsx`

- [ ] **Step 1: Create stacked bar chart component**

Create `packages/web/src/components/charts/stacked-bar-chart.tsx`:

```typescript
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { colors } from '../../styles/theme';

interface StackedBarDataPoint {
  name: string;
  value: number;
  color: string;
}

interface StackedBarChartProps {
  data: StackedBarDataPoint[];
  height?: number;
  onClick?: (name: string) => void;
}

export function StackedBarChart({
  data,
  height = 60,
  onClick,
}: StackedBarChartProps) {
  // Transform to single stacked bar format
  const totalValue = data.reduce((sum, d) => sum + d.value, 0);
  const chartData = [
    data.reduce((acc, d, i) => {
      acc[`segment${i}`] = d.value;
      return acc;
    }, {} as Record<string, number>),
  ];

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide domain={[0, totalValue]} />
          <YAxis type="category" hide />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value, name) => {
              const idx = parseInt(String(name).replace('segment', ''));
              const item = data[idx];
              return [`$${Number(value).toLocaleString()} (${((Number(value) / totalValue) * 100).toFixed(1)}%)`, item?.name || ''];
            }}
          />
          {data.map((item, index) => (
            <Bar
              key={index}
              dataKey={`segment${index}`}
              stackId="stack"
              fill={item.color}
              radius={index === 0 ? [8, 0, 0, 8] : index === data.length - 1 ? [0, 8, 8, 0] : 0}
              onClick={() => onClick?.(item.name)}
              style={{ cursor: onClick ? 'pointer' : 'default' }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/charts/stacked-bar-chart.tsx
git commit -m "feat(web): add stacked bar chart component"
```

---

## Task 8: Treemap Chart Component

**Files:**
- Create: `packages/web/src/components/charts/treemap-chart.tsx`

- [ ] **Step 1: Create treemap chart component**

Create `packages/web/src/components/charts/treemap-chart.tsx`:

```typescript
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { colors } from '../../styles/theme';

interface TreemapDataPoint {
  name: string;
  value: number;
  color: string;
  children?: TreemapDataPoint[];
}

interface TreemapChartProps {
  data: TreemapDataPoint[];
  height?: number;
  onClick?: (name: string) => void;
}

const CustomTreemapContent = ({
  x,
  y,
  width,
  height,
  name,
  color,
  value,
  onClick,
}: any) => {
  if (width < 30 || height < 30) return null;

  return (
    <g onClick={() => onClick?.(name)} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        stroke={colors.bg.DEFAULT}
        strokeWidth={2}
        rx={4}
      />
      {width > 60 && height > 40 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 8}
            textAnchor="middle"
            fill="#fff"
            fontSize={12}
            fontWeight={600}
          >
            {name}
          </text>
          <text
            x={x + width / 2}
            y={y + height / 2 + 10}
            textAnchor="middle"
            fill="rgba(255,255,255,0.7)"
            fontSize={10}
          >
            ${(value / 1000).toFixed(0)}K
          </text>
        </>
      )}
    </g>
  );
};

export function TreemapChart({
  data,
  height = 300,
  onClick,
}: TreemapChartProps) {
  const chartData = data.map((d) => ({
    name: d.name,
    size: d.value,
    color: d.color,
    children: d.children?.map((c) => ({
      name: c.name,
      size: c.value,
      color: c.color,
    })),
  }));

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={chartData}
          dataKey="size"
          aspectRatio={4 / 3}
          stroke={colors.bg.DEFAULT}
          content={<CustomTreemapContent onClick={onClick} />}
        >
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value: number) => [`$${value.toLocaleString()}`, 'Value']}
          />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/charts/treemap-chart.tsx
git commit -m "feat(web): add treemap chart component"
```

---

## Task 9: Fan Chart Component

**Files:**
- Create: `packages/web/src/components/charts/fan-chart.tsx`

- [ ] **Step 1: Create fan chart component**

Create `packages/web/src/components/charts/fan-chart.tsx`:

```typescript
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
} from 'recharts';
import { colors } from '../../styles/theme';

interface FanChartData {
  year: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

interface FanChartProps {
  data: FanChartData[];
  height?: number;
  color?: string;
}

export function FanChart({
  data,
  height = 300,
  color = colors.accent.DEFAULT,
}: FanChartProps) {
  // Transform data to show areas
  const chartData = data.map((d) => ({
    year: d.year,
    // Outer band (5th-95th)
    outerLow: d.p5,
    outerHigh: d.p95 - d.p5,
    // Inner band (25th-75th)
    innerLow: d.p25,
    innerHigh: d.p75 - d.p25,
    // Median
    median: d.p50,
  }));

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <defs>
            <linearGradient id="outerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.1} />
              <stop offset="100%" stopColor={color} stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="innerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0.25} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="year"
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
          />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value: number, name: string) => {
              const label = name === 'median' ? 'Median' : name;
              return [`$${value.toLocaleString()}`, label];
            }}
          />
          {/* 5th-95th percentile band */}
          <Area
            type="monotone"
            dataKey="outerHigh"
            stackId="outer"
            stroke="none"
            fill="url(#outerGradient)"
            baseLine={chartData.map((d) => d.outerLow)}
          />
          {/* 25th-75th percentile band */}
          <Area
            type="monotone"
            dataKey="innerHigh"
            stackId="inner"
            stroke="none"
            fill="url(#innerGradient)"
            baseLine={chartData.map((d) => d.innerLow)}
          />
          {/* Median line */}
          <Line
            type="monotone"
            dataKey="median"
            stroke={color}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/charts/fan-chart.tsx
git commit -m "feat(web): add fan chart component for Monte Carlo visualization"
```

---

## Task 10: Histogram Chart Component

**Files:**
- Create: `packages/web/src/components/charts/histogram-chart.tsx`

- [ ] **Step 1: Create histogram chart component**

Create `packages/web/src/components/charts/histogram-chart.tsx`:

```typescript
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { colors } from '../../styles/theme';

interface HistogramBucket {
  bucket: string;
  count: number;
  status: 'success' | 'close' | 'failure';
}

interface HistogramChartProps {
  data: HistogramBucket[];
  height?: number;
}

const STATUS_COLORS = {
  success: '#4ade80',
  close: '#f59e0b',
  failure: '#ef4444',
};

export function HistogramChart({ data, height = 200 }: HistogramChartProps) {
  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis
            dataKey="bucket"
            stroke={colors.text.muted}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={50}
          />
          <YAxis
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value: number) => [`${value} simulations`, 'Count']}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/charts/histogram-chart.tsx
git commit -m "feat(web): add histogram chart component"
```

---

## Task 11: Rolling Periods Chart Component

**Files:**
- Create: `packages/web/src/components/charts/rolling-periods-chart.tsx`

- [ ] **Step 1: Create rolling periods chart component**

Create `packages/web/src/components/charts/rolling-periods-chart.tsx`:

```typescript
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { colors } from '../../styles/theme';

interface BacktestPeriod {
  startYear: number;
  endBalance: number;
  status: 'success' | 'close' | 'failed';
}

interface RollingPeriodsChartProps {
  data: BacktestPeriod[];
  height?: number;
  initialBalance?: number;
}

const STATUS_COLORS = {
  success: '#4ade80',
  close: '#f59e0b',
  failed: '#ef4444',
};

export function RollingPeriodsChart({
  data,
  height = 200,
  initialBalance,
}: RollingPeriodsChartProps) {
  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis
            dataKey="startYear"
            stroke={colors.text.muted}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
          />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value: number, name: string, props: any) => [
              `$${value.toLocaleString()}`,
              `Started ${props.payload.startYear}`,
            ]}
          />
          {initialBalance && (
            <ReferenceLine
              y={initialBalance}
              stroke={colors.text.muted}
              strokeDasharray="3 3"
            />
          )}
          <Bar dataKey="endBalance" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/charts/rolling-periods-chart.tsx
git commit -m "feat(web): add rolling periods chart for backtest visualization"
```

---

## Task 12: Portfolio Composition Page

**Files:**
- Create: `packages/web/src/pages/portfolio-composition.tsx`

- [ ] **Step 1: Create portfolio composition page**

Create `packages/web/src/pages/portfolio-composition.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { PieChart, Building2, ChevronRight } from 'lucide-react';
import { cn, formatMoney } from '../lib/utils';
import { api } from '../lib/api';
import { DonutChart } from '../components/charts/pie-chart';
import { StackedBarChart } from '../components/charts/stacked-bar-chart';
import { TreemapChart } from '../components/charts/treemap-chart';
import { Button } from '../components/ui/button';
import { useLocation } from 'wouter';

type ChartType = 'donut' | 'bar' | 'treemap';
type TableLevel = 'assetClass' | 'subCategory' | 'holdings';

interface AssetClass {
  name: string;
  value: number;
  percentage: number;
  color: string;
  subCategories: SubCategory[];
}

interface SubCategory {
  name: string;
  value: number;
  percentage: number;
  holdings: Holding[];
}

interface Holding {
  ticker: string;
  name: string;
  shares: number;
  value: number;
  costBasis: number | null;
  account: string;
}

export function PortfolioComposition() {
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [chartType, setChartType] = useState<ChartType>('donut');
  const [tableLevel, setTableLevel] = useState<TableLevel>('assetClass');
  const [selectedAssetClass, setSelectedAssetClass] = useState<string | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);

  useEffect(() => {
    api.getPortfolioComposition()
      .then((data) => {
        setTotalValue(data.totalValue);
        setAssetClasses(data.assetClasses);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Build breadcrumb
  const breadcrumbs: string[] = ['All Assets'];
  if (selectedAssetClass) breadcrumbs.push(selectedAssetClass);
  if (selectedSubCategory) breadcrumbs.push(selectedSubCategory);

  // Get current data for chart/table
  const getCurrentData = () => {
    if (!selectedAssetClass) {
      return assetClasses.map((a) => ({
        name: a.name,
        value: a.value,
        color: a.color,
      }));
    }

    const assetClass = assetClasses.find((a) => a.name === selectedAssetClass);
    if (!assetClass) return [];

    if (!selectedSubCategory) {
      return assetClass.subCategories.map((s) => ({
        name: s.name,
        value: s.value,
        color: assetClass.color,
      }));
    }

    const subCategory = assetClass.subCategories.find((s) => s.name === selectedSubCategory);
    if (!subCategory) return [];

    return subCategory.holdings.map((h) => ({
      name: h.ticker,
      value: h.value,
      color: assetClass.color,
    }));
  };

  const handleChartClick = (name: string) => {
    if (!selectedAssetClass) {
      setSelectedAssetClass(name);
      setTableLevel('subCategory');
    } else if (!selectedSubCategory) {
      setSelectedSubCategory(name);
      setTableLevel('holdings');
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === 0) {
      setSelectedAssetClass(null);
      setSelectedSubCategory(null);
      setTableLevel('assetClass');
    } else if (index === 1) {
      setSelectedSubCategory(null);
      setTableLevel('subCategory');
    }
  };

  const chartData = getCurrentData();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  if (assetClasses.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center"
        >
          <Building2 className="w-16 h-16 text-text-muted mb-6" />
          <h2 className="font-display text-2xl md:text-3xl font-medium mb-3">
            No Holdings Found
          </h2>
          <p className="text-text-muted max-w-md mb-8">
            Link your investment accounts to see your portfolio composition.
          </p>
          <Button onClick={() => navigate('/accounts')}>
            Link Your Accounts
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-4 md:p-8"
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold mb-2">Portfolio Composition</h1>
            <p className="text-text-muted text-sm">Total: {formatMoney(totalValue)}</p>
          </div>
          <div className="flex gap-2">
            {(['donut', 'bar', 'treemap'] as ChartType[]).map((type) => (
              <button
                key={type}
                onClick={() => setChartType(type)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  chartType === type
                    ? 'bg-accent text-bg'
                    : 'bg-surface-solid text-text-muted hover:text-text'
                )}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm mb-6">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <ChevronRight className="w-4 h-4 text-text-muted" />}
              <button
                onClick={() => handleBreadcrumbClick(i)}
                className={cn(
                  'hover:text-accent transition-colors',
                  i === breadcrumbs.length - 1 ? 'text-accent font-medium' : 'text-text-muted'
                )}
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>

        {/* Chart + Table */}
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Chart */}
          <div className="flex-1 flex items-center justify-center min-h-[300px]">
            {chartType === 'donut' && (
              <DonutChart
                data={chartData}
                size={280}
                innerRadius={70}
                outerRadius={110}
              />
            )}
            {chartType === 'bar' && (
              <StackedBarChart
                data={chartData}
                height={80}
                onClick={handleChartClick}
              />
            )}
            {chartType === 'treemap' && (
              <TreemapChart
                data={chartData}
                height={300}
                onClick={handleChartClick}
              />
            )}
          </div>

          {/* Table */}
          <div className="flex-1">
            <div className="flex gap-2 mb-4">
              {(['assetClass', 'subCategory', 'holdings'] as TableLevel[]).map((level) => (
                <button
                  key={level}
                  onClick={() => setTableLevel(level)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    tableLevel === level
                      ? 'bg-accent text-bg'
                      : 'bg-surface-solid text-text-muted hover:text-text'
                  )}
                >
                  {level === 'assetClass' ? 'Asset Class' : level === 'subCategory' ? 'Sub-Category' : 'Holdings'}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center text-xs text-text-muted px-2 py-1">
                <span className="flex-1">Name</span>
                <span className="w-24 text-right">Value</span>
                <span className="w-16 text-right">%</span>
              </div>
              {chartData.map((item) => (
                <button
                  key={item.name}
                  onClick={() => handleChartClick(item.name)}
                  className="w-full flex items-center px-2 py-3 rounded-lg hover:bg-surface-hover transition-colors"
                >
                  <span
                    className="w-3 h-3 rounded-full mr-3 flex-shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="flex-1 text-left font-medium text-sm">{item.name}</span>
                  <span className="w-24 text-right text-sm tabular-nums">
                    {formatMoney(item.value, true)}
                  </span>
                  <span className="w-16 text-right text-sm text-text-muted tabular-nums">
                    {((item.value / totalValue) * 100).toFixed(1)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/pages/portfolio-composition.tsx
git commit -m "feat(web): add portfolio composition page with drill-down"
```

---

## Task 13: Probability of Success Page

**Files:**
- Create: `packages/web/src/pages/probability-of-success.tsx`

- [ ] **Step 1: Create probability of success page**

Create `packages/web/src/pages/probability-of-success.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Target, Building2 } from 'lucide-react';
import { cn, formatMoney } from '../lib/utils';
import { api } from '../lib/api';
import { FanChart } from '../components/charts/fan-chart';
import { HistogramChart } from '../components/charts/histogram-chart';
import { RollingPeriodsChart } from '../components/charts/rolling-periods-chart';
import { Button } from '../components/ui/button';
import { useLocation } from 'wouter';

type MonteCarloView = 'fan' | 'spaghetti';

interface SimulationParams {
  retirementAge: number;
  monthlySpend: number;
  allocation: {
    usStocks: number;
    intlStocks: number;
    bonds: number;
    reits: number;
    cash: number;
  };
}

export function ProbabilityOfSuccess() {
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [mcView, setMcView] = useState<MonteCarloView>('fan');
  const [params, setParams] = useState<SimulationParams>({
    retirementAge: 62,
    monthlySpend: 6500,
    allocation: {
      usStocks: 0.55,
      intlStocks: 0.15,
      bonds: 0.2,
      reits: 0.05,
      cash: 0.05,
    },
  });

  // Monte Carlo results
  const [successRate, setSuccessRate] = useState(0);
  const [percentiles, setPercentiles] = useState<{
    p5: number[];
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
  } | null>(null);
  const [histogram, setHistogram] = useState<{ bucket: string; count: number; status: 'success' | 'close' | 'failure' }[]>([]);
  const [samplePaths, setSamplePaths] = useState<number[][] | null>(null);

  // Backtest results
  const [backtestPeriods, setBacktestPeriods] = useState<{ startYear: number; endBalance: number; status: 'success' | 'close' | 'failed' }[]>([]);
  const [backtestSummary, setBacktestSummary] = useState({ periodsRun: 0, periodsSucceeded: 0, successRate: 0 });

  const runSimulations = useCallback(async () => {
    setLoading(true);
    try {
      // Get portfolio allocation first
      const portfolioData = await api.getPortfolioAllocation();
      setTotalValue(portfolioData.totalValue);
      setParams((p) => ({ ...p, allocation: portfolioData.allocation }));

      const annualWithdrawal = params.monthlySpend * 12;
      const yearsToSimulate = 30;

      // Run Monte Carlo
      const mcResult = await fetch('/api/simulations/monte-carlo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          allocation: portfolioData.allocation,
          initialValue: portfolioData.totalValue,
          annualWithdrawal,
          years: yearsToSimulate,
          simulations: 10000,
          includeSamplePaths: true,
          numSamplePaths: 50,
        }),
      }).then((r) => r.json());

      setSuccessRate(mcResult.successRate);
      setPercentiles(mcResult.percentiles);
      setHistogram(mcResult.histogram);
      setSamplePaths(mcResult.samplePaths);

      // Run Backtest
      const btResult = await fetch('/api/simulations/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          allocation: portfolioData.allocation,
          initialValue: portfolioData.totalValue,
          annualWithdrawal,
          years: yearsToSimulate,
        }),
      }).then((r) => r.json());

      setBacktestPeriods(btResult.periods);
      setBacktestSummary(btResult.summary);
    } catch (err) {
      console.error('Simulation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [params.monthlySpend]);

  useEffect(() => {
    runSimulations();
  }, []);

  // Build fan chart data
  const fanData = percentiles
    ? percentiles.p50.map((_, i) => ({
        year: new Date().getFullYear() + i,
        p5: percentiles.p5[i],
        p25: percentiles.p25[i],
        p50: percentiles.p50[i],
        p75: percentiles.p75[i],
        p95: percentiles.p95[i],
      }))
    : [];

  const successColor = successRate >= 0.8 ? '#4ade80' : successRate >= 0.6 ? '#f59e0b' : '#ef4444';

  if (loading && !percentiles) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted">Running simulations...</div>
      </div>
    );
  }

  if (totalValue === 0) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center"
        >
          <Building2 className="w-16 h-16 text-text-muted mb-6" />
          <h2 className="font-display text-2xl md:text-3xl font-medium mb-3">
            No Portfolio Data
          </h2>
          <p className="text-text-muted max-w-md mb-8">
            Link your accounts and view your portfolio composition first.
          </p>
          <Button onClick={() => navigate('/portfolio')}>
            View Portfolio
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8 space-y-6">
      {/* Hero Success Rate */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-8 text-center"
        style={{ background: `linear-gradient(180deg, ${successColor}10 0%, transparent 100%)` }}
      >
        <div
          className="font-display text-6xl font-bold mb-2"
          style={{ color: successColor }}
        >
          {Math.round(successRate * 100)}%
        </div>
        <div className="text-text-muted">Probability of Success</div>
        <div className="text-xs text-text-muted mt-2">
          Based on 10,000 Monte Carlo simulations using your actual allocation
        </div>
      </motion.div>

      {/* Parameter Sliders */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-card rounded-2xl p-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="text-sm text-text-muted mb-2 block">Retirement Age</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={50}
                max={80}
                value={params.retirementAge}
                onChange={(e) => setParams((p) => ({ ...p, retirementAge: parseInt(e.target.value) }))}
                className="flex-1 accent-accent"
              />
              <span className="font-semibold w-8">{params.retirementAge}</span>
            </div>
          </div>
          <div>
            <label className="text-sm text-text-muted mb-2 block">Monthly Spending</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={1000}
                max={30000}
                step={500}
                value={params.monthlySpend}
                onChange={(e) => setParams((p) => ({ ...p, monthlySpend: parseInt(e.target.value) }))}
                className="flex-1 accent-accent"
              />
              <span className="font-semibold w-20">${params.monthlySpend.toLocaleString()}</span>
            </div>
          </div>
          <div>
            <label className="text-sm text-text-muted mb-2 block">Stock/Bond Split</label>
            <div className="flex items-center gap-4">
              <span className="text-sm text-text-muted">
                {Math.round((params.allocation.usStocks + params.allocation.intlStocks) * 100)}/
                {Math.round((params.allocation.bonds + params.allocation.cash) * 100)}
              </span>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={runSimulations} disabled={loading}>
            {loading ? 'Running...' : 'Recalculate'}
          </Button>
        </div>
      </motion.div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Fan/Spaghetti Chart */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card rounded-2xl p-6 lg:col-span-2"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Portfolio Over Time</h3>
            <div className="flex gap-2">
              {(['fan', 'spaghetti'] as MonteCarloView[]).map((view) => (
                <button
                  key={view}
                  onClick={() => setMcView(view)}
                  className={cn(
                    'px-3 py-1 rounded-lg text-xs font-medium transition-colors',
                    mcView === view
                      ? 'bg-accent text-bg'
                      : 'bg-surface-solid text-text-muted hover:text-text'
                  )}
                >
                  {view === 'fan' ? 'Fan' : 'Paths'}
                </button>
              ))}
            </div>
          </div>
          <FanChart data={fanData} height={300} />
        </motion.div>

        {/* Histogram */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-card rounded-2xl p-6"
        >
          <h3 className="font-semibold mb-4">End Value Distribution</h3>
          <HistogramChart data={histogram} height={260} />
        </motion.div>
      </div>

      {/* Backtest Section */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="glass-card rounded-2xl p-6"
      >
        <h3 className="font-semibold mb-4">
          Historical Backtests (1930-1995 start years)
        </h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <RollingPeriodsChart
            data={backtestPeriods}
            height={200}
            initialBalance={totalValue}
          />
          <div>
            <div className="text-sm text-text-muted mb-2">Summary</div>
            <div className="space-y-2 text-sm">
              {backtestPeriods.slice(0, 5).map((p) => (
                <div key={p.startYear} className="flex justify-between">
                  <span>{p.startYear}</span>
                  <span className="tabular-nums">{formatMoney(p.endBalance, true)}</span>
                  <span className={cn(
                    p.status === 'success' ? 'text-success' : p.status === 'close' ? 'text-warning' : 'text-danger'
                  )}>
                    {p.status === 'success' ? '✓' : p.status === 'close' ? '~' : '✗'}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 text-sm font-medium text-success">
              {backtestSummary.periodsSucceeded}/{backtestSummary.periodsRun} periods succeeded
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/pages/probability-of-success.tsx
git commit -m "feat(web): add probability of success page with Monte Carlo and backtest"
```

---

## Task 14: Update Sidebar Navigation

**Files:**
- Modify: `packages/web/src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add Analysis section to sidebar**

Modify `packages/web/src/components/layout/sidebar.tsx`:

Add imports:
```typescript
import { PieChart } from 'lucide-react';
```

Update `fixedTabs` array to add Analysis section after Dashboard items:
```typescript
const fixedTabs: NavItem[] = [
  { id: 'dashboard', name: 'Overview', icon: LayoutDashboard, path: '/' },
  { id: 'net-worth', name: 'Net Worth', icon: TrendingUp, path: '/net-worth' },
  { id: 'cash-flow', name: 'Cash Flow', icon: ArrowRightLeft, path: '/cash-flow' },
  { id: 'tax-history', name: 'Tax History', icon: Receipt, path: '/tax-history' },
  { id: 'accounts', name: 'Linked Accounts', icon: Building2, path: '/accounts' },
];

const analysisTabs: NavItem[] = [
  { id: 'portfolio', name: 'Portfolio', icon: PieChart, path: '/portfolio' },
  { id: 'probability', name: 'Probability', icon: Target, path: '/probability' },
];
```

Add Analysis section in the nav:
```tsx
{/* Analysis */}
<div className="mb-6">
  <div className="text-xs uppercase tracking-wider text-text-secondary font-semibold mb-3 px-2">
    Analysis
  </div>
  <div className="space-y-1">
    {analysisTabs.map((tab) => {
      const Icon = tab.icon;
      return (
        <motion.button
          key={tab.id}
          onClick={() => navigate(tab.path)}
          whileHover={{ x: 2 }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            'w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
            isActive(tab.path)
              ? 'bg-accent/10 text-accent border border-accent/20'
              : 'hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent'
          )}
        >
          <Icon className={cn('w-5 h-5', isActive(tab.path) ? 'text-accent' : 'text-text-muted')} />
          <span className="flex-1 font-medium">{tab.name}</span>
        </motion.button>
      );
    })}
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/layout/sidebar.tsx
git commit -m "feat(web): add Analysis section to sidebar with Portfolio and Probability links"
```

---

## Task 15: Update App Routes

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Add routes for new pages**

Modify `packages/web/src/App.tsx`:

Add imports:
```typescript
import { PortfolioComposition } from './pages/portfolio-composition';
import { ProbabilityOfSuccess } from './pages/probability-of-success';
```

Add routes in the Switch:
```tsx
<Route path="/portfolio" component={PortfolioComposition} />
<Route path="/probability" component={ProbabilityOfSuccess} />
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "feat(web): add routes for portfolio composition and probability of success pages"
```

---

## Task 16: Update Simulation API Routes

**Files:**
- Modify: `packages/api/src/routes/simulations.ts`

- [ ] **Step 1: Update simulations routes for new request/response types**

Modify `packages/api/src/routes/simulations.ts` to use the extended Monte Carlo and Backtester:

```typescript
import { Hono } from "hono";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { getMonteCarloEngine, type AssetAllocation } from "../services/monte-carlo.js";
import { getBacktester } from "../services/backtester.js";

export const simulationsRouter = new Hono<AuthEnv>();
simulationsRouter.use("*", requireAuth);

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

  const result = engine.run({
    initialBalance: body.initialValue,
    withdrawalRate,
    yearsToSimulate: body.years,
    assetAllocation: body.allocation,
    inflationAdjusted: true,
    numSimulations: body.simulations || 10000,
    includeSamplePaths: body.includeSamplePaths,
    numSamplePaths: body.numSamplePaths,
  });

  return c.json(result);
});

simulationsRouter.post("/backtest", async (c) => {
  const body = await c.req.json<{
    allocation: AssetAllocation;
    initialValue: number;
    annualWithdrawal: number;
    years: number;
  }>();

  const backtester = getBacktester();
  const withdrawalRate = body.annualWithdrawal / body.initialValue;

  const result = backtester.run({
    initialBalance: body.initialValue,
    withdrawalRate,
    yearsToSimulate: body.years,
    assetAllocation: body.allocation,
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/simulations.ts
git commit -m "feat(api): update simulation routes for 5-asset allocation"
```

---

## Task 17: Integration Testing

**Files:**
- None (manual testing)

- [ ] **Step 1: Start the development server**

Run: `pnpm dev`

- [ ] **Step 2: Test Portfolio Composition page**

1. Navigate to `/portfolio`
2. Verify chart displays with asset class breakdown
3. Test drill-down by clicking segments
4. Test chart type switching (Donut/Bar/Treemap)
5. Test table level switching

- [ ] **Step 3: Test Probability of Success page**

1. Navigate to `/probability`
2. Verify success rate hero displays
3. Verify Monte Carlo fan chart renders
4. Test slider adjustments
5. Verify histogram displays
6. Verify backtest section displays

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration testing issues"
```

---

## Task 18: Final Build Verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript type check**

Run: `pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: verify build passes for portfolio and probability features"
```

---

## Summary

This plan implements:
1. **Core ticker mapping** - 90+ tickers mapped to 6 asset classes
2. **Extended historical data** - 5 asset classes with proration for missing data
3. **Extended Monte Carlo** - 5 assets, p25/p75 percentiles, histogram, sample paths
4. **Extended Backtester** - 5 assets with allocation proration
5. **Portfolio aggregation service** - Groups holdings by asset class/sub-category
6. **Portfolio API** - GET /api/portfolio/composition and /allocation
7. **4 new chart components** - Stacked bar, treemap, fan chart, histogram, rolling periods
8. **Portfolio Composition page** - Drill-down visualization with 3 chart types
9. **Probability of Success page** - Monte Carlo + backtest with interactive sliders
10. **Navigation** - Analysis section in sidebar

Total: 18 tasks with TDD workflow
