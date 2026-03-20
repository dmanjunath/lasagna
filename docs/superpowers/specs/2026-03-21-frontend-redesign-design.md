# Lasagna Frontend Redesign - Design Spec

**Date:** 2026-03-21
**Status:** Draft

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

### Frontend
- React (existing)
- Document-based routing (`/plans/:type/:id`)
- Markdown/rich-text rendering for plan sections
- Chart library for projections (recharts or similar)
- PDF generation (react-pdf or server-side)

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

## Open Questions

1. How should plan versioning work? Auto-save vs explicit versions?
2. Should AI recommendations require user approval before "applying"?
3. What's the onboarding flow for collecting user inputs (income, goals, etc.)?
4. How detailed should the expense categorization be?

## Next Steps

1. Create high-fidelity mockups
2. Define plan document schemas
3. Design AI agent prompts for each workflow
4. Implementation planning
