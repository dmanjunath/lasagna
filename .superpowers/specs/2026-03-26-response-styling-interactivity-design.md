# Response Styling & Interactivity Overhaul

## Problem Statement

The v2 chat responses have three issues:
1. **Too verbose** — Claude writes essay-length responses when users want concise, scannable insights
2. **Poor text styling** — typography feels amateur, not polished
3. **No interactivity** — static charts, no scenario exploration, no progressive disclosure

## Design Goals

| Aspect | Goal |
|--------|------|
| Content length | Concise, context-dependent. No paragraphs or bullet dumps. |
| Text styling | Clean editorial (Notion/Linear aesthetic) |
| Interactive elements | Premium fintech (Monarch/Wealthfront aesthetic) |
| Disclosure | Progressive — headline answer first, details on demand |
| Charts | Full what-if playground with sliders, toggles, time scrubbing |
| Response interaction | Thumbs up/down, "tell me more", collapsible deep-dives |
| Actions | Clickable next steps that feel actionable |

## Technical Approach

### Keep V2 Schema, Enhance Everything Else

The v2 schema (`metrics`, `content`, `actions`) is fine. The problems are:
1. The prompt lets Claude be verbose
2. The directives render static, non-interactive components
3. The typography system is basic

**Changes:**
1. **Prompt overhaul** — force conciseness, context-aware structure selection
2. **Enhanced directives** — `::chart` becomes interactive, add new directive types
3. **Typography system** — design tokens for clean editorial look
4. **Interactive components** — scenario explorer, comparison cards, insight pills

### Response Structure Philosophy

Claude should pick structure based on query type:

| Query Type | Structure |
|------------|-----------|
| "Can I retire at 50?" | Metric highlight + scenario explorer + action cards |
| "How does X work?" | Insight card with expandable explanation |
| "Compare X vs Y" | Comparison cards side-by-side |
| "What should I do?" | Action cards with priority indicators |
| Complex analysis | Progressive disclosure — headline, then expandable sections |

## Component Architecture

### 1. Typography System

**Design Tokens:**
```css
/* Headings - clean, not shouty */
--heading-1: 600 24px/1.3 'Inter', system-ui;
--heading-2: 600 18px/1.4 'Inter', system-ui;
--heading-3: 500 14px/1.4 'Inter', system-ui;

/* Body - highly readable */
--body: 400 15px/1.7 'Inter', system-ui;
--body-small: 400 13px/1.6 'Inter', system-ui;

/* Accents */
--label: 500 11px/1 'Inter', system-ui; /* uppercase tracking */
--metric: 600 28px/1.2 'Inter', system-ui;
```

**Color Palette (dark mode):**
```css
--text-primary: #f5f5f5;      /* Headlines, important */
--text-secondary: #a3a3a3;    /* Body text */
--text-muted: #6b6b6b;        /* Labels, hints */
--accent: #6366f1;            /* Interactive, links */
--accent-soft: #6366f1/10;    /* Hover states, backgrounds */
--surface: #18181b;           /* Cards */
--surface-elevated: #27272a;  /* Elevated cards, hovers */
--border: #3f3f46;            /* Subtle borders */
```

### 2. Insight Card

Replaces verbose paragraphs with scannable insights.

```
┌─────────────────────────────────────────────┐
│ ★ Key Insight                               │
│                                             │
│ Your 85% success rate drops to 62% if you   │
│ retire 5 years early.                       │
│                                             │
│ [Show analysis ▼]                           │
└─────────────────────────────────────────────┘
```

**Directive syntax:**
```markdown
::insight
Your 85% success rate drops to 62% if you retire 5 years early.
---
The Monte Carlo simulation shows sequence-of-returns risk is significantly
higher with a longer withdrawal period...
::
```

Content before `---` is the headline (always visible). Content after is expandable.

### 3. Scenario Explorer

Interactive chart with controls for what-if analysis.

```
┌─────────────────────────────────────────────┐
│ Portfolio Projection                        │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │          [Interactive Chart]            │ │
│ │    with hover tooltips, click points    │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────┐ ┌─────────┐ ┌─────────────────┐ │
│ │ Base    │ │ Bull    │ │ Bear            │ │
│ │ ●       │ │ ○       │ │ ○               │ │
│ └─────────┘ └─────────┘ └─────────────────┘ │
│                                             │
│ Retirement Age  ────●──────────  55         │
│ Savings Rate    ──────●────────  20%        │
│ Return Assumption ────────●────  7%         │
│                                             │
│ Timeline: [2024]═══════════●═══════[2060]   │
└─────────────────────────────────────────────┘
```

**Directive syntax:**
```markdown
::scenario-explorer
title: Portfolio Projection
source: run_monte_carlo
scenarios:
  - id: base
    label: Base Case
  - id: bull
    label: Bull Market
  - id: bear
    label: Bear Market
sliders:
  - id: retirement_age
    label: Retirement Age
    min: 50
    max: 70
    default: 55
  - id: savings_rate
    label: Savings Rate
    min: 5
    max: 40
    default: 20
    format: percent
::
```

### 4. Comparison Card

Side-by-side options with tradeoffs.

```
┌──────────────────────┬──────────────────────┐
│ Aggressive           │ Conservative         │
│ ──────────────────── │ ──────────────────── │
│                      │                      │
│ 90/10 stocks/bonds   │ 60/40 stocks/bonds   │
│                      │                      │
│ ✓ Higher growth      │ ✓ Lower volatility   │
│ ✓ Better for long    │ ✓ Sleep better       │
│ ✗ Bigger drawdowns   │ ✗ May underperform   │
│                      │                      │
│ Expected: $2.4M      │ Expected: $1.8M      │
│                      │                      │
│    [Select]          │    [Select]          │
└──────────────────────┴──────────────────────┘
```

**Directive syntax:**
```markdown
::comparison
options:
  - title: Aggressive
    summary: 90/10 stocks/bonds
    pros:
      - Higher growth potential
      - Better for long time horizons
    cons:
      - Bigger drawdowns in crashes
    metric: { label: "Expected", value: "$2.4M" }
  - title: Conservative
    summary: 60/40 stocks/bonds
    pros:
      - Lower volatility
      - Sleep better at night
    cons:
      - May underperform over time
    metric: { label: "Expected", value: "$1.8M" }
::
```

### 5. Action Card

Clickable next steps with context.

```
┌─────────────────────────────────────────────┐
│ → Increase 401k contribution to max         │
│   Saves $3,200/year in taxes                │
│                                        [Do] │
└─────────────────────────────────────────────┘
```

**Directive syntax:**
```markdown
::action{priority="high"}
Increase 401k contribution to max
---
Saves $3,200/year in taxes
::
```

### 6. Metric Pill

Inline highlighted metric for emphasis.

```
Your FIRE number is ::metric[$2.1M]{context="25x expenses"}:: based on current spending.
```

Renders as an inline pill: `[$2.1M]` with tooltip showing context.

## Prompt Changes

### Current Problem
The v2 prompt is too permissive. Claude writes essays.

### New Prompt Philosophy
```markdown
## Response Structure

You're writing for busy professionals. They want answers, not essays.

**Rules:**
1. Lead with the answer. Never "let me explain..." or "to understand this..."
2. One insight per block. If you have 3 insights, use 3 blocks.
3. Numbers over words. "$2.1M" not "approximately two million dollars"
4. Progressive disclosure. Headline is mandatory, details are expandable.

**Choose structure based on query:**
- Yes/no question → Metric + insight card
- How much/when → Scenario explorer with their inputs
- Compare options → Comparison cards
- What should I do → Action cards ranked by impact

**Never:**
- Write paragraphs of explanation upfront
- Use bullet points as a crutch
- Repeat the question back
- Hedge with "it depends" without then giving specifics
```

## Interactive Features

### Chart Interactions
- **Hover**: Show value at point, highlight related data
- **Click point**: Lock tooltip, show detailed breakdown
- **Drag timeline**: Scrub through time, values update
- **Scenario toggle**: Switch between pre-computed scenarios
- **Slider adjust**: Recalculate projection with new inputs

### Response Interactions
- **Expand/collapse**: Progressive disclosure on all cards
- **"Tell me more"**: Fetch deeper analysis for specific insight
- **Thumbs up/down**: Rate sections for quality feedback
- **Copy value**: Click metric to copy to clipboard

### Action Interactions
- **Click action**: Opens relevant flow (e.g., link to 401k settings)
- **Mark complete**: Check off completed actions
- **Snooze**: "Remind me later" for actions

## Migration Strategy

1. **Phase 1: Typography & Styling** — Update CSS tokens, improve base rendering
2. **Phase 2: Enhanced Directives** — Build insight, comparison, action components
3. **Phase 3: Scenario Explorer** — Full interactive chart with controls
4. **Phase 4: Prompt Overhaul** — New system prompt enforcing conciseness
5. **Phase 5: Response Interactions** — Add feedback, expand/collapse, copy

## File Structure

```
packages/web/src/
├── components/
│   └── plan-response/
│       ├── styles/
│       │   └── tokens.css          # Design tokens
│       ├── primitives/
│       │   ├── metric-pill.tsx     # Inline metric
│       │   └── expand-button.tsx   # Show more/less
│       ├── cards/
│       │   ├── insight-card.tsx    # Key insight with expand
│       │   ├── comparison-card.tsx # Side-by-side options
│       │   └── action-card.tsx     # Clickable next step
│       ├── charts/
│       │   ├── scenario-explorer.tsx    # Full interactive chart
│       │   ├── chart-controls.tsx       # Sliders, toggles
│       │   └── timeline-scrubber.tsx    # Time range selector
│       ├── markdown-renderer.tsx   # Updated with new directives
│       └── plan-response.tsx       # Container
├── lib/
│   └── directive-parser.ts         # Extended for new directives
```

## Success Criteria

1. **Conciseness**: Average response length drops 50%+ while maintaining insight quality
2. **Scannability**: User can get the answer in <3 seconds
3. **Interactivity**: Charts support slider/toggle/scrub interactions
4. **Polish**: Passes the "would I pay for this?" test
5. **Adaptability**: Different queries produce appropriately different structures
