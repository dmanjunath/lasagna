# Portfolio Composition & Probability of Success Design Spec

## Overview

Two new interconnected pages for Lasagna:

1. **Portfolio Composition** - Aggregates holdings across all linked accounts, normalizes similar tickers (VTI/VTSAX = Total Stock Market), and visualizes the portfolio with drill-down hierarchy
2. **Probability of Success** - Monte Carlo simulations and historical backtesting using the user's actual portfolio allocation (not generic S&P 500 assumptions)

These pages work together: Portfolio Composition defines the allocation that feeds into Probability of Success calculations.

## Page 1: Portfolio Composition

### Purpose

Show users their true portfolio allocation across all accounts. Many users hold the same asset class through different vehicles (VTI at Vanguard, FXAIX at Fidelity) without realizing their actual exposure.

### Data Flow

```
Holdings (from Plaid)
  → Ticker Normalization (hardcoded mapping)
  → Asset Class Aggregation
  → Three-Level Hierarchy
  → Visualization
```

### Holdings Snapshot Selection

Use the most recent `snapshotAt` timestamp for each holding. The holdings table may contain multiple snapshots over time; always select the latest snapshot per holding to get current portfolio state.

### Ticker Normalization

Hardcoded mapping of tickers to asset categories. The mapping file will include the following tickers (comprehensive list for MVP):

**Level 1: Asset Class**
- US Stocks
- International Stocks
- Bonds
- REITs
- Cash/Money Market
- Other

**Level 2: Sub-Category** with specific tickers:

**US Stocks:**
- Total Market: VTI, VTSAX, ITOT, SWTSX, FSKAX, FZROX, VTSMX
- S&P 500: VOO, VFIAX, SPY, IVV, FXAIX, SWPPX, VFINX
- Growth: VUG, VIGAX, VOOG, IWF, SCHG, QQQ, QQQM
- Value: VTV, VVIAX, VOOV, IWD, SCHV
- Small Cap: VB, VSMAX, IJR, SCHA, VBR, VISVX
- Mid Cap: VO, VIMAX, IJH, SCHM
- Dividend: VYM, VHYAX, SCHD, DVY

**International Stocks:**
- Developed: VEA, VXUS, IXUS, EFA, IEFA, SWISX
- Emerging: VWO, VEMAX, IEMG, EEM, SCHE
- Total International: VXUS, VTIAX, IXUS, FZILX

**Bonds:**
- Total Bond: BND, VBTLX, AGG, SCHZ, FXNAX
- Corporate: VCIT, LQD, VCLT
- Government: VGIT, GOVT, IEF, TLT, VGLT
- TIPS: VTIP, TIP, SCHP, VAIPX
- Municipal: VTEB, MUB, VWITX

**REITs:**
- US REITs: VNQ, VGSLX, IYR, SCHH, FREL
- International REITs: VNQI, VGRLX

**Cash/Money Market:**
- Money Market: VMFXX, SPAXX, FDRXX, SWVXX
- Short-Term: VGSH, SHY, BIL, SGOV

**Unmapped Tickers:** Any ticker not in the mapping is placed in "Other" asset class with sub-category matching the security type from Plaid (equity, fixed income, etc.) or "Unknown" if unavailable.

**Level 3: Individual Holdings**
- The actual tickers/positions with quantities and values

### Visualization Options

Users can switch between three chart types:

1. **Donut Chart** (default) - Classic allocation view with total value in center
2. **Horizontal Stacked Bar** - Easy to compare relative segment sizes
3. **Treemap** - Nested rectangles showing hierarchy, supports drill-down

### Drill-Down Behavior

- **Breadcrumb navigation** shows current position: "All Assets → US Stocks → Total Market"
- **Chart updates** to show only the selected level's breakdown
- **Table updates** in sync with chart to show matching data
- **Clicking a segment** drills down to the next level
- **Clicking breadcrumb** navigates back up the hierarchy

### Table Display

Side-by-side with chart, showing:
- Category/Ticker name
- Current value
- Percentage of (current view) total
- Color indicator matching chart

Table has tabs to quickly switch hierarchy level: "Asset Class | Sub-Category | Holdings"

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Portfolio Composition                    [Donut][Bar][Tree] │
│ Total: $524,830                                             │
│ All Assets → US Stocks → Total Market                       │
├────────────────────────────┬────────────────────────────────┤
│                            │ [Asset Class][Sub][Holdings]   │
│      [DONUT CHART]         │ Category    Value      %       │
│         $524K              │ ● US Stocks $289,156   55.1%   │
│                            │ ● Intl      $115,462   22.0%   │
│                            │ ● Bonds     $78,724    15.0%   │
│                            │ ● REITs     $26,241    5.0%    │
│                            │ ● Cash      $15,247    2.9%    │
└────────────────────────────┴────────────────────────────────┘
```

## Page 2: Probability of Success

### Purpose

Answer the core FIRE question: "Given my actual portfolio, what's my chance of not running out of money?" Uses Monte Carlo simulation and historical backtesting with the user's real allocation, not generic assumptions.

### Data Sources

**Portfolio Allocation**: Pulled from Portfolio Composition page's aggregated data

**Historical Returns**: Embedded dataset from NYU Stern Damodaran (1928-2024) containing annual returns for:
- US Stocks (S&P 500)
- US Bonds (10-year Treasury)
- T-Bills (Cash proxy)
- Inflation (CPI)

Extended with supplementary data for:
- International Stocks (MSCI EAFE, 1970+)
- REITs (NAREIT, 1972+)

**Missing Data Handling:** For years before International (pre-1970) or REIT (pre-1972) data exists, prorate the allocation across available asset classes. Example: If portfolio is 50% US, 20% Intl, 20% Bonds, 10% REIT and simulating 1960:
- Intl + REIT allocation (30%) is redistributed proportionally to US and Bonds
- Effective 1960 allocation: ~64% US, ~36% Bonds
- This applies to both Monte Carlo and backtest calculations

### Simulation Parameters

User-adjustable via interactive sliders, pre-populated from user data where available:

| Parameter | Default | Range | Source |
|-----------|---------|-------|--------|
| Retirement Age | 65 | 50-80 | User profile (if set) |
| Monthly Spending | $5,000 | $1K-$30K | Calculated from cash flow |
| Stock/Bond Split | From portfolio | 0/100 to 100/0 | Portfolio Composition |
| Inflation Rate | 3% | 1-5% | Fixed default |
| Simulation Years | 30 | 10-50 | Calculated from retirement age |

### Success Rate Display

Large "hero" number at top of page:

```
┌─────────────────────────────────────────────────────────────┐
│                         94%                                 │
│              Probability of Success                         │
│    Based on 10,000 Monte Carlo simulations                  │
│         using your actual allocation                        │
└─────────────────────────────────────────────────────────────┘
```

Color-coded: Green (>80%), Yellow (60-80%), Red (<60%)

### Monte Carlo Visualization

Two switchable chart types, plus always-visible histogram:

**Fan Chart** (default)
- Shows median path with confidence bands
- 5th-95th percentile outer band (light fill)
- 25th-75th percentile inner band (medium fill)
- Median line (solid)
- X-axis: Years (Today → Retirement + 30)
- Y-axis: Portfolio Value

**Spaghetti Plot** (toggle)
- Shows 50-100 individual simulation paths
- Successful paths in green, failures in red
- Creates dramatic visualization of uncertainty

**End Value Histogram** (always visible)
- Distribution of final portfolio values
- Bars colored by outcome (green=success, yellow=close, red=failure)
- X-axis: Final value buckets ($0, $500K, $1M, etc.)
- Y-axis: Frequency

### Historical Backtest Display

Shows how the plan would have performed starting from each historical year:

**Rolling Periods Chart**
- Each bar = one historical start year (1930-1995)
- Height = ending balance
- Color = success (green), close (yellow), failure (red)

**Sortable Table**
- Columns: Start Year, End Balance, Status, Worst Drawdown
- Sortable by any column
- Filterable to show only failures
- Summary row: "62/66 periods succeeded (94%)"

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│                         94%                                 │
│              Probability of Success                         │
│    Based on 10,000 Monte Carlo simulations                  │
├─────────────────────────────────────────────────────────────┤
│ Retirement Age        Monthly Spend         Stock/Bond      │
│ ────●───── 62        ────●───── $6,500     ────●───── 75/25 │
├──────────────────────────────────┬──────────────────────────┤
│ Portfolio Over Time [Fan][Paths] │ End Value Distribution   │
│                                  │                          │
│    ╱‾‾‾‾‾‾‾‾╲                   │    ▃                     │
│   ╱   ~~~~   ╲                   │   ▆█▅                    │
│  ╱────────────╲                  │  ▂███▃                   │
│ ╱              ╲                 │ ▁█████▂                  │
│ 2025         2055                │ $0   $1M   $2M   $3M     │
├──────────────────────────────────┴──────────────────────────┤
│ Historical Backtests (1930-1995 start years)                │
│ ▃▄▅▆▇█▅▄▃▂▅▆▇█▄▃▂▅▆▇  │ Year  End $   Status              │
│ 1930        1970      │ 1966  $2.1M   ✓                    │
│                       │ 1973  $0      ✗                    │
│                       │ 62/66 periods succeeded             │
└───────────────────────┴─────────────────────────────────────┘
```

## Technical Architecture

### New Files

**Frontend (packages/web/src/)**
```
pages/
  portfolio-composition.tsx    # New page
  probability-of-success.tsx   # New page

lib/
  ticker-mapping.ts            # Hardcoded ticker → category mapping

components/
  charts/
    treemap-chart.tsx          # New component
    fan-chart.tsx              # New component
    histogram-chart.tsx        # New component
    rolling-periods-chart.tsx  # New component
```

**Backend (packages/api/src/)**
```
routes/
  portfolio.ts                 # Aggregated portfolio endpoint
  simulations.ts               # Monte Carlo + backtest endpoints

services/
  portfolio-aggregator.ts      # Ticker normalization + grouping
  historical-data.ts           # Embedded return data
```

**Backend Data (packages/api/data/)**
```
historical-returns.json        # Embedded 1928-2024 multi-asset return data
```

**Shared (packages/core/src/)**
```
ticker-categories.ts           # Shared ticker → category mapping
```

### API Endpoints

**GET /api/portfolio/composition**
```typescript
interface PortfolioComposition {
  totalValue: number;
  assetClasses: AssetClass[];
}

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
```

**POST /api/simulations/monte-carlo**
```typescript
// Request
interface MonteCarloRequest {
  allocation: {
    usStocks: number;
    intlStocks: number;
    bonds: number;
    reits: number;
    cash: number;
  };
  initialValue: number;
  annualWithdrawal: number;
  years: number;
  simulations?: number; // default 10000
}

// Response
interface MonteCarloResult {
  successRate: number;
  percentiles: {
    p5: number[];   // yearly values at 5th percentile
    p25: number[];
    p50: number[];
    p75: number[];
    p95: number[];
  };
  histogram: {
    bucket: string;
    count: number;
    status: 'success' | 'close' | 'failure';
  }[];
  paths?: number[][]; // optional sample paths for spaghetti
}
```

**POST /api/simulations/backtest**
```typescript
// Request
interface BacktestRequest {
  allocation: {
    usStocks: number;
    intlStocks: number;
    bonds: number;
    reits: number;
    cash: number;
  };
  initialValue: number;
  annualWithdrawal: number;
  years: number;
}

// Response
interface BacktestResult {
  summary: {
    periodsRun: number;
    periodsSucceeded: number;
    successRate: number;
  };
  periods: {
    startYear: number;
    endBalance: number;
    status: 'success' | 'close' | 'failure';
    worstDrawdown: number;
    worstYear: number;
  }[];
}
```

### Existing Infrastructure to Leverage

- `monte-carlo.ts` - Has core simulation engine with 3 asset classes (stocks/bonds/cash). **Requires extension** to support 5 asset classes (usStocks/intlStocks/bonds/reits/cash), add p25/p75 percentile calculation (currently only has p5/p50/p95), and return sample paths for spaghetti visualization.
- `backtester.ts` - Has backtest logic with 3 asset classes. **Requires extension** to support 5 asset classes and handle missing historical data via proration.
- `historical-data.ts` - Loads from `packages/api/data/shiller-historical.json`. **Requires extension** to include international stocks and REIT return series. Historical data JSON file should be placed at `packages/api/data/historical-returns.json`.
- `DonutChart` component - Already exists, can be reused
- `AreaChart` component - Can be extended for fan chart with percentile bands

### Navigation

Add to sidebar (packages/web/src/components/layout/sidebar.tsx) under a new "Analysis" section below Dashboard items:

| Name | Icon | Path |
|------|------|------|
| Portfolio | PieChart (lucide) | /portfolio |
| Probability | Target (lucide) | /probability |

Analysis section appears after the fixed Dashboard tabs and before "Your Plans".

## Error Handling

- **Unmapped tickers**: Place in "Other" category, don't fail
- **Missing historical data**: Prorate allocation (see Missing Data Handling above)
- **Allocation doesn't sum to 100%**: Normalize to 100% before running simulations
- **No holdings linked**: Show empty state directing user to link accounts
- **Simulation timeout**: If Monte Carlo takes >5s, return partial results with warning

## Color Scheme

Consistent colors across both pages:

| Asset Class | Color | Hex |
|-------------|-------|-----|
| US Stocks | Green | #4ade80 |
| Intl Stocks | Blue | #60a5fa |
| Bonds | Amber | #f59e0b |
| REITs | Purple | #8b5cf6 |
| Cash | Pink | #ec4899 |
| Other | Stone | #a8a29e |

Success indicators:
- Success: Green #4ade80
- Close (within 10% of failure): Amber #f59e0b
- Failure: Red #ef4444

## Out of Scope

- Real-time ticker price lookup (use Plaid-provided values)
- Custom ticker mappings (hardcoded only for v1)
- Social Security / pension income modeling
- Tax optimization (handled separately)
- PDF export of results
- Saved scenarios / comparisons

## Success Criteria

1. User can see their true allocation across all accounts
2. Drill-down works smoothly through all three hierarchy levels
3. Monte Carlo runs in <2 seconds for 10,000 simulations
4. Historical backtest shows clear success/failure visualization
5. Sliders update charts in real-time (<100ms perceived latency)
6. Mobile-responsive layouts for both pages
