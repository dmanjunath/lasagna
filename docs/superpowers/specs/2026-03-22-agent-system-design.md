# Agent System Design Spec

## Overview

This spec defines the server-side agent system for Lasagna, enabling AI-powered financial planning through conversational interactions that generate dynamic UI.

**Core concept:** Users interact with plans through natural language chat. The agent interprets intent, accesses financial data via tools, and returns structured UI blocks that render as plan content. Plans are living documents that evolve through conversation.

## Architecture

### Approach

Embedded agent running directly in the Hono API server.

- **Framework:** Vercel AI SDK with OpenRouter provider (model flexibility)
- **Streaming:** Server-Sent Events (SSE) from API to frontend
- **Data access:** Direct database queries via agent tools (Drizzle ORM)
- **No separate services:** Agent runs in existing API process

### Why This Approach

- Uses existing infrastructure
- Direct database access without network hops
- Simpler deployment and debugging
- Can refactor to separate service later if scaling demands

## Database Schema

### Plans

```sql
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'net_worth', 'retirement', 'custom', etc.
  title TEXT NOT NULL,
  inputs JSONB, -- structured form inputs (if applicable)
  content JSONB, -- agent-generated UI layout + data
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft', 'active', 'archived'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Plan Edit History

Append-only log for Google Docs-style history.

```sql
CREATE TABLE plan_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  edited_by VARCHAR(20) NOT NULL, -- 'user', 'agent'
  previous_content JSONB NOT NULL, -- snapshot before edit
  change_description TEXT, -- what changed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

To restore: copy `previous_content` back to `plans.content`.

### Chat Threads

```sql
CREATE TABLE chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES plans(id) ON DELETE CASCADE, -- null for global threads
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- `plan_id` set: thread scoped to that plan
- `plan_id` null: global thread (future feature)
- Multiple threads per plan supported

### Messages

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'user', 'assistant'
  content TEXT NOT NULL,
  tool_calls JSONB, -- tools invoked by agent
  ui_payload JSONB, -- generative UI blocks
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Agent Tools

### Financial Data Tools

Tools wrap existing Drizzle queries, scoped to tenant.

```typescript
get_accounts()
// Returns all accounts with types, balances, institution names

get_net_worth(timeframe?: '1m' | '3m' | '6m' | '1y' | 'all')
// Returns current net worth + historical snapshots

get_holdings()
// Returns investment holdings with securities, quantities, values

get_account_history(accountId: string, timeframe: string)
// Returns balance history for a specific account

get_asset_allocation()
// Returns breakdown by account type (depository, investment, credit, loan)
```

### Plan Tools

```typescript
get_plan(planId: string)
// Returns plan with current content

update_plan_content(planId: string, content: UIPayload)
// Updates plan content, creates edit history entry

create_plan(type: string, title: string)
// Creates new plan, returns planId
```

## Generative UI Schema

Agent returns structured JSON that frontend renders.

```typescript
type UIPayload = {
  layout: 'single' | 'split' | 'grid';
  blocks: UIBlock[];
};

type UIBlock =
  | { type: 'stat'; label: string; value: string; change?: string }
  | { type: 'chart'; chartType: 'area' | 'bar' | 'donut'; data: DataPoint[] }
  | { type: 'table'; columns: Column[]; rows: Row[] }
  | { type: 'text'; content: string; variant?: 'prose' | 'callout' }
  | { type: 'projection'; scenarios: Scenario[] }
  | { type: 'action'; label: string; action: string; params?: object };

type DataPoint = { label: string; value: number; [key: string]: unknown };
type Column = { key: string; label: string };
type Row = Record<string, string | number>;
type Scenario = { name: string; [key: string]: unknown };
```

Frontend has `<UIRenderer payload={uiPayload} />` that maps blocks to React components.

## API Endpoints

### Plans

```
POST   /api/plans                — Create new plan
GET    /api/plans                — List user's plans
GET    /api/plans/:id            — Get plan with content
PATCH  /api/plans/:id            — Update plan (title, status, inputs)
DELETE /api/plans/:id            — Archive/delete plan
GET    /api/plans/:id/history    — Get edit history
POST   /api/plans/:id/clone      — Clone plan to new draft
POST   /api/plans/:id/restore    — Restore from history entry
```

### Chat Threads

```
POST   /api/threads              — Create thread (with optional planId)
GET    /api/threads              — List threads (filter by planId)
GET    /api/threads/:id          — Get thread with messages
DELETE /api/threads/:id          — Delete thread
```

### Chat (Streaming)

```
POST   /api/chat
Body: { threadId: string, message: string }
Response: SSE stream
```

**SSE Events:**

```
event: text
data: { content: "partial text..." }

event: tool_call
data: { name: "get_accounts", args: {}, result: {...} }

event: ui
data: { blocks: [...] }

event: error
data: { code: "TOOL_FAILED", message: "..." }

event: done
data: { messageId: "...", planUpdated: true }
```

## Interaction Flow

### Example: Retirement Plan

**1. Create Plan**
- User creates "Retirement" plan
- System shows starter template with prompts

**2. Initial Generation**
- User: "I want to retire at 62, currently have $800k in 401k and $200k in Roth"
- Agent fetches actual account data via tools
- Agent generates plan content with stats, projections, charts
- Plan UI renders blocks

**3. Refinement via Chat**
- User: "What's the optimal withdrawal order to minimize lifetime taxes?"
- Agent runs analysis, returns new UI blocks
- Blocks get added to plan content
- Edit history records change

**4. Follow-up**
- User: "What if I do Roth conversions of $50k/year until 62?"
- Agent recalculates, updates relevant sections
- Previous version saved in history

Plans grow and refine through conversation.

## Frontend Integration

### Vercel AI SDK Hooks

```typescript
const { messages, input, handleSubmit, isLoading } = useChat({
  api: '/api/chat',
  body: { threadId },
});
```

### Component Structure

```
/plans/[planId]
├── PlanView
│   ├── PlanHeader (title, status, actions)
│   ├── UIRenderer (renders plan.content blocks)
│   └── PlanHistory (edit history sidebar)
└── PlanChat (collapsible panel)
    ├── MessageList
    ├── MessageBubble
    │   └── UIRenderer (inline UI in messages)
    └── ChatInput
```

### UIRenderer

```typescript
function UIRenderer({ payload }: { payload: UIPayload }) {
  return (
    <div className={layoutClasses[payload.layout]}>
      {payload.blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  );
}
```

Reuses existing components: StatCard, AreaChart, DonutChart, etc.

## Error Handling

### Agent Errors

| Scenario | Handling |
|----------|----------|
| Agent hallucinates data | Tools return real data only |
| Tool execution fails | Return error block, don't crash stream |
| Rate limit / API error | Retry with backoff, surface if persistent |
| Malformed UI payload | Validate schema, fallback to text block |

### Data Edge Cases

| Scenario | Handling |
|----------|----------|
| No accounts linked | Agent prompts to link accounts |
| Partial data | Agent works with available data, notes limitations |
| Stale data | Agent mentions freshness, suggests sync |

### Streaming Failures

```
event: error
data: { code: "TOOL_FAILED", message: "Could not fetch account data" }

event: done
data: { messageId: "...", partial: true }
```

Frontend shows inline error, conversation continues.

### Validation

- Input: Sanitize messages (length limits)
- Output: Validate UIPayload against Zod schema
- Mutations: Verify tenant ownership

## Initial Scope

### Phase 1 (This Spec)

- Database schema: plans, plan_edits, chat_threads, messages
- Agent with Vercel AI SDK + OpenRouter
- Financial data tools (accounts, net worth, holdings)
- Plan CRUD tools
- Streaming chat endpoint
- UIRenderer component
- Two plan types: Net Worth, Retirement

### Future Phases

- Global chat threads
- Additional plan types (tax, cash flow, debt)
- Plan sharing/collaboration
- PDF export
- Scheduled re-analysis

## Tech Stack

- **Agent framework:** Vercel AI SDK (`ai`, `@ai-sdk/openrouter`)
- **API:** Hono (existing)
- **Database:** PostgreSQL + Drizzle ORM (existing)
- **Streaming:** Server-Sent Events
- **Frontend:** React + existing component library
