# Hyper-Specific Financial Insights

**Date:** 2026-04-13
**Status:** Approved

## Problem

The current insights engine generates advice that feels generic. It sends account balances, holdings, and a financial profile to Claude — but omits spending patterns, month-over-month trends, goal trajectories, and debt payoff projections. The result is insights like "consider maxing your Roth IRA" rather than "you spent $612 on dining this month — 47% more than last month — which is delaying your emergency fund goal by 6 weeks."

Additionally, insights only appear on the Dashboard. Users have no way to see insights relevant to the page they're actively working on.

## Goals

- Every insight must reference specific dollar amounts, percentages, and comparisons that match numbers shown elsewhere in the app
- No cap on the number of insights generated
- Insights appear contextually on relevant pages and in a dedicated Insights tab
- No new infrastructure or external data sources required

---

## Backend Changes

### 1. Enrich `gatherFinancialData()`

**File:** `packages/api/src/lib/insights-engine.ts`

Expand the data snapshot to include:

**Spending analysis (from `transactions` table):**
- Category breakdown: total spend per category for current month and prior month
- Month-over-month delta per category ($ and %)
- Top 5 merchants by spend (current month)
- Recurring charges: transactions with the same merchant appearing 3+ consecutive months

**Balance trends (from `balance_snapshots` table):**
- 30-day balance delta per account (latest snapshot minus 30-days-ago snapshot)
- Savings rate: `(monthly_income - monthly_expenses) / monthly_income` for current and prior month

**Goals (from `goals` table):**
- All active goals: name, target amount, current amount, deadline
- Projected completion date at current monthly savings rate

**Debt trajectory (from `accounts` + `balance_snapshots`):**
- For each debt account: months to payoff at current minimum payment, total interest remaining
- Interest-to-principal ratio for current month's payments

### 2. Rewrite `INSIGHTS_PROMPT`

Replace the current prompt with a structured 4-lens system. The AI must analyze each lens and generate all insights that meet the specificity bar.

**Lens 1 — Spending:**
Examine category breakdowns, month-over-month changes, merchant patterns, and subscription creep. Surface anomalies, trends, and concrete savings opportunities.

**Lens 2 — Progress:**
Examine goals, debt payoff trajectory, and savings rate trends. Identify what's on track, what's slipping, and by how much.

**Lens 3 — Optimization:**
Examine tax moves (Roth conversion, 0% LTCG, HSA, asset location), contribution gaps (employer match), and interest rate arbitrage.

**Lens 4 — Behavioral:**
Examine spending habits: dining vs grocery ratio, subscription count, weekend vs weekday patterns, impulse spend signals.

**Specificity requirements (enforced in prompt):**
- Every insight must include at least one specific dollar amount or percentage from the user's actual data
- Every insight must include a comparison: vs last month, vs target, vs a benchmark, or vs a threshold
- Every insight must include a concrete next step

**No count cap.** Generate as many insights as the data warrants.

**Return `type` on each insight** (separate from `category`). The AI returns both fields: `category` for the financial classification (portfolio/debt/tax/savings/general) and `type` for page routing (spending/behavioral/debt/tax/portfolio/savings/retirement/general).

**Regeneration behavior:** Clear all non-dismissed insights on each run (see Schema Change section for details). Stale hyper-specific data is worse than missing data.

### 3. Schema Change — Add `type` Field to `insights` Table

**File:** `packages/core/src/schema.ts`

The `insights` table already has a `category` column (enum: `portfolio` | `debt` | `tax` | `savings` | `general`) that classifies the insight's financial topic. We add a **separate** `type` column for page routing — it determines where the insight surfaces contextually in the UI. These two fields serve different purposes and both are kept.

Add column:
```
type: text — nullable, one of: "spending" | "debt" | "tax" | "portfolio" | "savings" | "retirement" | "behavioral" | "general"
```

This is a plain `text` column (not an enum) to avoid requiring `ALTER TYPE` migrations when new values are added.

**Migration:** Run `pnpm db:push` to add the nullable column. Existing rows will have `type = NULL` — they will not appear in page-filtered views until regenerated. No backfill is needed since insights are regenerated on next dashboard load.

The AI assigns `type` based on which page the insight most naturally belongs to:
- Spending patterns, merchant analysis, subscriptions → `"spending"`
- Behavioral habits (dining ratio, weekend spend) → `"behavioral"`
- Debt payoff, interest rates → `"debt"`
- Tax optimization (Roth, HSA, LTCG, asset location) → `"tax"`
- Portfolio allocation, holdings concentration → `"portfolio"`
- Goals, emergency fund, savings rate → `"savings"`
- Retirement projections, contribution gaps → `"retirement"`
- Anything else → `"general"`

### 4. Remove Hard Cap and Update Regeneration Logic

**File:** `packages/api/src/lib/insights-engine.ts`

**Remove the `slice(0, 6)` guard** (currently line 323): `generated.slice(0, 6)` — this caps insertion at 6 and contradicts the "no count cap" goal. Remove it; insert all valid generated insights.

**Replace the selective-delete + deduplication logic** with a full delete of all non-dismissed insights before each run:

```ts
// Replace the current two-step delete (low/medium only) + existingTitles dedup check
// with a single delete of all non-dismissed insights for this tenant
await db.delete(insights).where(
  and(eq(insights.tenantId, tenantId), sql`${insights.dismissed} IS NULL`)
);
```

**Rationale:** The current logic preserves `critical`/`high` insights across runs to avoid losing them between regenerations. But with hyper-specific insights referencing last month's spending, stale numbers are worse than missing data. Full regeneration ensures all numbers stay accurate. The tradeoff (losing a critical insight briefly between generation runs) is acceptable because regeneration happens on every dashboard load.

---

## Frontend Changes

### 1. New `/insights` Page

**New file:** `packages/web/src/pages/insights.tsx`

A dedicated page showing all insights:
- Grouped by urgency: Critical → High → Medium → Low
- Filter tabs by type: All | Spending | Debt | Tax | Portfolio | Savings | Retirement
- Each card shows full insight (title, description, impact, next step)
- Each card has a "See in context" link that deep-links to the relevant page
- Dismiss button per card (calls existing dismiss API)

### 2. Mobile Tab Bar — 4th Tab

**File:** `packages/web/src/components/layout/mobile-tab-bar.tsx`

Add Insights as the 4th tab: Home | Chat | Insights | Profile

Icon: lightbulb or sparkles.

### 3. Desktop Sidebar

**File:** `packages/web/src/components/layout/sidebar.tsx`

Add "Insights" link in the main navigation section (alongside Home, Your Layers, Accounts, etc.).

### 4. Dashboard — Cross-Page Insight Mix

**File:** `packages/web/src/pages/Dashboard.tsx`

The existing insights section shows a curated mix: the 2-3 highest-urgency insights across all types. No filtering — home surfaces the most critical things regardless of category. Each card links to the full `/insights` page.

### 5. Contextual Insight Sections on Pages

Add a collapsible "Insights" section near the top of each page, filtered by `type`. Note: `behavioral` is a valid `type` value stored in the plain-text column — it has no corresponding `category` enum value, but that's fine since `type` and `category` are independent fields.

| Page | Filters by `type` |
|---|---|
| `/spending` | `spending`, `behavioral` |
| `/debt` | `debt` |
| `/tax` | `tax` |
| `/invest` | `portfolio` |
| `/goals` | `savings` |
| `/priorities` | `critical` urgency only (all types) |
| `/retirement` | `savings`, `portfolio` |

Each contextual section shows max 2-3 most urgent insights for that type, with a "View all insights →" link to `/insights`.

**Implementation:** A shared `<InsightsSidebar type="debt" />` (or inline section) component that accepts a `type` filter and uses a `useInsights(type?)` hook.

### 6. `useInsights` Hook

**New file:** `packages/web/src/hooks/useInsights.ts`

```ts
useInsights(type?: string) → { insights, isLoading, dismiss, refresh }
```

Fetches from existing `GET /insights` endpoint. Optionally filters client-side by `type`. Used by both the `/insights` page and all contextual page sections — one data fetch, shared across the app via React Query or SWR cache.

---

## What Doesn't Change

- Insight generation trigger (on dashboard load when stale)
- Dismiss and acted-on API endpoints
- The `ActionItem` card component (reused as-is)
- AI model and OpenRouter integration
- Chat prompt on each insight (deep-links into chat with context)

---

## Consistency Rule

The numbers in insights must match numbers shown on the relevant page. For example:
- A spending insight referencing "$612 on dining" must use the same transaction query as the Spending page
- A savings rate insight must use the same income/expense calculation as the Priorities page
- A debt payoff insight must use the same interest rate from account metadata as the Debt page

This is enforced by passing the same enriched financial snapshot (computed server-side) directly into the prompt — the AI never invents numbers, it only formats and analyzes what it's given.
