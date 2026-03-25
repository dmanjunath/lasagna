# Plan UI Refinement Spec

## Overview

Refine the plan UI to improve user experience when viewing LLM-generated financial plans. Three main areas of improvement:

1. **Prompt → Sidebar Animation**: Smooth transition from initial prompt input to chat sidebar
2. **Text Formatting**: Reduce prose, use structured components
3. **Dynamic Visualizations**: Config-driven charts with interactivity (Recharts + Vega-Lite)

## 1. Prompt → Sidebar Animation

### Problem

Currently, when a user selects a starter prompt or enters a custom prompt:
- The chat sidebar doesn't open until messages exist
- The user's prompt disappears into the sidebar without visual feedback
- No clear loading state during plan generation

### Solution

Animated transition flow with persistent chat sidebar:

```
┌─────────────────────────────────────────────────────────────────┐
│  State 1: New Plan                                              │
│  ├─ Main area shows starter prompts + custom input              │
│  └─ No sidebar visible                                          │
│                                                                 │
│  State 2: Animating (on submit)                                 │
│  ├─ Sidebar slides in from right (spring animation, ~300ms)    │
│  ├─ User's prompt "flies" from input to chat bubble position   │
│  └─ Main content crossfades to loading state                   │
│                                                                 │
│  State 3: Loading                                               │
│  ├─ Main area: centered spinner with "Generating plan..."      │
│  ├─ Sidebar: user message + assistant typing indicator         │
│  └─ Both areas show activity                                   │
│                                                                 │
│  State 4: Complete                                              │
│  ├─ Plan content fades in with staggered block animations      │
│  ├─ Assistant response appears in sidebar                      │
│  └─ Chat input active for follow-up questions                  │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

#### Integration with Existing Components

The current `PlanDetailPage` uses:
- `StarterPrompts` component for initial prompt selection
- `initialMessage` state to trigger auto-send
- `generatingContent` boolean for loading state
- `hasChat` derived state to control sidebar visibility

**This implementation REPLACES the existing state management** with a unified `transitionState` that handles the full animation flow. The `StarterPrompts` component remains but gains animation capabilities via framer-motion's `layoutId`.

**Backward compatibility:** For any external code that depends on the old state variables, provide derived values:
```typescript
// Backward-compatible derived state (if needed by other components)
const generatingContent = transitionState === 'loading';
const hasChat = transitionState !== 'idle';
```

#### Modified: `PlanDetailPage`

```typescript
// REPLACE existing state (initialMessage, generatingContent) with:
const [transitionState, setTransitionState] = useState<
  'idle' | 'animating' | 'loading' | 'complete'
>('idle');
const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);

// Sidebar visibility: show when not idle (replaces hasChat logic)
const showSidebar = transitionState !== 'idle';

// REPLACE existing handleSelectPrompt with:
const handleSelectPrompt = async (prompt: string) => {
  setSubmittedPrompt(prompt);
  setTransitionState('animating');

  // Create thread if needed (existing logic)
  if (!thread && id) {
    const { thread: newThread } = await api.createThread(id);
    setThread(newThread);
  }

  // Wait for animation to complete
  await new Promise(resolve => setTimeout(resolve, 300));
  setTransitionState('loading');

  // Send message (triggers ChatPanel's sendMessage via initialMessage prop)
  // ChatPanel's onChatResponse callback will set transitionState to 'complete'
};

// Callback from ChatPanel when response finishes
// TIMING: This fires when streaming completes AND plan content is saved
// (ChatPanel's existing onChatResponse callback, after reader.read() loop completes)
const handleChatResponse = useCallback(async () => {
  if (!id) return;
  // Fetch updated plan content (API returns newly saved content)
  const updatedPlan = await api.getPlan(id);
  setPlan(updatedPlan);
  // Only transition to 'complete' after plan is fetched and ready to render
  setTransitionState('complete');
}, [id]);
```

#### New Component: `PromptTransition`

Wraps `StarterPrompts` to add shared element animation:

```typescript
type PromptTransitionProps = {
  planType: PlanType;
  transitionState: 'idle' | 'animating' | 'loading' | 'complete';
  submittedPrompt: string | null;
  onSelectPrompt: (prompt: string) => void;
};

function PromptTransition({ planType, transitionState, submittedPrompt, onSelectPrompt }) {
  return (
    <AnimatePresence mode="wait">
      {transitionState === 'idle' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <StarterPrompts planType={planType} onSelectPrompt={onSelectPrompt} />
        </motion.div>
      )}

      {transitionState === 'animating' && submittedPrompt && (
        <motion.div
          layoutId="prompt-bubble"
          className="prompt-flying"
          // Animate from center to sidebar position
        >
          {submittedPrompt}
        </motion.div>
      )}

      {(transitionState === 'loading' || transitionState === 'complete') && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {transitionState === 'loading' ? <LoadingSpinner /> : <UIRenderer payload={plan.content} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

#### Animation Details

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Sidebar | slideInRight | 300ms | spring(damping: 25, stiffness: 300) |
| Prompt bubble | layoutId transition | 300ms | spring |
| Main content | fadeOut → fadeIn | 200ms | easeOut |
| Plan blocks | staggered fadeIn | 30ms delay each, max 300ms total | easeOut |

**Note on block stagger:** To prevent slow reveals on plans with many blocks, cap total stagger time at 300ms. For N blocks, delay = min(30ms, 300ms / N).

## 2. Text Formatting

### Problem

LLM responses contain walls of prose text that look out of place in a dashboard UI:
- Long paragraphs without visual hierarchy
- Headers blend into body text
- No distinction between sections

### Solution

Two-part approach:

1. **Minimize prose**: Update LLM system prompts to return structured blocks
2. **Section cards as fallback**: Wrap necessary text in styled containers

### New Block Types

#### `section_card`

For wrapping prose sections with visual hierarchy:

```typescript
type SectionCardBlock = {
  type: "section_card";
  label: string;        // e.g., "The Numbers", "Key Considerations"
  content: string;      // Markdown content
  variant?: "default" | "highlight" | "warning";
};
```

**Variant styling:**
| Variant | Border Color | Background |
|---------|--------------|------------|
| `default` | `border-border` (gray) | `glass-card` default |
| `highlight` | `border-accent` (amber) | `bg-accent/5` |
| `warning` | `border-warning` (orange) | `bg-warning/5` |

Renders as:
```
┌─────────────────────────────────────────┐
│ THE NUMBERS                             │  ← uppercase label
├─────────────────────────────────────────┤
│ To spend $100,000 annually, you'll      │
│ need $2.5 million saved...              │
└─────────────────────────────────────────┘
```

#### `collapsible_details`

For lengthy explanations that shouldn't dominate the view:

```typescript
type CollapsibleDetailsBlock = {
  type: "collapsible_details";
  summary: string;      // Always visible
  content: string;      // Revealed on expand
  defaultOpen?: boolean;
};
```

### LLM Prompt Updates

Update the `systemPrompt` constant in `packages/api/src/agent/agent.ts`. Add the following to the existing UI block guidance section:

```typescript
// In packages/api/src/agent/agent.ts, append to systemPrompt:

const systemPrompt = `
... existing prompt content ...

## UI Block Guidelines (Updated)

PREFER returning data as structured blocks:
- stat: for key metrics (FIRE number, success rate, etc.)
- dynamic_chart: for visualizations with interactivity
- table: for comparisons and lists
- section_card: for explanatory text (use sparingly, max 2-3 per response)
- collapsible_details: for detailed explanations users can expand

AVOID long prose paragraphs. Break information into digestible components.

When using dynamic_chart:
- Use renderer: "recharts" for standard bar/line/area charts, brush selection
- Use renderer: "vega-lite" for sliders, dropdowns, linked views, or unusual chart types
- Always include data inline (no external URLs)
- Prefer interactivity when it helps users explore tradeoffs
`;
```

## 3. Dynamic Visualizations

### Problem

Current chart system is limited:
- Fixed chart types (area, bar, donut)
- No interactivity beyond tooltips
- Can't create novel visualizations

### Solution

Config-driven charts supporting both Recharts and Vega-Lite. Claude outputs JSON configuration, the app renders it. No code execution required.

### New Block Type: `dynamic_chart`

```typescript
type DynamicChartBlock = {
  type: "dynamic_chart";
  title?: string;
  renderer: "recharts" | "vega-lite";
  // For Recharts:
  rechartsConfig?: RechartsConfig;
  // For Vega-Lite:
  vegaLiteSpec?: VegaLiteSpec;
};

type RechartsConfig = {
  chartType: "composed" | "pie" | "radar" | "radial" | "treemap" | "funnel" | "sankey";
  width?: number | "responsive";
  height?: number;
  data: Record<string, unknown>[];
  components: RechartsComponent[];
  xAxis?: AxisConfig;
  yAxis?: AxisConfig | AxisConfig[];
  tooltip?: boolean | TooltipConfig;
  legend?: boolean | LegendConfig;
  brush?: BrushConfig;
  referenceLines?: ReferenceLineConfig[];
};

type RechartsComponent = {
  type: "Area" | "Bar" | "Line" | "Scatter" | "Pie" | "Radar" | "Cell" | "Treemap" | "Funnel" | "Sankey";
  dataKey: string;
  fill?: string;
  stroke?: string;
  stackId?: string;
  yAxisId?: string;
  // Treemap/Sankey specific
  nameKey?: string;
  // ... other Recharts props
};

type VegaLiteSpec = {
  $schema?: string;
  data: { values: unknown[] } | { url: string };
  mark: string | { type: string; [key: string]: unknown };
  encoding: Record<string, unknown>;
  params?: VegaLiteParam[];
  layer?: VegaLiteSpec[];
  hconcat?: VegaLiteSpec[];
  vconcat?: VegaLiteSpec[];
  // ... full Vega-Lite spec
};
```

### When to Use Each Renderer

| Use Case | Renderer | Reason |
|----------|----------|--------|
| Standard charts (bar, line, area) | Recharts | Matches app styling, simpler config |
| Composed/multi-series charts | Recharts | Good support for multiple components |
| Brush/zoom selection | Recharts | Built-in components |
| Sliders/dropdowns controlling chart | Vega-Lite | Native `params` binding |
| Linked views (selection in one affects another) | Vega-Lite | Native support |
| Heatmaps, geographic, unusual types | Vega-Lite | Broader chart type support |

### Implementation

#### `DynamicChartRenderer`

Main component that delegates to the appropriate renderer:

```typescript
function DynamicChartRenderer({ block }: { block: DynamicChartBlock }) {
  if (block.renderer === "vega-lite" && block.vegaLiteSpec) {
    return <VegaLiteChart spec={block.vegaLiteSpec} title={block.title} />;
  }

  if (block.renderer === "recharts" && block.rechartsConfig) {
    return <RechartsFromConfig config={block.rechartsConfig} title={block.title} />;
  }

  return <ChartError message="Invalid chart configuration" />;
}
```

#### `VegaLiteChart`

Thin wrapper around vega-embed:

```typescript
function VegaLiteChart({ spec, title }: { spec: VegaLiteSpec; title?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const themedSpec = {
      ...spec,
      background: "transparent",
      config: {
        ...spec.config,
        // Apply app theme colors
        axis: { labelColor: "#a8a29e", titleColor: "#d6d3d1", gridColor: "rgba(120,113,108,0.2)" },
        legend: { labelColor: "#d6d3d1" },
      },
    };

    vegaEmbed(containerRef.current, themedSpec, {
      actions: false,
      renderer: "svg",
    });

    return () => {
      // Cleanup
    };
  }, [spec]);

  return (
    <div className="glass-card p-4">
      {title && <h4 className="text-sm font-medium text-text-muted mb-3">{title}</h4>}
      <div ref={containerRef} />
    </div>
  );
}
```

#### `RechartsFromConfig`

Maps JSON config to Recharts components:

```typescript
import { colors } from "../../../styles/theme.js";

// Theme colors for consistent styling
const THEME = {
  text: { muted: colors.text.muted, secondary: colors.text.secondary },
  accent: colors.accent.DEFAULT,
  grid: "rgba(120, 113, 108, 0.2)",
  background: colors.bg.elevated,
  border: colors.border.DEFAULT,
  chartColors: [colors.accent.DEFAULT, colors.success, "#3b82f6", "#a855f7", colors.danger, "#06b6d4"],
};

// Map chartType to Recharts container component
// Falls back to ComposedChart for unknown types (most flexible)
function getChartContainer(chartType: string): React.ComponentType<any> | null {
  const containers: Record<string, React.ComponentType<any>> = {
    composed: ComposedChart,
    pie: PieChart,
    radar: RadarChart,
    radial: RadialBarChart,
    treemap: Treemap,
    funnel: FunnelChart,
    sankey: Sankey,
  };
  const container = containers[chartType];
  if (!container) {
    console.warn(`Unknown chart type: ${chartType}, falling back to ComposedChart`);
    return ComposedChart;
  }
  return container;
}

// Map axis config to Recharts props with theme
function mapAxisConfig(config: AxisConfig) {
  return {
    ...config,
    stroke: THEME.text.muted,
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    tickFormatter: config.tickFormatter === "currency"
      ? (v: number) => `$${v.toLocaleString()}`
      : config.tickFormatter === "percent"
      ? (v: number) => `${v}%`
      : undefined,
  };
}

// Apply theme colors to component props
function applyTheme(props: Record<string, unknown>, index: number) {
  return {
    ...props,
    fill: props.fill || THEME.chartColors[index % THEME.chartColors.length],
    stroke: props.stroke || THEME.chartColors[index % THEME.chartColors.length],
  };
}

function RechartsFromConfig({ config, title }: { config: RechartsConfig; title?: string }) {
  const ChartContainer = getChartContainer(config.chartType);

  return (
    <div className="glass-card p-4">
      {title && <h4 className="text-sm font-medium text-text-muted mb-3">{title}</h4>}
      <ResponsiveContainer width="100%" height={config.height || 300}>
        <ChartContainer data={config.data}>
          {config.xAxis && <XAxis {...mapAxisConfig(config.xAxis)} />}
          {config.yAxis && (Array.isArray(config.yAxis)
            ? config.yAxis.map((y, i) => <YAxis key={i} {...mapAxisConfig(y)} />)
            : <YAxis {...mapAxisConfig(config.yAxis)} />
          )}
          {config.tooltip && (
            <Tooltip
              contentStyle={{
                background: THEME.background,
                border: `1px solid ${THEME.border}`,
                borderRadius: "12px",
              }}
            />
          )}
          {config.legend && <Legend />}
          {config.brush && <Brush {...config.brush} fill={THEME.grid} />}
          {config.components.map((comp, i) => renderComponent(comp, i))}
          {config.referenceLines?.map((line, i) => <ReferenceLine key={i} {...line} />)}
        </ChartContainer>
      </ResponsiveContainer>
    </div>
  );
}

function renderComponent(comp: RechartsComponent, index: number) {
  const Component = {
    Area, Bar, Line, Scatter, Pie, Radar, Cell, Treemap, Funnel, Sankey
  }[comp.type];

  if (!Component) return null;

  const { type, ...props } = comp;
  return <Component key={index} {...applyTheme(props, index)} />;
}
```

### Example: Budget vs Success Rate Slider

Claude could output either:

**Vega-Lite (with slider):**
```json
{
  "type": "dynamic_chart",
  "title": "Budget vs Success Rate",
  "renderer": "vega-lite",
  "vegaLiteSpec": {
    "params": [{
      "name": "budget",
      "value": 100000,
      "bind": {"input": "range", "min": 60000, "max": 150000, "step": 10000}
    }],
    "data": {"values": [...]},
    "layer": [
      {"mark": "line", "encoding": {"x": {"field": "budget"}, "y": {"field": "successRate"}}},
      {"mark": "point", "encoding": {
        "x": {"field": "budget"},
        "y": {"field": "successRate"},
        "color": {"condition": {"test": "datum.budget == budget", "value": "green"}, "value": "gray"}
      }}
    ]
  }
}
```

**Recharts (with brush):**
```json
{
  "type": "dynamic_chart",
  "title": "Budget vs Success Rate",
  "renderer": "recharts",
  "rechartsConfig": {
    "chartType": "composed",
    "data": [...],
    "components": [
      {"type": "Area", "dataKey": "successRate", "fill": "#fbbf24", "stroke": "#fbbf24"}
    ],
    "xAxis": {"dataKey": "budget", "tickFormatter": "currency"},
    "yAxis": {"domain": [0, 100]},
    "tooltip": true,
    "brush": {"dataKey": "budget", "height": 30}
  }
}
```

## Type Definitions

Add to `packages/web/src/lib/types.ts`:

```typescript
// Section Card Block
export type SectionCardBlock = {
  type: "section_card";
  label: string;
  content: string;
  variant?: "default" | "highlight" | "warning";
};

// Collapsible Details Block
export type CollapsibleDetailsBlock = {
  type: "collapsible_details";
  summary: string;
  content: string;
  defaultOpen?: boolean;
};

// Dynamic Chart Block
export type DynamicChartBlock = {
  type: "dynamic_chart";
  title?: string;
  renderer: "recharts" | "vega-lite";
  rechartsConfig?: RechartsConfig;
  vegaLiteSpec?: VegaLiteSpec;
};

// Recharts Config Types
export type RechartsConfig = {
  chartType: "composed" | "pie" | "radar" | "radial" | "treemap" | "funnel" | "sankey";
  width?: number | "responsive";
  height?: number;
  data: Record<string, unknown>[];
  components: RechartsComponent[];
  xAxis?: AxisConfig;
  yAxis?: AxisConfig | AxisConfig[];
  tooltip?: boolean | TooltipConfig;
  legend?: boolean | LegendConfig;
  brush?: BrushConfig;
  referenceLines?: ReferenceLineConfig[];
};

export type RechartsComponent = {
  type: "Area" | "Bar" | "Line" | "Scatter" | "Pie" | "Radar" | "Cell" | "Treemap" | "Funnel" | "Sankey";
  dataKey: string;
  fill?: string;
  stroke?: string;
  stackId?: string;
  yAxisId?: string;
  nameKey?: string;  // For Treemap/Sankey
};

export type AxisConfig = {
  dataKey?: string;
  type?: "number" | "category";
  domain?: [number | "auto", number | "auto"];
  tickFormatter?: "currency" | "percent" | "number";
  orientation?: "left" | "right" | "top" | "bottom";
  yAxisId?: string;
};

export type TooltipConfig = {
  formatter?: "currency" | "percent" | "number";
};

export type LegendConfig = {
  position?: "top" | "bottom" | "left" | "right";
};

export type BrushConfig = {
  dataKey: string;
  height?: number;
  startIndex?: number;
  endIndex?: number;
};

export type ReferenceLineConfig = {
  x?: number | string;
  y?: number | string;
  stroke?: string;
  strokeDasharray?: string;
  label?: string;
};

// Vega-Lite types - minimum required fields for validation
// For full type safety, install: pnpm add -D vega-lite (includes types)
export type VegaLiteSpec = {
  $schema?: string;
  data: { values: unknown[] };  // Only inline data allowed (no URLs for security)
  mark: string | { type: string };
  encoding?: Record<string, unknown>;
  params?: Array<{ name: string; value?: unknown; bind?: unknown }>;
  layer?: VegaLiteSpec[];
  hconcat?: VegaLiteSpec[];
  vconcat?: VegaLiteSpec[];
  config?: Record<string, unknown>;
  [key: string]: unknown;  // Allow additional Vega-Lite properties
};

// Update UIBlock union
export type UIBlock =
  | StatBlock
  | ChartBlock
  | TableBlock
  | TextBlock
  | ProjectionBlock
  | ActionBlock
  | MonteCarloChartBlock
  | BacktestTableBlock
  | SliderControlBlock
  | ScenarioComparisonBlock
  | SequenceRiskChartBlock
  | IncomeBreakdownBlock
  | AccountSummaryBlock
  | FireCalculatorBlock
  | FailureAnalysisBlock
  | ImprovementActionsBlock
  | SectionCardBlock        // NEW
  | CollapsibleDetailsBlock // NEW
  | DynamicChartBlock;      // NEW
```

## Dependencies

Add to `packages/web/package.json`:

```json
{
  "dependencies": {
    "vega": "^5.25.0",
    "vega-lite": "^5.16.0",
    "vega-embed": "^6.24.0"
  }
}
```

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `packages/web/src/lib/types.ts` | Modify | Add new block types |
| `packages/web/src/pages/plans/[id].tsx` | Modify | Add animation state and transition logic |
| `packages/web/src/components/ui-renderer/ui-renderer.tsx` | Modify | Register new block renderers |
| `packages/web/src/components/ui-renderer/blocks/section-card.tsx` | Create | Section card component |
| `packages/web/src/components/ui-renderer/blocks/collapsible-details.tsx` | Create | Collapsible details component |
| `packages/web/src/components/ui-renderer/blocks/dynamic-chart.tsx` | Create | Dynamic chart renderer |
| `packages/web/src/components/charts/vega-lite-chart.tsx` | Create | Vega-Lite wrapper |
| `packages/web/src/components/charts/recharts-from-config.tsx` | Create | Recharts config mapper |
| `packages/web/src/components/plan/prompt-transition.tsx` | Create | Animation component |
| `packages/web/package.json` | Modify | Add vega dependencies |
| `packages/api/src/agent/agent.ts` | Modify | Update `systemPrompt` constant with new block type guidance |

## Error Handling

When chart configuration is invalid or rendering fails, display a `ChartError` component.

**File:** `packages/web/src/components/charts/chart-error.tsx`

```typescript
function ChartError({ message, data }: { message: string; data?: unknown[] }) {
  return (
    <div className="glass-card p-4 border-warning/30">
      <div className="text-warning text-sm mb-2">Chart Error: {message}</div>
      {data && data.length > 0 && (
        <details className="text-xs text-text-muted">
          <summary className="cursor-pointer">View raw data</summary>
          <pre className="mt-2 p-2 bg-surface rounded overflow-auto max-h-48">
            {JSON.stringify(data.slice(0, 5), null, 2)}
            {data.length > 5 && `\n... and ${data.length - 5} more rows`}
          </pre>
        </details>
      )}
    </div>
  );
}
```

## Testing Considerations

1. **Animation testing**: Verify transitions work across browsers, test with reduced motion preference
2. **Chart rendering**: Test both renderers with various configurations
3. **Error handling**: Verify ChartError fallback displays correctly with invalid configs
4. **Performance**: Vega-Lite specs can be large; use React.lazy() for VegaLiteChart component
5. **Accessibility**: Ensure charts have appropriate ARIA labels, keyboard navigation for interactive elements
