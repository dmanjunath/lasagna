# Lasagna - Product Requirements

## Vision

Lasagna is an AI-powered financial planning tool for individuals who want to self-manage their money without a CFP. It provides projections, actionable insights, and a clear path forward for people across the financial spectrum — from those with tens of thousands in debt to those managing a few million dollars.

**What Lasagna is:** A projection and insight engine. Think ficalc.app or ProjectionLab, but extremely user-friendly. It answers: "Where do I stand?", "What should I do next?", and "Am I on track?"

**What Lasagna is not:** A budgeting app. It is not competing with Monarch, YNAB, or Mint. Transactions exist only to understand monthly expenses as an input to projections — not to micromanage spending categories.

**Disclaimer:** Lasagna does not provide financial advice. There is no liability on this service. Users operate at their own risk.

---

## Target Users

| Segment | Net Worth Range | Primary Need |
|---------|----------------|--------------|
| Debt Climber | -$60K to $0 | Debt payoff strategy, what to prioritize |
| Early Builder | $0 to $100K | Build emergency fund, start investing, employer match |
| Accumulator | $100K to $750K | Optimize allocation, tax strategy, retirement timeline |
| Pre-Retiree | $750K to $3M | Retirement modeling, withdrawal strategy, FIRE planning |
| High Net Worth | $3M+ | Portfolio exposure, tax optimization, estate/legacy |

---

## Core Use Cases

### 1. Portfolio Analysis & Exposure

**User Story:** "Show me a breakdown of my portfolio. Let me group across different accounts to see my total S&P 500 exposure (even if in different ETFs), and give me a blended average annual historical return."

**Requirements:**
- Aggregate holdings across all linked accounts
- Group by asset class, sub-category (S&P 500, Total Market, etc.), or individual ticker
- Show total exposure to each index/category regardless of which ETF/fund holds it
- Calculate blended historical return based on actual allocation weights
- Support drill-down: Asset Class > Sub-Category > Holding > Account
- Display via donut chart, bar chart, or treemap (user choice)
- One-click to run Monte Carlo simulation from current portfolio allocation

### 2. Retirement Modeling

**User Story:** "I want to model my retirement date and available retirement spending with different strategies."

**Requirements:**
- Show current age, target retirement age, years remaining, current portfolio value
- Calculate FIRE number (25x annual expenses)
- Project portfolio at retirement (compound growth + estimated contributions)
- Estimate sustainable monthly retirement income (4% rule and alternatives)
- Retirement readiness score (portfolio / FIRE number)
- Interactive sliders: retirement age (50-75), monthly retirement spending ($2K-$20K)
- Four withdrawal strategies: Constant Dollar, Percent of Portfolio, Guardrails, Rules-Based
- Monte Carlo simulation (5,000+ runs) with fan chart (percentiles p5/p25/p50/p75/p95)
- Historical backtesting against every period since 1928
- Spaghetti chart of individual simulation paths
- Histogram of final portfolio values
- Stress testing: 2008 crash, Great Depression, stagflation, Japan lost decade

### 3. Tax Optimization Insights

**User Story:** "Tell me about optimizations I can make based on my situation — Roth conversions, taking no ordinary income and using it on LTCG buckets, etc."

**Requirements:**
- Roth conversion ladder: Flag when Traditional IRA/401k balance is high and income is below conversion thresholds
- 0% LTCG bracket: Identify when filing status + income qualifies for $0 tax on long-term capital gains
- Tax-loss harvesting: Flag unrealized losses in taxable accounts that can offset gains
- HSA triple tax advantage: Recommend opening/maxing HSA if eligible
- Asset location optimization: Suggest placing bonds/REITs in tax-deferred, index funds in taxable, growth in Roth
- 401(k) contribution gap: Calculate free money left on the table from unmatched employer contributions
- Insights generated automatically from user's financial data
- Each insight includes: urgency level, dollar impact, specific action to take, and a chat prompt for deeper discussion

### 4. Debt Management

**User Story:** "If I'm in debt I want to know how much, interest rates, and the best order to pay it off."

**Requirements:**
- Show all debts with balances, APRs, minimum payments
- Avalanche strategy (highest APR first) vs Snowball strategy (lowest balance first) comparison
- Calculate: total interest paid under each strategy, time to debt-free, interest savings
- Payoff timeline with projected debt-free date
- Suggested payment amounts (e.g., 1.8x minimum)
- Action items: negotiate APR, set up autopay, balance transfer opportunities
- Debt categorization: high-interest (>7% APR), medium (4-7%), low (<4%)

### 5. Financial Priority Waterfall

**User Story:** "I want to know what steps to take in my financial life — should I fund my emergency fund first, contribute to 401k, invest, pay off debt?"

**Requirements:**
- Personalized step-by-step action plan based on user's actual financial data
- Priority order:
  1. Emergency fund (3-6 months expenses)
  2. Employer 401(k) match (free money)
  3. High-interest debt payoff (>7% APR)
  4. Max HSA ($4,300 individual / $8,550 family)
  5. Max Roth IRA ($7,000 / $8,000 if 50+)
  6. Max 401(k) ($23,500 / $31,000 if 50+)
  7. Medium-interest debt (4-7% APR)
  8. Taxable brokerage investing
- Each step shows: current amount, target amount, progress bar, specific action, dollar amounts
- The "current step" (first incomplete) is highlighted
- Completed steps shown with checkmark
- Monthly cash flow summary: income, expenses, surplus available to deploy

---

## Supporting Features

### Account Aggregation
- Link bank, investment, credit, and loan accounts via Plaid
- Manual account entry for assets not in Plaid (real estate, crypto, vehicles)
- Automatic balance sync (every 4 hours)
- Net worth tracking over time with historical chart

### AI Chat Assistant
- Conversational AI with access to all user financial data
- Can run simulations, pull account data, calculate FIRE numbers
- Generates structured financial reports with embedded charts
- Available from any page via sidebar (desktop) or floating input (mobile)

### Financial Plans
- Create plans of 4 types: Net Worth, Retirement, Debt Payoff, Custom
- Each plan has an AI chat thread for interactive analysis
- Plan content rendered as professional reports with embedded charts
- Full edit history with restore capability

### Financial Health Score
- Single 0-100 score based on: net worth, emergency fund, debt ratio, profile completeness, savings rate
- Color-coded grade: Excellent (80+), Good (65+), Fair (50+), Needs Work (35+), Getting Started
- Displayed on dashboard

### Goals
- Set and track financial goals with progress bars
- Preset templates: emergency fund, house, retirement, vacation, car, education, wedding
- Deadline tracking with days remaining
- Manual progress updates

### Spending Overview
- Monthly spending by category (donut chart)
- Income vs expenses trend (6 months)
- Transaction list with search and category filter
- NOT a budgeting tool — exists only to inform projections

### Insights Engine
- AI-generated personalized insights based on financial snapshot
- Categories: portfolio, debt, tax, savings, general
- Urgency levels: low, medium, high, critical
- Dismissable, actionable, with chat prompts for deeper discussion
- Tax optimization rules built in

### Profile
- Date of birth, annual income, filing status, state, risk tolerance
- Retirement age target, employer match percentage
- Used to personalize all projections and recommendations

---

## Non-Functional Requirements

### Performance
- Dashboard loads in <2 seconds
- Simulations complete in <5 seconds (5,000 Monte Carlo runs)
- Transaction list pagination (50 per page)

### Security
- AES encryption for Plaid access tokens at rest
- HTTP-only session cookies
- Tenant isolation on all queries
- DLP for sensitive data in tax documents

### Accessibility
- Responsive design: mobile (390px) to desktop (1440px+)
- Bottom tab navigation on mobile
- Sidebar navigation on desktop
- Keyboard navigable

### Data
- Multi-tenant architecture with cascading deletes
- Simulation result caching by parameter hash
- 90-day insight expiration
- Full plan edit audit trail
