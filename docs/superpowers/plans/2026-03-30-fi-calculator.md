# FI Calculator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing `/probability` page into a full FI calculator with 4 withdrawal strategies, filterable historical backtest table with year-by-year drill-down, real/nominal dollar toggle, and improved histogram.

**Architecture:** Backend withdrawal logic is extracted into a shared `withdrawal-strategies.ts` module used by both Monte Carlo and backtester. The backtester is refactored to return year-by-year data with both nominal and real values. Frontend adds strategy configuration, backtest table, and inline detail components.

**Tech Stack:** Hono.js (API), React + Wouter + Framer Motion (UI), Recharts (charts), Playwright (E2E tests)

**Spec:** `docs/superpowers/specs/2026-03-30-fi-calculator-design.md`

---

## File Structure

### Backend (New)
- `packages/api/src/services/withdrawal-strategies.ts` — All 4 withdrawal strategy implementations. Pure functions, no IO. ~200 lines.

### Backend (Modify)
- `packages/api/src/services/backtester.ts` — Refactor `simulatePeriod` to return year-by-year data with nominal + real values. Integrate withdrawal strategies.
- `packages/api/src/services/monte-carlo.ts` — Replace hardcoded withdrawal logic with strategy module calls.
- `packages/api/src/routes/simulations.ts` — Accept `strategy` + `strategyParams` in request body, pass to engines, fix `combineMonteCarloResults` bug.

### Frontend (New)
- `packages/web/src/components/simulation/strategy-config.tsx` — Strategy selector tabs + per-strategy parameter controls. ~250 lines.
- `packages/web/src/components/simulation/backtest-table.tsx` — Filterable summary cards + sortable table + inline expand. ~300 lines.
- `packages/web/src/components/simulation/year-detail.tsx` — Year-by-year detail table for a single period. ~100 lines.

### Frontend (Modify)
- `packages/web/src/pages/probability-of-success.tsx` — Rewrite to use new components, add dollar toggle, remove old backtest chart.
- `packages/web/src/components/charts/histogram-chart.tsx` — Range labels + improved tooltip with percentage.

### Frontend (Remove)
- `packages/web/src/components/charts/rolling-periods-chart.tsx` — Replaced by backtest-table.

### Tests
- `e2e/probability.spec.ts` — Update for new UI structure.

---

## Task 1: Withdrawal Strategies Module

**Files:**
- Create: `packages/api/src/services/withdrawal-strategies.ts`

This is the foundation. Pure functions that compute withdrawal amounts given portfolio state and strategy params. Used by both Monte Carlo and backtester.

- [ ] **Step 1: Create the withdrawal strategies module with types and all 4 strategies**

```typescript
// packages/api/src/services/withdrawal-strategies.ts

export type StrategyType = "constant_dollar" | "percent_of_portfolio" | "guardrails" | "rules_based";

export interface StrategyParams {
  // constant_dollar
  inflationAdjusted?: boolean;

  // percent_of_portfolio
  withdrawalRate?: number;
  floor?: number | null;
  ceiling?: number | null;

  // guardrails
  initialRate?: number;
  capitalPreservationThreshold?: number;
  prosperityThreshold?: number;
  increaseAmount?: number;
  decreaseAmount?: number;

  // rules_based
  marketDownThreshold?: number;
  depletionOrder?: string[];
}

export interface WithdrawalContext {
  currentBalance: number;
  initialBalance: number;
  year: number;  // year index (1-based)
  annualWithdrawal: number;  // base withdrawal amount (in start-year dollars)
  cumulativeInflation: number;  // multiplier from start year, e.g., product of (1 + inflation_i)
  yearInflationRate: number;  // this year's inflation rate (e.g., 0.03 for 3%)
  equityReturn: number;  // weighted equity return: (usReturn * usAlloc + intlReturn * intlAlloc) / (usAlloc + intlAlloc)
  currentAllocation: Record<string, number>;  // current $ amounts per asset class
  previousWithdrawal?: number;  // last year's actual withdrawal (for guardrails)
}

// NOTE on per-asset-class tracking:
// Both Monte Carlo and backtester must maintain 5 separate asset class dollar balances.
// Each year: apply per-class returns to per-class balances, then call computeWithdrawal.
// For non-rules-based strategies, rebalance to target allocation after withdrawal each year.
// For rules-based, do NOT rebalance (allocation drift is intentional).

export interface WithdrawalResult {
  amount: number;  // total withdrawal
  source?: string;  // description for rules-based (e.g., "cash and bonds only")
  notes: string[];  // strategy events that fired
  allocationAfterWithdrawal?: Record<string, number>;  // for rules-based sourcing
}

/**
 * Compute withdrawal for a given year based on strategy.
 */
export function computeWithdrawal(
  strategy: StrategyType,
  params: StrategyParams,
  ctx: WithdrawalContext
): WithdrawalResult {
  switch (strategy) {
    case "constant_dollar":
      return constantDollar(params, ctx);
    case "percent_of_portfolio":
      return percentOfPortfolio(params, ctx);
    case "guardrails":
      return guardrails(params, ctx);
    case "rules_based":
      return rulesBased(params, ctx);
  }
}

function constantDollar(params: StrategyParams, ctx: WithdrawalContext): WithdrawalResult {
  const inflationAdjusted = params.inflationAdjusted !== false;  // default true
  const amount = inflationAdjusted
    ? ctx.annualWithdrawal * ctx.cumulativeInflation
    : ctx.annualWithdrawal;

  return {
    amount: Math.min(amount, ctx.currentBalance),
    notes: inflationAdjusted && ctx.year > 1 ? [`Inflation-adjusted: $${Math.round(amount).toLocaleString()}`] : [],
  };
}

function percentOfPortfolio(params: StrategyParams, ctx: WithdrawalContext): WithdrawalResult {
  const rate = (params.withdrawalRate ?? 4) / 100;
  let amount = ctx.currentBalance * rate;
  const notes: string[] = [];

  // Apply floor (inflation-adjusted)
  if (params.floor != null) {
    const adjustedFloor = params.floor * ctx.cumulativeInflation;
    if (amount < adjustedFloor) {
      amount = adjustedFloor;
      notes.push(`Floor applied: $${Math.round(adjustedFloor).toLocaleString()}`);
    }
  }

  // Apply ceiling (inflation-adjusted)
  if (params.ceiling != null) {
    const adjustedCeiling = params.ceiling * ctx.cumulativeInflation;
    if (amount > adjustedCeiling) {
      amount = adjustedCeiling;
      notes.push(`Ceiling applied: $${Math.round(adjustedCeiling).toLocaleString()}`);
    }
  }

  return { amount: Math.min(amount, ctx.currentBalance), notes };
}

function guardrails(params: StrategyParams, ctx: WithdrawalContext): WithdrawalResult {
  const initialRate = (params.initialRate ?? 5) / 100;
  const cpThreshold = (params.capitalPreservationThreshold ?? 20) / 100;
  const prosThreshold = (params.prosperityThreshold ?? 20) / 100;
  const increaseAmt = (params.increaseAmount ?? 10) / 100;
  const decreaseAmt = (params.decreaseAmount ?? 10) / 100;
  const notes: string[] = [];

  // Base withdrawal: previous year's withdrawal adjusted for this year's actual inflation, or initial
  let baseWithdrawal = ctx.previousWithdrawal
    ? ctx.previousWithdrawal * (1 + ctx.yearInflationRate)
    : ctx.initialBalance * initialRate;

  // Current effective withdrawal rate
  const effectiveRate = baseWithdrawal / ctx.currentBalance;

  // Capital preservation: if effective rate > initial * (1 + threshold), cut
  if (effectiveRate > initialRate * (1 + cpThreshold)) {
    baseWithdrawal *= (1 - decreaseAmt);
    notes.push(`Capital preservation: cut withdrawal ${(decreaseAmt * 100).toFixed(0)}%`);
  }
  // Prosperity: if effective rate < initial * (1 - threshold), raise
  else if (effectiveRate < initialRate * (1 - prosThreshold)) {
    baseWithdrawal *= (1 + increaseAmt);
    notes.push(`Prosperity rule: raised withdrawal ${(increaseAmt * 100).toFixed(0)}%`);
  }

  return { amount: Math.min(baseWithdrawal, ctx.currentBalance), notes };
}

function rulesBased(params: StrategyParams, ctx: WithdrawalContext): WithdrawalResult {
  const threshold = (params.marketDownThreshold ?? -10) / 100;
  const depletionOrder = params.depletionOrder ?? ["cash", "bonds", "reits", "intlStocks", "usStocks"];
  const notes: string[] = [];

  // Base withdrawal amount (constant dollar, inflation-adjusted)
  const amount = Math.min(ctx.annualWithdrawal * ctx.cumulativeInflation, ctx.currentBalance);
  const allocation = { ...ctx.currentAllocation };

  let source: string;

  if (ctx.equityReturn < threshold) {
    // Down market: withdraw from cash/bonds first per depletion order
    source = withdrawByDepletionOrder(amount, allocation, depletionOrder);
    notes.push(`Market down ${(ctx.equityReturn * 100).toFixed(1)}%: ${source}`);
  } else {
    // Flat/up market: withdraw proportionally
    source = "proportional from all assets";
    withdrawProportionally(amount, allocation);
  }

  return { amount, source, notes, allocationAfterWithdrawal: allocation };
}

function withdrawByDepletionOrder(
  amount: number,
  allocation: Record<string, number>,
  order: string[]
): string {
  let remaining = amount;
  const sources: string[] = [];

  for (const assetClass of order) {
    if (remaining <= 0) break;
    const available = allocation[assetClass] || 0;
    if (available <= 0) continue;

    const take = Math.min(remaining, available);
    allocation[assetClass] = available - take;
    remaining -= take;
    sources.push(assetClass);
  }

  // Fallthrough: if still remaining, take from remaining assets in reverse order
  if (remaining > 0) {
    for (const key of Object.keys(allocation)) {
      if (remaining <= 0) break;
      const available = allocation[key] || 0;
      if (available <= 0) continue;
      const take = Math.min(remaining, available);
      allocation[key] = available - take;
      remaining -= take;
    }
  }

  return sources.length > 0 ? `withdrew from ${sources.join(", ")}` : "no assets available";
}

function withdrawProportionally(amount: number, allocation: Record<string, number>): void {
  const total = Object.values(allocation).reduce((s, v) => s + v, 0);
  if (total <= 0) return;
  for (const key of Object.keys(allocation)) {
    allocation[key] -= (allocation[key] / total) * amount;
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit -p packages/api/tsconfig.json 2>&1 | grep withdrawal-strategies`
Expected: No errors from this file

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/withdrawal-strategies.ts
git commit -m "feat: add withdrawal strategies module (constant dollar, % of portfolio, guardrails, rules-based)"
```

---

## Task 2: Refactor Backtester for Year-by-Year Data + Strategies

**Files:**
- Modify: `packages/api/src/services/backtester.ts`

Refactor `simulatePeriod` to: (a) use the withdrawal strategies module, (b) track year-by-year data with both nominal and real values, (c) return enhanced period objects.

- [ ] **Step 1: Update types and refactor simulatePeriod**

Update `BacktestParams` to accept strategy info, update `BacktestPeriod` to include `yearByYear`, refactor `simulatePeriod` to build year-by-year detail.

Key changes:
- Replace `withdrawalRate` with `annualWithdrawal` (dollar amount) in `BacktestParams`
- Add `strategy` and `strategyParams` to `BacktestParams`
- Add `YearDetail` interface and `yearByYear: YearDetail[]` to `BacktestPeriod`
- **Track 5 per-asset-class dollar balances** (not just a single `balance` number). Initialize from `initialBalance * allocation[class]`. Each year, apply the per-class historical return to that class's balance. Sum for total `currentBalance`.
- Compute `equityReturn` as: `(usReturn * usBalance + intlReturn * intlBalance) / (usBalance + intlBalance)` (weighted by current dollar values, not target allocation)
- Track `cumulativeInflation` from historical data: `cumulativeInflation *= (1 + returns.inflation)` each year
- Pass `yearInflationRate: returns.inflation` into `WithdrawalContext`
- Call `computeWithdrawal` each year. For rules-based, use `result.allocationAfterWithdrawal` to update class balances (no rebalance). For other strategies, subtract withdrawal proportionally and rebalance to target allocation.
- Record year detail with both nominal values and real values (`nominal / cumulativeInflation`)
- Use `historical-data.ts` inflation data (`returns.inflation`) for cumulative inflation tracking

The `YearDetail` interface:
```typescript
interface YearDetail {
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
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit -p packages/api/tsconfig.json 2>&1 | grep backtester`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/backtester.ts
git commit -m "refactor: backtester returns year-by-year detail with withdrawal strategies"
```

---

## Task 3: Integrate Strategies into Monte Carlo Engine

**Files:**
- Modify: `packages/api/src/services/monte-carlo.ts`

Replace the hardcoded withdrawal logic in `runSingleSimulation` with calls to `computeWithdrawal`. Add `strategy` and `strategyParams` to `MonteCarloParams`.

- [ ] **Step 1: Update MonteCarloParams and runSingleSimulation**

Key changes:
- Replace `withdrawalRate` with `annualWithdrawal` (dollar amount) in `MonteCarloParams`
- Add `strategy?: StrategyType`, `strategyParams?: StrategyParams`, `numSimulations` to `MonteCarloParams`
- Add `numSimulations: number` to `MonteCarloResult` (set from `params.numSimulations` in `run()`)
- In `runSingleSimulation`, **track 5 per-asset-class dollar balances** (initialized from `initialBalance * allocation[class]`). Each year, apply per-class random return to that class's balance. Sum for total.
- Track `cumulativeInflation` using random normal inflation (same as current but tracked as a multiplier)
- Track `yearInflationRate` per year (the random inflation drawn for that year)
- Compute `equityReturn` from the per-class equity returns weighted by current dollar balances
- Build `WithdrawalContext` and call `computeWithdrawal` instead of hardcoded withdrawal logic
- Default to `constant_dollar` if no strategy specified (backward compat)
- Track `previousWithdrawal` for guardrails
- For non-rules-based strategies, rebalance to target allocation after withdrawal. For rules-based, use `result.allocationAfterWithdrawal` (no rebalance).

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit -p packages/api/tsconfig.json 2>&1 | grep monte-carlo`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/monte-carlo.ts
git commit -m "feat: Monte Carlo engine supports withdrawal strategies"
```

---

## Task 4: Update Simulation Routes

**Files:**
- Modify: `packages/api/src/routes/simulations.ts`

Accept `strategy` + `strategyParams` in both endpoints, pass through to engines. Fix `combineMonteCarloResults` bug.

- [ ] **Step 1: Update route handlers**

Key changes:
- Add `strategy` and `strategyParams` to both request body types
- **Stop converting annualWithdrawal to withdrawalRate.** Pass `annualWithdrawal` (dollar amount) directly to the engines. Remove the `withdrawalRate = body.annualWithdrawal / body.initialValue` conversion. Both engines should accept `annualWithdrawal` directly and pass it as `ctx.annualWithdrawal` in `WithdrawalContext`. Update `MonteCarloParams` and `BacktestParams` interfaces accordingly (replace `withdrawalRate: number` with `annualWithdrawal: number`).
- Pass `strategy` and `strategyParams` through to engine `.run()` calls
- Fix `combineMonteCarloResults`: add `numSimulations: number` to the `MonteCarloResult` interface in monte-carlo.ts (set it from `params.numSimulations` in the `run()` method). Then use `r.numSimulations` instead of the fallback `r.numSimulations || 1000`.
- Update backtest response to include `yearByYear` in each period
- Align summary shape with spec: return `{ totalPeriods, successRate, avgFinalValue }` (drop `periodsSucceeded` or keep as extra)

- [ ] **Step 2: Test with curl**

```bash
# Login
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seed-...@lasagna.local","password":"password123"}'

# Test backtest with constant_dollar strategy
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/simulations/backtest \
  -H "Content-Type: application/json" \
  -d '{"allocation":{"usStocks":60,"intlStocks":10,"bonds":25,"reits":5,"cash":0},"initialValue":500000,"annualWithdrawal":20000,"years":30,"strategy":"constant_dollar","strategyParams":{"inflationAdjusted":true}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); p=d['periods'][0]; print('periods:', len(d['periods']), 'first yearByYear:', len(p.get('yearByYear',[])))"
```

Expected: `periods: ~67  first yearByYear: 30` (or close, depending on data range)

- [ ] **Step 3: Restart API and verify**

```bash
docker compose restart api
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/simulations.ts
git commit -m "feat: simulation routes accept withdrawal strategy params, fix combineMonteCarloResults bug"
```

---

## Task 5: Strategy Configuration Component

**Files:**
- Create: `packages/web/src/components/simulation/strategy-config.tsx`

Tab selector for the 4 strategies, each showing its own params below.

- [ ] **Step 1: Create strategy-config component**

The component accepts:
```typescript
interface StrategyConfigProps {
  strategy: StrategyType;
  params: StrategyParams;
  annualSpending: number;
  onStrategyChange: (s: StrategyType) => void;
  onParamsChange: (p: StrategyParams) => void;
}
```

Layout:
- Row of 4 tab buttons: Constant Dollar, % of Portfolio, Guardrails, Rules-Based
- Active tab highlighted with `bg-accent/10 text-accent border-accent/30`
- Below tabs, render the active strategy's controls in a `glass-card`
- Each control uses the existing input styling from the codebase (`bg-surface rounded-xl border border-border`)
- Use range sliders for percentages, number inputs for dollar amounts, toggle for inflation
- Rules-based: render the depletion order as a simple list of badges the user can reorder (drag not needed for v1 — just show the default order with a note)

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json 2>&1 | grep strategy-config`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/simulation/strategy-config.tsx
git commit -m "feat: withdrawal strategy configuration component"
```

---

## Task 6: Backtest Table + Year Detail Components

**Files:**
- Create: `packages/web/src/components/simulation/backtest-table.tsx`
- Create: `packages/web/src/components/simulation/year-detail.tsx`

- [ ] **Step 1: Create year-detail component**

Simple table showing year-by-year breakdown for a single period. Accepts:
```typescript
interface YearDetailProps {
  yearByYear: YearDetail[];
  useRealDollars: boolean;
  showWithdrawalSource: boolean;  // true for rules-based strategy
}
```

Renders a `<table>` with columns: Year, Portfolio Value, Return %, Withdrawal, Source (conditional), Notes. Rows have green/red tint based on market return. Uses `cn()` for conditional styling.

- [ ] **Step 2: Create backtest-table component**

Accepts:
```typescript
interface BacktestTableProps {
  periods: BacktestPeriod[];
  useRealDollars: boolean;
  showWithdrawalSource: boolean;
}
```

Renders:
1. Three summary cards (Succeeded / Close / Failed) as clickable filter buttons
2. A table below with columns: Start Year, Years Lasted, End Balance, Status (badge), Worst Drawdown
3. Clicking a row toggles `expandedRow` state, showing `<YearDetail>` below that row
4. Column headers are clickable to sort (use local state for sort key + direction)

Use `motion.div` with `AnimatePresence` for the inline expand animation (same pattern as sidebar plan expand).

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json 2>&1 | grep -E "backtest-table|year-detail"`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/simulation/backtest-table.tsx packages/web/src/components/simulation/year-detail.tsx
git commit -m "feat: backtest table with filterable summary cards and inline year detail"
```

---

## Task 7: Improve Histogram Chart

**Files:**
- Modify: `packages/web/src/components/charts/histogram-chart.tsx`

- [ ] **Step 1: Update histogram to show range labels and improved tooltip**

Key changes:
- After `rebucket()`, compute the step size (difference between consecutive bucket boundaries)
- Change `label` from `formatValue(bucket)` to `formatValue(bucket) + "–" + formatValue(bucket + step)` for range display
- Update tooltip formatter to show: range string, count, and percentage of total (`(count / totalSimulations * 100).toFixed(1)%`)
- Pass `totalSimulations` into the component (sum of all counts) or compute it inside

- [ ] **Step 2: Verify compilation**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json 2>&1 | grep histogram`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/charts/histogram-chart.tsx
git commit -m "fix: histogram shows range labels and percentage in tooltip"
```

---

## Task 8: Rewrite Probability Page

**Files:**
- Modify: `packages/web/src/pages/probability-of-success.tsx`
- Remove: `packages/web/src/components/charts/rolling-periods-chart.tsx` (remove import, delete file)

This is the main integration task. Wire everything together.

- [ ] **Step 1: Rewrite the probability page**

Key structure:
```
State:
  - strategy, strategyParams (new)
  - useRealDollars (new toggle, default true)
  - portfolioValue (editable, seeded from net worth)
  - retirementAge, lifeExpectancy, monthlySpend (existing)
  - allocation (existing)
  - mcResults (existing: successRate, percentiles, histogram, samplePaths)
  - backtestResults (new: { summary, periods[] with yearByYear })

Data loading (useEffect on mount):
  - Same as current: fetch balances, portfolio allocation, profile
  - Seed portfolioValue from net worth, monthlySpend from credit, allocation from holdings

runSimulations():
  - Send strategy + strategyParams to both /monte-carlo and /backtest
  - Parse enhanced backtest response with yearByYear

Layout (top to bottom):
  1. Editable stat cards row: Portfolio Value, Retirement Age, Life Expectancy, Monthly Spend
  2. <StrategyConfig> — strategy selector + params
  3. Portfolio Allocation section (existing presets + sliders)
  4. Run Simulation button
  5. Dollar toggle: "Real dollars" / "Nominal dollars" button group
     NOTE: The dollar toggle only affects the backtest section (which has both nominal + real data).
     Monte Carlo results are inherently nominal (random inflation per sim) — note this in the UI.
  6. Hero card with success rate + error retry button
  7. Monte Carlo fan/spaghetti chart (existing)
  8. Histogram (improved — already has color coding by status + legend from prior work)
  9. <BacktestTable> with summary cards + filterable table + inline detail
```

Remove the import and usage of `RollingPeriodsChart`. Remove the old "Historical Backtest Analysis" section that used it.

- [ ] **Step 2: Delete rolling-periods-chart.tsx**

```bash
rm packages/web/src/components/charts/rolling-periods-chart.tsx
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json 2>&1 | grep -v ocr`
Expected: No errors (or only pre-existing unrelated errors)

- [ ] **Step 4: Restart API and smoke test in browser**

```bash
docker compose restart api
```

Navigate to `http://localhost:5173/probability`, verify:
- Page loads with real data seeded
- Strategy selector shows 4 options, switching shows different params
- Run Simulation works, results appear
- Dollar toggle switches values
- Backtest table shows with filter cards
- Clicking a row expands year-by-year detail
- Histogram shows range labels

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: FI calculator page with withdrawal strategies, backtest table, dollar toggle"
```

---

## Task 9: Update E2E Tests

**Files:**
- Modify: `e2e/probability.spec.ts`

- [ ] **Step 1: Rewrite probability tests for new UI**

Test cases:
1. Page loads and shows simulation results or empty state
2. Strategy selector is visible with 4 options
3. Can switch strategies and see different params
4. Can run simulation and see results
5. Backtest summary cards are visible (Succeeded / Close / Failed)
6. Can filter backtest table by clicking summary cards
7. Can expand a row to see year-by-year detail
8. Dollar toggle switches between real and nominal

- [ ] **Step 2: Run tests**

```bash
npx playwright test probability.spec.ts --reporter=line
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add e2e/probability.spec.ts
git commit -m "test: update probability page E2E tests for FI calculator"
```
