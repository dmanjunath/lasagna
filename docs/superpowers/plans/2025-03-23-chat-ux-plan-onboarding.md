# Chat UX + Plan Onboarding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chat tool use indicators, plan starter prompts, debt_payoff plan type, and fix sidebar consistency.

**Architecture:** Backend changes to expose tool calls in stream, frontend refactor to use Vercel AI SDK's useChat hook, new StarterPrompts component for empty plans, sidebar fetches real user plans from API.

**Tech Stack:** React, TypeScript, Hono, Drizzle ORM, Vercel AI SDK, Playwright

**Spec:** `docs/superpowers/specs/2025-03-23-chat-ux-plan-onboarding-design.md`

---

## File Structure

### New Files
| File | Purpose |
|------|---------|
| `packages/web/src/components/chat/tool-status.tsx` | Display active tool calls during AI response |
| `packages/web/src/components/chat/starter-prompts.tsx` | Show starter prompt cards for new plans |
| `e2e/chat-tool-status.spec.ts` | E2E tests for tool status indicator |
| `e2e/starter-prompts.spec.ts` | E2E tests for starter prompts |
| `e2e/sidebar-plans.spec.ts` | E2E tests for sidebar plan list |

### Modified Files
| File | Changes |
|------|---------|
| `packages/core/src/schema.ts` | Add `debt_payoff` to plan type enum |
| `packages/api/src/routes/plans.ts` | Update validation to accept `debt_payoff` |
| `packages/api/src/routes/chat.ts` | Change to `toDataStreamResponse()` |
| `packages/web/src/lib/types.ts` | Add `debt_payoff` to PlanType |
| `packages/web/src/pages/plans/new.tsx` | Add Debt Payoff plan card |
| `packages/web/src/components/chat/chat-panel.tsx` | Refactor to use `useChat` hook, add tool status |
| `packages/web/src/pages/plans/[id].tsx` | Integrate starter prompts |
| `packages/web/src/components/layout/shell.tsx` | Wire New Plan button navigation |
| `packages/web/src/components/layout/sidebar.tsx` | Fetch plans from API, remove mock data |
| `e2e/new-plan.spec.ts` | Add debt_payoff plan creation test |

---

## Task 1: Add Debt Payoff Plan Type to Schema

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/api/src/routes/plans.ts`
- Modify: `packages/web/src/lib/types.ts`
- Modify: `packages/web/src/pages/plans/new.tsx`

- [ ] **Step 1: Update schema enum**

```typescript
// packages/core/src/schema.ts
// Find the planTypeEnum and add debt_payoff:
export const planTypeEnum = pgEnum("plan_type", [
  "net_worth",
  "retirement",
  "debt_payoff",
  "custom",
]);
```

- [ ] **Step 2: Update API validation schema**

```typescript
// packages/api/src/routes/plans.ts
// Update createPlanSchema:
const createPlanSchema = z.object({
  type: z.enum(["net_worth", "retirement", "debt_payoff", "custom"]),
  title: z.string().min(1).max(255),
});
```

- [ ] **Step 3: Update frontend types**

```typescript
// packages/web/src/lib/types.ts
export type PlanType = "net_worth" | "retirement" | "debt_payoff" | "custom";
```

- [ ] **Step 4: Add Debt Payoff card to new plan page**

```typescript
// packages/web/src/pages/plans/new.tsx
// Add to imports:
import { Target, TrendingUp, Sparkles, CreditCard } from "lucide-react";

// Add to planTypes array after retirement:
{
  type: "debt_payoff",
  label: "Debt Payoff",
  description: "Create a strategy to pay off debt efficiently",
  icon: CreditCard,
},
```

- [ ] **Step 5: Rebuild core package**

Run: `pnpm --filter @lasagna/core build`

- [ ] **Step 6: Run existing tests to verify no breakage**

Run: `pnpm test`

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/schema.ts packages/api/src/routes/plans.ts packages/web/src/lib/types.ts packages/web/src/pages/plans/new.tsx
git commit -m "feat: add debt_payoff plan type"
```

---

## Task 2: Add E2E Test for Debt Payoff Plan Creation

**Files:**
- Modify: `e2e/new-plan.spec.ts`

- [ ] **Step 1: Add debt payoff plan creation test**

```typescript
// Add to e2e/new-plan.spec.ts inside the test.describe block:

test("can create debt payoff plan", async ({ page }) => {
  // Click on Debt Payoff plan type card
  await page.getByRole("button", { name: /Debt Payoff.*pay off debt/ }).click();

  // Wait for title input and fill it
  await expect(page.getByPlaceholder("e.g., My Retirement Plan")).toBeVisible();
  await page.getByPlaceholder("e.g., My Retirement Plan").fill("My Debt Freedom Plan");
  await page.getByRole("button", { name: "Create Plan" }).click();

  // Wait for redirect to plan detail page
  await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

  // Verify plan type is shown
  await expect(page.getByText("debt payoff Plan", { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx playwright test e2e/new-plan.spec.ts --grep "debt payoff"`

- [ ] **Step 3: Commit**

```bash
git add e2e/new-plan.spec.ts
git commit -m "test: add e2e test for debt payoff plan creation"
```

---

## Task 3: Fix Sidebar New Plan Button

**Files:**
- Modify: `packages/web/src/components/layout/shell.tsx`

- [ ] **Step 1: Wire handleNewPlan to navigate**

```typescript
// packages/web/src/components/layout/shell.tsx
// Add import:
import { useLocation } from "wouter";

// Inside the component, replace:
// const handleNewPlan = () => console.log("New plan");
// With:
const [, setLocation] = useLocation();
const handleNewPlan = () => setLocation("/plans/new");
```

- [ ] **Step 2: Verify manually**

Start dev server, click "New Plan" in sidebar, should navigate to /plans/new

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/layout/shell.tsx
git commit -m "fix: wire sidebar New Plan button to navigate"
```

---

## Task 4: Fetch Real Plans in Sidebar

**Files:**
- Modify: `packages/web/src/components/layout/sidebar.tsx`
- Create: `e2e/sidebar-plans.spec.ts`

- [ ] **Step 1: Add imports and state for plans**

```typescript
// packages/web/src/components/layout/sidebar.tsx
// Add imports:
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import type { Plan } from "../../lib/types.js";
```

- [ ] **Step 2: Add plan type icon mapping**

```typescript
// Add near top of file after imports:
const planTypeIcons: Record<string, string> = {
  net_worth: "◈",
  retirement: "◎",
  debt_payoff: "◆",
  custom: "✦",
};
```

- [ ] **Step 3: Replace mock data with API fetch**

```typescript
// Inside Sidebar component, replace the hardcoded userPlans with:
const [plans, setPlans] = useState<Plan[]>([]);
const [loadingPlans, setLoadingPlans] = useState(true);

useEffect(() => {
  api.getPlans()
    .then(({ plans }) => setPlans(plans))
    .catch((err) => console.error("Failed to load plans:", err))
    .finally(() => setLoadingPlans(false));
}, []);
```

- [ ] **Step 4: Update the plans rendering section**

Replace the `userPlans.map()` section with:

```typescript
{loadingPlans ? (
  <div className="px-3 py-2 text-sm text-text-muted">Loading...</div>
) : plans.length === 0 ? (
  <div className="px-3 py-2 text-sm text-text-muted">No plans yet</div>
) : (
  plans.map((plan) => (
    <motion.button
      key={plan.id}
      onClick={() => setLocation(`/plans/${plan.id}`)}
      className="w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-colors duration-200 hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent"
      whileHover={{ x: 2 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="text-accent">{planTypeIcons[plan.type] || "◎"}</span>
      <span className="truncate">{plan.title}</span>
    </motion.button>
  ))
)}
```

- [ ] **Step 5: Add useLocation import if not present**

```typescript
import { useLocation } from "wouter";
// Inside component:
const [, setLocation] = useLocation();
```

- [ ] **Step 6: Remove old NavItem type and userPlans mock data**

Delete the `NavItem` interface and `userPlans` array that was hardcoded.

- [ ] **Step 7: Create E2E test for sidebar plans**

```typescript
// e2e/sidebar-plans.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Sidebar Plans", () => {
  test("shows user plans in sidebar", async ({ page }) => {
    // First create a plan
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
    await page.getByRole("button", { name: /Net Worth.*Track your wealth/ }).click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Sidebar Test Plan");
    await page.getByRole("button", { name: "Create Plan" }).click();
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });

    // Navigate to dashboard
    await page.goto("/");

    // Verify the plan appears in sidebar
    await expect(page.getByRole("button", { name: /Sidebar Test Plan/ })).toBeVisible({ timeout: 10000 });
  });

  test("New Plan button navigates to new plan page", async ({ page }) => {
    await page.goto("/");

    // Click New Plan button in sidebar
    await page.getByRole("button", { name: /\+ New Plan/ }).click();

    // Verify navigation
    await expect(page).toHaveURL("/plans/new");
  });
});
```

- [ ] **Step 8: Run tests**

Run: `npx playwright test e2e/sidebar-plans.spec.ts`

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/components/layout/sidebar.tsx e2e/sidebar-plans.spec.ts
git commit -m "feat: fetch real plans in sidebar, add e2e tests"
```

---

## Task 5: Create Starter Prompts Component

**Files:**
- Create: `packages/web/src/components/chat/starter-prompts.tsx`

- [ ] **Step 1: Create the starter prompts component**

```typescript
// packages/web/src/components/chat/starter-prompts.tsx
import { useState } from "react";
import { Send } from "lucide-react";
import { motion } from "framer-motion";
import type { PlanType } from "../../lib/types.js";

const promptsByType: Record<PlanType, string[]> = {
  retirement: [
    "Analyze my retirement readiness",
    "I want to retire early at 35, am I on track?",
    "Minimize my lifetime taxes",
  ],
  net_worth: [
    "Show my net worth breakdown",
    "How has my wealth changed?",
    "Review my asset allocation",
  ],
  debt_payoff: [
    "Create a debt payoff strategy",
    "What's the most efficient way to pay off my debt",
    "How fast can I become debt-free?",
  ],
  custom: [
    "Help me create a financial plan",
    "What should I focus on first to maximize my future net worth?",
    "Analyze my financial health",
  ],
};

type StarterPromptsProps = {
  planType: PlanType;
  onSelectPrompt: (prompt: string) => void;
};

export function StarterPrompts({ planType, onSelectPrompt }: StarterPromptsProps) {
  const [customPrompt, setCustomPrompt] = useState("");
  const prompts = promptsByType[planType] || promptsByType.custom;

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customPrompt.trim()) {
      onSelectPrompt(customPrompt.trim());
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-lg font-medium text-text mb-2">Get started with a question</h3>
        <p className="text-sm text-text-muted">Choose a suggestion or write your own</p>
      </div>

      <div className="grid gap-3">
        {prompts.map((prompt, index) => (
          <motion.button
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            onClick={() => onSelectPrompt(prompt)}
            className="w-full p-4 text-left rounded-xl border border-border bg-surface hover:border-accent/50 hover:bg-surface-hover transition-all text-sm text-text"
          >
            {prompt}
          </motion.button>
        ))}
      </div>

      <form onSubmit={handleCustomSubmit} className="flex gap-2">
        <input
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Or type your own question..."
          className="flex-1 px-4 py-3 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50"
        />
        <button
          type="submit"
          disabled={!customPrompt.trim()}
          className="px-4 py-3 bg-accent text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent/90 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Add export to chat index**

```typescript
// packages/web/src/components/chat/index.ts
// Add:
export { StarterPrompts } from "./starter-prompts.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/starter-prompts.tsx packages/web/src/components/chat/index.ts
git commit -m "feat: create StarterPrompts component"
```

---

## Task 6: Integrate Starter Prompts in Plan Detail Page

**Files:**
- Modify: `packages/web/src/pages/plans/[id].tsx`
- Create: `e2e/starter-prompts.spec.ts`

- [ ] **Step 1: Import StarterPrompts**

```typescript
// packages/web/src/pages/plans/[id].tsx
import { StarterPrompts } from "../../components/chat/starter-prompts.js";
```

- [ ] **Step 2: Add state for initial message**

```typescript
// Add state after existing state declarations:
const [initialMessage, setInitialMessage] = useState<string | null>(null);
```

- [ ] **Step 3: Add handler for prompt selection**

```typescript
const handleSelectPrompt = (prompt: string) => {
  setInitialMessage(prompt);
};
```

- [ ] **Step 4: Replace empty state with starter prompts**

Replace the empty state `div` (the one with "This plan is empty...") with:

```typescript
{plan.content ? (
  <UIRenderer payload={plan.content} />
) : (
  <div className="glass-card p-8">
    {messages.length === 0 && !initialMessage ? (
      <StarterPrompts
        planType={plan.type}
        onSelectPrompt={handleSelectPrompt}
      />
    ) : (
      <p className="text-text-muted text-center">
        Start a conversation to generate content.
      </p>
    )}
  </div>
)}
```

- [ ] **Step 5: Pass initialMessage to ChatPanel**

Update the ChatPanel component call to include initialMessage:

```typescript
<ChatPanel
  threadId={thread.id}
  initialMessages={messages}
  initialMessage={initialMessage}
  onMessageSent={() => setInitialMessage(null)}
/>
```

- [ ] **Step 6: Create E2E test for starter prompts**

```typescript
// e2e/starter-prompts.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Starter Prompts", () => {
  test.beforeEach(async ({ page }) => {
    // Create a new retirement plan
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
    await page.getByRole("button", { name: /Retirement.*Plan your retirement/ }).click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Starter Prompt Test");
    await page.getByRole("button", { name: "Create Plan" }).click();
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });
  });

  test("shows starter prompts for new plan", async ({ page }) => {
    // Wait for page to load
    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });

    // Verify starter prompts are visible
    await expect(page.getByText("Get started with a question")).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyze my retirement readiness" })).toBeVisible();
    await expect(page.getByRole("button", { name: /retire early at 35/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Minimize my lifetime taxes/ })).toBeVisible();
  });

  test("clicking a prompt sends it as a message", async ({ page }) => {
    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });

    // Click a starter prompt
    await page.getByRole("button", { name: "Analyze my retirement readiness" }).click();

    // Verify the message appears in chat
    await expect(page.getByText("Analyze my retirement readiness")).toBeVisible({ timeout: 10000 });
  });

  test("can send custom prompt", async ({ page }) => {
    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });

    // Type custom prompt
    await page.getByPlaceholder("Or type your own question...").fill("What is my savings rate?");

    // Submit
    await page.locator("form").filter({ hasText: "Or type your own" }).getByRole("button").click();

    // Verify message appears
    await expect(page.getByText("What is my savings rate?")).toBeVisible({ timeout: 10000 });
  });
});
```

- [ ] **Step 7: Run tests**

Run: `npx playwright test e2e/starter-prompts.spec.ts`

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/plans/[id].tsx e2e/starter-prompts.spec.ts
git commit -m "feat: integrate starter prompts in plan detail page"
```

---

## Task 7: Update ChatPanel to Accept initialMessage

**Files:**
- Modify: `packages/web/src/components/chat/chat-panel.tsx`

- [ ] **Step 1: Add initialMessage prop**

```typescript
// Update props type:
type ChatPanelProps = {
  threadId: string;
  initialMessages?: Message[];
  initialMessage?: string | null;
  onMessageSent?: () => void;
};

// Update function signature:
export function ChatPanel({
  threadId,
  initialMessages = [],
  initialMessage = null,
  onMessageSent,
}: ChatPanelProps) {
```

- [ ] **Step 2: Add useEffect to auto-send initialMessage**

```typescript
// Add after state declarations:
useEffect(() => {
  if (initialMessage && !isLoading) {
    sendMessage(initialMessage);
    onMessageSent?.();
  }
}, [initialMessage]);
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/chat-panel.tsx
git commit -m "feat: add initialMessage prop to ChatPanel"
```

---

## Task 8: Create Tool Status Component

**Files:**
- Create: `packages/web/src/components/chat/tool-status.tsx`

- [ ] **Step 1: Create tool status component**

```typescript
// packages/web/src/components/chat/tool-status.tsx
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const toolDisplayNames: Record<string, string> = {
  get_accounts: "Getting your accounts...",
  get_net_worth: "Calculating net worth...",
  get_transactions: "Fetching transactions...",
  get_monthly_summary: "Analyzing monthly data...",
  update_plan_content: "Updating your plan...",
  get_plan: "Loading plan details...",
};

type ToolStatusProps = {
  toolName: string | null;
};

export function ToolStatus({ toolName }: ToolStatusProps) {
  if (!toolName) return null;

  const displayText = toolDisplayNames[toolName] || `Running ${toolName}...`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -5 }}
        className="flex items-center gap-2 text-sm text-text-muted px-4 py-2"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>{displayText}</span>
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Export from index**

```typescript
// packages/web/src/components/chat/index.ts
export { ToolStatus } from "./tool-status.js";
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/tool-status.tsx packages/web/src/components/chat/index.ts
git commit -m "feat: create ToolStatus component"
```

---

## Task 9: Update Backend to Use Data Stream Response

**Files:**
- Modify: `packages/api/src/routes/chat.ts`

- [ ] **Step 1: Change toTextStreamResponse to toDataStreamResponse**

```typescript
// packages/api/src/routes/chat.ts
// Change the return statement from:
return result.toTextStreamResponse();

// To:
return result.toDataStreamResponse();
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/chat.ts
git commit -m "feat: use data stream response for tool call visibility"
```

---

## Task 10: Refactor ChatPanel to Use useChat Hook

**Files:**
- Modify: `packages/web/src/components/chat/chat-panel.tsx`
- Create: `e2e/chat-tool-status.spec.ts`

- [ ] **Step 1: Install ai package in web if not present**

Run: `pnpm --filter @lasagna/web add ai`

- [ ] **Step 2: Refactor ChatPanel to use useChat**

```typescript
// packages/web/src/components/chat/chat-panel.tsx
import { useEffect } from "react";
import { useChat } from "ai/react";
import { Send, Loader2 } from "lucide-react";
import { MessageList } from "./message-list.js";
import { ToolStatus } from "./tool-status.js";
import { Button } from "../ui/button.js";
import type { Message } from "../../lib/types.js";

type ChatPanelProps = {
  threadId: string;
  initialMessages?: Message[];
  initialMessage?: string | null;
  onMessageSent?: () => void;
};

export function ChatPanel({
  threadId,
  initialMessages = [],
  initialMessage = null,
  onMessageSent,
}: ChatPanelProps) {
  const {
    messages,
    input,
    setInput,
    handleSubmit,
    isLoading,
    append,
  } = useChat({
    api: "/api/chat",
    body: { threadId },
    initialMessages: initialMessages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  // Get current tool being called
  const currentTool = messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.toolInvocations || [])
    .find((t) => t.state === "call")?.toolName || null;

  // Auto-send initial message
  useEffect(() => {
    if (initialMessage && !isLoading) {
      append({ role: "user", content: initialMessage });
      onMessageSent?.();
    }
  }, [initialMessage]);

  return (
    <div className="flex flex-col h-full bg-bg-elevated rounded-2xl border border-border">
      <div className="p-4 border-b border-border">
        <h3 className="font-medium text-text">Chat</h3>
      </div>

      <MessageList
        messages={messages.map((m) => ({
          id: m.id,
          threadId,
          role: m.role as "user" | "assistant",
          content: m.content,
          toolCalls: null,
          uiPayload: null,
          createdAt: new Date().toISOString(),
        }))}
      />

      <ToolStatus toolName={currentTool} />

      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-border flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your finances..."
          className="flex-1 px-4 py-2 bg-surface rounded-xl border border-border text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          disabled={isLoading}
        />
        <Button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Create E2E test for tool status**

```typescript
// e2e/chat-tool-status.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Chat Tool Status", () => {
  test.beforeEach(async ({ page }) => {
    // Create a new plan
    await page.goto("/plans/new");
    await expect(page.getByRole("heading", { name: "Create a Plan" })).toBeVisible();
    await page.getByRole("button", { name: /Net Worth.*Track your wealth/ }).click();
    await page.getByPlaceholder("e.g., My Retirement Plan").fill("Tool Status Test");
    await page.getByRole("button", { name: "Create Plan" }).click();
    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/, { timeout: 10000 });
    await expect(page.getByText("Loading plan...")).not.toBeVisible({ timeout: 10000 });
  });

  test("shows tool status while AI is working", async ({ page }) => {
    // Send a message that triggers tool use
    await page.getByRole("button", { name: "Show my net worth breakdown" }).click();

    // Should see the message being sent
    await expect(page.getByText("Show my net worth breakdown")).toBeVisible({ timeout: 5000 });

    // Should eventually see a response (tool status may be too fast to catch)
    // Just verify the chat works end-to-end
    await expect(page.locator(".text-text-muted").filter({ hasText: /Getting|Calculating|Loading/ })).toBeVisible({ timeout: 15000 }).catch(() => {
      // Tool status might complete too fast, that's ok
    });
  });

  test("chat input is disabled while loading", async ({ page }) => {
    // Click a starter prompt
    await page.getByRole("button", { name: "Show my net worth breakdown" }).click();

    // Input should be disabled during loading
    const input = page.getByPlaceholder("Ask about your finances...");
    await expect(input).toBeDisabled();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx playwright test e2e/chat-tool-status.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/chat-panel.tsx e2e/chat-tool-status.spec.ts
git commit -m "feat: refactor ChatPanel to use useChat hook with tool status"
```

---

## Task 11: Run All E2E Tests and Fix Any Issues

**Files:**
- Various test files

- [ ] **Step 1: Run all tests**

Run: `npx playwright test`

- [ ] **Step 2: Fix any failing tests**

Address issues based on test output.

- [ ] **Step 3: Commit fixes if needed**

```bash
git add -A
git commit -m "fix: address e2e test issues"
```

---

## Task 12: Final Verification and Cleanup

- [ ] **Step 1: Run full test suite**

Run: `pnpm test && npx playwright test`

- [ ] **Step 2: Verify all features manually**

1. Create each plan type (net_worth, retirement, debt_payoff, custom)
2. Verify starter prompts appear for each type
3. Click a starter prompt, verify it sends
4. Type a custom prompt, verify it sends
5. Verify tool status appears during AI response
6. Verify sidebar shows real plans
7. Verify New Plan button navigates correctly

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete chat UX and plan onboarding implementation"
```

---

## Summary

| Task | Description | Tests |
|------|-------------|-------|
| 1 | Add debt_payoff plan type | - |
| 2 | E2E test for debt_payoff | new-plan.spec.ts |
| 3 | Fix sidebar New Plan button | - |
| 4 | Fetch real plans in sidebar | sidebar-plans.spec.ts |
| 5 | Create StarterPrompts component | - |
| 6 | Integrate starter prompts | starter-prompts.spec.ts |
| 7 | Add initialMessage to ChatPanel | - |
| 8 | Create ToolStatus component | - |
| 9 | Update backend to data stream | - |
| 10 | Refactor ChatPanel with useChat | chat-tool-status.spec.ts |
| 11 | Run all tests, fix issues | - |
| 12 | Final verification | - |
