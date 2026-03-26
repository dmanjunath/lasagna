# Flexible Response Format Design

## Overview

Replace the rigid 20+ block type UIPayload schema with a minimal, flexible format that lets Claude write natural research reports with embedded visualizations.

**Goal:** High-quality, engaging responses without wide swings in length or comprehensiveness. Claude decides structure based on what the response needs.

## Current State

| Aspect | Current |
|--------|---------|
| Block types | 20+ (stat, text, monte_carlo_chart, backtest_table, section_card, etc.) |
| Schema code | 308 lines of Zod validation |
| System prompt | ~150 lines explaining format requirements |
| Failure modes | JSON validation fails → "No content generated" |

**Problems:**
- Complex JSON often fails validation
- Claude spends tokens on format compliance vs. content quality
- Unnatural - forcing structure where prose would work better
- Hard to extend (new block type = schema + renderer + types)

## New Design

### Schema

```typescript
const responseSchema = z.object({
  // Optional array. When present, each item must have label + value
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    context: z.string().optional()
  })).optional(),

  // Required - the main content
  content: z.string(),

  // Optional array of action strings
  actions: z.array(z.string()).optional()
})
```

- `content` - Required. The research report with markdown + directives
- `metrics` - Optional. When present, items must have `label` and `value`
- `actions` - Optional. Next steps (rendered as footer)

**Complete example:**
```json
{
  "metrics": [
    { "label": "FIRE Number", "value": "$2.5M" },
    { "label": "Success Rate", "value": "85%", "context": "Monte Carlo" }
  ],
  "content": "## Your Path to Early Retirement\n\nRetiring at 50 requires careful planning...\n\n::chart\ntype: area\ntitle: Portfolio Projection\nsource: run_monte_carlo\n::\n\nThe simulation shows strong probability of success.\n\n::card{variant=\"warning\"}\nSequence of returns risk is elevated for early retirees.\n::\n\n::collapse{title=\"Methodology\"}\nWe ran 10,000 Monte Carlo simulations...\n::",
  "actions": [
    "Increase monthly savings to $2,500",
    "Review asset allocation quarterly"
  ]
}

### Directives

Embedded in markdown content. All directives are **block-level only** (own paragraph).

**Syntax:**
```
::directiveName{attr="value"}
content (YAML for charts, markdown for card/collapse)
::
```

**Directive types:**

| Directive | Attributes | Content |
|-----------|------------|---------|
| `chart` | none | YAML config (type, title, source or data) |
| `card` | `variant`: default, warning, highlight | Markdown text |
| `collapse` | `title`: string | Markdown text |

**Charts:**
```markdown
::chart
type: area
title: Portfolio Survival Probability
source: run_monte_carlo
::
```

With inline data:
```markdown
::chart
type: pie
title: Asset Allocation
data:
  - label: Stocks
    value: 60
  - label: Bonds
    value: 30
::
```

**Cards:**
```markdown
::card{variant="warning"}
Early retirement means 35+ years of withdrawals.
::
```

**Collapsible:**
```markdown
::collapse{title="Methodology"}
We ran 10,000 simulations...
::
```

### Directive Parsing Rules

**Parser behavior:**
1. Scan for `::` at start of line
2. Extract directive name and optional `{attributes}`
3. Capture content until closing `::` on its own line
4. Render appropriate component

**Regex pattern:**
```javascript
/^::(\w+)(?:\{([^}]+)\})?\n([\s\S]*?)\n::$/gm
```

**Constraints:**
- Block-level only - must start on own line
- No nesting - directives cannot contain other directives
- Attributes use `key="value"` syntax (double quotes required)
- Content between `::` markers is trimmed

**Malformed handling:**
- Unclosed `::` - render as plain text (no crash)
- Unknown directive name - render as code block with warning
- Invalid YAML in chart - show error card with raw content

### Tool Result Binding

Charts can reference tool results via `source` field:

```yaml
source: run_monte_carlo  # Tool name
```

**Binding mechanism:**
1. Chat API returns tool results alongside response
2. Frontend stores tool results in context: `Map<toolName, result>`
3. ChartDirective looks up `source` in context map
4. If found, passes result data to Recharts
5. If not found, shows "Data unavailable" placeholder

**Multiple calls of same tool:** Use most recent result. Future enhancement could support `source: run_monte_carlo[0]` indexing.

### System Prompt

~40 lines focused on quality, not format:

```markdown
You are a financial planning assistant creating personalized research reports.

## Response Format

Return JSON:
{
  "metrics": [{ "label": "...", "value": "...", "context?": "..." }],
  "content": "markdown with directives",
  "actions": ["next step 1", "next step 2"]
}

All fields optional. Use what the response needs.

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
Early retirement means 35+ years of withdrawals - sequence risk is critical.
::

::collapse{title="Methodology: Monte Carlo Simulation"}
We ran 10,000 simulations using historical return distributions...
::

## Visualizations

Use charts when they communicate better than words:
::chart
type: area
title: Portfolio Survival Probability
source: monte_carlo_result
::

Good: Success probability fan chart, allocation breakdown, projection scenarios
Avoid: Charts restating what the text already says, decoration

## Quality Bar

Think Projection Lab, Monarch - polished, insightful, actionable.
Every chart should answer a question. Every paragraph should add value.
```

### Frontend Architecture

```
┌─────────────────────────────────────────┐
│ <PlanResponse>                          │
│  ├─ <MetricsBar metrics={[...]} />      │  ← Optional row of stat cards
│  ├─ <MarkdownRenderer content="..." />  │  ← Parses directives
│  │    ├─ <ChartDirective config={...}/> │  ← Inline charts
│  │    ├─ <CardDirective variant="..."/> │  ← Callout cards
│  │    └─ <CollapseDirective title=".."/>│  ← Expandable sections
│  └─ <ActionsFooter actions={[...]} />   │  ← Optional next steps
└─────────────────────────────────────────┘
```

**MarkdownRenderer responsibilities:**
1. Split content on directive blocks (`::directive ... ::`)
2. Render markdown segments with ReactMarkdown (existing prose styling)
3. Render directive segments with appropriate component
4. Pass tool results context for chart data references

**Components to keep:**
- `StatCard` - for metrics bar
- Recharts integration - for chart rendering

**Components to delete:**
- 15+ block renderers (monte_carlo_chart, backtest_table, section_card, etc.)
- UIRenderer, BlockRenderer architecture

## Migration Path

### Phase 1: Add new endpoint (parallel)
- Create `/api/chat/v2` with new schema
- Keep `/api/chat` working as-is
- Build new `<PlanResponse>` component with directive parser

### Phase 2: Frontend support
- Add `MarkdownRenderer` with directive extraction
- Add `ChartDirective`, `CardDirective`, `CollapseDirective` components
- Reuse existing Recharts integration

### Phase 3: Switch over
- Update frontend to use v2
- Remove old UIPayload types and block renderers
- Delete ~400 lines of schema/renderer code

**Rollback:** Keep v1 endpoint for 2 weeks, then remove.

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| Schema | 20+ block types, 308 lines Zod | 3 optional fields, ~15 lines |
| Prompt | 150 lines format rules | 40 lines quality guidance |
| Frontend | 15+ block renderers | 1 markdown renderer + 3 directives |
| Claude output | Rigid JSON blocks | Natural prose + directives |
| Failure modes | Validation errors | Graceful (just markdown) |

## Testing

- E2E test: retirement-quality.spec.ts adapted for new format
- Quality assertions: has metrics OR prose, charts render, actions present when relevant
- Graceful degradation: invalid directives render as code blocks, don't crash
