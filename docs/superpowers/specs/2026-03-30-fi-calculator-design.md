# FI Calculator — Probability of Success Page Redesign

**Date:** 2026-03-30
**Page:** `/probability` (enhance existing `ProbabilityOfSuccess` component)

## Overview

Transform the existing probability-of-success page into a full FI calculator inspired by ficalc.app. Uses real account data as the starting point (portfolio value from net worth, spending from credit card balances, allocation from actual holdings). Adds multiple withdrawal strategies, a filterable historical backtest table with inline year-by-year drill-down, and improved chart visualizations.

## Inputs / Configuration

### Top-Level Parameters

Displayed as editable stat cards (existing `EditableStatCard` component), seeded from real account data on page load:

- **Portfolio Value** — net worth from all linked accounts (assets - liabilities)
- **Retirement Age** — default 65, range 50-80
- **Life Expectancy** — default 95, range 70-110
- **Annual Spending** — seeded from credit card balances, user-adjustable

### Withdrawal Strategy Selector

A tab/button group that switches between 4 strategies. Each strategy reveals its own parameter controls below the selector.

#### 1. Constant Dollar (default)
The classic 4% rule approach. Fixed inflation-adjusted withdrawal each year.
- **Annual withdrawal amount** — defaults to current annual spending
- **Inflation adjustment** — toggle, default on (adjusts withdrawal by historical inflation each year)

#### 2. Percent of Portfolio
Withdraw a fixed percentage of current portfolio value each year. Spending varies with market.
- **Withdrawal rate %** — default 4%
- **Floor** (optional) — minimum annual withdrawal regardless of portfolio performance
- **Ceiling** (optional) — maximum annual withdrawal even if portfolio grows significantly

#### 3. Guardrails (Guyton-Klinger inspired)
Start with a base withdrawal, but adjust up/down when portfolio crosses thresholds.
- **Initial withdrawal rate %** — default 5%
- **Upper guardrail %** — if withdrawal rate drops below this (portfolio grew), increase withdrawal. Default: 20% below initial (e.g., if portfolio grows enough that the withdrawal rate would be 4%, and initial was 5%, trigger increase)
- **Lower guardrail %** — if withdrawal rate rises above this (portfolio shrank), decrease withdrawal. Default: 20% above initial
- **Increase amount %** — how much to raise withdrawal when upper guardrail hit. Default: 10%
- **Decrease amount %** — how much to cut withdrawal when lower guardrail hit. Default: 10%

#### 4. Rules-Based
User-configurable withdrawal sourcing rules based on market conditions.
- **Market down threshold** — e.g., -10%. If the market is down more than this %, withdraw from cash/bonds only (preserve equities)
- **Market flat/up behavior** — pull proportionally from full portfolio
- **Depletion order** — user-sortable list defining which asset class to spend first: e.g., Cash → Bonds → REITs → Int'l Stocks → US Stocks
- **Base withdrawal** — annual amount or percentage (same as Constant Dollar, but sourcing changes)

### Portfolio Allocation

Same as current implementation:
- Preset buttons: Current Portfolio, Conservative, Balanced, Growth, Aggressive
- Individual sliders for US Stocks, Int'l Stocks, Bonds, REITs, Cash (must sum to 100%)
- Expected return display based on weighted historical averages

### Run Simulation Button

Triggers both Monte Carlo (5,000 simulations) and Historical Backtest (every possible starting year from historical data).

## Results / Output

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
- Tooltip shows: range label + count + percentage of total simulations
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

**Inline Year-by-Year Detail** — clicking a row expands it to show a table for that specific historical period:
- Columns: Year, Portfolio Value, Market Return %, Withdrawal Amount, Withdrawal Source (for rules-based strategy), Notes
- **Notes column** shows strategy-specific events: "Guardrail triggered: reduced withdrawal 10%", "Rules-based: withdrew from cash only (market down -15%)", "Inflation adjustment applied"
- **Color-coded rows**: green background tint for growth years, red tint for down years
- Scrollable if many years

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
  strategyParams: { ... strategy-specific params ... },
  simulations?: number  // Monte Carlo only, default 5000
}
```

### Backend Processing

- **Monte Carlo endpoint** (`POST /api/simulations/monte-carlo`) — enhanced to accept strategy + params, apply withdrawal logic per strategy per year
- **Backtest endpoint** (`POST /api/simulations/backtest`) — enhanced similarly, returns full year-by-year data for each period (not just summary)

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
          portfolioValue: number,
          marketReturn: number,
          withdrawalAmount: number,
          withdrawalSource?: string,  // for rules-based
          notes: string[],            // strategy events
        }
      ]
    }
  ]
}
```

## Files to Modify

### Backend
- `packages/api/src/routes/simulations.ts` — accept strategy params, route to correct engine
- `packages/api/src/services/monte-carlo.ts` — add withdrawal strategy logic
- `packages/api/src/services/backtester.ts` — add withdrawal strategy logic, return year-by-year data
- New: `packages/api/src/services/withdrawal-strategies.ts` — shared withdrawal strategy implementations

### Frontend
- `packages/web/src/pages/probability-of-success.tsx` — main page rewrite with strategy selector, backtest table, drill-down
- `packages/web/src/components/charts/histogram-chart.tsx` — range labels, improved tooltip
- `packages/web/src/components/charts/rolling-periods-chart.tsx` — remove (replaced by table)
- New: `packages/web/src/components/simulation/strategy-config.tsx` — strategy selector + per-strategy param controls
- New: `packages/web/src/components/simulation/backtest-table.tsx` — filterable table with inline expand
- New: `packages/web/src/components/simulation/year-detail.tsx` — year-by-year detail view

### Tests
- `e2e/probability.spec.ts` — update for new UI structure

## Non-Goals

- Extra withdrawals / additional income (future enhancement)
- Glide path / allocation changes over time (future)
- CSV export (future)
- Tax calculations (future)
- Saving/sharing configurations via URL (future)
