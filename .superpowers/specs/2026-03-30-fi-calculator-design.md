# FI Calculator — Probability of Success Page Redesign

**Date:** 2026-03-30
**Page:** `/probability` (enhance existing `ProbabilityOfSuccess` component)

## Overview

Transform the existing probability-of-success page into a full FI calculator inspired by ficalc.app. Uses real account data as the starting point (portfolio value from net worth, spending from credit card balances, allocation from actual holdings). Adds multiple withdrawal strategies, a filterable historical backtest table with inline year-by-year drill-down, and improved chart visualizations.

**Scope note:** This models the withdrawal/retirement phase only. It does not model an accumulation phase. The "years" value is `Life Expectancy - Retirement Age` (how long the portfolio needs to last).

## Inputs / Configuration

### Top-Level Parameters

Displayed as editable stat cards (existing `EditableStatCard` component), seeded from real account data on page load:

- **Portfolio Value** — net worth from all linked accounts (assets - liabilities). Editable so the user can override with a hypothetical value for what-if scenarios.
- **Retirement Age** — default 65, range 50-80
- **Life Expectancy** — default 95, range 70-110
- **Monthly Spending** — seeded from credit card balances, user-adjustable. Displayed and stored as monthly; converted to annual internally (`monthlySpend * 12`).

### Withdrawal Strategy Selector

A tab/button group that switches between 4 strategies. Each strategy reveals its own parameter controls below the selector.

**Inflation handling:** All strategies apply historical inflation adjustment to withdrawals by default. The Constant Dollar strategy has an explicit toggle to disable it. For all other strategies, inflation is always applied to any fixed-dollar amounts (floors, ceilings, base withdrawal).

#### 1. Constant Dollar (default)
The classic 4% rule approach. Fixed inflation-adjusted withdrawal each year.
- **Annual withdrawal amount** — defaults to monthly spending × 12
- **Inflation adjustment** — toggle, default on (adjusts withdrawal by historical inflation each year)

#### 2. Percent of Portfolio
Withdraw a fixed percentage of current portfolio value each year. Spending varies with market.
- **Withdrawal rate %** — default 4%
- **Floor** (optional) — minimum annual withdrawal regardless of portfolio performance. Inflation-adjusted each year.
- **Ceiling** (optional) — maximum annual withdrawal even if portfolio grows significantly. Inflation-adjusted each year.

**Validation:** Floor must be less than ceiling if both are set.

#### 3. Guardrails (Guyton-Klinger inspired)
Start with a base withdrawal, but adjust up/down when portfolio crosses thresholds. Uses standard Guyton-Klinger terminology.
- **Initial withdrawal rate %** — default 5%
- **Capital Preservation rule** — if current withdrawal rate exceeds `initial rate × (1 + threshold)`, cut withdrawal. Threshold default: 20%. Cut amount default: 10%.
- **Prosperity rule** — if current withdrawal rate falls below `initial rate × (1 - threshold)`, raise withdrawal. Threshold default: 20%. Raise amount default: 10%.

Example: initial rate 5%, threshold 20%. If portfolio drops and effective rate hits 6% (> 5% × 1.2 = 6%), cut withdrawal by 10%. If portfolio grows and effective rate drops to 3.9% (< 5% × 0.8 = 4%), raise withdrawal by 10%.

**Validation:** Threshold must be >0%. Increase/decrease amounts must be >0%.

#### 4. Rules-Based
User-configurable withdrawal sourcing rules based on market conditions. Uses Constant Dollar withdrawal amount, but varies *where* the money comes from.
- **Base withdrawal** — annual amount, defaults to monthly spending × 12. Inflation-adjusted.
- **Market down threshold** — default: -10%. If the **equity return** (weighted US + Int'l stocks) is down more than this %, withdraw from cash and bonds only (preserve equities).
- **Down-market fallthrough** — if cash + bonds are insufficient to cover the withdrawal in a down market, the remainder comes from equities (the portfolio doesn't just fail to withdraw).
- **Market flat/up behavior** — withdraw proportionally from all asset classes based on current allocation.
- **Depletion order** — user-sortable list defining which asset class to deplete first during down-market withdrawals. Default: Cash → Bonds → REITs → Int'l Stocks → US Stocks.
- **Rebalancing:** After any withdrawal, the remaining portfolio is NOT rebalanced (allocation drift is intentional with this strategy). Rebalancing only happens at year boundaries if the user's allocation sliders change via a glide path (not in v1).

### Portfolio Allocation

Same as current implementation:
- Preset buttons: Current Portfolio, Conservative, Balanced, Growth, Aggressive
- Individual sliders for US Stocks, Int'l Stocks, Bonds, REITs, Cash (must sum to 100%)
- Expected return display based on weighted historical averages

### Run Simulation Button

Triggers both Monte Carlo (5,000 simulations) and Historical Backtest (every possible starting year from historical data).

## Results / Output

### Dollar Value Toggle

A toggle at the top of the results section: **Real (today's) dollars** vs **Nominal (future) dollars**. Default: Real. When toggled, all dollar values throughout the results — hero card, histogram, backtest table, year-by-year detail — update to show inflation-adjusted or nominal values. The backtest response includes both `portfolioValue` (nominal) and `portfolioValueReal` (inflation-adjusted) for each year, so this is a frontend-only toggle with no re-simulation needed.

### 1. Hero Card

Prominent display of:
- **Success Rate %** — from Monte Carlo, color-coded (green ≥80%, yellow ≥60%, red <60%)
- Starting balance and projection years
- Retry button on error

### 2. Monte Carlo Projection

Fan chart / spaghetti paths toggle (existing, keep as-is). Shows p5/p25/p50/p75/p95 percentile bands or 20 sample paths.

### 3. Distribution of Final Portfolio Values (Histogram)

**Improvements from current:**
- Bucket labels show ranges: "$100K–$200K" instead of a single value
- Tooltip on hover shows: range ("$100K–$200K"), count ("342 simulations"), percentage ("6.8% of total")
- Color-coded by status (green = succeeded, yellow = close, red = failed)
- Legend below chart
- ~12-15 bins with nice round boundaries

### 4. Historical Backtest Section

**Summary cards** — three clickable stat cards displayed in a row:
- **Succeeded** (green) — count of periods that lasted the full duration
- **Close Call** (yellow) — count that lasted ≥90% of duration
- **Ran Out** (red) — count that lasted <90% of duration

Each card acts as a **filter toggle**: clicking "Succeeded" filters the table below to only successful periods. Clicking the active filter clears it (shows all). Active filter is visually highlighted.

**Simulation Table** — all historical starting periods, displayed below the summary cards:
- Columns: Start Year, Years Lasted, End Balance, Status (badge), Worst Drawdown %
- Sortable by any column
- Filterable by status (via summary cards above)
- Rows are clickable to expand inline detail
- No pagination needed (~40-90 rows depending on duration; all rendered)

**Inline Year-by-Year Detail** — clicking a row expands it below to show a table for that specific historical period:
- Columns: Year, Portfolio Value, Market Return %, Withdrawal Amount, Withdrawal Source (for rules-based strategy), Notes
- **Notes column** shows strategy-specific events: "Capital preservation: reduced withdrawal 10%", "Rules-based: withdrew from cash only (equity return -15%)", "Prosperity rule: raised withdrawal 10%"
- **Color-coded rows**: green background tint for growth years (positive return), red tint for down years (negative return)
- Scrollable if many years
- Year-by-year data is **returned eagerly** in the backtest response (all periods include full detail). Payload is ~100KB for a typical 30-year simulation across 60 starting years — acceptable.

## Data Flow

### Frontend → Backend

The simulation request includes:
```
{
  allocation: { usStocks, intlStocks, bonds, reits, cash },
  initialValue: number,
  annualWithdrawal: number,
  years: number,
  strategy: "constant_dollar" | "percent_of_portfolio" | "guardrails" | "rules_based",
  strategyParams: {
    // constant_dollar
    inflationAdjusted?: boolean,

    // percent_of_portfolio
    withdrawalRate?: number,
    floor?: number | null,
    ceiling?: number | null,

    // guardrails
    initialRate?: number,
    capitalPreservationThreshold?: number,
    prosperityThreshold?: number,
    increaseAmount?: number,
    decreaseAmount?: number,

    // rules_based
    marketDownThreshold?: number,
    depletionOrder?: string[],
  },
  simulations?: number  // Monte Carlo only, default 5000
}
```

### Backend Processing

- **Monte Carlo endpoint** (`POST /api/simulations/monte-carlo`) — enhanced to accept strategy + params, apply withdrawal logic per strategy per year
- **Backtest endpoint** (`POST /api/simulations/backtest`) — enhanced similarly, returns year-by-year data for each period
- **Shared withdrawal logic** — `packages/api/src/services/withdrawal-strategies.ts` implements all 4 strategies. Both Monte Carlo and backtester call into this shared module.
- **Bug fix:** The existing `combineMonteCarloResults` in `simulations.ts` incorrectly uses `r.numSimulations` (which doesn't exist). Fix as part of route refactoring.

### Backend → Frontend

Monte Carlo response (same structure as current, plus strategy metadata).

Backtest response enhanced:
```
{
  summary: { totalPeriods, successRate, avgFinalValue },
  periods: [
    {
      startYear: number,
      endBalance: number,
      yearsLasted: number,
      status: "success" | "close" | "failed",
      worstDrawdown: number,
      yearByYear: [
        {
          year: number,
          portfolioValue: number,         // nominal
          portfolioValueReal: number,     // inflation-adjusted to start year
          marketReturn: number,
          withdrawalAmount: number,       // nominal
          withdrawalAmountReal: number,   // inflation-adjusted
          cumulativeInflation: number,    // cumulative inflation multiplier from start
          withdrawalSource?: string,
          notes: string[],
        }
      ]
    }
  ]
}
```

## Files to Modify

### Backend
- `packages/api/src/routes/simulations.ts` — accept strategy params, fix `combineMonteCarloResults` bug, route to correct withdrawal logic
- `packages/api/src/services/monte-carlo.ts` — integrate with withdrawal strategies module instead of hardcoded withdrawal logic
- `packages/api/src/services/backtester.ts` — significant refactor of `simulatePeriod` to track and return year-by-year data, integrate with withdrawal strategies
- New: `packages/api/src/services/withdrawal-strategies.ts` — shared withdrawal strategy implementations (all 4 strategies)

### Frontend
- `packages/web/src/pages/probability-of-success.tsx` — main page rewrite with strategy selector, backtest table, drill-down
- `packages/web/src/components/charts/histogram-chart.tsx` — range labels, improved hover tooltip
- `packages/web/src/components/charts/rolling-periods-chart.tsx` — remove (existing backtest bar chart replaced by filterable table)
- New: `packages/web/src/components/simulation/strategy-config.tsx` — strategy selector + per-strategy param controls
- New: `packages/web/src/components/simulation/backtest-table.tsx` — filterable table with inline expand
- New: `packages/web/src/components/simulation/year-detail.tsx` — year-by-year detail view

### Tests
- `e2e/probability.spec.ts` — update for new UI structure

## Known Limitations

- **Asset class correlation:** The Monte Carlo engine generates independent random returns per asset class. In reality, asset classes are correlated (stocks/bonds have negative correlation). This means Monte Carlo results may understate tail risk. Historical backtest uses real correlated data and is more reliable for this reason.
- **No accumulation phase:** This models withdrawal only. A user who is 40 and plans to retire at 65 should enter their projected portfolio value at retirement, not current value.
- **No tax modeling:** Withdrawals are pre-tax. Users should gross up their spending to account for taxes.

## Non-Goals

- Extra withdrawals / additional income (future enhancement)
- Glide path / allocation changes over time (future)
- CSV export (future)
- Tax calculations (future)
- Saving/sharing configurations via URL (future)
- Accumulation phase modeling (future)
