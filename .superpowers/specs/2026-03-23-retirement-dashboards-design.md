# Retirement Plan Interactive Dashboards Design Spec

## Overview

Design interactive dashboard components for retirement plan analysis. The AI agent can compose these components to answer user questions, with three prompt templates serving as optimized starting points.

**Core Principle:** Components are reusable building blocks. Prompt templates are default compositions. The AI can mix and match based on conversation flow.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA LAYER                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ User Data   │  │ Historical  │  │ Computation │             │
│  │ (Plaid)     │  │ Market Data │  │ Results     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   COMPUTATION LAYER                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Monte Carlo │  │ Historical  │  │ Projection  │             │
│  │ Engine      │  │ Backtester  │  │ Calculator  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AI TOOLS                                   │
│  run_monte_carlo | run_backtest | calculate_projections        │
│  get_portfolio_summary | get_simulation_results                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   COMPONENT LIBRARY                             │
│  UI blocks the AI can include in responses                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   PROMPT TEMPLATES                              │
│  Default component compositions for starter prompts             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Data Layer

### 1.1 User Data (from Plaid)

Data already available — never ask the user to re-enter:

| Data Point | Source | Usage |
|------------|--------|-------|
| Account balances | Plaid accounts | Current portfolio value |
| Holdings | Plaid investments | Asset allocation calculation |
| Account types | Plaid metadata | Tax treatment (401k, IRA, Roth, taxable) |
| Historical balances | Balance snapshots | Personal return history |

### 1.2 Historical Market Data

**Primary Source: Shiller Dataset**
- URL: http://www.econ.yale.edu/~shiller/data/ie_data.xls
- Coverage: 1871–present, monthly
- Fields: S&P 500 price, dividends, earnings, CPI
- Storage: Bundle as static JSON file in `packages/api/data/shiller-historical.json`
- Update process: Manual quarterly (see Section 6.3)
- Alternative: https://github.com/posix4e/shiller_wrapper_data (auto-updated JSON API)

**Supplementary Source: Alpha Vantage / Yahoo Finance**
- For recent daily data and specific tickers
- npm package: `yahoo-finance2` (no API key required)

**Derived Data (pre-computed):**

| Series | Calculation | Usage |
|--------|-------------|-------|
| Real total returns | (Price + Dividends) / CPI | Backtesting |
| Rolling returns | 1yr, 5yr, 10yr, 20yr windows | Distribution fitting |
| Volatility | Standard deviation by period | Monte Carlo params |
| Inflation rates | CPI change YoY | Real vs nominal |

### 1.3 Computation Results Storage

Store simulation results in PostgreSQL to avoid re-computation:

```sql
-- Database table: simulation_results
-- Note: plans table already exists (packages/api/drizzle/schema.ts)
CREATE TABLE simulation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('monte_carlo', 'backtest', 'scenario')),
  params JSONB NOT NULL,           -- SimulationParams as JSON
  results JSONB NOT NULL,          -- SimulationOutput as JSON
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL, -- TTL for cache invalidation

  -- Index for fast lookups by plan + type + params hash
  CONSTRAINT unique_simulation UNIQUE (plan_id, type, md5(params::text))
);

CREATE INDEX idx_simulation_plan ON simulation_results(plan_id);
CREATE INDEX idx_simulation_expires ON simulation_results(expires_at);
```

```typescript
// TypeScript types for application layer
type SimulationParams = MonteCarloParams | BacktestParams | ScenarioParams;
type SimulationOutput = MonteCarloResult | BacktestResult | ScenarioResult;

interface SimulationResult {
  id: string;
  planId: string;
  type: 'monte_carlo' | 'backtest' | 'scenario';
  params: SimulationParams;
  results: SimulationOutput;
  createdAt: Date;
  expiresAt: Date; // Default: 24 hours, or until portfolio changes
}

// ScenarioParams for storage consistency
interface ScenarioParams {
  scenario: 'crash_2008' | 'great_depression' | 'stagflation_70s' | 'japan_lost_decade' | 'custom';
  customParams?: {
    yearOneReturn: number;
    subsequentReturns: number;
    inflationRate: number;
    durationYears: number;
  };
  withdrawalRate: number;
  retirementDuration: number;
}
```

Cache invalidation triggers:
- Portfolio balance changes > 5%
- User modifies plan assumptions
- New month of historical data available

---

## 2. Computation Layer

### 2.1 Monte Carlo Engine

**Purpose:** Probabilistic projection of portfolio outcomes

**Inputs:**
```typescript
interface MonteCarloParams {
  initialBalance: number;        // From user accounts
  // Withdrawal: provide ONE of these (withdrawalRate takes precedence if both provided)
  withdrawalRate?: number;       // Percentage (e.g., 0.04 for 4%)
  annualWithdrawal?: number;     // Fixed dollar amount
  yearsToSimulate: number;       // Retirement duration
  assetAllocation: {             // From holdings
    stocks: number;              // 0-1
    bonds: number;               // 0-1
    cash: number;                // 0-1
  };
  inflationAdjusted: boolean;    // Real vs nominal
  numSimulations: number;        // Default: 10,000
}

// Withdrawal resolution logic:
// 1. If withdrawalRate provided: annualWithdrawal = initialBalance * withdrawalRate
// 2. Else if annualWithdrawal provided: use as-is
// 3. Else: default to withdrawalRate = 0.04 (4%)
```

**Model (v1 - fixed parameters based on historical averages):**
- Stock returns: LogNormal distribution, μ=10%, σ=18%
- Bond returns: Normal distribution, μ=5%, σ=6%
- Correlation: Stocks/Bonds ρ = 0.2
- Inflation: Normal, μ=2.5%, σ=1.5%
- Cash returns: Fixed 2% (approximates money market)

*Future enhancement: Fit parameters from historical data dynamically.*

**Outputs:**
```typescript
interface MonteCarloResult {
  successRate: number;           // % of simulations with balance > 0
  percentiles: {
    p5: number[];                // Year-by-year 5th percentile
    p25: number[];
    p50: number[];               // Median
    p75: number[];
    p95: number[];
  };
  finalBalanceDistribution: {
    buckets: number[];           // e.g., [0, 250K, 500K, 1M, 2M, 3M+]
    counts: number[];            // Count in each bucket
  };
  failureYear: {                 // For failed simulations
    median: number;
    p10: number;
    p90: number;
  };
}
```

### 2.2 Historical Backtester

**Purpose:** Test plan against actual historical sequences

**Inputs:**
```typescript
interface BacktestParams {
  initialBalance: number;
  // Withdrawal: same resolution as MonteCarloParams
  withdrawalRate?: number;       // Percentage (e.g., 0.04 for 4%) - takes precedence
  annualWithdrawal?: number;     // Fixed dollar amount
  yearsToSimulate: number;
  assetAllocation: {
    stocks: number;
    bonds: number;
  };
  startYearRange?: {             // Default: all available
    from: number;
    to: number;
  };
  inflationAdjusted: boolean;
}
// Uses same withdrawal resolution logic as MonteCarloParams (Section 2.1)
```

**Process:**
1. For each valid starting year where full retirement duration data exists:
   - Starting year range: 1930 through (currentYear - retirementDuration)
   - Example: For 25-year retirement in 2026, test 1930-2001 = 72 periods
   - Example: For 30-year retirement in 2026, test 1930-1996 = 67 periods
   - Simulate retirement using actual historical returns
   - Track year-by-year balance
   - Record worst drawdown, best year, final outcome

*Note: The number of testable periods depends on retirement duration. Longer retirements have fewer complete historical periods to test.*

**Outputs:**
```typescript
interface BacktestResult {
  totalPeriods: number;          // e.g., 94
  successfulPeriods: number;     // e.g., 88
  successRate: number;           // 88/94 = 93.6%
  periods: BacktestPeriod[];
}

interface BacktestPeriod {
  startYear: number;
  endBalance: number;            // Inflation-adjusted
  yearsLasted: number;
  status: 'success' | 'failed' | 'close';  // close = ended with < 20% initial
  worstDrawdown: {
    year: number;
    percent: number;
  };
  bestYear: {
    year: number;
    percent: number;
  };
  yearByYear: {                  // For detailed view
    year: number;
    balance: number;
    return: number;
    withdrawal: number;
  }[];
}
```

### 2.3 Projection Calculator

**Purpose:** Deterministic projections for specific scenarios

**Calculations:**
- FIRE number: `annualExpenses / withdrawalRate`
- Years to goal: Compound growth formula
- Social Security estimates: Based on current age and income
- RMD projections: IRS tables

---

## 3. AI Tools

Tools available to the AI agent for retirement analysis:

### 3.1 run_monte_carlo

```typescript
{
  name: "run_monte_carlo",
  description: "Run Monte Carlo simulation for retirement projections",
  parameters: {
    planId: string,
    withdrawalRate: number,      // Optional override
    retirementAge: number,       // Optional override
    numSimulations?: number,     // Default 10,000
  },
  returns: MonteCarloResult
}
```

### 3.2 run_backtest

```typescript
{
  name: "run_backtest",
  description: "Run historical backtesting for retirement plan",
  parameters: {
    planId: string,
    withdrawalRate: number,
    retirementAge: number,
    retirementDuration: number,  // Years in retirement
  },
  returns: BacktestResult
}
```

### 3.3 get_portfolio_summary

```typescript
{
  name: "get_portfolio_summary",
  description: "Get user's current portfolio from connected accounts",
  parameters: {
    planId: string,
  },
  returns: {
    totalBalance: number,
    byAccountType: {
      traditional: number,       // 401k + Traditional IRA
      roth: number,
      taxable: number,
    },
    assetAllocation: {
      stocks: number,
      bonds: number,
      cash: number,
      other: number,
    },
    holdings: Holding[],
  }
}
```

### 3.4 calculate_fire_number

```typescript
{
  name: "calculate_fire_number",
  description: "Calculate required portfolio for FIRE",
  parameters: {
    annualExpenses: number,
    withdrawalRate: number,
  },
  returns: {
    fireNumber: number,
    currentBalance: number,
    gap: number,
    percentComplete: number,
  }
}
```

### 3.5 run_scenario

```typescript
{
  name: "run_scenario",
  description: "Test a specific hypothetical scenario",
  parameters: {
    planId: string,
    scenario: 'crash_2008' | 'great_depression' | 'stagflation_70s' | 'japan_lost_decade' | 'custom',
    withdrawalRate?: number,       // Optional override, default 0.04
    retirementDuration?: number,   // Optional override, default 25 years
    customParams?: {               // Required only if scenario='custom'
      yearOneReturn: number,
      subsequentReturns: number,
      inflationRate: number,
      durationYears: number,
    }
  },
  returns: ScenarioResult
}

// ScenarioResult type definition
interface ScenarioResult {
  scenarioName: string;
  description: string;
  survivalRate: number;           // % chance of surviving this scenario
  endBalance: number;             // Median ending balance
  depletionYear: number | null;   // Year portfolio hits zero (if failed)
  yearByYear: {
    year: number;
    balance: number;
    return: number;
    withdrawal: number;
  }[];
  comparison: {
    vsBaseline: number;           // % difference vs normal Monte Carlo
    vsHistoricalWorst: number;    // % difference vs worst historical period
  };
}
```

---

## 4. Component Library

### 4.1 UI Block Schema Extensions

**Schema location (shared types):** `packages/api/src/agent/types.ts`
**React components location:** `packages/web/src/components/ui-renderer/blocks/`

The current `uiBlockSchema` includes: `stat`, `chart`, `table`, `text`, `projection`, `action`.

For each new block type below:
1. Add the Zod schema to `packages/api/src/agent/types.ts`
2. Add to the `uiBlockSchema` discriminated union
3. Create React component in `packages/web/src/components/ui-renderer/blocks/<block-name>.tsx`
4. Register in `packages/web/src/components/ui-renderer/ui-renderer.tsx`

Extend with new interactive components by adding these to `uiBlockSchema`:

```typescript
// New block types to add to packages/api/src/agent/types.ts
// Add each schema to the uiBlockSchema discriminatedUnion

export const monteCarloChartSchema = z.object({
  type: z.literal("monte_carlo_chart"),
  variant: z.enum(["fan", "histogram"]),  // Fan chart or distribution
  title: z.string().optional(),
  simulationId: z.string(),               // Reference to stored results
  showPaths: z.boolean().optional(),      // Show individual sim paths
});

export const backtestTableSchema = z.object({
  type: z.literal("backtest_table"),
  title: z.string().optional(),
  simulationId: z.string(),
  defaultSort: z.enum(["startYear", "endBalance", "status"]).optional(),
  defaultFilter: z.enum(["all", "failed", "close", "success"]).optional(),
  showCount: z.number().optional(),       // Initial rows to show
});

export const sliderControlSchema = z.object({
  type: z.literal("slider_control"),
  controlType: z.enum(["swr", "retirement_age", "contribution"]),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  currentValue: z.number(),
  impactPreview: z.boolean().optional(),  // Show impact as slider moves
  linkedSimulation: z.string().optional(), // Re-run on change
});

export const scenarioComparisonSchema = z.object({
  type: z.literal("scenario_comparison"),
  title: z.string().optional(),
  scenarios: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    result: z.object({
      successRate: z.number(),
      endBalance: z.number(),
    }),
    isRecommended: z.boolean().optional(),
  })),
});

export const sequenceRiskChartSchema = z.object({
  type: z.literal("sequence_risk_chart"),
  title: z.string().optional(),
  goodSequenceData: z.array(z.number()),
  badSequenceData: z.array(z.number()),
});

export const incomeBreakdownSchema = z.object({
  type: z.literal("income_breakdown"),
  title: z.string().optional(),
  sources: z.array(z.object({
    name: z.string(),
    annualAmount: z.number(),
    startAge: z.number().optional(),
  })),
  totalAnnual: z.number(),
  totalMonthly: z.number(),
});

export const accountSummarySchema = z.object({
  type: z.literal("account_summary"),
  totalBalance: z.number(),
  allocation: z.object({
    stocks: z.number(),
    bonds: z.number(),
    cash: z.number(),
  }),
  byType: z.array(z.object({
    type: z.string(),
    balance: z.number(),
    percentage: z.number(),
  })),
});

export const fireCalculatorSchema = z.object({
  type: z.literal("fire_calculator"),
  targetNumber: z.number(),
  currentBalance: z.number(),
  gap: z.number(),
  percentComplete: z.number(),
  swrUsed: z.number(),
});

export const failureAnalysisSchema = z.object({
  type: z.literal("failure_analysis"),
  title: z.string().optional(),
  failedPeriods: z.array(z.object({
    startYear: z.number(),
    earlyReturns: z.array(z.number()),  // First 5 years
    pattern: z.string(),
  })),
  insight: z.string(),
});

export const improvementActionsSchema = z.object({
  type: z.literal("improvement_actions"),
  title: z.string().optional(),
  actions: z.array(z.object({
    description: z.string(),
    impact: z.string(),             // e.g., "+3% success"
    tradeoff: z.string().optional(),
    actionId: z.string(),           // For "Apply" functionality
  })),
});
```

### 4.2 Component Behaviors

**monte_carlo_chart (fan variant):**
- X-axis: Age/Years
- Y-axis: Portfolio balance
- Bands: 5th, 25th, 50th, 75th, 95th percentiles
- Hover: Show exact values at each point
- Toggle: Show/hide individual simulation paths (sample of 100)

**monte_carlo_chart (histogram variant):**
- X-axis: Final balance buckets
- Y-axis: Probability/count
- Segments: Fail (red), Struggle (yellow), Comfortable (green)
- Hover: Show exact count and percentage

**backtest_table:**
- Columns: Start Year, End Balance, Worst Drawdown, Best Year, Years Lasted, Status
- Sortable: Click column headers
- Filterable: All / Failed Only / Close Calls / Successes
- Expandable: Click row for year-by-year breakdown
- Pagination: Show 10, load more

**slider_control:**
- Real-time value display
- Optional impact preview (e.g., "94% → 97% success")
- Debounced re-computation (300ms)
- Linked to Monte Carlo or Backtest for live updates

**scenario_comparison:**
- Side-by-side cards or table rows
- Highlight recommended option
- Click to expand details

---

## 5. Prompt Templates

### 5.1 Template: "Analyze my retirement readiness"

**Default Components:**
1. `account_summary` — Current portfolio from connected accounts
2. `stat` (grid of 4) — Readiness %, Projected Balance, Monthly Income, Success Rate
3. `monte_carlo_chart` (fan) — Projection to retirement
4. `income_breakdown` — Portfolio + Social Security
5. `slider_control` (retirement_age) — What-if age adjustment
6. `improvement_actions` — AI recommendations

**AI Behavior:**
- Run Monte Carlo with user's current allocation and assumed 4% SWR
- Calculate projected balance at assumed retirement age (65 default or from plan)
- Generate readiness score: `successRate * (projectedIncome / targetIncome)`
- Provide 2-3 actionable recommendations

### 5.2 Template: "I want to retire early at [age], am I on track?"

**Dynamic Input:** Extract target age from prompt (e.g., "35", "45", "55")

**Default Components:**
1. `fire_calculator` — FIRE number vs current balance
2. `stat` (grid) — Target Age, Gap, Success %, Years to FIRE
3. `slider_control` (swr) — Adjust withdrawal rate
4. `backtest_table` — Historical survival for long retirement (age→90)
5. `scenario_comparison` — Paths to close the gap
6. `sequence_risk_chart` — Early years matter most
7. `text` (callout) — AI reality check

**AI Behavior:**
- Calculate FIRE number based on estimated expenses using this priority:
  1. If plan has `targetExpenses` set: use that value
  2. If Plaid transaction data available: calculate average monthly spending × 12
  3. Fallback: AI asks user for estimated annual expenses (cannot be derived)
- Run backtest for extended duration (e.g., 55 years for age 35)
- Highlight sequence-of-returns risk for early retirees
- Suggest realistic alternatives if gap is large

### 5.3 Template: "Stress test my retirement plan"

**Default Components:**
1. `stat` (grid of 4) — Historical Success %, Worst Drawdown, Survived/Failed counts
2. `backtest_table` — Full historical results (sortable, filterable)
3. `failure_analysis` — What went wrong in failed periods
4. `sequence_risk_chart` — Good vs bad sequence visualization
5. `scenario_comparison` — What-if scenarios (2008 crash, depression, etc.)
6. `monte_carlo_chart` (histogram) — Distribution of outcomes
7. `improvement_actions` — How to improve survival rate

**AI Behavior:**
- Run full backtest (all available starting years)
- Identify patterns in failed periods
- Run hypothetical stress scenarios
- Quantify impact of mitigations (lower SWR, cash buffer, flexible spending)

---

## 6. Implementation Notes

### 6.1 Data Flow for Interactive Components

```
User adjusts slider
        │
        ▼
Frontend debounces (300ms)
        │
        ▼
API call: POST /api/simulations/run
        │
        ▼
Server checks cache
        │
        ├─ Hit → Return cached result
        │
        └─ Miss → Run computation → Store → Return
        │
        ▼
Frontend updates linked components
```

**API Contract: POST /api/simulations/run**

```typescript
// Request body
interface SimulationRequest {
  planId: string;
  type: 'monte_carlo' | 'backtest' | 'scenario';
  params: {
    // Common params
    withdrawalRate?: number;
    retirementAge?: number;
    retirementDuration?: number;

    // Monte Carlo specific
    numSimulations?: number;  // Default: 10,000

    // Backtest specific
    startYearRange?: { from: number; to: number };

    // Scenario specific
    scenario?: 'crash_2008' | 'great_depression' | 'stagflation_70s' | 'japan_lost_decade' | 'custom';
    customScenario?: {
      yearOneReturn: number;
      subsequentReturns: number;
      inflationRate: number;
      durationYears: number;
    };
  };
}

// Response body
interface SimulationResponse {
  simulationId: string;           // For referencing in UI components
  type: 'monte_carlo' | 'backtest' | 'scenario';
  cached: boolean;                // Whether result was from cache
  computeTimeMs: number;
  result: MonteCarloResult | BacktestResult | ScenarioResult;
}
```

### 6.2 Performance Targets

| Operation | Target Latency | Notes |
|-----------|----------------|-------|
| Monte Carlo (10K sims) | < 500ms | Server-side, optimized |
| Backtest (94 periods) | < 200ms | Pre-computed historical returns |
| Slider update | < 100ms perceived | Optimistic UI + background compute |
| Initial page load | < 1s | Parallel data fetching |

### 6.3 Historical Data Pipeline

**v1: Manual script run quarterly**

```bash
# File: packages/api/scripts/update-shiller-data.ts
# package.json script: "update-shiller-data": "tsx packages/api/scripts/update-shiller-data.ts"

cd packages/api && npm run update-shiller-data
```

Script steps:
1. Fetch latest Shiller Excel file from Yale (`ie_data.xls`)
2. Parse Excel using `xlsx` npm package
3. Validate data integrity (no gaps, values in expected ranges)
4. Compute derived series (real total returns, rolling windows, volatility)
5. Write to `packages/api/data/shiller-historical.json`
6. Output summary of changes and cache invalidation recommendations

*Future enhancement: Automate with GitHub Actions cron job.*

### 6.4 Error Handling

- **Missing account data:** Show prompt to connect accounts
- **Computation timeout:** Return partial results with warning
- **Invalid parameters:** Validate on frontend, show inline errors
- **Historical data gaps:** Interpolate or exclude affected periods

---

## 7. Future Considerations (Out of Scope for v1)

- Tax-aware simulations (different account types have different tax treatment)
- Social Security optimization (claiming age strategies)
- Dynamic withdrawal strategies (guardrails, CAPE-based)
- International markets / non-US users
- Custom asset classes beyond stocks/bonds/cash
- PDF report export

---

## 8. Success Criteria

1. User can see Monte Carlo projections within 1 second of page load
2. Sliders provide real-time feedback (< 300ms perceived latency)
3. Backtesting table loads all available historical periods with sorting/filtering
4. AI can compose any combination of components based on conversation
5. All computations use actual user portfolio data (no manual entry required)
6. Historical backtests use real S&P 500 data back to 1930
