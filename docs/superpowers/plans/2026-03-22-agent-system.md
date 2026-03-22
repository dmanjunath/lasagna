# Agent System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI-powered planning system where users interact via chat, and the agent generates dynamic UI blocks that render as living plan documents.

**Architecture:** Embedded agent in Hono API using Vercel AI SDK with OpenRouter. Agent has tools to access financial data and update plans. Streaming responses via SSE. Frontend renders generative UI from structured JSON payloads.

**Tech Stack:** Vercel AI SDK, OpenRouter, Hono, Drizzle ORM, PostgreSQL, React, Zod

---

## File Structure

### Core Package (packages/core/src/)
```
schema.ts                    — MODIFY: Add plans, plan_edits, chat_threads, messages tables
```

### API Package (packages/api/src/)
```
agent/
├── types.ts                 — CREATE: UIPayload, UIBlock types with Zod schemas
├── tools/
│   ├── financial.ts         — CREATE: get_accounts, get_net_worth, get_holdings, etc.
│   └── plans.ts             — CREATE: get_plan, update_plan_content, create_plan
├── agent.ts                 — CREATE: Agent configuration with system prompt
└── index.ts                 — CREATE: Export agent and tools

routes/
├── plans.ts                 — CREATE: Plan CRUD endpoints
├── threads.ts               — CREATE: Chat thread endpoints
└── chat.ts                  — CREATE: Streaming chat endpoint

server.ts                    — MODIFY: Register new routes
```

### Web Package (packages/web/src/)
```
components/
├── ui-renderer/
│   ├── ui-renderer.tsx      — CREATE: Main renderer component
│   ├── blocks/
│   │   ├── stat-block.tsx   — CREATE: Stat block renderer
│   │   ├── chart-block.tsx  — CREATE: Chart block renderer
│   │   ├── table-block.tsx  — CREATE: Table block renderer
│   │   ├── text-block.tsx   — CREATE: Text block renderer
│   │   └── index.ts         — CREATE: Block exports
│   └── index.ts             — CREATE: UIRenderer export
└── chat/
    ├── chat-panel.tsx       — CREATE: Chat panel with input
    ├── message-list.tsx     — CREATE: Message list component
    └── message-bubble.tsx   — CREATE: Individual message

pages/
├── plans/
│   ├── index.tsx            — CREATE: Plan list page
│   ├── new.tsx              — CREATE: Create plan page
│   └── [id].tsx             — CREATE: Plan detail page

lib/
├── api.ts                   — MODIFY: Add plan and chat API methods
└── types.ts                 — CREATE: Shared types (UIPayload, Plan, etc.)

App.tsx                      — MODIFY: Add plan routes
```

---

## Phase 1: Database Schema

### Task 1: Add Plan-Related Enums and Tables

**Files:**
- Modify: `packages/core/src/schema.ts`

- [ ] **Step 1: Add enums for plans**

Add after existing enums (after line 26):

```typescript
export const planTypeEnum = pgEnum("plan_type", [
  "net_worth",
  "retirement",
  "custom",
]);

export const planStatusEnum = pgEnum("plan_status", [
  "draft",
  "active",
  "archived",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

export const editedByEnum = pgEnum("edited_by", ["user", "agent"]);
```

- [ ] **Step 2: Add plans table**

Add after syncLog table:

```typescript
// ── Plans ─────────────────────────────────────────────────────────────────

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  type: planTypeEnum("type").notNull(),
  title: text("title").notNull(),
  inputs: text("inputs"), // JSON string
  content: text("content"), // JSON string (UIPayload)
  status: planStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

- [ ] **Step 3: Add plan_edits table**

```typescript
// ── Plan Edits ────────────────────────────────────────────────────────────

export const planEdits = pgTable("plan_edits", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  editedBy: editedByEnum("edited_by").notNull(),
  previousContent: text("previous_content").notNull(), // JSON string
  changeDescription: text("change_description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

- [ ] **Step 4: Add chat_threads table**

```typescript
// ── Chat Threads ──────────────────────────────────────────────────────────

export const chatThreads = pgTable("chat_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

- [ ] **Step 5: Add messages table**

```typescript
// ── Messages ──────────────────────────────────────────────────────────────

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => chatThreads.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"), // JSON string
  uiPayload: text("ui_payload"), // JSON string
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

- [ ] **Step 6: Generate and run migration**

Run:
```bash
cd packages/core && pnpm db:generate && pnpm db:migrate
```

Expected: Migration runs successfully, new tables created.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/schema.ts packages/core/drizzle/
git commit -m "feat(core): add plans, plan_edits, chat_threads, messages schema"
```

---

## Phase 2: Agent Infrastructure

### Task 2: Create UI Payload Types

**Files:**
- Create: `packages/api/src/agent/types.ts`

- [ ] **Step 1: Create types file with Zod schemas**

```typescript
import { z } from "zod";

// ── UI Block Schemas ──────────────────────────────────────────────────────

export const statBlockSchema = z.object({
  type: z.literal("stat"),
  label: z.string(),
  value: z.string(),
  change: z.string().optional(),
  trend: z.enum(["up", "down", "neutral"]).optional(),
});

export const dataPointSchema = z.object({
  label: z.string(),
  value: z.number(),
});

export const chartBlockSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["area", "bar", "donut"]),
  title: z.string().optional(),
  data: z.array(dataPointSchema.passthrough()),
});

export const columnSchema = z.object({
  key: z.string(),
  label: z.string(),
});

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  columns: z.array(columnSchema),
  rows: z.array(z.record(z.union([z.string(), z.number()]))),
});

export const textBlockSchema = z.object({
  type: z.literal("text"),
  content: z.string(),
  variant: z.enum(["prose", "callout"]).optional(),
});

export const scenarioSchema = z.object({
  name: z.string(),
}).passthrough();

export const projectionBlockSchema = z.object({
  type: z.literal("projection"),
  title: z.string().optional(),
  scenarios: z.array(scenarioSchema),
});

export const actionBlockSchema = z.object({
  type: z.literal("action"),
  label: z.string(),
  action: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const uiBlockSchema = z.discriminatedUnion("type", [
  statBlockSchema,
  chartBlockSchema,
  tableBlockSchema,
  textBlockSchema,
  projectionBlockSchema,
  actionBlockSchema,
]);

export const uiPayloadSchema = z.object({
  layout: z.enum(["single", "split", "grid"]),
  blocks: z.array(uiBlockSchema),
});

// ── TypeScript Types ──────────────────────────────────────────────────────

export type StatBlock = z.infer<typeof statBlockSchema>;
export type ChartBlock = z.infer<typeof chartBlockSchema>;
export type TableBlock = z.infer<typeof tableBlockSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
export type ProjectionBlock = z.infer<typeof projectionBlockSchema>;
export type ActionBlock = z.infer<typeof actionBlockSchema>;
export type UIBlock = z.infer<typeof uiBlockSchema>;
export type UIPayload = z.infer<typeof uiPayloadSchema>;
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/agent/types.ts
git commit -m "feat(api): add UI payload types with Zod schemas"
```

---

### Task 3: Create Financial Data Tools

**Files:**
- Create: `packages/api/src/agent/tools/financial.ts`

- [ ] **Step 1: Create financial tools**

```typescript
import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import {
  accounts,
  balanceSnapshots,
  holdings,
  securities,
} from "@lasagna/core";
import { eq, desc, and, gte, sql } from "drizzle-orm";

export function createFinancialTools(tenantId: string) {
  return {
    get_accounts: tool({
      description:
        "Get all financial accounts for the user with their current balances",
      parameters: z.object({}),
      execute: async () => {
        const results = await db
          .select({
            id: accounts.id,
            name: accounts.name,
            type: accounts.type,
            subtype: accounts.subtype,
            mask: accounts.mask,
          })
          .from(accounts)
          .where(eq(accounts.tenantId, tenantId));

        // Get latest balance for each account
        const accountsWithBalances = await Promise.all(
          results.map(async (account) => {
            const [latestBalance] = await db
              .select({
                balance: balanceSnapshots.balance,
                available: balanceSnapshots.available,
                snapshotAt: balanceSnapshots.snapshotAt,
              })
              .from(balanceSnapshots)
              .where(eq(balanceSnapshots.accountId, account.id))
              .orderBy(desc(balanceSnapshots.snapshotAt))
              .limit(1);

            return {
              ...account,
              balance: latestBalance?.balance ?? "0",
              available: latestBalance?.available ?? null,
              lastUpdated: latestBalance?.snapshotAt ?? null,
            };
          })
        );

        return { accounts: accountsWithBalances };
      },
    }),

    get_net_worth: tool({
      description:
        "Get the user's net worth with historical data for trend analysis",
      parameters: z.object({
        timeframe: z
          .enum(["1m", "3m", "6m", "1y", "all"])
          .optional()
          .default("3m"),
      }),
      execute: async ({ timeframe }) => {
        const timeframeMap: Record<string, number> = {
          "1m": 30,
          "3m": 90,
          "6m": 180,
          "1y": 365,
          all: 3650,
        };
        const days = timeframeMap[timeframe];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get all accounts for tenant
        const tenantAccounts = await db
          .select({ id: accounts.id, type: accounts.type })
          .from(accounts)
          .where(eq(accounts.tenantId, tenantId));

        const accountIds = tenantAccounts.map((a) => a.id);

        if (accountIds.length === 0) {
          return { currentNetWorth: 0, history: [], breakdown: {} };
        }

        // Get latest balances
        const latestBalances = await Promise.all(
          tenantAccounts.map(async (account) => {
            const [latest] = await db
              .select({ balance: balanceSnapshots.balance })
              .from(balanceSnapshots)
              .where(eq(balanceSnapshots.accountId, account.id))
              .orderBy(desc(balanceSnapshots.snapshotAt))
              .limit(1);

            const balance = parseFloat(latest?.balance ?? "0");
            // Credit and loan are liabilities (negative)
            const adjustedBalance =
              account.type === "credit" || account.type === "loan"
                ? -Math.abs(balance)
                : balance;

            return { type: account.type, balance: adjustedBalance };
          })
        );

        const currentNetWorth = latestBalances.reduce(
          (sum, b) => sum + b.balance,
          0
        );

        // Group by type for breakdown
        const breakdown: Record<string, number> = {};
        latestBalances.forEach(({ type, balance }) => {
          breakdown[type] = (breakdown[type] ?? 0) + balance;
        });

        return {
          currentNetWorth,
          breakdown,
          accountCount: accountIds.length,
        };
      },
    }),

    get_holdings: tool({
      description: "Get investment holdings with securities information",
      parameters: z.object({}),
      execute: async () => {
        const results = await db
          .select({
            id: holdings.id,
            accountId: holdings.accountId,
            quantity: holdings.quantity,
            institutionPrice: holdings.institutionPrice,
            institutionValue: holdings.institutionValue,
            costBasis: holdings.costBasis,
            securityName: securities.name,
            tickerSymbol: securities.tickerSymbol,
            securityType: securities.type,
          })
          .from(holdings)
          .innerJoin(securities, eq(holdings.securityId, securities.id))
          .where(eq(holdings.tenantId, tenantId));

        const totalValue = results.reduce(
          (sum, h) => sum + parseFloat(h.institutionValue ?? "0"),
          0
        );

        return { holdings: results, totalValue };
      },
    }),

    get_asset_allocation: tool({
      description: "Get breakdown of assets by account type",
      parameters: z.object({}),
      execute: async () => {
        const tenantAccounts = await db
          .select({ id: accounts.id, type: accounts.type, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.tenantId, tenantId));

        const allocation: Record<
          string,
          { total: number; accounts: { name: string; balance: number }[] }
        > = {};

        for (const account of tenantAccounts) {
          const [latest] = await db
            .select({ balance: balanceSnapshots.balance })
            .from(balanceSnapshots)
            .where(eq(balanceSnapshots.accountId, account.id))
            .orderBy(desc(balanceSnapshots.snapshotAt))
            .limit(1);

          const balance = parseFloat(latest?.balance ?? "0");

          if (!allocation[account.type]) {
            allocation[account.type] = { total: 0, accounts: [] };
          }
          allocation[account.type].total += balance;
          allocation[account.type].accounts.push({
            name: account.name,
            balance,
          });
        }

        return { allocation };
      },
    }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/agent/tools/financial.ts
git commit -m "feat(api): add financial data tools for agent"
```

---

### Task 4: Create Plan Tools

**Files:**
- Create: `packages/api/src/agent/tools/plans.ts`

- [ ] **Step 1: Create plan tools**

```typescript
import { tool } from "ai";
import { z } from "zod";
import { db } from "../../lib/db.js";
import { plans, planEdits } from "@lasagna/core";
import { eq, and } from "drizzle-orm";
import { uiPayloadSchema } from "../types.js";

export function createPlanTools(tenantId: string) {
  return {
    get_plan: tool({
      description: "Get a plan's current content",
      parameters: z.object({
        planId: z.string().uuid(),
      }),
      execute: async ({ planId }) => {
        const [plan] = await db
          .select()
          .from(plans)
          .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

        if (!plan) {
          return { error: "Plan not found" };
        }

        return {
          id: plan.id,
          type: plan.type,
          title: plan.title,
          status: plan.status,
          content: plan.content ? JSON.parse(plan.content) : null,
          inputs: plan.inputs ? JSON.parse(plan.inputs) : null,
        };
      },
    }),

    update_plan_content: tool({
      description:
        "Update a plan's content with new UI blocks. Creates edit history.",
      parameters: z.object({
        planId: z.string().uuid(),
        content: uiPayloadSchema,
        changeDescription: z.string().optional(),
      }),
      execute: async ({ planId, content, changeDescription }) => {
        // Get current plan
        const [plan] = await db
          .select()
          .from(plans)
          .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

        if (!plan) {
          return { error: "Plan not found" };
        }

        // Save edit history
        if (plan.content) {
          await db.insert(planEdits).values({
            planId,
            tenantId,
            editedBy: "agent",
            previousContent: plan.content,
            changeDescription,
          });
        }

        // Update plan
        await db
          .update(plans)
          .set({ content: JSON.stringify(content) })
          .where(eq(plans.id, planId));

        return { success: true, planId };
      },
    }),

    create_plan: tool({
      description: "Create a new plan",
      parameters: z.object({
        type: z.enum(["net_worth", "retirement", "custom"]),
        title: z.string(),
      }),
      execute: async ({ type, title }) => {
        const [newPlan] = await db
          .insert(plans)
          .values({
            tenantId,
            type,
            title,
            status: "draft",
          })
          .returning({ id: plans.id });

        return { planId: newPlan.id };
      },
    }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/agent/tools/plans.ts
git commit -m "feat(api): add plan CRUD tools for agent"
```

---

### Task 5: Create Agent Configuration

**Files:**
- Create: `packages/api/src/agent/agent.ts`
- Create: `packages/api/src/agent/index.ts`

- [ ] **Step 1: Create agent configuration**

```typescript
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createFinancialTools } from "./tools/financial.js";
import { createPlanTools } from "./tools/plans.js";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

export const model = openrouter("anthropic/claude-sonnet-4");

export function createAgentTools(tenantId: string) {
  return {
    ...createFinancialTools(tenantId),
    ...createPlanTools(tenantId),
  };
}

export const systemPrompt = `You are a financial planning assistant for Lasagna, a personal finance platform.

Your role is to help users understand their finances and create actionable plans. You have access to their real financial data through tools.

When responding, you generate UI blocks that render as part of the user's plan document. Always use the tools to get real data - never make up numbers.

## Available UI Block Types

- stat: Display a key metric (label, value, optional change indicator)
- chart: Visualize data (area, bar, or donut charts)
- table: Display tabular data
- text: Prose content or callouts
- projection: Compare scenarios
- action: Suggest user actions

## Guidelines

1. Always fetch real data using tools before making recommendations
2. Be specific and actionable in your advice
3. When updating plans, describe what changed
4. For retirement planning, consider: current savings, expected contributions, withdrawal strategies, tax implications
5. For net worth analysis: track trends, asset allocation, debt-to-asset ratios

## Response Format

Return a UIPayload object with layout and blocks array. Choose layout based on content:
- "single": One column, good for text-heavy responses
- "split": Two columns, good for comparisons
- "grid": Multiple cards, good for stats overview
`;
```

- [ ] **Step 2: Create agent index**

```typescript
export { model, createAgentTools, systemPrompt } from "./agent.js";
export * from "./types.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/agent/agent.ts packages/api/src/agent/index.ts
git commit -m "feat(api): add agent configuration with system prompt"
```

---

## Phase 3: API Routes

### Task 6: Install Vercel AI SDK Dependencies

**Files:**
- Modify: `packages/api/package.json`

- [ ] **Step 1: Install dependencies**

```bash
cd packages/api && pnpm add ai @openrouter/ai-sdk-provider zod
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add Vercel AI SDK and OpenRouter dependencies"
```

---

### Task 7: Create Plans Routes

**Files:**
- Create: `packages/api/src/routes/plans.ts`

- [ ] **Step 1: Create plans routes**

```typescript
import { Hono } from "hono";
import { db } from "../lib/db.js";
import { plans, planEdits, chatThreads } from "@lasagna/core";
import { eq, and, desc } from "drizzle-orm";
import type { AuthEnv } from "../middleware/auth.js";

export const plansRouter = new Hono<AuthEnv>();

// List all plans
plansRouter.get("/", async (c) => {
  const { tenantId } = c.get("auth");

  const results = await db
    .select({
      id: plans.id,
      type: plans.type,
      title: plans.title,
      status: plans.status,
      createdAt: plans.createdAt,
      updatedAt: plans.updatedAt,
    })
    .from(plans)
    .where(eq(plans.tenantId, tenantId))
    .orderBy(desc(plans.updatedAt));

  return c.json({ plans: results });
});

// Get single plan
plansRouter.get("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const planId = c.req.param("id");

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  return c.json({
    ...plan,
    content: plan.content ? JSON.parse(plan.content) : null,
    inputs: plan.inputs ? JSON.parse(plan.inputs) : null,
  });
});

// Create plan
plansRouter.post("/", async (c) => {
  const { tenantId } = c.get("auth");
  const body = await c.req.json<{
    type: "net_worth" | "retirement" | "custom";
    title: string;
  }>();

  const [newPlan] = await db
    .insert(plans)
    .values({
      tenantId,
      type: body.type,
      title: body.title,
      status: "draft",
    })
    .returning();

  // Create default chat thread for plan
  await db.insert(chatThreads).values({
    tenantId,
    planId: newPlan.id,
    title: "Plan Chat",
  });

  return c.json({ plan: newPlan }, 201);
});

// Update plan
plansRouter.patch("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const planId = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    status?: "draft" | "active" | "archived";
    inputs?: Record<string, unknown>;
  }>();

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  const updates: Partial<typeof plans.$inferInsert> = {};
  if (body.title) updates.title = body.title;
  if (body.status) updates.status = body.status;
  if (body.inputs) updates.inputs = JSON.stringify(body.inputs);

  await db.update(plans).set(updates).where(eq(plans.id, planId));

  return c.json({ success: true });
});

// Delete plan
plansRouter.delete("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const planId = c.req.param("id");

  const [plan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  await db.delete(plans).where(eq(plans.id, planId));

  return c.json({ success: true });
});

// Get plan history
plansRouter.get("/:id/history", async (c) => {
  const { tenantId } = c.get("auth");
  const planId = c.req.param("id");

  const history = await db
    .select()
    .from(planEdits)
    .where(and(eq(planEdits.planId, planId), eq(planEdits.tenantId, tenantId)))
    .orderBy(desc(planEdits.createdAt))
    .limit(50);

  return c.json({
    history: history.map((h) => ({
      ...h,
      previousContent: JSON.parse(h.previousContent),
    })),
  });
});

// Clone plan
plansRouter.post("/:id/clone", async (c) => {
  const { tenantId } = c.get("auth");
  const planId = c.req.param("id");

  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

  if (!plan) {
    return c.json({ error: "Plan not found" }, 404);
  }

  const [newPlan] = await db
    .insert(plans)
    .values({
      tenantId,
      type: plan.type,
      title: `${plan.title} (Copy)`,
      content: plan.content,
      inputs: plan.inputs,
      status: "draft",
    })
    .returning();

  // Create chat thread for cloned plan
  await db.insert(chatThreads).values({
    tenantId,
    planId: newPlan.id,
    title: "Plan Chat",
  });

  return c.json({ plan: newPlan }, 201);
});

// Restore from history
plansRouter.post("/:id/restore", async (c) => {
  const { tenantId } = c.get("auth");
  const planId = c.req.param("id");
  const body = await c.req.json<{ editId: string }>();

  const [edit] = await db
    .select()
    .from(planEdits)
    .where(
      and(
        eq(planEdits.id, body.editId),
        eq(planEdits.planId, planId),
        eq(planEdits.tenantId, tenantId)
      )
    );

  if (!edit) {
    return c.json({ error: "Edit not found" }, 404);
  }

  // Get current content for history
  const [currentPlan] = await db
    .select({ content: plans.content })
    .from(plans)
    .where(eq(plans.id, planId));

  // Save current as edit
  if (currentPlan?.content) {
    await db.insert(planEdits).values({
      planId,
      tenantId,
      editedBy: "user",
      previousContent: currentPlan.content,
      changeDescription: "Before restore",
    });
  }

  // Restore
  await db
    .update(plans)
    .set({ content: edit.previousContent })
    .where(eq(plans.id, planId));

  return c.json({ success: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/plans.ts
git commit -m "feat(api): add plans CRUD routes"
```

---

### Task 8: Create Threads Routes

**Files:**
- Create: `packages/api/src/routes/threads.ts`

- [ ] **Step 1: Create threads routes**

```typescript
import { Hono } from "hono";
import { db } from "../lib/db.js";
import { chatThreads, messages } from "@lasagna/core";
import { eq, and, desc } from "drizzle-orm";
import type { AuthEnv } from "../middleware/auth.js";

export const threadsRouter = new Hono<AuthEnv>();

// List threads (optionally filter by planId)
threadsRouter.get("/", async (c) => {
  const { tenantId } = c.get("auth");
  const planId = c.req.query("planId");

  let query = db
    .select({
      id: chatThreads.id,
      planId: chatThreads.planId,
      title: chatThreads.title,
      createdAt: chatThreads.createdAt,
      updatedAt: chatThreads.updatedAt,
    })
    .from(chatThreads)
    .where(eq(chatThreads.tenantId, tenantId))
    .orderBy(desc(chatThreads.updatedAt));

  if (planId) {
    query = db
      .select({
        id: chatThreads.id,
        planId: chatThreads.planId,
        title: chatThreads.title,
        createdAt: chatThreads.createdAt,
        updatedAt: chatThreads.updatedAt,
      })
      .from(chatThreads)
      .where(
        and(eq(chatThreads.tenantId, tenantId), eq(chatThreads.planId, planId))
      )
      .orderBy(desc(chatThreads.updatedAt));
  }

  const results = await query;
  return c.json({ threads: results });
});

// Get thread with messages
threadsRouter.get("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const threadId = c.req.param("id");

  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(
      and(eq(chatThreads.id, threadId), eq(chatThreads.tenantId, tenantId))
    );

  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  const threadMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);

  return c.json({
    thread,
    messages: threadMessages.map((m) => ({
      ...m,
      toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : null,
      uiPayload: m.uiPayload ? JSON.parse(m.uiPayload) : null,
    })),
  });
});

// Create thread
threadsRouter.post("/", async (c) => {
  const { tenantId } = c.get("auth");
  const body = await c.req.json<{ planId?: string; title?: string }>();

  const [thread] = await db
    .insert(chatThreads)
    .values({
      tenantId,
      planId: body.planId ?? null,
      title: body.title ?? null,
    })
    .returning();

  return c.json({ thread }, 201);
});

// Delete thread
threadsRouter.delete("/:id", async (c) => {
  const { tenantId } = c.get("auth");
  const threadId = c.req.param("id");

  const [thread] = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(
      and(eq(chatThreads.id, threadId), eq(chatThreads.tenantId, tenantId))
    );

  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  await db.delete(chatThreads).where(eq(chatThreads.id, threadId));

  return c.json({ success: true });
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/threads.ts
git commit -m "feat(api): add chat threads routes"
```

---

### Task 9: Create Chat Streaming Route

**Files:**
- Create: `packages/api/src/routes/chat.ts`

- [ ] **Step 1: Create streaming chat route**

```typescript
import { Hono } from "hono";
import { streamText } from "ai";
import { db } from "../lib/db.js";
import { chatThreads, messages, plans } from "@lasagna/core";
import { eq, and } from "drizzle-orm";
import { model, createAgentTools, systemPrompt } from "../agent/index.js";
import { uiPayloadSchema } from "../agent/types.js";
import type { AuthEnv } from "../middleware/auth.js";

export const chatRouter = new Hono<AuthEnv>();

chatRouter.post("/", async (c) => {
  const { tenantId } = c.get("auth");
  const body = await c.req.json<{ threadId: string; message: string }>();

  // Verify thread belongs to tenant
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(
      and(eq(chatThreads.id, body.threadId), eq(chatThreads.tenantId, tenantId))
    );

  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  // Get plan context if thread is attached to a plan
  let planContext = "";
  if (thread.planId) {
    const [plan] = await db
      .select({ type: plans.type, title: plans.title, content: plans.content })
      .from(plans)
      .where(eq(plans.id, thread.planId));

    if (plan) {
      planContext = `\n\nCurrent plan: "${plan.title}" (${plan.type})`;
      if (plan.content) {
        planContext += `\nCurrent content: ${plan.content}`;
      }
    }
  }

  // Save user message
  await db.insert(messages).values({
    threadId: body.threadId,
    tenantId,
    role: "user",
    content: body.message,
  });

  // Get conversation history
  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.threadId, body.threadId))
    .orderBy(messages.createdAt);

  // Create tools with tenant context
  const tools = createAgentTools(tenantId);

  // Stream response
  const result = streamText({
    model,
    system: systemPrompt + planContext,
    messages: history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    tools,
    maxSteps: 10,
    onFinish: async ({ text, toolCalls, toolResults }) => {
      // Try to extract UI payload from response
      let uiPayload = null;
      try {
        // Look for JSON in the response
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          const validated = uiPayloadSchema.safeParse(parsed);
          if (validated.success) {
            uiPayload = validated.data;
          }
        }
      } catch {
        // Not valid JSON, that's ok
      }

      // Save assistant message
      await db.insert(messages).values({
        threadId: body.threadId,
        tenantId,
        role: "assistant",
        content: text,
        toolCalls: toolCalls ? JSON.stringify(toolCalls) : null,
        uiPayload: uiPayload ? JSON.stringify(uiPayload) : null,
      });

      // Update plan content if we have UI payload and plan is attached
      if (uiPayload && thread.planId) {
        const [plan] = await db
          .select({ content: plans.content })
          .from(plans)
          .where(eq(plans.id, thread.planId));

        // Save edit history
        if (plan?.content) {
          const { planEdits } = await import("@lasagna/core");
          await db.insert(planEdits).values({
            planId: thread.planId,
            tenantId,
            editedBy: "agent",
            previousContent: plan.content,
            changeDescription: "Updated via chat",
          });
        }

        // Update plan
        await db
          .update(plans)
          .set({ content: JSON.stringify(uiPayload) })
          .where(eq(plans.id, thread.planId));
      }
    },
  });

  // Return as SSE stream
  return result.toDataStreamResponse();
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/chat.ts
git commit -m "feat(api): add streaming chat route with agent"
```

---

### Task 10: Register New Routes

**Files:**
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Import and register routes**

Add imports at top:
```typescript
import { plansRouter } from "./routes/plans.js";
import { threadsRouter } from "./routes/threads.js";
import { chatRouter } from "./routes/chat.js";
```

Add routes after existing routes (before app export):
```typescript
// Plan routes
app.route("/api/plans", requireAuth, plansRouter);
app.route("/api/threads", requireAuth, threadsRouter);
app.route("/api/chat", requireAuth, chatRouter);
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/server.ts
git commit -m "feat(api): register plans, threads, and chat routes"
```

---

## Phase 4: Frontend Components

### Task 11: Install Frontend Dependencies

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Install AI SDK**

```bash
cd packages/web && pnpm add ai
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add Vercel AI SDK"
```

---

### Task 12: Create Shared Types

**Files:**
- Create: `packages/web/src/lib/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// ── UI Payload Types ──────────────────────────────────────────────────────

export type StatBlock = {
  type: "stat";
  label: string;
  value: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
};

export type DataPoint = {
  label: string;
  value: number;
  [key: string]: unknown;
};

export type ChartBlock = {
  type: "chart";
  chartType: "area" | "bar" | "donut";
  title?: string;
  data: DataPoint[];
};

export type Column = {
  key: string;
  label: string;
};

export type TableBlock = {
  type: "table";
  title?: string;
  columns: Column[];
  rows: Record<string, string | number>[];
};

export type TextBlock = {
  type: "text";
  content: string;
  variant?: "prose" | "callout";
};

export type Scenario = {
  name: string;
  [key: string]: unknown;
};

export type ProjectionBlock = {
  type: "projection";
  title?: string;
  scenarios: Scenario[];
};

export type ActionBlock = {
  type: "action";
  label: string;
  action: string;
  params?: Record<string, unknown>;
};

export type UIBlock =
  | StatBlock
  | ChartBlock
  | TableBlock
  | TextBlock
  | ProjectionBlock
  | ActionBlock;

export type UIPayload = {
  layout: "single" | "split" | "grid";
  blocks: UIBlock[];
};

// ── Plan Types ────────────────────────────────────────────────────────────

export type PlanType = "net_worth" | "retirement" | "custom";
export type PlanStatus = "draft" | "active" | "archived";

export type Plan = {
  id: string;
  type: PlanType;
  title: string;
  status: PlanStatus;
  content: UIPayload | null;
  inputs: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type PlanEdit = {
  id: string;
  planId: string;
  editedBy: "user" | "agent";
  previousContent: UIPayload;
  changeDescription: string | null;
  createdAt: string;
};

// ── Chat Types ────────────────────────────────────────────────────────────

export type ChatThread = {
  id: string;
  planId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: unknown[] | null;
  uiPayload: UIPayload | null;
  createdAt: string;
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/types.ts
git commit -m "feat(web): add shared types for plans and UI payload"
```

---

### Task 13: Update API Client

**Files:**
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Add plan and thread API methods**

Add to existing api object:

```typescript
// Plans
async getPlans() {
  const res = await fetch(`${BASE}/plans`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch plans");
  return res.json() as Promise<{ plans: Plan[] }>;
},

async getPlan(id: string) {
  const res = await fetch(`${BASE}/plans/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch plan");
  return res.json() as Promise<Plan>;
},

async createPlan(type: PlanType, title: string) {
  const res = await fetch(`${BASE}/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ type, title }),
  });
  if (!res.ok) throw new Error("Failed to create plan");
  return res.json() as Promise<{ plan: Plan }>;
},

async updatePlan(id: string, updates: { title?: string; status?: PlanStatus }) {
  const res = await fetch(`${BASE}/plans/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Failed to update plan");
},

async deletePlan(id: string) {
  const res = await fetch(`${BASE}/plans/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete plan");
},

async getPlanHistory(id: string) {
  const res = await fetch(`${BASE}/plans/${id}/history`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json() as Promise<{ history: PlanEdit[] }>;
},

async clonePlan(id: string) {
  const res = await fetch(`${BASE}/plans/${id}/clone`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to clone plan");
  return res.json() as Promise<{ plan: Plan }>;
},

// Threads
async getThreads(planId?: string) {
  const url = planId ? `${BASE}/threads?planId=${planId}` : `${BASE}/threads`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch threads");
  return res.json() as Promise<{ threads: ChatThread[] }>;
},

async getThread(id: string) {
  const res = await fetch(`${BASE}/threads/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch thread");
  return res.json() as Promise<{ thread: ChatThread; messages: Message[] }>;
},

async createThread(planId?: string) {
  const res = await fetch(`${BASE}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ planId }),
  });
  if (!res.ok) throw new Error("Failed to create thread");
  return res.json() as Promise<{ thread: ChatThread }>;
},
```

Also add imports at top:
```typescript
import type { Plan, PlanType, PlanStatus, PlanEdit, ChatThread, Message } from "./types.js";
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/api.ts
git commit -m "feat(web): add plan and thread API methods"
```

---

### Task 14: Create UI Block Renderers

**Files:**
- Create: `packages/web/src/components/ui-renderer/blocks/stat-block.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/chart-block.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/table-block.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/text-block.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/index.ts`

- [ ] **Step 1: Create stat block**

```typescript
// packages/web/src/components/ui-renderer/blocks/stat-block.tsx
import { StatCard } from "../../common/stat-card.js";
import type { StatBlock as StatBlockType } from "../../../lib/types.js";

export function StatBlockRenderer({ block }: { block: StatBlockType }) {
  return (
    <StatCard
      label={block.label}
      value={block.value}
      change={block.change}
      trend={block.trend}
    />
  );
}
```

- [ ] **Step 2: Create chart block**

```typescript
// packages/web/src/components/ui-renderer/blocks/chart-block.tsx
import { AreaChart } from "../../charts/area-chart.js";
import { DonutChart } from "../../charts/pie-chart.js";
import type { ChartBlock as ChartBlockType } from "../../../lib/types.js";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export function ChartBlockRenderer({ block }: { block: ChartBlockType }) {
  if (block.chartType === "area") {
    return (
      <div className="h-64">
        {block.title && (
          <h4 className="text-sm font-medium text-text-muted mb-2">
            {block.title}
          </h4>
        )}
        <AreaChart data={block.data} />
      </div>
    );
  }

  if (block.chartType === "donut") {
    return (
      <div className="h-64">
        {block.title && (
          <h4 className="text-sm font-medium text-text-muted mb-2">
            {block.title}
          </h4>
        )}
        <DonutChart data={block.data} />
      </div>
    );
  }

  if (block.chartType === "bar") {
    return (
      <div className="h-64">
        {block.title && (
          <h4 className="text-sm font-medium text-text-muted mb-2">
            {block.title}
          </h4>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={block.data}>
            <XAxis dataKey="label" stroke="#a8a29e" fontSize={12} />
            <YAxis stroke="#a8a29e" fontSize={12} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1c1917",
                border: "1px solid rgba(120, 113, 108, 0.2)",
                borderRadius: "8px",
              }}
            />
            <Bar dataKey="value" fill="#fbbf24" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 3: Create table block**

```typescript
// packages/web/src/components/ui-renderer/blocks/table-block.tsx
import type { TableBlock as TableBlockType } from "../../../lib/types.js";

export function TableBlockRenderer({ block }: { block: TableBlockType }) {
  return (
    <div className="overflow-x-auto">
      {block.title && (
        <h4 className="text-sm font-medium text-text-muted mb-2">
          {block.title}
        </h4>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {block.columns.map((col) => (
              <th
                key={col.key}
                className="text-left py-2 px-3 text-text-muted font-medium"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, i) => (
            <tr key={i} className="border-b border-border/50">
              {block.columns.map((col) => (
                <td key={col.key} className="py-2 px-3 text-text">
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Create text block**

```typescript
// packages/web/src/components/ui-renderer/blocks/text-block.tsx
import { cn } from "../../../lib/utils.js";
import type { TextBlock as TextBlockType } from "../../../lib/types.js";

export function TextBlockRenderer({ block }: { block: TextBlockType }) {
  if (block.variant === "callout") {
    return (
      <div className="bg-accent/10 border border-accent/20 rounded-xl p-4">
        <p className="text-text">{block.content}</p>
      </div>
    );
  }

  return (
    <div className="prose prose-invert max-w-none">
      <p className="text-text-secondary leading-relaxed">{block.content}</p>
    </div>
  );
}
```

- [ ] **Step 5: Create index**

```typescript
// packages/web/src/components/ui-renderer/blocks/index.ts
export { StatBlockRenderer } from "./stat-block.js";
export { ChartBlockRenderer } from "./chart-block.js";
export { TableBlockRenderer } from "./table-block.js";
export { TextBlockRenderer } from "./text-block.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/ui-renderer/blocks/
git commit -m "feat(web): add UI block renderer components"
```

---

### Task 15: Create UIRenderer Component

**Files:**
- Create: `packages/web/src/components/ui-renderer/ui-renderer.tsx`
- Create: `packages/web/src/components/ui-renderer/index.ts`

- [ ] **Step 1: Create UIRenderer**

```typescript
// packages/web/src/components/ui-renderer/ui-renderer.tsx
import { cn } from "../../lib/utils.js";
import type { UIPayload, UIBlock } from "../../lib/types.js";
import {
  StatBlockRenderer,
  ChartBlockRenderer,
  TableBlockRenderer,
  TextBlockRenderer,
} from "./blocks/index.js";

const layoutClasses = {
  single: "flex flex-col gap-6",
  split: "grid grid-cols-1 md:grid-cols-2 gap-6",
  grid: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4",
};

function BlockRenderer({ block }: { block: UIBlock }) {
  switch (block.type) {
    case "stat":
      return <StatBlockRenderer block={block} />;
    case "chart":
      return <ChartBlockRenderer block={block} />;
    case "table":
      return <TableBlockRenderer block={block} />;
    case "text":
      return <TextBlockRenderer block={block} />;
    case "projection":
      // TODO: Implement projection renderer
      return (
        <div className="p-4 border border-border rounded-xl">
          <p className="text-text-muted">Projection: {block.scenarios.length} scenarios</p>
        </div>
      );
    case "action":
      return (
        <button className="px-4 py-2 bg-accent text-bg rounded-lg font-medium hover:bg-accent-dim transition-colors">
          {block.label}
        </button>
      );
    default:
      return null;
  }
}

export function UIRenderer({ payload }: { payload: UIPayload }) {
  if (!payload || !payload.blocks) {
    return null;
  }

  return (
    <div className={cn(layoutClasses[payload.layout])}>
      {payload.blocks.map((block, index) => (
        <BlockRenderer key={index} block={block} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create index**

```typescript
// packages/web/src/components/ui-renderer/index.ts
export { UIRenderer } from "./ui-renderer.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ui-renderer/ui-renderer.tsx packages/web/src/components/ui-renderer/index.ts
git commit -m "feat(web): add UIRenderer component for generative UI"
```

---

### Task 16: Create Chat Components

**Files:**
- Create: `packages/web/src/components/chat/message-bubble.tsx`
- Create: `packages/web/src/components/chat/message-list.tsx`
- Create: `packages/web/src/components/chat/chat-panel.tsx`
- Create: `packages/web/src/components/chat/index.ts`

- [ ] **Step 1: Create message bubble**

```typescript
// packages/web/src/components/chat/message-bubble.tsx
import { cn } from "../../lib/utils.js";
import { UIRenderer } from "../ui-renderer/index.js";
import type { Message } from "../../lib/types.js";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-accent text-bg"
            : "bg-surface border border-border text-text"
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>

        {message.uiPayload && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <UIRenderer payload={message.uiPayload} />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create message list**

```typescript
// packages/web/src/components/chat/message-list.tsx
import { useEffect, useRef } from "react";
import { MessageBubble } from "./message-bubble.js";
import type { Message } from "../../lib/types.js";

export function MessageList({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <p>Start a conversation to get personalized financial insights.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto space-y-4 p-4">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 3: Create chat panel**

```typescript
// packages/web/src/components/chat/chat-panel.tsx
import { useState } from "react";
import { useChat } from "ai/react";
import { Send } from "lucide-react";
import { MessageList } from "./message-list.js";
import { Button } from "../ui/button.js";
import type { Message } from "../../lib/types.js";

type ChatPanelProps = {
  threadId: string;
  initialMessages?: Message[];
};

export function ChatPanel({ threadId, initialMessages = [] }: ChatPanelProps) {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({
      api: "/api/chat",
      body: { threadId },
      initialMessages: initialMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      })),
    });

  // Map AI SDK messages to our format
  const displayMessages: Message[] = messages.map((m) => ({
    id: m.id,
    threadId,
    role: m.role as "user" | "assistant",
    content: m.content,
    toolCalls: null,
    uiPayload: null,
    createdAt: new Date().toISOString(),
  }));

  return (
    <div className="flex flex-col h-full bg-bg-elevated rounded-2xl border border-border">
      <div className="p-4 border-b border-border">
        <h3 className="font-medium text-text">Chat</h3>
      </div>

      <MessageList messages={displayMessages} />

      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-border flex gap-2"
      >
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask about your finances..."
          className="flex-1 px-4 py-2 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          disabled={isLoading}
        />
        <Button type="submit" disabled={isLoading || !input.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Create index**

```typescript
// packages/web/src/components/chat/index.ts
export { ChatPanel } from "./chat-panel.js";
export { MessageList } from "./message-list.js";
export { MessageBubble } from "./message-bubble.js";
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/
git commit -m "feat(web): add chat components with streaming support"
```

---

### Task 17: Create Plan Pages

**Files:**
- Create: `packages/web/src/pages/plans/index.tsx`
- Create: `packages/web/src/pages/plans/new.tsx`
- Create: `packages/web/src/pages/plans/[id].tsx`

- [ ] **Step 1: Create plan list page**

```typescript
// packages/web/src/pages/plans/index.tsx
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Plus, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import { Section } from "../../components/common/section.js";
import type { Plan } from "../../lib/types.js";

export function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPlans().then(({ plans }) => {
      setPlans(plans);
      setLoading(false);
    });
  }, []);

  const planTypeLabels = {
    net_worth: "Net Worth",
    retirement: "Retirement",
    custom: "Custom",
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-display font-semibold text-text">
            Financial Plans
          </h1>
          <p className="text-text-muted mt-1">
            AI-powered plans tailored to your goals
          </p>
        </div>
        <Link href="/plans/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Plan
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="text-text-muted">Loading...</div>
      ) : plans.length === 0 ? (
        <Section>
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text mb-2">No plans yet</h3>
            <p className="text-text-muted mb-4">
              Create your first financial plan to get started.
            </p>
            <Link href="/plans/new">
              <Button>Create Plan</Button>
            </Link>
          </div>
        </Section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((plan, i) => (
            <Link key={plan.id} href={`/plans/${plan.id}`}>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card glass-card-hover p-6 cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent">
                    {planTypeLabels[plan.type]}
                  </span>
                  <span className="text-xs text-text-muted capitalize">
                    {plan.status}
                  </span>
                </div>
                <h3 className="font-medium text-text mb-2">{plan.title}</h3>
                <p className="text-sm text-text-muted">
                  Updated {new Date(plan.updatedAt).toLocaleDateString()}
                </p>
              </motion.div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create new plan page**

```typescript
// packages/web/src/pages/plans/new.tsx
import { useState } from "react";
import { useLocation } from "wouter";
import { Target, TrendingUp, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/button.js";
import type { PlanType } from "../../lib/types.js";

const planTypes: { type: PlanType; label: string; description: string; icon: typeof Target }[] = [
  {
    type: "net_worth",
    label: "Net Worth",
    description: "Track your wealth, analyze trends, and optimize asset allocation",
    icon: TrendingUp,
  },
  {
    type: "retirement",
    label: "Retirement",
    description: "Plan your retirement with withdrawal strategies and projections",
    icon: Target,
  },
  {
    type: "custom",
    label: "Custom",
    description: "Create a custom plan with AI assistance for any financial goal",
    icon: Sparkles,
  },
];

export function NewPlanPage() {
  const [, setLocation] = useLocation();
  const [selectedType, setSelectedType] = useState<PlanType | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!selectedType || !title.trim()) return;

    setCreating(true);
    try {
      const { plan } = await api.createPlan(selectedType, title);
      setLocation(`/plans/${plan.id}`);
    } catch (error) {
      console.error("Failed to create plan:", error);
      setCreating(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-display font-semibold text-text mb-2">
        Create a Plan
      </h1>
      <p className="text-text-muted mb-8">
        Choose a plan type and give it a name to get started.
      </p>

      <div className="space-y-4 mb-8">
        {planTypes.map((pt, i) => (
          <motion.button
            key={pt.type}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => setSelectedType(pt.type)}
            className={`w-full p-4 rounded-xl border text-left transition-all ${
              selectedType === pt.type
                ? "border-accent bg-accent/10"
                : "border-border bg-surface hover:border-accent/50"
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="p-2 rounded-lg bg-bg-elevated">
                <pt.icon className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h3 className="font-medium text-text">{pt.label}</h3>
                <p className="text-sm text-text-muted mt-1">{pt.description}</p>
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {selectedType && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-text mb-2">
              Plan Name
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., My Retirement Plan"
              className="w-full px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50"
            />
          </div>

          <Button
            onClick={handleCreate}
            disabled={!title.trim() || creating}
            className="w-full"
          >
            {creating ? "Creating..." : "Create Plan"}
          </Button>
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create plan detail page**

```typescript
// packages/web/src/pages/plans/[id].tsx
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { MessageSquare, History, MoreVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../lib/api.js";
import { UIRenderer } from "../../components/ui-renderer/index.js";
import { ChatPanel } from "../../components/chat/index.js";
import { Button } from "../../components/ui/button.js";
import type { Plan, ChatThread, Message } from "../../lib/types.js";

export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showChat, setShowChat] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    Promise.all([
      api.getPlan(id),
      api.getThreads(id),
    ]).then(([planData, { threads }]) => {
      setPlan(planData);

      if (threads.length > 0) {
        setThread(threads[0]);
        api.getThread(threads[0].id).then(({ messages }) => {
          setMessages(messages);
        });
      }

      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 text-text-muted">Loading plan...</div>
    );
  }

  if (!plan) {
    return (
      <div className="p-6 text-text-muted">Plan not found</div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-start justify-between mb-8">
            <div>
              <h1 className="text-2xl font-display font-semibold text-text">
                {plan.title}
              </h1>
              <p className="text-text-muted mt-1 capitalize">
                {plan.type.replace("_", " ")} Plan
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowChat(!showChat)}
              >
                <MessageSquare className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <History className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Plan content */}
          {plan.content ? (
            <UIRenderer payload={plan.content} />
          ) : (
            <div className="glass-card p-8 text-center">
              <p className="text-text-muted mb-4">
                This plan is empty. Start a conversation to generate content.
              </p>
              {!showChat && (
                <Button onClick={() => setShowChat(true)}>
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Open Chat
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chat panel */}
      <AnimatePresence>
        {showChat && thread && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 400, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-l border-border overflow-hidden"
          >
            <ChatPanel threadId={thread.id} initialMessages={messages} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/plans/
git commit -m "feat(web): add plan pages (list, create, detail)"
```

---

### Task 18: Update App Routes

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Add plan routes**

Add imports:
```typescript
import { PlansPage } from "./pages/plans/index.js";
import { NewPlanPage } from "./pages/plans/new.js";
import { PlanDetailPage } from "./pages/plans/[id].js";
```

Add routes inside the Shell component (after existing routes):
```typescript
<Route path="/plans" component={PlansPage} />
<Route path="/plans/new" component={NewPlanPage} />
<Route path="/plans/:id" component={PlanDetailPage} />
```

- [ ] **Step 2: Update sidebar navigation**

In sidebar.tsx, add Plans link:
```typescript
{ icon: FileText, label: "Plans", href: "/plans" },
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/layout/sidebar.tsx
git commit -m "feat(web): add plan routes and navigation"
```

---

## Phase 5: Integration & Testing

### Task 19: Add Environment Variables

**Files:**
- Modify: `.env.example` or create if needed

- [ ] **Step 1: Add OpenRouter API key**

Add to environment:
```
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

- [ ] **Step 2: Update env.ts if needed**

In `packages/api/src/lib/env.ts`, add:
```typescript
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/lib/env.ts
git commit -m "chore(api): add OpenRouter environment variable"
```

---

### Task 20: Manual Integration Test

- [ ] **Step 1: Start the development server**

```bash
pnpm dev
```

- [ ] **Step 2: Test plan creation**

1. Navigate to `/plans`
2. Click "New Plan"
3. Select "Net Worth" type
4. Enter a title
5. Click "Create Plan"

Expected: Redirected to plan detail page with empty content and chat panel.

- [ ] **Step 3: Test chat interaction**

1. In the chat panel, type: "What's my current net worth?"
2. Wait for agent response

Expected: Agent should call `get_net_worth` tool and return a response with financial data.

- [ ] **Step 4: Test UI rendering**

If the agent returns UI blocks, verify they render correctly in the plan content area.

- [ ] **Step 5: Commit any fixes**

```bash
git add .
git commit -m "fix: integration test fixes"
```

---

## Summary

This plan implements the agent system in 20 tasks across 5 phases:

1. **Database Schema** (1 task) — Add plans, plan_edits, chat_threads, messages tables
2. **Agent Infrastructure** (4 tasks) — Types, financial tools, plan tools, agent config
3. **API Routes** (5 tasks) — Dependencies, plans, threads, chat, route registration
4. **Frontend Components** (7 tasks) — Dependencies, types, API client, UI blocks, UIRenderer, chat, pages, routes
5. **Integration** (3 tasks) — Environment, testing, fixes

Each task is designed to be independently committable and testable.
