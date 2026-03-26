# Flexible Response Format Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace rigid 20+ block UIPayload with minimal schema (metrics, content, actions) and directive-based rendering.

**Architecture:** New v2 API endpoint returns simplified JSON. Frontend MarkdownRenderer parses `::directive` blocks from content and renders charts/cards/collapse inline. Parallel deployment allows rollback.

**Tech Stack:** Zod (schema), ReactMarkdown (prose), Recharts (charts), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-26-flexible-response-format-design.md`

---

## File Structure

### API (packages/api/src)
| File | Action | Responsibility |
|------|--------|----------------|
| `agent/types-v2.ts` | Create | New minimal response schema |
| `agent/prompt-v2.ts` | Create | New quality-focused system prompt |
| `routes/chat-v2.ts` | Create | V2 chat endpoint |
| `routes/chat.ts` | Keep | V1 endpoint (unchanged for rollback) |

### Frontend (packages/web/src)
| File | Action | Responsibility |
|------|--------|----------------|
| `lib/types-v2.ts` | Create | V2 response types |
| `lib/directive-parser.ts` | Create | Parse `::directive` blocks from markdown |
| `components/plan-response/index.ts` | Create | Export barrel |
| `components/plan-response/plan-response.tsx` | Create | Main container (metrics + content + actions) |
| `components/plan-response/metrics-bar.tsx` | Create | Render metrics array as stat cards |
| `components/plan-response/actions-footer.tsx` | Create | Render actions array as list |
| `components/plan-response/markdown-renderer.tsx` | Create | Render markdown with directive extraction |
| `components/plan-response/directives/chart-directive.tsx` | Create | Render ::chart blocks |
| `components/plan-response/directives/card-directive.tsx` | Create | Render ::card blocks |
| `components/plan-response/directives/collapse-directive.tsx` | Create | Render ::collapse blocks |
| `pages/plans/[id].tsx` | Modify | Use PlanResponse for v2 |

### Tests
| File | Action |
|------|--------|
| `packages/api/src/agent/__tests__/types-v2.test.ts` | Create |
| `packages/web/src/lib/__tests__/directive-parser.test.ts` | Create |
| `e2e/retirement-quality-v2.spec.ts` | Create |

---

## Task 1: V2 Response Schema (API)

**Files:**
- Create: `packages/api/src/agent/types-v2.ts`
- Test: `packages/api/src/agent/__tests__/types-v2.test.ts`

- [ ] **Step 1: Write failing test for schema validation**

```typescript
// packages/api/src/agent/__tests__/types-v2.test.ts
import { describe, it, expect } from 'vitest';
import { responseSchemaV2 } from '../types-v2.js';

describe('responseSchemaV2', () => {
  it('accepts valid response with all fields', () => {
    const input = {
      metrics: [{ label: 'FIRE Number', value: '$2.5M' }],
      content: '## Analysis\n\nSome content here.',
      actions: ['Increase savings', 'Review allocation']
    };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('accepts response with only content', () => {
    const input = { content: 'Just prose, no metrics or actions.' };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects response without content', () => {
    const input = { metrics: [{ label: 'X', value: 'Y' }] };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects metrics with missing label', () => {
    const input = {
      content: 'text',
      metrics: [{ value: '$100' }]
    };
    const result = responseSchemaV2.safeParse(input);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/api && pnpm test src/agent/__tests__/types-v2.test.ts
```
Expected: FAIL - module not found

- [ ] **Step 3: Implement schema**

```typescript
// packages/api/src/agent/types-v2.ts
import { z } from 'zod';

export const metricSchema = z.object({
  label: z.string(),
  value: z.string(),
  context: z.string().optional(),
});

export const responseSchemaV2 = z.object({
  metrics: z.array(metricSchema).optional(),
  content: z.string(),
  actions: z.array(z.string()).optional(),
});

export type MetricV2 = z.infer<typeof metricSchema>;
export type ResponseV2 = z.infer<typeof responseSchemaV2>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/api && pnpm test src/agent/__tests__/types-v2.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/agent/types-v2.ts packages/api/src/agent/__tests__/types-v2.test.ts
git commit -m "feat(api): add v2 response schema with minimal structure"
```

---

## Task 2: V2 System Prompt (API)

**Files:**
- Create: `packages/api/src/agent/prompt-v2.ts`

- [ ] **Step 1: Create prompt file**

```typescript
// packages/api/src/agent/prompt-v2.ts
export const systemPromptV2 = `You are a financial planning assistant creating personalized research reports.

## Response Format

Return JSON:
{
  "metrics": [{ "label": "...", "value": "...", "context?": "..." }],
  "content": "markdown with directives",
  "actions": ["next step 1", "next step 2"]
}

All fields optional except content. Use what the response needs.

## Analysis Quality

DO NOT rely on the 4% rule as your answer. It's a starting point for discussion.

Proper analysis includes:
- Monte Carlo simulations with actual success probabilities
- Historical backtesting against real market data
- Scenario stress tests (2008 crash, stagflation, etc.)
- Sequence of returns risk assessment
- Inflation-adjusted projections

Run the tools. Show the data. Explain the implications.

## Writing Style

You're writing a research report - think McKinsey meets Bloomberg.

Use rich markdown:
- **Headings** to structure the narrative (##, ###)
- **Bold/emphasis** for key figures and insights
- **Lists** when comparing options or steps

Use directives for emphasis:
::card{variant="warning"}
Important warning or insight here.
::

::collapse{title="Methodology"}
Detailed explanation here...
::

## Visualizations

Use charts when they communicate better than words:
::chart
type: area
title: Portfolio Projection
source: run_monte_carlo
::

Good: Success probability fan chart, allocation breakdown, projection scenarios
Avoid: Charts restating what the text already says, decoration

## Quality Bar

Think Projection Lab, Monarch - polished, insightful, actionable.
Every chart should answer a question. Every paragraph should add value.

## Available Tools

- get_portfolio_summary: Get current portfolio data
- run_monte_carlo: Run 10K simulations for success probability
- run_backtest: Test against historical market data (1930-present)
- run_scenario: Test specific scenarios (2008 crash, etc.)
- calculate_fire_number: Calculate FIRE number from expenses
`;
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/agent/prompt-v2.ts
git commit -m "feat(api): add v2 system prompt focused on quality"
```

---

## Task 3: Directive Parser (Frontend)

**Files:**
- Create: `packages/web/src/lib/directive-parser.ts`
- Test: `packages/web/src/lib/__tests__/directive-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/web/src/lib/__tests__/directive-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseDirectives, type ParsedSegment } from '../directive-parser.js';

describe('parseDirectives', () => {
  it('returns single markdown segment for plain text', () => {
    const input = 'Just some markdown text.';
    const result = parseDirectives(input);
    expect(result).toEqual([
      { type: 'markdown', content: 'Just some markdown text.' }
    ]);
  });

  it('extracts chart directive', () => {
    const input = `Some text.

::chart
type: area
title: Test Chart
source: run_monte_carlo
::

More text.`;
    const result = parseDirectives(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'markdown', content: 'Some text.' });
    expect(result[1]).toEqual({
      type: 'chart',
      config: { type: 'area', title: 'Test Chart', source: 'run_monte_carlo' }
    });
    expect(result[2]).toEqual({ type: 'markdown', content: 'More text.' });
  });

  it('extracts card directive with variant', () => {
    const input = `::card{variant="warning"}
This is a warning.
::`;
    const result = parseDirectives(input);
    expect(result).toEqual([
      { type: 'card', variant: 'warning', content: 'This is a warning.' }
    ]);
  });

  it('extracts collapse directive with title', () => {
    const input = `::collapse{title="Details"}
Hidden content here.
::`;
    const result = parseDirectives(input);
    expect(result).toEqual([
      { type: 'collapse', title: 'Details', content: 'Hidden content here.' }
    ]);
  });

  it('handles malformed directive gracefully', () => {
    const input = '::unknown\nsome content\n::';
    const result = parseDirectives(input);
    expect(result[0].type).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web && pnpm test src/lib/__tests__/directive-parser.test.ts
```
Expected: FAIL - module not found

- [ ] **Step 3: Implement parser**

```typescript
// packages/web/src/lib/directive-parser.ts
import YAML from 'yaml';

export type ParsedSegment =
  | { type: 'markdown'; content: string }
  | { type: 'chart'; config: Record<string, unknown> }
  | { type: 'card'; variant: string; content: string }
  | { type: 'collapse'; title: string; content: string }
  | { type: 'unknown'; raw: string };

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

export function parseDirectives(content: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;

  const regex = /::(\w+)(?:\{([^}]+)\})?\n([\s\S]*?)\n::/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add markdown before this directive
    if (match.index > lastIndex) {
      const markdown = content.slice(lastIndex, match.index).trim();
      if (markdown) {
        segments.push({ type: 'markdown', content: markdown });
      }
    }

    const [, directiveName, attrStr, innerContent] = match;
    const attrs = attrStr ? parseAttributes(attrStr) : {};

    switch (directiveName) {
      case 'chart':
        try {
          const config = YAML.parse(innerContent.trim());
          segments.push({ type: 'chart', config });
        } catch {
          segments.push({ type: 'unknown', raw: match[0] });
        }
        break;
      case 'card':
        segments.push({
          type: 'card',
          variant: attrs.variant || 'default',
          content: innerContent.trim(),
        });
        break;
      case 'collapse':
        segments.push({
          type: 'collapse',
          title: attrs.title || 'Details',
          content: innerContent.trim(),
        });
        break;
      default:
        segments.push({ type: 'unknown', raw: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining markdown
  if (lastIndex < content.length) {
    const markdown = content.slice(lastIndex).trim();
    if (markdown) {
      segments.push({ type: 'markdown', content: markdown });
    }
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', content }];
}
```

- [ ] **Step 4: Add yaml dependency**

```bash
cd packages/web && pnpm add yaml
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/web && pnpm test src/lib/__tests__/directive-parser.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/directive-parser.ts packages/web/src/lib/__tests__/directive-parser.test.ts packages/web/package.json packages/web/pnpm-lock.yaml
git commit -m "feat(web): add directive parser for ::chart, ::card, ::collapse"
```

---

## Task 4: V2 Types (Frontend)

**Files:**
- Create: `packages/web/src/lib/types-v2.ts`

- [ ] **Step 1: Create types file**

```typescript
// packages/web/src/lib/types-v2.ts
export interface MetricV2 {
  label: string;
  value: string;
  context?: string;
}

export interface ResponseV2 {
  metrics?: MetricV2[];
  content: string;
  actions?: string[];
}

export interface ToolResult {
  toolName: string;
  result: unknown;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/lib/types-v2.ts
git commit -m "feat(web): add v2 response types"
```

---

## Task 5: MetricsBar Component

**Files:**
- Create: `packages/web/src/components/plan-response/metrics-bar.tsx`

- [ ] **Step 1: Create component**

```typescript
// packages/web/src/components/plan-response/metrics-bar.tsx
import { StatCard } from '../common/stat-card.js';
import type { MetricV2 } from '../../lib/types-v2.js';

interface MetricsBarProps {
  metrics: MetricV2[];
}

export function MetricsBar({ metrics }: MetricsBarProps) {
  if (!metrics.length) return null;

  return (
    <div data-testid="metrics-bar" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {metrics.map((metric, i) => (
        <StatCard
          key={i}
          label={metric.label}
          value={metric.value}
          description={metric.context}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/metrics-bar.tsx
git commit -m "feat(web): add MetricsBar component for v2 response"
```

---

## Task 6: ActionsFooter Component

**Files:**
- Create: `packages/web/src/components/plan-response/actions-footer.tsx`

- [ ] **Step 1: Create component**

```typescript
// packages/web/src/components/plan-response/actions-footer.tsx
import { ArrowRight } from 'lucide-react';

interface ActionsFooterProps {
  actions: string[];
}

export function ActionsFooter({ actions }: ActionsFooterProps) {
  if (!actions.length) return null;

  return (
    <div data-testid="actions-footer" className="mt-8 p-6 rounded-2xl bg-gradient-to-b from-[#141416] to-[#0f0f11] border border-accent/10">
      <h3 className="text-sm font-semibold text-accent uppercase tracking-wider mb-4">
        Recommended Next Steps
      </h3>
      <ul className="space-y-3">
        {actions.map((action, i) => (
          <li key={i} className="flex items-start gap-3">
            <ArrowRight className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
            <span className="text-[#c5c5c5]">{action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/actions-footer.tsx
git commit -m "feat(web): add ActionsFooter component for v2 response"
```

---

## Task 7: Chart Directive Component

**Files:**
- Create: `packages/web/src/components/plan-response/directives/chart-directive.tsx`

- [ ] **Step 1: Create component**

```typescript
// packages/web/src/components/plan-response/directives/chart-directive.tsx
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

const COLORS = ['#f5a623', '#4a90d9', '#7ed321', '#d0021b', '#9013fe'];

interface ChartDirectiveProps {
  config: {
    type: 'area' | 'bar' | 'pie' | 'line';
    title?: string;
    source?: string;
    data?: Array<{ label: string; value: number }>;
  };
  toolResults?: Map<string, unknown>;
}

export function ChartDirective({ config, toolResults }: ChartDirectiveProps) {
  // Get data from source or inline
  let data = config.data;
  if (config.source && toolResults?.has(config.source)) {
    const result = toolResults.get(config.source) as { data?: unknown[] };
    data = result?.data as typeof data;
  }

  if (!data || !data.length) {
    return (
      <div className="p-4 bg-surface rounded-xl border border-border text-text-muted text-center">
        Chart data unavailable
      </div>
    );
  }

  return (
    <div className="my-6 p-4 bg-surface rounded-xl border border-border">
      {config.title && (
        <h4 className="text-sm font-medium text-text mb-4">{config.title}</h4>
      )}
      <ResponsiveContainer width="100%" height={250}>
        {config.type === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        ) : config.type === 'bar' ? (
          <BarChart data={data}>
            <XAxis dataKey="label" stroke="#666" />
            <YAxis stroke="#666" />
            <Tooltip />
            <Bar dataKey="value" fill="#f5a623" />
          </BarChart>
        ) : (
          <AreaChart data={data}>
            <XAxis dataKey="label" stroke="#666" />
            <YAxis stroke="#666" />
            <Tooltip />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#f5a623"
              fill="#f5a623"
              fillOpacity={0.3}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/directives/chart-directive.tsx
git commit -m "feat(web): add ChartDirective for ::chart blocks"
```

---

## Task 8: Card and Collapse Directive Components

**Files:**
- Create: `packages/web/src/components/plan-response/directives/card-directive.tsx`
- Create: `packages/web/src/components/plan-response/directives/collapse-directive.tsx`

- [ ] **Step 1: Create card directive**

```typescript
// packages/web/src/components/plan-response/directives/card-directive.tsx
import ReactMarkdown from 'react-markdown';
import { cn } from '../../../lib/utils.js';

const variantStyles = {
  default: 'border-border/50 bg-surface/30',
  warning: 'border-warning/40 bg-warning/5',
  highlight: 'border-accent/40 bg-accent/5',
};

const labelStyles = {
  default: 'text-text-muted',
  warning: 'text-warning',
  highlight: 'text-accent',
};

interface CardDirectiveProps {
  variant: 'default' | 'warning' | 'highlight';
  content: string;
}

export function CardDirective({ variant, content }: CardDirectiveProps) {
  return (
    <div className={cn('my-6 p-5 rounded-xl border', variantStyles[variant])}>
      <div className={cn('text-xs font-semibold uppercase tracking-wider mb-2', labelStyles[variant])}>
        {variant === 'warning' ? '⚠ Warning' : variant === 'highlight' ? '★ Key Insight' : '◆ Note'}
      </div>
      <div className="prose prose-sm prose-invert max-w-none prose-p:text-text-secondary">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create collapse directive**

```typescript
// packages/web/src/components/plan-response/directives/collapse-directive.tsx
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cn } from '../../../lib/utils.js';

interface CollapseDirectiveProps {
  title: string;
  content: string;
}

export function CollapseDirective({ title, content }: CollapseDirectiveProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="my-6 border border-border/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-surface/30 hover:bg-surface/50 transition-colors"
      >
        <span className="text-sm font-medium text-text">{title}</span>
        <ChevronDown
          className={cn('w-4 h-4 text-text-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen && (
        <div className="p-4 border-t border-border/50">
          <div className="prose prose-sm prose-invert max-w-none prose-p:text-text-secondary">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/plan-response/directives/
git commit -m "feat(web): add CardDirective and CollapseDirective components"
```

---

## Task 9: MarkdownRenderer Component

**Files:**
- Create: `packages/web/src/components/plan-response/markdown-renderer.tsx`

- [ ] **Step 1: Create component**

```typescript
// packages/web/src/components/plan-response/markdown-renderer.tsx
import ReactMarkdown from 'react-markdown';
import { parseDirectives } from '../../lib/directive-parser.js';
import { ChartDirective } from './directives/chart-directive.js';
import { CardDirective } from './directives/card-directive.js';
import { CollapseDirective } from './directives/collapse-directive.js';
import { cn } from '../../lib/utils.js';

interface MarkdownRendererProps {
  content: string;
  toolResults?: Map<string, unknown>;
}

export function MarkdownRenderer({ content, toolResults }: MarkdownRendererProps) {
  const segments = parseDirectives(content);

  return (
    <div className="space-y-4">
      {segments.map((segment, i) => {
        switch (segment.type) {
          case 'markdown':
            return (
              <div
                key={i}
                className={cn(
                  'prose prose-invert max-w-none',
                  'prose-p:text-[#c5c5c5] prose-p:text-[15px] prose-p:leading-[1.85]',
                  'prose-h2:text-[22px] prose-h2:font-semibold prose-h2:text-white prose-h2:mt-8 prose-h2:mb-4',
                  'prose-h3:text-[16px] prose-h3:font-semibold prose-h3:text-accent prose-h3:mt-6 prose-h3:mb-3',
                  'prose-strong:text-accent prose-strong:font-semibold',
                  'prose-li:text-[#c5c5c5]',
                  'prose-a:text-accent prose-a:no-underline hover:prose-a:underline'
                )}
              >
                <ReactMarkdown>{segment.content}</ReactMarkdown>
              </div>
            );
          case 'chart':
            return <ChartDirective key={i} config={segment.config as any} toolResults={toolResults} />;
          case 'card':
            return <CardDirective key={i} variant={segment.variant as any} content={segment.content} />;
          case 'collapse':
            return <CollapseDirective key={i} title={segment.title} content={segment.content} />;
          case 'unknown':
            return (
              <pre key={i} className="p-4 bg-surface rounded-xl text-xs text-text-muted overflow-x-auto">
                {segment.raw}
              </pre>
            );
        }
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/plan-response/markdown-renderer.tsx
git commit -m "feat(web): add MarkdownRenderer with directive support"
```

---

## Task 10: PlanResponse Container Component

**Files:**
- Create: `packages/web/src/components/plan-response/plan-response.tsx`
- Create: `packages/web/src/components/plan-response/index.ts`

- [ ] **Step 1: Create main component**

```typescript
// packages/web/src/components/plan-response/plan-response.tsx
import { MetricsBar } from './metrics-bar.js';
import { MarkdownRenderer } from './markdown-renderer.js';
import { ActionsFooter } from './actions-footer.js';
import type { ResponseV2, ToolResult } from '../../lib/types-v2.js';

interface PlanResponseProps {
  response: ResponseV2;
  toolResults?: ToolResult[];
}

export function PlanResponse({ response, toolResults }: PlanResponseProps) {
  // Convert tool results array to map for easy lookup
  const toolResultsMap = new Map(
    toolResults?.map((tr) => [tr.toolName, tr.result]) ?? []
  );

  return (
    <div className="space-y-6">
      {response.metrics && response.metrics.length > 0 && (
        <MetricsBar metrics={response.metrics} />
      )}

      <div className="p-6 rounded-2xl bg-gradient-to-b from-[#141416] to-[#0f0f11] border border-accent/10">
        <MarkdownRenderer content={response.content} toolResults={toolResultsMap} />
      </div>

      {response.actions && response.actions.length > 0 && (
        <ActionsFooter actions={response.actions} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create barrel export**

```typescript
// packages/web/src/components/plan-response/index.ts
export { PlanResponse } from './plan-response.js';
export { MetricsBar } from './metrics-bar.js';
export { ActionsFooter } from './actions-footer.js';
export { MarkdownRenderer } from './markdown-renderer.js';
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/plan-response/
git commit -m "feat(web): add PlanResponse container component"
```

---

## Task 11: V2 Chat Endpoint (API)

**Files:**
- Create: `packages/api/src/routes/chat-v2.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create v2 endpoint**

```typescript
// packages/api/src/routes/chat-v2.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { generateText } from 'ai';
import { db } from '../lib/db.js';
import { chatThreads, messages, plans, planEdits, eq, and } from '@lasagna/core';
import { getModel, createAgentTools } from '../agent/index.js';
import { systemPromptV2 } from '../agent/prompt-v2.js';
import { responseSchemaV2 } from '../agent/types-v2.js';
import { requireAuth, type AuthEnv } from '../middleware/auth.js';

export const chatRouterV2 = new Hono<AuthEnv>();
chatRouterV2.use('*', requireAuth);

const chatRequestSchema = z.object({
  threadId: z.string().uuid(),
  message: z.string().min(1).max(10000),
});

chatRouterV2.post('/', async (c) => {
  const { tenantId } = c.get('session');
  const rawBody = await c.req.json();

  const parseResult = chatRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json({ error: 'Invalid request body' }, 400);
  }
  const body = parseResult.data;

  // Verify thread belongs to tenant
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.id, body.threadId), eq(chatThreads.tenantId, tenantId)));

  if (!thread) {
    return c.json({ error: 'Thread not found' }, 404);
  }

  // Get plan context
  let planContext = '';
  if (thread.planId) {
    const [plan] = await db
      .select({ type: plans.type, title: plans.title })
      .from(plans)
      .where(and(eq(plans.id, thread.planId), eq(plans.tenantId, tenantId)));
    if (plan) {
      planContext = `\n\nCurrent plan: "${plan.title}" (${plan.type})`;
    }
  }

  // Save user message
  await db.insert(messages).values({
    threadId: body.threadId,
    tenantId,
    role: 'user',
    content: body.message,
  });

  // Get conversation history
  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.threadId, body.threadId))
    .orderBy(messages.createdAt);

  const tools = createAgentTools(tenantId);
  const threadId = body.threadId;
  const planId = thread.planId;

  // Agentic loop
  let conversationMessages = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  let finalText = '';
  let allToolResults: Array<{ toolName: string; result: unknown }> = [];
  const MAX_ROUNDS = 5;

  for (let step = 0; step < MAX_ROUNDS; step++) {
    const stepResult = await generateText({
      model: getModel(),
      system: systemPromptV2 + planContext,
      messages: conversationMessages,
      tools,
      maxSteps: 1,
    });

    finalText = stepResult.text;

    if (!stepResult.toolCalls?.length || stepResult.finishReason !== 'tool-calls') {
      break;
    }

    // Execute tools
    const toolResults: Array<{ toolName: string; result: string }> = [];
    for (const toolCall of stepResult.toolCalls) {
      const tool = tools[toolCall.toolName as keyof typeof tools];
      if (tool && 'execute' in tool) {
        try {
          const result = await (tool as any).execute(toolCall.args ?? {});
          toolResults.push({ toolName: toolCall.toolName, result: JSON.stringify(result) });
          allToolResults.push({ toolName: toolCall.toolName, result });
        } catch (e) {
          toolResults.push({ toolName: toolCall.toolName, result: JSON.stringify({ error: String(e) }) });
        }
      }
    }

    conversationMessages.push({ role: 'assistant', content: stepResult.text });
    conversationMessages.push({
      role: 'user',
      content: `[Tool results]\n${toolResults.map((t) => `${t.toolName}: ${t.result}`).join('\n')}\n\nContinue with analysis and output final JSON.`,
    });
  }

  // Parse response
  let response = null;
  try {
    const jsonMatch = finalText.match(/```json\n?([\s\S]*?)\n?```/) ||
                      finalText.match(/\{[\s\S]*"content"[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      const validated = responseSchemaV2.safeParse(parsed);
      if (validated.success) {
        response = validated.data;
      }
    }
  } catch (e) {
    console.error('[ChatV2] JSON parse error:', e);
  }

  // Fallback: if no valid JSON, wrap raw text as content
  if (!response && finalText.trim()) {
    response = { content: finalText };
  }

  // Save assistant message
  await db.insert(messages).values({
    threadId,
    tenantId,
    role: 'assistant',
    content: finalText,
    uiPayload: response ? JSON.stringify(response) : null,
  });

  // Update plan if we have a response
  if (response && planId) {
    await db
      .update(plans)
      .set({ content: JSON.stringify(response) })
      .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));
  }

  return c.json({ response, toolResults: allToolResults });
});
```

- [ ] **Step 2: Register v2 route in server**

Add to `packages/api/src/server.ts`:
```typescript
import { chatRouterV2 } from './routes/chat-v2.js';
// ... existing routes
app.route('/api/chat/v2', chatRouterV2);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/chat-v2.ts packages/api/src/server.ts
git commit -m "feat(api): add v2 chat endpoint with simplified response"
```

---

## Task 12: Update Plan Page to Use V2

**Files:**
- Modify: `packages/web/src/pages/plans/[id].tsx`
- Modify: `packages/web/src/lib/api.ts` (if exists, or create api helper)

- [ ] **Step 1: Add v2 response type guard and API helper**

Create a type guard to safely validate v2 responses:

```typescript
// Add to packages/web/src/lib/types-v2.ts
export function isResponseV2(obj: unknown): obj is ResponseV2 {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'content' in obj &&
    typeof (obj as any).content === 'string' &&
    !('blocks' in obj)
  );
}
```

- [ ] **Step 2: Add v2 API call and PlanResponse**

Update the plan page to detect v2 responses and render with PlanResponse:

```typescript
// Add import at top
import { PlanResponse } from '../../components/plan-response/index.js';
import type { ResponseV2, ToolResult } from '../../lib/types-v2.js';
import { isResponseV2 } from '../../lib/types-v2.js';

// In component, add state for v2
const [responseV2, setResponseV2] = useState<ResponseV2 | null>(null);
const [toolResults, setToolResults] = useState<ToolResult[]>([]);

// Modify handleChatSubmit to use v2 endpoint and capture tool results
const handleChatSubmit = useCallback(async (message: string) => {
  if (!plan?.threadId) return;
  setTransitionState('generating');

  try {
    // Call v2 endpoint
    const res = await fetch('/api/chat/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: plan.threadId, message }),
    });
    const data = await res.json();

    // Extract tool results from response
    if (data.toolResults) {
      setToolResults(data.toolResults);
    }

    // Fetch updated plan
    const updatedPlan = await api.getPlan(id);
    setPlan(updatedPlan);

    // Safely validate v2 format before using
    if (updatedPlan.content && isResponseV2(updatedPlan.content)) {
      setResponseV2(updatedPlan.content);
    }

    setTransitionState('complete');
  } catch (err) {
    console.error('Failed to submit chat:', err);
    setTransitionState('complete');
  }
}, [plan?.threadId, id]);

// In render, conditionally use PlanResponse or PromptTransition
{responseV2 ? (
  <PlanResponse
    response={responseV2}
    toolResults={toolResults}
  />
) : plan.content ? (
  <PromptTransition ... />
) : (
  <PromptTransition ... />
)}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/plans/[id].tsx packages/web/src/lib/types-v2.ts
git commit -m "feat(web): integrate PlanResponse for v2 format in plan page"
```

---

## Task 13: E2E Test for V2

**Files:**
- Create: `e2e/retirement-quality-v2.spec.ts`

- [ ] **Step 1: Create v2 E2E test**

```typescript
// e2e/retirement-quality-v2.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Retirement Plan V2', () => {
  test('creates plan with v2 response format', async ({ page }) => {
    test.setTimeout(180000);

    await page.goto('/plans/new');
    await page.getByRole('button', { name: /Retirement/ }).click();
    await page.getByPlaceholder(/e.g.,/).fill('V2 Test Plan');
    await page.getByRole('button', { name: 'Create Plan' }).click();

    await expect(page).toHaveURL(/\/plans\/[a-f0-9-]+/);

    // Submit prompt
    const input = page.getByPlaceholder(/type your own/);
    await input.fill('I want to retire at 55 with $80k annual spending');
    await page.locator('button[type="submit"]').click();

    // Wait for response
    await expect(page.getByText('Generating')).not.toBeVisible({ timeout: 120000 });

    // Check for v2 elements - prose content should be visible
    await expect(page.locator('.prose')).toBeVisible();

    // Check for markdown rendering (headings, paragraphs)
    await expect(page.locator('.prose h2, .prose h3')).toBeVisible();

    // Check for metrics bar if present (not required, but good to verify rendering)
    const metricsBar = page.locator('[data-testid="metrics-bar"]');
    const hasMetrics = await metricsBar.count() > 0;
    if (hasMetrics) {
      await expect(metricsBar).toBeVisible();
    }

    // Check for actions footer if present
    const actionsFooter = page.locator('[data-testid="actions-footer"]');
    const hasActions = await actionsFooter.count() > 0;
    if (hasActions) {
      await expect(actionsFooter).toBeVisible();
      await expect(actionsFooter.locator('li')).toHaveCount({ minimum: 1 });
    }

    // Take screenshot
    await page.screenshot({ path: 'e2e/screenshots/v2-test.png', fullPage: true });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add e2e/retirement-quality-v2.spec.ts
git commit -m "test(e2e): add v2 response format test"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | V2 Response Schema | types-v2.ts |
| 2 | V2 System Prompt | prompt-v2.ts |
| 3 | Directive Parser | directive-parser.ts |
| 4 | V2 Frontend Types | types-v2.ts |
| 5 | MetricsBar | metrics-bar.tsx |
| 6 | ActionsFooter | actions-footer.tsx |
| 7 | ChartDirective | chart-directive.tsx |
| 8 | Card/Collapse | card-directive.tsx, collapse-directive.tsx |
| 9 | MarkdownRenderer | markdown-renderer.tsx |
| 10 | PlanResponse | plan-response.tsx |
| 11 | V2 Chat Endpoint | chat-v2.ts |
| 12 | Plan Page Integration | [id].tsx |
| 13 | E2E Test | retirement-quality-v2.spec.ts |
