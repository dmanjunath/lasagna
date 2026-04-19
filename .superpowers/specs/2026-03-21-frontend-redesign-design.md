# Lasagna Frontend Redesign - Design Spec

**Date:** 2026-03-21
**Status:** Approved
**Reference Mockup:** `mockups/workspace-ui.html`

## Overview

Redesign the Lasagna frontend from a basic dashboard to an AI-powered personal finance planning platform.

## Personas

### Primary User
- Net worth $500k+ USD
- Past the budgeting-every-dollar phase
- Focused on: debt payoff, goal-based savings, retirement readiness
- Wants a trusted "advisor" without paying advisor fees

### AI Advisor (not a human)
- LLM-powered assistant
- Creates plans, runs analyses, writes reports
- Proactive suggestions once plans are set up
- Accessible via chat for questions and edits

## Key Decisions

### Interaction Model
- **Structured workflows** for specific planning tasks (user knows where to go)
- **Proactive AI** monitors and suggests optimizations once plans exist
- **Chat interface** for questions and edits within any context
- User signs up and links accounts; AI does the advising

### Planning Workflows (Priority Order)
1. **Net worth tracking** — trends, projections, asset allocation
2. **Retirement planning** — readiness score, withdrawal strategies, Social Security timing
3. **Tax optimization** — asset location, tax-loss harvesting, Roth conversion analysis
4. **Cash flow / runway** — sustainable withdrawal rate, burn analysis, longevity projections
5. **Debt payoff planning** — avalanche/snowball modeling, payoff optimization

### User Data Inputs (Beyond Plaid)
- Income details (salary, bonuses, side income, expected raises, Social Security)
- Expense categories (fixed costs, discretionary; or auto-categorized from transactions)
- Debt details (interest rates, minimum payments, terms)
- Tax situation (filing status, bracket, state, account types)
- Goals & timeline (retirement age, major purchases, risk tolerance)

### AI Output Format
- **Living documents** — plans exist in-app, interactive, editable
- **PDF snapshots** — exportable at any point for sharing/printing

### Chat Integration
- Start with **contextual chat per workflow** (simpler)
- Design for eventual **global chat** accessible via MCP/API

### AI/LLM Architecture
- **Agent framework** (Claude Agent SDK or similar) for structured workflows with consistent results
- **MCP server** to expose financial data for external access

## UI Approach

### Selected: Workspace/Document Model (Approach C) with Chat-Forward Elements (B)

Each plan is a "document" the user opens. Documents have structured sections that AI fills in. Chat is contextual to the open document.

```
┌─────────────────────────────────────────────────────────────┐
│ Lasagna                                                     │
├──────────────┬──────────────────────────────────────────────┤
│ Documents    │ Retirement Plan (v3)                    [=]  │
│              │──────────────────────────────────────────────│
│ Net Worth    │                                              │
│ Retirement ← │ ## Summary                                   │
│ Tax Strategy │ Readiness: 73% | Target: 65 | Gap: $17k/yr   │
│ Debt Payoff  │                                              │
│              │ ## Assumptions                    [Edit] [AI]│
│ [+ New Plan] │ • Current savings: $450k                     │
│              │ • Monthly contribution: $2,500               │
│              │ • Expected return: 7%                        │
│              │                                              │
│              │ ## Projections                               │
│              │ [Chart: Balance over time]                   │
│              │                                              │
│              │ ## AI Recommendations                        │
│              │ 1. Increase 401k by $500/mo                  │
│              │ 2. Consider Roth conversion                  │
│              │                                              │
│              │ ─────────────────────────────────────────────│
│              │ Ask about this plan...                       │
└──────────────┴──────────────────────────────────────────────┘
```

### Why This Approach
1. Users with $500k+ want **persistent, versioned plans** — not ephemeral chat
2. Plans need **PDF export** — document model maps directly
3. **Proactive AI** fits as sections within documents that update
4. **Contextual chat** is simpler to implement and natural for "ask about this plan"
5. Structured workflows map to **document templates**

### Hybrid Element
Within documents, AI interaction sections use chat-forward patterns. Structure of documents, conversational feel of chat.

### Sidebar Structure: Fixed Tabs vs User Plans

The sidebar distinguishes between singleton views and user-created plans:

**Fixed Tabs (Singletons)** — Always one instance, aggregate views:
- Overview (Dashboard) — To-do list, plan summaries, quick actions
- Net Worth — Aggregate view of all accounts and balances
- Cash Flow — Income vs expenses, savings rate
- Tax Strategy — Tax bracket, optimization opportunities

**User Plans (Multiples)** — User creates and names these:
- Retirement Plans — Can have multiple scenarios ("Conservative", "Early Retirement")
- Savings Goals — Multiple goals ("House Down Payment", "Vacation Fund", "New Car")
- Debt Payoff Plans — Can have multiple strategies

```
┌─────────────────────────────────────┐
│ Lasagna                             │
│ AI Financial Advisor                │
├─────────────────────────────────────┤
│ DASHBOARD                           │
│   ◐ Overview                        │
│   ◈ Net Worth                       │
│   ◉ Cash Flow                       │
│   ◇ Tax Strategy                    │
├─────────────────────────────────────┤
│ YOUR PLANS                        ▾ │
│   ◎ Retirement Plan           v3   │
│   ◎ House Down Payment       45%   │
│   ◎ Europe Vacation          72%   │
│   ◆ Debt Payoff                    │
│   + New Plan                        │
└─────────────────────────────────────┘
```

**Why this structure:**
- Net Worth is a snapshot — you only have one net worth
- Cash Flow is aggregate — one view of all money movement
- Tax Strategy is per-year — typically one active strategy
- But users often have multiple savings goals and may want to model multiple retirement scenarios

## Alternative Approaches Considered

### A: Traditional App + Chat Sidebar
- Familiar SaaS pattern, clear navigation
- Rejected: Chat feels bolted-on, context switching

### B: Chat-Forward with Rich Panels
- Natural interaction, AI feels like true advisor
- Rejected as primary: Harder to find features, history clutters, less structure
- Incorporated: Used within documents for AI sections

### D: Wizard-Driven with AI
- Very guided, good for first-time setup
- Rejected: Tedious for power users, plans feel locked in

## Technical Architecture

### Frontend Stack (Approved)
- **React** (existing in `packages/web`)
- **React Router** for document-based routing (`/plans/:type/:id`)
- **shadcn/ui + Radix UI** for accessible, customizable components
- **Tailwind CSS** for styling (already in use)
- **Framer Motion** for high-quality animations (spring physics, layout animations)
- **Recharts** for data visualization (charts, graphs)
- **PDF generation** (react-pdf or server-side, future phase)

### Design Tokens
- Dark theme primary (warm stone palette from mockup)
- Accent color: Amber/gold (`#fbbf24`)
- Typography: DM Sans (body), Fraunces (display headings)
- Glassmorphism cards with subtle borders and backdrop blur
- Consistent spacing scale via Tailwind

### Backend
- Hono API (existing)
- New endpoints for plans CRUD
- Agent framework integration for AI workflows
- MCP server for external data access

### Database
- New tables: `plans`, `plan_versions`, `plan_sections`, `chat_messages`
- Link plans to tenants

### AI Integration
- Claude Agent SDK for structured workflows
- Defined tools for each planning type
- Consistent prompt templates for reproducible outputs

## Page Specifications

### Dashboard (`/`)
- Greeting with user name
- Plan summary cards (Net Worth, Retirement, Tax Strategy, Debt Payoff, Cash Flow) with status indicators
- Action items / to-do list with priority indicators, linked to relevant plans
- Quick action buttons (Sync All Accounts, Run Full Analysis, Export Reports)

### Net Worth (`/net-worth`)
- Total net worth with month-over-month change
- Line/area chart showing net worth over time
- Donut pie chart showing asset allocation (Cash, Investments, Retirement, Real Estate)
- Expandable account sections grouped by category, showing individual account balances
- Debt shown separately (not in pie chart, but in accounts list)

### Cash Flow (`/cash-flow`)
- Monthly income, expenses, savings rate, emergency runway stats
- Expense breakdown with horizontal bar visualization by category

### Tax Strategy (`/tax-strategy`)
- Marginal bracket, effective rate, potential savings stats
- PDF upload for tax return analysis
- List of optimization opportunities with potential savings amounts

### Retirement Plan (`/plans/retirement`)
- Header with plan name, version, last updated
- Expected return display (weighted by asset allocation) with real/nominal toggle
- Asset allocation breakdown showing each asset class with expected returns
- Readiness score (large display), projected balance, income gap
- AI-suggested drawdown order with reasoning (user can reorder)
- AI recommendations list with "Apply" actions
- Contextual chat panel (desktop: side panel, mobile: bottom sheet or separate view)
- Version history modal
- Scenario runner modal

### Savings Goals (`/plans/savings-:id`)
- Goal name and target date
- Current progress with amount and percentage
- Progress bar with milestones
- Stats: monthly contribution, remaining amount, months to goal, on-track status
- Savings history chart
- Action buttons: Add Contribution, Edit Goal, Set Reminder

### Debt Payoff (`/plans/debt-payoff`)
- Total debt, monthly payment, debt-free date stats
- Strategy toggle (Avalanche vs Snowball) with explanation
- Ordered list of debts with "Focus" indicator on current priority
- Each debt shows balance, APR, minimum payment

## Open Questions

1. ~~How should plan versioning work?~~ Start with explicit versions triggered by major changes
2. ~~Should AI recommendations require user approval?~~ Yes, show "Apply" button
3. What's the onboarding flow for collecting user inputs (income, goals, etc.)? — Future phase
4. How detailed should the expense categorization be? — Start with Plaid categories

## Next Steps

1. ~~Create high-fidelity mockups~~ Done: `mockups/workspace-ui.html`
2. Implementation planning (current)
3. Build foundation: routing, layout, design system
4. Implement pages incrementally
5. Define plan document schemas (as pages are built)
6. Design AI agent prompts for each workflow (future phase)
