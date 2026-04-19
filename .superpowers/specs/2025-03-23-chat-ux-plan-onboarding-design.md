# Chat UX + Plan Onboarding Design Spec

## Overview

This spec covers three related improvements to the Lasagna financial planning app:

1. **Chat Tool Use Indicator** — Show users what tools the AI is using during responses
2. **Plan Starter Prompts** — Provide clickable prompts when a new plan is created
3. **Sidebar Consistency** — Fix hard-coded mock data and wire up the New Plan button

---

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

**Backend Change Required:**

The current implementation uses `toTextStreamResponse()` which only streams text. To expose tool calls, we must change to `toDataStreamResponse()` which includes tool call events in the stream.

**File:** `packages/api/src/routes/chat.ts`

```typescript
// Change from:
return result.toTextStreamResponse();

// To:
return result.toDataStreamResponse();
```

**Frontend Change Required:**

The current frontend uses a basic `TextDecoder` to read the stream. We need to use the Vercel AI SDK's `useChat` hook or parse the data stream protocol manually.

**Option A (Recommended):** Use `useChat` hook from `ai/react`
- Provides built-in support for tool call events
- Handles streaming, loading states, and message management
- Requires refactoring ChatPanel to use the hook

**Option B:** Parse data stream manually
- Keep existing fetch-based approach
- Parse the data stream protocol to extract tool call events
- More work but less refactoring

**We will use Option A** — refactor to use `useChat` hook for cleaner integration.

### Files to Modify

- `packages/api/src/routes/chat.ts` — Change to `toDataStreamResponse()`
- `packages/web/src/components/chat/chat-panel.tsx` — Refactor to use `useChat` hook
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
- Arranged in a row or grid (responsive: stack on mobile)
- Subtle hover effect with accent border
- Custom input field styled consistently with chat input
- "Or type your own question..." placeholder

### Technical Approach

**Integration with ChatPanel:**

The `StarterPrompts` component will be rendered inside the plan detail page. When a prompt is selected:

1. `StarterPrompts` calls `onSelectPrompt(promptText)` prop
2. Plan detail page passes the prompt to `ChatPanel` via a new `initialMessage` prop
3. `ChatPanel` auto-sends the message when `initialMessage` is set
4. `StarterPrompts` is hidden once `messages.length > 0`

**Condition for showing prompts:**
- `plan.content === null` (plan has no generated content)
- `messages.length === 0` (no messages in the thread yet)

### Files to Modify

- `packages/web/src/components/chat/starter-prompts.tsx` — New component
- `packages/web/src/pages/plans/[id].tsx` — Integrate starter prompts, pass initialMessage to ChatPanel
- `packages/web/src/components/chat/chat-panel.tsx` — Accept optional `initialMessage` prop

---

## 3. Add Debt Payoff Plan Type

### Problem

The plan type enum only includes `net_worth`, `retirement`, and `custom`. Users cannot create debt payoff plans.

### Solution

Add `debt_payoff` as a new plan type throughout the stack.

### Changes Required

#### Database Schema

**File:** `packages/core/src/schema.ts`

Update the enum definition:
```typescript
export const planTypeEnum = pgEnum("plan_type", [
  "net_worth",
  "retirement",
  "debt_payoff",  // ADD THIS
  "custom",
]);
```

#### Migration

**File:** `packages/core/drizzle/XXXX_add_debt_payoff_type.sql`

PostgreSQL enum values must be added via ALTER TYPE:
```sql
ALTER TYPE plan_type ADD VALUE IF NOT EXISTS 'debt_payoff';
```

Run migration: `pnpm --filter @lasagna/core db:migrate`

**Note:** After modifying the core package, rebuild it: `pnpm --filter @lasagna/core build`

#### API Validation

**File:** `packages/api/src/routes/plans.ts`

Update the zod schema:
```typescript
const createPlanSchema = z.object({
  type: z.enum(["net_worth", "retirement", "debt_payoff", "custom"]),
  title: z.string().min(1).max(255),
});
```

#### Frontend - New Plan Page

**File:** `packages/web/src/pages/plans/new.tsx`

Add Debt Payoff to the plan types array:
```typescript
{
  type: "debt_payoff",
  label: "Debt Payoff",
  description: "Create a strategy to pay off debt efficiently",
  icon: CreditCard,  // from lucide-react
},
```

#### Frontend Types

**File:** `packages/web/src/lib/types.ts`

Update the PlanType:
```typescript
export type PlanType = "net_worth" | "retirement" | "debt_payoff" | "custom";
```

---

## 4. Sidebar Consistency Fixes

### Problem

1. Sidebar shows hard-coded mock plans that don't reflect user's actual plans
2. "New Plan" button only logs to console instead of navigating

### Solution

1. Fetch actual user plans from API
2. Wire New Plan button to navigate to `/plans/new`

### Technical Approach

#### Current Structure

The sidebar receives `onNewPlan` as a prop from the parent `Shell` component (`packages/web/src/components/layout/shell.tsx`). The fix must be made in `Shell`, not in `Sidebar`.

**File:** `packages/web/src/components/layout/shell.tsx`

Current (line ~15):
```typescript
// TODO: Open new plan modal
const handleNewPlan = () => console.log("New plan");
```

Fix:
```typescript
const [, setLocation] = useLocation();
const handleNewPlan = () => setLocation("/plans/new");
```

#### Fetch User Plans

**File:** `packages/web/src/components/layout/sidebar.tsx`

Remove the hard-coded `userPlans` array. Instead:

1. Add state for plans and loading
2. Fetch plans on mount using `api.getPlans()`
3. Map API response to sidebar format

```typescript
const [plans, setPlans] = useState<Plan[]>([]);
const [loadingPlans, setLoadingPlans] = useState(true);

useEffect(() => {
  api.getPlans()
    .then(({ plans }) => setPlans(plans))
    .finally(() => setLoadingPlans(false));
}, []);
```

#### Simplify NavItem Interface

Remove `version` and `progress` fields from NavItem since the API doesn't return them. Use plan type to determine icon.

#### Plan Type to Icon Mapping

```typescript
const planTypeIcons: Record<PlanType, string> = {
  net_worth: "◈",
  retirement: "◎",
  debt_payoff: "◆",
  custom: "✦",
};
```

(Keep unicode icons for consistency with existing sidebar style)

#### Loading State

Show skeleton or "Loading..." while plans are being fetched.

#### Error State

If fetch fails, show "Could not load plans" with retry option.

### Files to Modify

- `packages/web/src/components/layout/shell.tsx` — Wire handleNewPlan to navigate
- `packages/web/src/components/layout/sidebar.tsx` — Fetch plans from API, remove mock data

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
