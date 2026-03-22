# Chat UX + Plan Onboarding Design Spec

## Overview

This spec covers three related improvements to the Lasagna financial planning app:

1. **Chat Tool Use Indicator** — Show users what tools the AI is using during responses
2. **Plan Starter Prompts** — Provide clickable prompts when a new plan is created
3. **Sidebar Consistency** — Fix hard-coded mock data and wire up the New Plan button

## 1. Chat Tool Use Indicator

### Problem

When the AI uses tools (fetching accounts, calculating net worth), users see nothing until the final response appears. This creates confusion about whether the system is working.

### Solution

Display transient status messages showing which tool is being called.

### User Experience

1. User sends a message
2. Send button shows spinner (existing behavior)
3. As tools are called, show status below the streaming message:
   - "Getting your accounts..."
   - "Calculating net worth..."
   - "Fetching transactions..."
4. Status disappears when tool completes
5. Final response renders normally

### Tool Name Mapping

| Tool ID | Display Text |
|---------|-------------|
| `get_accounts` | "Getting your accounts..." |
| `get_net_worth` | "Calculating net worth..." |
| `get_transactions` | "Fetching transactions..." |
| `get_monthly_summary` | "Analyzing monthly data..." |
| `update_plan_content` | "Updating your plan..." |
| `get_plan` | "Loading plan details..." |

### Visual Design

- Small text below the message bubble
- Pulsing dot or subtle spinner icon
- Muted text color (text-muted)
- Animate in/out smoothly

### Technical Approach

The Vercel AI SDK's `streamText` includes tool call information in the stream. We need to:

1. Parse tool calls from the streaming response
2. Track which tools are currently executing
3. Render a `ToolStatus` component showing active tools
4. Clear status when tool completes or response ends

### Files to Modify

- `packages/web/src/components/chat/chat-panel.tsx` — Parse tool calls from stream
- `packages/web/src/components/chat/tool-status.tsx` — New component for status display

---

## 2. Plan Starter Prompts

### Problem

When users create a new plan, they land on an empty page with only "This plan is empty. Start a conversation to generate content." This provides no guidance on what to ask.

### Solution

Show 3 contextual starter prompts based on plan type, plus a custom input field.

### User Experience

1. User creates a new plan (e.g., Retirement)
2. Plan detail page shows:
   - Plan header with title and type
   - Starter prompts section with 3 clickable cards
   - Custom input field below prompts
3. User clicks a prompt OR types custom message
4. Message is sent to chat
5. Prompts disappear, normal chat interface takes over

### Starter Prompts by Plan Type

#### Retirement
1. "Analyze my retirement readiness"
2. "I want to retire early at 35, am I on track?"
3. "Minimize my lifetime taxes"

#### Net Worth
1. "Show my net worth breakdown"
2. "How has my wealth changed?"
3. "Review my asset allocation"

#### Debt Payoff (NEW PLAN TYPE)
1. "Create a debt payoff strategy"
2. "What's the most efficient way to pay off my debt"
3. "How fast can I become debt-free?"

#### Custom
1. "Help me create a financial plan"
2. "What should I focus on first to maximize my future net worth?"
3. "Analyze my financial health"

### Visual Design

- Prompts displayed as clickable cards/buttons
- Arranged in a row or grid
- Subtle hover effect
- Custom input field styled consistently with chat input
- "Or type your own question..." placeholder

### Technical Approach

1. Create `StarterPrompts` component
2. Accept `planType` and `onSelectPrompt` props
3. Render in plan detail page when `plan.content` is null AND no messages exist
4. On prompt click or custom submit, send message via existing chat mechanism
5. Hide prompts once first message is sent

### Files to Modify

- `packages/web/src/components/chat/starter-prompts.tsx` — New component
- `packages/web/src/pages/plans/[id].tsx` — Integrate starter prompts

---

## 3. Add Debt Payoff Plan Type

### Problem

The plan type enum only includes `net_worth`, `retirement`, and `custom`. Users cannot create debt payoff plans.

### Solution

Add `debt_payoff` as a new plan type throughout the stack.

### Changes Required

#### Database Schema
- Add `debt_payoff` to plan type enum in `packages/core/src/schema.ts`
- Create migration to add new enum value

#### API
- Update validation schema in `packages/api/src/routes/plans.ts` to accept `debt_payoff`

#### Frontend
- Add Debt Payoff card to `packages/web/src/pages/plans/new.tsx`:
  - Label: "Debt Payoff"
  - Description: "Create a strategy to pay off debt efficiently"
  - Icon: Use appropriate lucide icon (e.g., `CreditCard` or `TrendingDown`)

#### Types
- Update `PlanType` in `packages/web/src/lib/types.ts`

---

## 4. Sidebar Consistency Fixes

### Problem

1. Sidebar shows hard-coded mock plans that don't reflect user's actual plans
2. "New Plan" button only logs to console instead of navigating

### Solution

1. Fetch actual user plans from API
2. Wire New Plan button to navigate to `/plans/new`

### Technical Approach

#### Fetch User Plans
- Call `api.getPlans()` on sidebar mount
- Display actual plan titles with appropriate icons based on plan type
- Show loading state while fetching
- Handle empty state (no plans yet)

#### Plan Type Icons
| Type | Icon |
|------|------|
| `net_worth` | TrendingUp |
| `retirement` | Target |
| `debt_payoff` | CreditCard |
| `custom` | Sparkles |

#### New Plan Button
- Change from `console.log` to `setLocation("/plans/new")`

### Files to Modify

- `packages/web/src/components/layout/sidebar.tsx` — Fetch plans, wire button

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      Plan Creation                          │
├─────────────────────────────────────────────────────────────┤
│  1. User clicks "New Plan" in sidebar                       │
│  2. Navigates to /plans/new                                 │
│  3. User selects plan type (retirement/net_worth/debt/etc)  │
│  4. User enters title, clicks "Create Plan"                 │
│  5. API creates plan + chat thread                          │
│  6. Redirect to /plans/{id}                                 │
│  7. Plan detail shows starter prompts                       │
│  8. User clicks prompt or types custom message              │
│  9. Message sent, AI responds with tool usage visible       │
│ 10. Plan content generated, prompts hidden                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Testing Considerations

### E2E Tests to Add/Update

1. **Tool status indicator** — Verify status appears during tool calls
2. **Starter prompts** — Verify prompts appear for each plan type
3. **Prompt click** — Verify clicking prompt sends message
4. **Custom input** — Verify custom prompt submission works
5. **Debt payoff plan** — Verify new plan type can be created
6. **Sidebar plans** — Verify user's actual plans appear
7. **New Plan button** — Verify navigation works

### Unit Tests

1. Tool name mapping function
2. Starter prompts component renders correct prompts per type

---

## Out of Scope

The following items are deferred to a future spec:

- Dashboard mock data replacement
- Net Worth page hard-coded data
- Tax Strategy "coming soon" placeholder
- Cash Flow "coming soon" placeholder
- Retirement page "coming soon" placeholder
- Debt Payoff page "coming soon" placeholder
- Plan detail History button functionality
- Plan detail Options menu functionality
- Dashboard Quick Action buttons (Sync, Analysis, Export)
- UIRenderer projection block implementation

---

## Success Criteria

1. Users see tool status messages during AI responses
2. New plans show relevant starter prompts
3. All 4 plan types (net_worth, retirement, debt_payoff, custom) can be created
4. Sidebar shows user's actual plans
5. New Plan button navigates correctly
6. All existing e2e tests pass
7. New e2e tests cover added functionality
