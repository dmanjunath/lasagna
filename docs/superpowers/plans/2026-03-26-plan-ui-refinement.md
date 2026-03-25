# Plan UI Refinement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the plan UI with animated prompt transitions, better text formatting via section cards, and config-driven dynamic charts (Recharts + Vega-Lite).

**Architecture:** Three interconnected improvements share a foundation in `types.ts` and `UIRenderer`. The prompt transition modifies `PlanDetailPage` state management. Text formatting adds two new block types. Dynamic charts add a third block type with two renderer implementations.

**Tech Stack:** React 19, TypeScript, Framer Motion (existing), Recharts (existing), Vega-Lite (new dependency)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/web/src/lib/types.ts` | Type definitions for all new blocks |
| `packages/web/src/components/plan/prompt-transition.tsx` | Animation wrapper for starter prompts |
| `packages/web/src/components/ui-renderer/blocks/section-card.tsx` | Section card block renderer |
| `packages/web/src/components/ui-renderer/blocks/collapsible-details.tsx` | Collapsible details block renderer |
| `packages/web/src/components/ui-renderer/blocks/dynamic-chart.tsx` | Dynamic chart dispatcher |
| `packages/web/src/components/charts/recharts-from-config.tsx` | JSON config to Recharts components |
| `packages/web/src/components/charts/vega-lite-chart.tsx` | Vega-Lite embed wrapper |
| `packages/web/src/components/charts/chart-error.tsx` | Error fallback for invalid charts |
| `packages/web/src/components/ui-renderer/blocks/index.ts` | Export new block renderers |
| `packages/web/src/components/ui-renderer/ui-renderer.tsx` | Register new blocks in switch |
| `packages/web/src/pages/plans/[id].tsx` | New transition state + animation logic |
| `packages/api/src/agent/agent.ts` | LLM prompt updates for new block types |

---

## Task 1: Add Vega-Lite Dependencies

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Add vega dependencies**

```bash
cd packages/web && pnpm add vega@^5.25.0 vega-lite@^5.16.0 vega-embed@^6.24.0
```

- [ ] **Step 2: Verify installation**

Run: `cd packages/web && pnpm list vega vega-lite vega-embed`
Expected: All three packages listed with versions

- [ ] **Step 3: Commit**

```bash
git add packages/web/package.json packages/web/pnpm-lock.yaml
git commit -m "chore(web): add vega-lite dependencies for dynamic charts"
```

---

## Task 2: Add Type Definitions

**Files:**
- Modify: `packages/web/src/lib/types.ts:208-229`

- [ ] **Step 1: Add SectionCardBlock type**

In `packages/web/src/lib/types.ts`, add after `ImprovementActionsBlock` type (line ~206):

```typescript
// ── Text Formatting Blocks ────────────────────────────────────────────────

export type SectionCardBlock = {
  type: "section_card";
  label: string;
  content: string;
  variant?: "default" | "highlight" | "warning";
};

export type CollapsibleDetailsBlock = {
  type: "collapsible_details";
  summary: string;
  content: string;
  defaultOpen?: boolean;
};
```

- [ ] **Step 2: Add DynamicChartBlock and supporting types**

Continue adding after `CollapsibleDetailsBlock`:

```typescript
// ── Dynamic Chart Blocks ──────────────────────────────────────────────────

export type RechartsComponent = {
  type: "Area" | "Bar" | "Line" | "Scatter" | "Pie" | "Radar" | "Cell" | "Treemap" | "Funnel" | "Sankey";
  dataKey: string;
  fill?: string;
  stroke?: string;
  stackId?: string;
  yAxisId?: string;
  nameKey?: string;
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

export type VegaLiteSpec = {
  $schema?: string;
  data: { values: unknown[] };
  mark: string | { type: string };
  encoding?: Record<string, unknown>;
  params?: Array<{ name: string; value?: unknown; bind?: unknown }>;
  layer?: VegaLiteSpec[];
  hconcat?: VegaLiteSpec[];
  vconcat?: VegaLiteSpec[];
  config?: Record<string, unknown>;
  [key: string]: unknown;
};

export type DynamicChartBlock = {
  type: "dynamic_chart";
  title?: string;
  renderer: "recharts" | "vega-lite";
  rechartsConfig?: RechartsConfig;
  vegaLiteSpec?: VegaLiteSpec;
};
```

- [ ] **Step 3: Update UIBlock union**

Replace the existing `UIBlock` union (lines ~208-224) with:

```typescript
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
  | SectionCardBlock
  | CollapsibleDetailsBlock
  | DynamicChartBlock;
```

- [ ] **Step 4: Run typecheck to verify**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/types.ts
git commit -m "feat(types): add SectionCard, CollapsibleDetails, DynamicChart block types"
```

---

## Task 3: Create ChartError Component

**Files:**
- Create: `packages/web/src/components/charts/chart-error.tsx`

- [ ] **Step 1: Create the error fallback component**

Create `packages/web/src/components/charts/chart-error.tsx`:

```typescript
interface ChartErrorProps {
  message: string;
  data?: unknown[];
}

export function ChartError({ message, data }: ChartErrorProps) {
  return (
    <div className="glass-card p-4 border border-warning/30">
      <div className="text-warning text-sm mb-2">Chart Error: {message}</div>
      {data && data.length > 0 && (
        <details className="text-xs text-text-muted">
          <summary className="cursor-pointer hover:text-text-secondary">
            View raw data ({data.length} rows)
          </summary>
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

- [ ] **Step 2: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/charts/chart-error.tsx
git commit -m "feat(charts): add ChartError fallback component"
```

---

## Task 4: Create VegaLiteChart Component

**Files:**
- Create: `packages/web/src/components/charts/vega-lite-chart.tsx`

- [ ] **Step 1: Create the Vega-Lite wrapper**

Create `packages/web/src/components/charts/vega-lite-chart.tsx`:

```typescript
import { useEffect, useRef } from "react";
import embed from "vega-embed";
import type { VegaLiteSpec } from "../../lib/types.js";
import { colors } from "../../styles/theme.js";
import { ChartError } from "./chart-error.js";

interface VegaLiteChartProps {
  spec: VegaLiteSpec;
  title?: string;
}

export function VegaLiteChart({ spec, title }: VegaLiteChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Apply theme to spec
    const themedSpec = {
      ...spec,
      background: "transparent",
      config: {
        ...spec.config,
        axis: {
          labelColor: colors.text.muted,
          titleColor: colors.text.secondary,
          gridColor: colors.border.DEFAULT,
          domainColor: colors.border.DEFAULT,
        },
        legend: {
          labelColor: colors.text.secondary,
          titleColor: colors.text.secondary,
        },
        title: {
          color: colors.text.DEFAULT,
        },
        view: {
          stroke: "transparent",
        },
        range: {
          category: [colors.accent.DEFAULT, colors.success, "#3b82f6", "#a855f7", colors.danger, "#06b6d4"],
        },
      },
    };

    let cleanup: (() => void) | undefined;

    embed(containerRef.current, themedSpec, {
      actions: false,
      renderer: "svg",
    }).then((result) => {
      cleanup = () => result.finalize();
    }).catch((err) => {
      console.error("Vega-Lite render error:", err);
    });

    return () => {
      cleanup?.();
    };
  }, [spec]);

  // Validate spec has required data
  if (!spec.data?.values || !Array.isArray(spec.data.values)) {
    return <ChartError message="Invalid Vega-Lite spec: missing data.values array" />;
  }

  return (
    <div className="glass-card p-4">
      {title && (
        <h4 className="text-sm font-medium text-text-muted mb-3">{title}</h4>
      )}
      <div ref={containerRef} className="min-h-[200px]" />
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/charts/vega-lite-chart.tsx
git commit -m "feat(charts): add VegaLiteChart wrapper component"
```

---

## Task 5: Create RechartsFromConfig Component

**Files:**
- Create: `packages/web/src/components/charts/recharts-from-config.tsx`

- [ ] **Step 1: Create the Recharts config mapper**

Create `packages/web/src/components/charts/recharts-from-config.tsx`:

```typescript
import {
  ResponsiveContainer,
  ComposedChart,
  PieChart,
  RadarChart,
  RadialBarChart,
  Treemap,
  FunnelChart,
  Sankey,
  Area,
  Bar,
  Line,
  Scatter,
  Pie,
  Radar,
  Cell,
  Funnel,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Brush,
  ReferenceLine,
} from "recharts";
import { colors } from "../../styles/theme.js";
import type { RechartsConfig, RechartsComponent, AxisConfig } from "../../lib/types.js";
import { ChartError } from "./chart-error.js";

const CHART_COLORS = [
  colors.accent.DEFAULT,
  colors.success,
  "#3b82f6",
  "#a855f7",
  colors.danger,
  "#06b6d4",
];

// Map chartType to container component
function getChartContainer(chartType: string): React.ComponentType<any> {
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

// Map tick formatter string to function
function getTickFormatter(formatter?: string) {
  if (formatter === "currency") {
    return (v: number) => `$${v.toLocaleString()}`;
  }
  if (formatter === "percent") {
    return (v: number) => `${v}%`;
  }
  return undefined;
}

// Map axis config to Recharts props
function mapAxisConfig(config: AxisConfig) {
  return {
    ...config,
    stroke: colors.text.muted,
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    tickFormatter: getTickFormatter(config.tickFormatter),
  };
}

// Render a single chart component with theme colors
function renderComponent(comp: RechartsComponent, index: number) {
  const componentMap: Record<string, React.ComponentType<any>> = {
    Area,
    Bar,
    Line,
    Scatter,
    Pie,
    Radar,
    Cell,
    Funnel,
  };

  const Component = componentMap[comp.type];
  if (!Component) {
    console.warn(`Unknown component type: ${comp.type}`);
    return null;
  }

  const { type, ...props } = comp;
  const themedProps = {
    ...props,
    fill: props.fill || CHART_COLORS[index % CHART_COLORS.length],
    stroke: props.stroke || CHART_COLORS[index % CHART_COLORS.length],
  };

  return <Component key={`${type}-${index}`} {...themedProps} />;
}

interface RechartsFromConfigProps {
  config: RechartsConfig;
  title?: string;
}

export function RechartsFromConfig({ config, title }: RechartsFromConfigProps) {
  // Validate config
  if (!config.data || !Array.isArray(config.data) || config.data.length === 0) {
    return <ChartError message="Invalid Recharts config: missing or empty data array" />;
  }

  if (!config.components || config.components.length === 0) {
    return <ChartError message="Invalid Recharts config: no components defined" data={config.data} />;
  }

  const ChartContainer = getChartContainer(config.chartType);
  const height = config.height || 300;

  return (
    <div className="glass-card p-4">
      {title && (
        <h4 className="text-sm font-medium text-text-muted mb-3">{title}</h4>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ChartContainer data={config.data}>
          {/* Axes */}
          {config.xAxis && <XAxis {...mapAxisConfig(config.xAxis)} />}
          {config.yAxis && (
            Array.isArray(config.yAxis)
              ? config.yAxis.map((y, i) => <YAxis key={i} {...mapAxisConfig(y)} />)
              : <YAxis {...mapAxisConfig(config.yAxis)} />
          )}

          {/* Tooltip */}
          {config.tooltip && (
            <Tooltip
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
              }}
              labelStyle={{ color: colors.text.secondary }}
              itemStyle={{ color: colors.text.DEFAULT }}
            />
          )}

          {/* Legend */}
          {config.legend && <Legend />}

          {/* Brush for selection */}
          {config.brush && (
            <Brush
              dataKey={config.brush.dataKey}
              height={config.brush.height || 30}
              fill={colors.surface.DEFAULT}
              stroke={colors.border.DEFAULT}
            />
          )}

          {/* Chart components */}
          {config.components.map((comp, i) => renderComponent(comp, i))}

          {/* Reference lines */}
          {config.referenceLines?.map((line, i) => (
            <ReferenceLine
              key={i}
              {...line}
              stroke={line.stroke || colors.text.muted}
            />
          ))}
        </ChartContainer>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/charts/recharts-from-config.tsx
git commit -m "feat(charts): add RechartsFromConfig mapper component"
```

---

## Task 6: Create DynamicChartRenderer Block

**Files:**
- Create: `packages/web/src/components/ui-renderer/blocks/dynamic-chart.tsx`

- [ ] **Step 1: Create the dynamic chart block renderer**

Create `packages/web/src/components/ui-renderer/blocks/dynamic-chart.tsx`:

```typescript
import { lazy, Suspense } from "react";
import type { DynamicChartBlock } from "../../../lib/types.js";
import { RechartsFromConfig } from "../../charts/recharts-from-config.js";
import { ChartError } from "../../charts/chart-error.js";

// Lazy load Vega-Lite to reduce initial bundle size
const VegaLiteChart = lazy(() =>
  import("../../charts/vega-lite-chart.js").then((m) => ({ default: m.VegaLiteChart }))
);

function ChartLoadingFallback() {
  return (
    <div className="glass-card p-4 min-h-[200px] flex items-center justify-center">
      <div className="text-text-muted text-sm">Loading chart...</div>
    </div>
  );
}

export function DynamicChartRenderer({ block }: { block: DynamicChartBlock }) {
  if (block.renderer === "vega-lite") {
    if (!block.vegaLiteSpec) {
      return <ChartError message="Vega-Lite renderer selected but no spec provided" />;
    }
    return (
      <Suspense fallback={<ChartLoadingFallback />}>
        <VegaLiteChart spec={block.vegaLiteSpec} title={block.title} />
      </Suspense>
    );
  }

  if (block.renderer === "recharts") {
    if (!block.rechartsConfig) {
      return <ChartError message="Recharts renderer selected but no config provided" />;
    }
    return <RechartsFromConfig config={block.rechartsConfig} title={block.title} />;
  }

  return <ChartError message={`Unknown renderer: ${block.renderer}`} />;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ui-renderer/blocks/dynamic-chart.tsx
git commit -m "feat(ui-renderer): add DynamicChartRenderer block"
```

---

## Task 7: Create SectionCard Block

**Files:**
- Create: `packages/web/src/components/ui-renderer/blocks/section-card.tsx`

- [ ] **Step 1: Create the section card block renderer**

Create `packages/web/src/components/ui-renderer/blocks/section-card.tsx`:

```typescript
import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { SectionCardBlock } from "../../../lib/types.js";

const variantStyles = {
  default: {
    border: "border-border",
    bg: "",
    label: "text-text-muted",
  },
  highlight: {
    border: "border-accent/30",
    bg: "bg-accent/5",
    label: "text-accent",
  },
  warning: {
    border: "border-warning/30",
    bg: "bg-warning/5",
    label: "text-warning",
  },
} as const;

export function SectionCardRenderer({ block }: { block: SectionCardBlock }) {
  const variant = block.variant || "default";
  const styles = variantStyles[variant];

  return (
    <div className={cn("glass-card overflow-hidden", styles.bg, "border", styles.border)}>
      {/* Label header */}
      <div className={cn(
        "px-4 py-2 border-b",
        styles.border,
        variant === "default" ? "bg-surface/50" : ""
      )}>
        <span className={cn("text-xs font-medium uppercase tracking-wide", styles.label)}>
          {block.label}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown>{block.content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ui-renderer/blocks/section-card.tsx
git commit -m "feat(ui-renderer): add SectionCardRenderer block"
```

---

## Task 8: Create CollapsibleDetails Block

**Files:**
- Create: `packages/web/src/components/ui-renderer/blocks/collapsible-details.tsx`

- [ ] **Step 1: Create the collapsible details block renderer**

Create `packages/web/src/components/ui-renderer/blocks/collapsible-details.tsx`:

```typescript
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "../../../lib/utils.js";
import type { CollapsibleDetailsBlock } from "../../../lib/types.js";

export function CollapsibleDetailsRenderer({ block }: { block: CollapsibleDetailsBlock }) {
  const [isOpen, setIsOpen] = useState(block.defaultOpen ?? false);

  return (
    <div className="glass-card overflow-hidden">
      {/* Summary (always visible) */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full px-4 py-3 flex items-center gap-2 text-left",
          "hover:bg-surface/50 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-accent/30 focus:ring-inset"
        )}
      >
        <motion.div
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-4 h-4 text-text-muted" />
        </motion.div>
        <span className="text-text-secondary font-medium">{block.summary}</span>
      </button>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 border-t border-border">
              <div className="pt-3 prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{block.content}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ui-renderer/blocks/collapsible-details.tsx
git commit -m "feat(ui-renderer): add CollapsibleDetailsRenderer block"
```

---

## Task 9: Update Blocks Index

**Files:**
- Modify: `packages/web/src/components/ui-renderer/blocks/index.ts`

- [ ] **Step 1: Export new block renderers**

Add to the end of `packages/web/src/components/ui-renderer/blocks/index.ts`:

```typescript
// Text formatting blocks
export { SectionCardRenderer } from "./section-card.js";
export { CollapsibleDetailsRenderer } from "./collapsible-details.js";

// Dynamic charts
export { DynamicChartRenderer } from "./dynamic-chart.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ui-renderer/blocks/index.ts
git commit -m "feat(ui-renderer): export new block renderers"
```

---

## Task 10: Update UIRenderer Switch

**Files:**
- Modify: `packages/web/src/components/ui-renderer/ui-renderer.tsx:1-19`

- [ ] **Step 1: Import new renderers**

Update the imports in `packages/web/src/components/ui-renderer/ui-renderer.tsx`:

```typescript
import { cn } from "../../lib/utils.js";
import type { UIPayload, UIBlock } from "../../lib/types.js";
import {
  StatBlockRenderer,
  ChartBlockRenderer,
  TableBlockRenderer,
  TextBlockRenderer,
  MonteCarloChartRenderer,
  BacktestTableRenderer,
  SliderControlRenderer,
  ScenarioComparisonRenderer,
  SequenceRiskChartRenderer,
  IncomeBreakdownRenderer,
  AccountSummaryRenderer,
  FireCalculatorRenderer,
  FailureAnalysisRenderer,
  ImprovementActionsRenderer,
  SectionCardRenderer,
  CollapsibleDetailsRenderer,
  DynamicChartRenderer,
} from "./blocks/index.js";
```

- [ ] **Step 2: Add cases to BlockRenderer switch**

In the `BlockRenderer` function, add cases before `default:`:

```typescript
    case "section_card":
      return <SectionCardRenderer block={block} />;
    case "collapsible_details":
      return <CollapsibleDetailsRenderer block={block} />;
    case "dynamic_chart":
      return <DynamicChartRenderer block={block} />;
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/ui-renderer/ui-renderer.tsx
git commit -m "feat(ui-renderer): register new block types in switch"
```

---

## Task 11: Create PromptTransition Component

**Files:**
- Create: `packages/web/src/components/plan/prompt-transition.tsx`

- [ ] **Step 1: Create the prompt transition component**

Create `packages/web/src/components/plan/prompt-transition.tsx`:

```typescript
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { StarterPrompts } from "../chat/index.js";
import { UIRenderer } from "../ui-renderer/index.js";
import type { PlanType, UIPayload } from "../../lib/types.js";

export type TransitionState = "idle" | "animating" | "loading" | "complete";

interface PromptTransitionProps {
  planType: PlanType;
  transitionState: TransitionState;
  submittedPrompt: string | null;
  planContent: UIPayload | null;
  onSelectPrompt: (prompt: string) => void;
}

export function PromptTransition({
  planType,
  transitionState,
  submittedPrompt,
  planContent,
  onSelectPrompt,
}: PromptTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      {/* State 1: Idle - show starter prompts */}
      {transitionState === "idle" && (
        <motion.div
          key="starter-prompts"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="glass-card p-8"
        >
          <StarterPrompts planType={planType} onSelectPrompt={onSelectPrompt} />
        </motion.div>
      )}

      {/* State 2: Animating - prompt flying to sidebar */}
      {transitionState === "animating" && submittedPrompt && (
        <motion.div
          key="animating"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="glass-card p-8 flex items-center justify-center"
        >
          {/* Visual feedback during transition */}
          <motion.div
            layoutId="prompt-bubble"
            className="bg-accent/20 text-accent px-4 py-2 rounded-xl text-sm max-w-md truncate"
          >
            {submittedPrompt}
          </motion.div>
        </motion.div>
      )}

      {/* State 3: Loading - show spinner */}
      {transitionState === "loading" && (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="glass-card p-12 flex flex-col items-center justify-center gap-4"
        >
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <p className="text-text-muted">Generating your plan...</p>
        </motion.div>
      )}

      {/* State 4: Complete - show plan content */}
      {transitionState === "complete" && planContent && (
        <motion.div
          key="complete"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <UIRenderer payload={planContent} />
        </motion.div>
      )}

      {/* Fallback: no content yet in complete state */}
      {transitionState === "complete" && !planContent && (
        <motion.div
          key="empty"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass-card p-8 text-center text-text-muted"
        >
          No content generated yet.
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/plan/prompt-transition.tsx
git commit -m "feat(plan): add PromptTransition animation component"
```

---

## Task 12: Update PlanDetailPage

**Files:**
- Modify: `packages/web/src/pages/plans/[id].tsx`

- [ ] **Step 1: Update imports**

Replace the imports at the top of `packages/web/src/pages/plans/[id].tsx`:

```typescript
import { useEffect, useState, useCallback } from "react";
import { useParams } from "wouter";
import { History, MoreVertical, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../lib/api.js";
import { ChatPanel } from "../../components/chat/index.js";
import { Button } from "../../components/ui/button.js";
import { PromptTransition, type TransitionState } from "../../components/plan/prompt-transition.js";
import type { Plan, ChatThread, Message } from "../../lib/types.js";
```

- [ ] **Step 2: Replace state management**

Replace the state declarations (lines ~13-21) with:

```typescript
export function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // New: unified transition state
  const [transitionState, setTransitionState] = useState<TransitionState>("idle");
  const [submittedPrompt, setSubmittedPrompt] = useState<string | null>(null);

  // Backward-compatible derived state
  const initialMessage = transitionState === "animating" || transitionState === "loading" ? submittedPrompt : null;

  // Show sidebar when not idle (has activity)
  const showSidebar = transitionState !== "idle" || messages.length > 0;
```

- [ ] **Step 3: Replace handleSelectPrompt**

Replace the `handleSelectPrompt` function:

```typescript
  const handleSelectPrompt = async (prompt: string) => {
    setSubmittedPrompt(prompt);
    setTransitionState("animating");

    // Create thread if needed
    if (!thread && id) {
      const { thread: newThread } = await api.createThread(id);
      setThread(newThread);
    }

    // Wait for animation, then transition to loading
    setTimeout(() => {
      setTransitionState("loading");
    }, 300);
  };
```

- [ ] **Step 4: Update handleChatResponse**

Replace the `handleChatResponse` callback:

```typescript
  // Callback when chat response finishes streaming
  const handleChatResponse = useCallback(async () => {
    if (!id) return;
    try {
      const updatedPlan = await api.getPlan(id);
      setPlan(updatedPlan);
      // Only transition to complete after plan is ready
      setTransitionState("complete");
    } catch (err) {
      console.error("Failed to fetch updated plan:", err);
      setTransitionState("complete");
    }
  }, [id]);
```

- [ ] **Step 5: Update useEffect for state reset**

Update the useEffect to reset the new state:

```typescript
  useEffect(() => {
    if (!id) return;

    // Reset all state when plan changes
    setLoading(true);
    setPlan(null);
    setThread(null);
    setMessages([]);
    setTransitionState("idle");
    setSubmittedPrompt(null);

    const loadPlan = async () => {
      const [planData, { threads }] = await Promise.all([
        api.getPlan(id),
        api.getThreads(id),
      ]);

      setPlan(planData);

      if (threads.length > 0) {
        setThread(threads[0]);
        const { messages: threadMessages } = await api.getThread(threads[0].id);
        setMessages(threadMessages);
        // If there are existing messages, start in complete state
        if (threadMessages.length > 0) {
          setTransitionState("complete");
        }
      }

      setLoading(false);
    };

    loadPlan();
  }, [id]);
```

- [ ] **Step 6: Update render section**

Replace the plan content section (lines ~119-144) with:

```typescript
          {/* Plan content with transitions */}
          {plan.content ? (
            <PromptTransition
              planType={plan.type}
              transitionState="complete"
              submittedPrompt={null}
              planContent={plan.content}
              onSelectPrompt={handleSelectPrompt}
            />
          ) : (
            <PromptTransition
              planType={plan.type}
              transitionState={transitionState}
              submittedPrompt={submittedPrompt}
              planContent={null}
              onSelectPrompt={handleSelectPrompt}
            />
          )}
```

- [ ] **Step 7: Update sidebar visibility condition**

Change the sidebar AnimatePresence condition to use `showSidebar`:

```typescript
      {/* Chat panel - show when there's activity */}
      <AnimatePresence>
        {showSidebar && thread && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="border-l border-border overflow-hidden h-full flex-shrink-0"
          >
            <ChatPanel
              threadId={thread.id}
              initialMessages={messages}
              initialMessage={initialMessage}
              onMessageSent={() => setSubmittedPrompt(null)}
              onChatResponse={handleChatResponse}
            />
          </motion.div>
        )}
      </AnimatePresence>
```

- [ ] **Step 8: Run typecheck**

Run: `cd packages/web && pnpm typecheck`
Expected: No type errors

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/pages/plans/[id].tsx
git commit -m "feat(plan): add animated prompt transition state machine"
```

---

## Task 13: Update LLM System Prompt

**Files:**
- Modify: `packages/api/src/agent/agent.ts:50-57`

This task updates the LLM prompts to encourage use of new block types. Required before manual testing.

- [ ] **Step 1: Add new block types to Available UI Block Types section**

In `packages/api/src/agent/agent.ts`, find the "Available UI Block Types" section (lines 50-57) and replace it with:

```typescript
## Available UI Block Types

- stat: { type: "stat", label: string, value: string, description?: string }
- text: { type: "text", content: string (supports markdown) }
- chart: { type: "chart", chartType: "area"|"bar"|"donut", title?: string, data: [{label, value}] }
- table: { type: "table", title?: string, columns: [{key, label}], rows: [{...}] }
- projection: { type: "projection", title?: string, scenarios: [{name, value?, description?}] }
- action: { type: "action", title: string, description?: string, actions: string[] }
- section_card: { type: "section_card", label: string, content: string (markdown), variant?: "default"|"highlight"|"warning" }
- collapsible_details: { type: "collapsible_details", summary: string, content: string (markdown), defaultOpen?: boolean }
- dynamic_chart: { type: "dynamic_chart", title?: string, renderer: "recharts"|"vega-lite", rechartsConfig?: {...}, vegaLiteSpec?: {...} }

### Dynamic Chart - Recharts Config
Use renderer: "recharts" for standard charts (bar, line, area, pie, radar).
{
  "type": "dynamic_chart",
  "renderer": "recharts",
  "rechartsConfig": {
    "chartType": "composed",
    "data": [{"month": "Jan", "value": 100}],
    "components": [{"type": "Bar", "dataKey": "value"}],
    "xAxis": {"dataKey": "month"},
    "tooltip": true
  }
}

### Dynamic Chart - Vega-Lite Config
Use renderer: "vega-lite" for interactive charts with sliders, filters, or unusual types.
{
  "type": "dynamic_chart",
  "renderer": "vega-lite",
  "vegaLiteSpec": {
    "data": {"values": [{"x": 1, "y": 10}]},
    "mark": "point",
    "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "y", "type": "quantitative"}}
  }
}
```

- [ ] **Step 2: Add guidelines section before Planning Topics**

Find the line `## Planning Topics` (line 78) and insert this BEFORE it:

```typescript
## Block Usage Guidelines

PREFER structured blocks over prose text:
- Use section_card for explanatory text (max 2-3 per response)
- Use collapsible_details for detailed explanations users may want to skip
- Use dynamic_chart with interactivity when it helps users explore tradeoffs
- Use stat blocks for key metrics instead of embedding numbers in text

AVOID:
- Long prose paragraphs without visual hierarchy
- Multiple consecutive text blocks
- Walls of numbers without charts

```

- [ ] **Step 3: Run typecheck to verify no syntax errors**

Run: `cd packages/api && pnpm typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/agent/agent.ts
git commit -m "feat(agent): update system prompt with new block type guidance"
```

---

## Task 14: Manual Testing

**Testing approach:** Create a new plan and use the chat to generate content. With the updated system prompt (Task 13), the LLM will use the new block types. For direct block testing, you can also manually update a plan's content via the database.

- [ ] **Step 1: Start the development server**

```bash
pnpm dev
```

- [ ] **Step 2: Test prompt transition animation**

1. Navigate to `/plans/new` and create a new plan
2. On the plan detail page, click a starter prompt
3. Verify: Sidebar slides in from right with spring animation
4. Verify: Loading spinner shows in main content area
5. Verify: Plan content appears when generation completes
6. Verify: Chat sidebar stays open for follow-up

- [ ] **Step 3: Test LLM-generated content with new blocks**

1. Create a new retirement plan
2. Send a prompt like "Analyze my retirement readiness, show me different spending scenarios with explanations"
3. Verify the LLM uses some combination of:
   - section_card blocks for explanatory text
   - collapsible_details for detailed explanations
   - dynamic_chart for interactive visualizations

- [ ] **Step 4: Test collapsible details interaction**

1. If a collapsible_details block was generated, verify:
   - Collapsed state shows summary with chevron icon
   - Click expands with smooth animation
   - Click again collapses
   - Content renders markdown correctly

- [ ] **Step 5: Test direct block rendering (optional - for debugging)**

If you need to test specific block configurations directly, you can update a plan's content via the API or database:

```bash
# Using curl to update a plan's content directly (replace PLAN_ID)
curl -X PATCH http://localhost:3000/api/plans/PLAN_ID \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "layout": "single",
      "blocks": [
        {
          "type": "dynamic_chart",
          "title": "Test Recharts",
          "renderer": "recharts",
          "rechartsConfig": {
            "chartType": "composed",
            "data": [{"month": "Jan", "value": 100}, {"month": "Feb", "value": 200}],
            "components": [{"type": "Bar", "dataKey": "value"}],
            "xAxis": {"dataKey": "month"},
            "tooltip": true
          }
        },
        {
          "type": "dynamic_chart",
          "title": "Test Vega-Lite",
          "renderer": "vega-lite",
          "vegaLiteSpec": {
            "data": {"values": [{"x": 1, "y": 10}, {"x": 2, "y": 20}, {"x": 3, "y": 15}]},
            "mark": "point",
            "encoding": {
              "x": {"field": "x", "type": "quantitative"},
              "y": {"field": "y", "type": "quantitative"}
            }
          }
        },
        {
          "type": "section_card",
          "label": "Test Section",
          "content": "This is **markdown** content in a section card.",
          "variant": "highlight"
        },
        {
          "type": "collapsible_details",
          "summary": "Click to see details",
          "content": "This is the hidden content with **markdown** support."
        }
      ]
    }
  }'
```

- [ ] **Step 6: Test error handling**

Test with intentionally invalid configs:

```bash
# Test ChartError fallback - missing data
curl -X PATCH http://localhost:3000/api/plans/PLAN_ID \
  -H "Content-Type: application/json" \
  -d '{
    "content": {
      "layout": "single",
      "blocks": [
        {
          "type": "dynamic_chart",
          "renderer": "recharts",
          "rechartsConfig": {
            "chartType": "composed",
            "data": [],
            "components": []
          }
        }
      ]
    }
  }'
```

Verify: ChartError component displays with helpful message

- [ ] **Step 7: Test reduced motion preference**

1. Enable "Reduce motion" in system accessibility settings
2. Verify sidebar still appears (without spring animation)
3. Verify collapsible details still works (without animation)

Note: framer-motion respects `prefers-reduced-motion` by default

---

## Task 15: Final Commit

- [ ] **Step 1: Run full typecheck**

```bash
cd packages/web && pnpm typecheck
```

- [ ] **Step 2: Run build to verify no errors**

```bash
cd packages/web && pnpm build
```

- [ ] **Step 3: Create summary commit if needed**

If any fixes were made during testing:

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```
