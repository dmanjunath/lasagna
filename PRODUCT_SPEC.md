# Lasagna - Product Specification

## System Architecture

```
┌──────────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind)                  │
│  Deployed on Cloudflare Pages                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │  Pages   │ │Components│ │ Charts   │             │
│  │ 15 pages │ │ 50+ comp │ │ Recharts │             │
│  └──────────┘ └──────────┘ └──────────┘             │
└───────────────────────┬──────────────────────────────┘
                        │ REST API (JSON)
┌───────────────────────┴──────────────────────────────┐
│  Backend (Hono + Node.js)                            │
│  Deployed on GCP Cloud Run                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │  Routes  │ │ Services │ │ AI Agent │             │
│  │ 14 route │ │ Monte    │ │ Claude   │             │
│  │ modules  │ │ Carlo,   │ │ Sonnet 4 │             │
│  │          │ │ Backtest │ │ via      │             │
│  │          │ │          │ │ OpenRouter│             │
│  └──────────┘ └──────────┘ └──────────┘             │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────┴──────────────────────────────┐
│  Data Layer                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │PostgreSQL│ │  Plaid   │ │Google    │             │
│  │ 16 tables│ │  API     │ │Cloud     │             │
│  │ Drizzle  │ │          │ │Storage   │             │
│  │ ORM      │ │          │ │Doc AI    │             │
│  └──────────┘ └──────────┘ └──────────┘             │
└──────────────────────────────────────────────────────┘
```

---

## Database Schema

### Tables (16 total)

#### Core
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `tenants` | Multi-tenant root | id, name, plan (free/pro) |
| `users` | Authentication | id, tenantId, email, passwordHash, role (owner/member) |
| `financial_profiles` | User KYC data | tenantId (unique), dateOfBirth, annualIncome, filingStatus, stateOfResidence, riskTolerance, retirementAge, employerMatchPercent |

#### Financial Data
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `plaid_items` | Linked institutions | tenantId, accessToken (encrypted), institutionName, status, lastSyncedAt |
| `accounts` | Bank/investment/credit/loan | tenantId, plaidItemId, name, type (depository/investment/credit/loan/real_estate/alternative), subtype, mask, metadata (JSON) |
| `balance_snapshots` | Time-series balances | accountId, tenantId, balance, available, limit, snapshotAt |
| `securities` | Stock/fund definitions | plaidSecurityId, name, tickerSymbol, type, closePrice |
| `holdings` | Investment positions | accountId, securityId, quantity, institutionPrice, institutionValue, costBasis, snapshotAt |
| `transactions` | Spending data | accountId, tenantId, date, name, merchantName, amount (+expense/-income), category (20 types), pending |
| `sync_log` | Plaid sync history | tenantId, plaidItemId, status (running/success/error), error |

#### Planning
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `plans` | Financial plans | tenantId, type (net_worth/retirement/debt_payoff/custom), title, inputs (JSON), content (JSON UIPayload), status (draft/active/archived) |
| `plan_edits` | Edit audit trail | planId, editedBy (user/agent), previousContent, changeDescription |
| `chat_threads` | Conversations | tenantId, planId (nullable), title |
| `messages` | Chat messages | threadId, role (user/assistant), content, toolCalls (JSON), uiPayload (JSON) |

#### Analysis
| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `simulation_results` | Cached simulations | planId, type (monte_carlo/backtest/scenario), paramsHash, params (JSON), results (JSON), expiresAt |
| `insights` | AI-generated insights | tenantId, category (portfolio/debt/tax/savings/general), urgency (low-critical), title, description, impact, chatPrompt, dismissed, actedOn, expiresAt |
| `goals` | Financial goals | tenantId, name, targetAmount, currentAmount, deadline, category, status (active/completed/paused), icon |
| `tax_documents` | Uploaded tax forms | tenantId, fileName, gcsPath, rawExtraction (JSONB), llmFields (JSONB), llmSummary, taxYear |

---

## API Specification

### Authentication
| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/api/auth/signup` | Create account + tenant | No |
| POST | `/api/auth/login` | Login, set session cookie | No |
| POST | `/api/auth/logout` | Clear session | Yes |
| GET | `/api/auth/me` | Current user + tenant | Yes |

### Accounts & Data
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/plaid/link-token` | Initialize Plaid Link |
| POST | `/api/plaid/exchange-token` | Complete Plaid auth |
| GET | `/api/plaid/items` | List linked institutions with accounts |
| DELETE | `/api/plaid/items/:id` | Unlink institution |
| GET | `/api/accounts` | List all accounts |
| GET | `/api/accounts/balances` | Latest balance per account |
| GET | `/api/accounts/debts` | Debt accounts with APR, term, min payment |
| GET | `/api/accounts/net-worth/history` | Daily net worth time series |
| GET | `/api/accounts/:id/history` | Single account balance history |
| GET | `/api/holdings` | All investment holdings |
| POST | `/api/sync` | Trigger Plaid sync |

### Portfolio
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/portfolio/composition` | Holdings grouped by asset class > sub-category > ticker |
| GET | `/api/portfolio/allocation` | Simple allocation percentages (usStocks, intlStocks, bonds, reits, cash) |
| GET | `/api/portfolio/exposure` | Cross-account exposure with blended historical return |

### Simulations
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/simulations/monte-carlo` | Run N Monte Carlo simulations |
| POST | `/api/simulations/backtest` | Historical backtest (1928-present) |

**Monte Carlo Input:**
```json
{
  "allocation": { "usStocks": 60, "intlStocks": 10, "bonds": 25, "reits": 5, "cash": 0 },
  "initialValue": 1000000,
  "annualWithdrawal": 40000,
  "years": 30,
  "simulations": 5000,
  "strategy": "constant_dollar",
  "strategyParams": { "inflationAdjusted": true },
  "fees": { "equities": 0.0004, "bonds": 0.0005, "reits": 0.0004, "cash": 0 },
  "cashGrowthRate": 0.015,
  "includeSamplePaths": true,
  "numSamplePaths": 20
}
```

**Monte Carlo Output:**
```json
{
  "successRate": 0.87,
  "percentiles": {
    "p5": [1000000, 980000, ...],
    "p25": [1000000, 1020000, ...],
    "p50": [1000000, 1060000, ...],
    "p75": [1000000, 1100000, ...],
    "p95": [1000000, 1200000, ...]
  },
  "histogram": [{ "bucket": "0-500K", "count": 150, "success": false }, ...],
  "samplePaths": [[1000000, 1050000, ...], ...]
}
```

**Withdrawal Strategies:**

| Strategy | Key Params | Description |
|----------|-----------|-------------|
| `constant_dollar` | inflationAdjusted | Fixed amount, optionally adjusted for inflation |
| `percent_of_portfolio` | withdrawalRate, floor, ceiling | Dynamic % of current portfolio value |
| `guardrails` | initialRate, capitalPreservationThreshold, prosperityThreshold | Cut 10% if over-withdrawing, increase 10% if under |
| `rules_based` | marketDownThreshold, depletionOrder | Withdraw from specific asset classes based on market conditions |

### Plans & Chat
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/plans` | List / create plans |
| GET/PATCH/DELETE | `/api/plans/:id` | Get / update / archive plan |
| GET | `/api/plans/:id/history` | Edit audit trail |
| POST | `/api/plans/:id/clone` | Duplicate plan |
| GET/POST | `/api/threads` | List / create chat threads |
| GET | `/api/threads/:id` | Thread with messages |
| POST | `/api/chat` | Send message to AI agent |

### Transactions & Spending
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/transactions` | Paginated transaction list (filter: category, date range, search) |
| GET | `/api/transactions/spending-summary` | Category breakdown for date range |
| GET | `/api/transactions/monthly-trend` | 6-month income vs expenses |

### Goals
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/goals` | List / create goals |
| PATCH/DELETE | `/api/goals/:id` | Update / delete goal |

### Priorities
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/priorities` | Personalized financial priority waterfall |

### Insights
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/insights` | Active insights (not dismissed, not expired) |
| POST | `/api/insights/generate` | Trigger AI insight generation |
| POST | `/api/insights/:id/dismiss` | Dismiss insight |
| POST | `/api/insights/:id/acted` | Mark acted on |

### Settings
| Method | Path | Purpose |
|--------|------|---------|
| GET/PATCH | `/api/settings/profile` | User profile |
| POST | `/api/settings/change-password` | Change password |
| GET/PATCH | `/api/settings/financial-profile` | Financial profile (income, age, etc.) |

---

## AI Agent Specification

### Model
Claude Sonnet 4 via OpenRouter (`anthropic/claude-sonnet-4`)

### Available Tools (12)

**Financial Data:**
1. `get_accounts` — All accounts with latest balances
2. `get_net_worth` — Current net worth + trend analysis
3. `get_holdings` — Investment positions with security details
4. `get_asset_allocation` — Assets grouped by type

**Simulations:**
5. `get_portfolio_summary` — Portfolio value + allocation for planning
6. `run_monte_carlo` — 1,000-10,000 stochastic simulations
7. `run_backtest` — Historical backtest (1928-present)
8. `run_scenario` — Named stress tests (2008, Depression, stagflation, Japan)
9. `calculate_fire_number` — FIRE target = expenses / withdrawal rate

**Plans:**
10. `get_plan` — Retrieve plan content
11. `update_plan_content` — Update plan with new UI blocks
12. `create_plan` — Create new plan

### Asset Return Models (Monte Carlo)
| Asset Class | Mean Return | Volatility (StdDev) |
|-------------|-------------|---------------------|
| US Stocks | 10.0% | 18.0% |
| Int'l Stocks | 8.0% | 20.0% |
| Bonds | 5.0% | 7.0% |
| REITs | 9.0% | 22.0% |
| Cash | 2.0% | 1.0% |
| Inflation | 3.0% | 1.5% |

### Ticker Classification System
175+ tickers mapped to Asset Class > Sub-Category:
- **US Stocks:** S&P 500, Total Market, Growth, Nasdaq, Value, Small Cap, Mid Cap, Dividend, Large Cap (30 individual stocks)
- **International:** Developed, Emerging, Total International
- **Bonds:** Total Bond, Corporate, Government, TIPS, Municipal
- **REITs:** US REITs, International REITs
- **Cash:** Money Market, Short-Term

### Tax Optimization Rules (Insights Engine)
1. Roth conversion ladder (Traditional balance + income thresholds)
2. 0% LTCG bracket ($47,025 single / $94,050 married joint)
3. Tax-loss harvesting (taxable accounts with unrealized losses)
4. HSA triple tax advantage ($4,300 individual / $8,550 family)
5. Asset location (bonds in tax-deferred, index funds in taxable)
6. 401(k) contribution gap (missed employer match = CRITICAL)

---

## Page Specifications

### Dashboard (`/`)
**Purpose:** At-a-glance financial overview

**Sections:**
1. Greeting with user name
2. Setup progress bar (7 steps, hidden when all complete)
3. Financial Health Score (0-100, circular ring) + Net Worth hero (sparkline)
4. Key metrics row: Emergency Fund, Monthly Income, Monthly Spend, Total Debt
5. Spending breakdown (donut) + Goals progress (top 3)
6. Additional metrics: Linked Accounts, Runway, 401(k) Match
7. Insights/Action Items (dismissable, refreshable)

### Next Steps / Priorities (`/priorities`)
**Purpose:** Personalized financial action plan

**Layout:** Vertical waterfall/timeline with connected steps

**Steps (in order):**
1. Emergency Fund (6 months expenses)
2. Employer 401(k) Match
3. High-Interest Debt (>7% APR)
4. Max HSA
5. Max Roth IRA (or Backdoor if over income limit)
6. Max 401(k)
7. Medium-Interest Debt (4-7% APR)
8. Taxable Brokerage Investing

**Each step shows:** Status (complete/current/future), progress bar, current/target amounts, specific action text

### Retirement (`/retirement`)
**Purpose:** Retirement planning overview

**Sections:**
1. Age timeline (current age -> retirement age, years remaining)
2. Stats: Portfolio value, Monthly spending, Savings rate
3. Key projections: Portfolio at retirement, Years money lasts, Monthly retirement income, FIRE number
4. Retirement readiness meter (circular progress)
5. Portfolio projection chart (area chart)
6. Interactive modeling: Retirement age slider, Monthly spending slider, Strategy selector
7. "Run Full Simulation" button -> navigates to /probability
8. Action items

### Probability / Full Simulation (`/probability`)
**Purpose:** Deep-dive Monte Carlo and backtest analysis

**Sections:**
1. Stat cards: Portfolio value, Retirement age, Life expectancy
2. Withdrawal strategy selector with parameters
3. Portfolio allocation sliders (5 asset classes) with fee inputs
4. Expected return display
5. Success rate hero (percentage with status color)
6. Monte Carlo projection (fan chart or spaghetti chart toggle)
7. Histogram of final portfolio values
8. Historical backtest table (every period since 1928)

### Portfolio / Invest (`/invest`)
**Purpose:** Portfolio composition and exposure analysis

**Sections:**
1. Total portfolio value with blended historical return
2. "Run simulation" link
3. Grouping selector (Asset Class / Sub-Category / Holdings)
4. Chart type selector (Donut / Bar / Treemap)
5. Breadcrumb drill-down navigation
6. Interactive chart with click-to-drill
7. Category breakdown table (expandable rows with holdings)

### Debt (`/debt`)
**Purpose:** Debt overview and payoff strategy

**Two states:**
- **Has debt:** Total debt, strategy (avalanche), payoff timeline, debt order, actions
- **Debt-free:** Congratulations, stay debt-free tips

### Spending (`/spending`)
**Purpose:** Monthly expense tracking (for projection inputs)

**Sections:**
1. Month selector (prev/next)
2. Stats: Total spent, Total income, Net cash flow
3. Spending by category (donut chart + list)
4. Monthly trend (area chart, 6 months)
5. Transaction list (searchable, filterable, paginated)

### Goals (`/goals`)
**Purpose:** Track financial goals

**Features:**
- Create goal with name, target, deadline, icon, category
- Preset templates (8 common goals)
- Progress bars with percentage
- Edit current amount inline
- Mark complete, delete
- Completed goals section

### Accounts (`/accounts`)
**Purpose:** Manage linked financial accounts

**Features:**
- Link bank account via Plaid
- List institutions with accounts and balances
- Sync all accounts
- Delete institution

### Profile (`/profile`)
**Purpose:** User settings and financial profile

**Sections:**
- Personal info (DOB, filing status, state, risk tolerance, retirement age)
- Income & employment (gross income, employer match)
- Linked accounts link
- Financial goals link
- Sign out

---

## Seed Data Presets

For development and demo purposes, 9 wealth-level presets:

| Preset | Assets | Profile |
|--------|--------|---------|
| `negative` | $2K cash, $60K debt | Age 24, $45K income, Single |
| `100k` | $105K assets, $8K debt | Age 30, $85K income, Single |
| `750k` | $700K assets, $400K mortgage | Age 38, $175K income, Married |
| `1.8M` | $1.25M assets, $650K debt | Age 45, $250K income, Married |
| `4M` | $2.6M assets, $700K debt | Age 50, $400K income, Married |
| `7M` | $4.85M assets, $950K debt | Age 55, $500K income, Married |
| `12M` | $6.3M assets, $750K debt | Age 52, $750K income, Married |
| `25M` | $11M assets, $500K debt | Age 55, $1M income, Married |
| `75M` | $37M assets, $1M debt | Age 58, $2M income, Married |

Each preset generates: accounts, balance history (30 days), holdings with securities, transactions (6 months), goals (2-3), and financial profile.
