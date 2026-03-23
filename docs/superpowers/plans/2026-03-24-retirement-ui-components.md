# Retirement UI Components Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build interactive UI components for retirement dashboards including Monte Carlo charts, backtesting tables, sliders, and prompt templates.

**Architecture:** Extend existing UIBlock system with 10 new block types. React components use Recharts for visualization, existing glass-card design system.

**Tech Stack:** React, TypeScript, Recharts, Framer Motion, TailwindCSS

**Spec:** `docs/superpowers/specs/2026-03-23-retirement-dashboards-design.md`

**Depends on:** Plan 1 (Computation Engine) must be implemented first.

**Scope Note:** This plan implements UI components only. The AI behavior and default component compositions described in Spec Section 5 (Prompt Templates) will be implemented as part of the agent integration after components are available.

**Architecture Choice:** This plan uses an embedded data approach rather than simulationId references. The AI agent calls computation tools (from Plan 1), receives results, and constructs UIBlocks with data inline. This keeps components self-contained and avoids extra fetching logic. The spec's simulationId concept is implemented at the agent level (AI tracks which simulation it ran) rather than the component level.

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `packages/web/src/components/ui-renderer/blocks/monte-carlo-chart.tsx` | Monte Carlo fan chart and histogram |
| `packages/web/src/components/ui-renderer/blocks/backtest-table.tsx` | Sortable/filterable backtesting results |
| `packages/web/src/components/ui-renderer/blocks/slider-control.tsx` | Interactive sliders with live preview |
| `packages/web/src/components/ui-renderer/blocks/scenario-comparison.tsx` | Side-by-side scenario cards |
| `packages/web/src/components/ui-renderer/blocks/sequence-risk-chart.tsx` | Good vs bad sequence visualization |
| `packages/web/src/components/ui-renderer/blocks/income-breakdown.tsx` | Retirement income sources |
| `packages/web/src/components/ui-renderer/blocks/account-summary.tsx` | Portfolio overview with allocation |
| `packages/web/src/components/ui-renderer/blocks/fire-calculator.tsx` | FIRE number progress display |
| `packages/web/src/components/ui-renderer/blocks/failure-analysis.tsx` | Historical failure pattern analysis |
| `packages/web/src/components/ui-renderer/blocks/improvement-actions.tsx` | Actionable recommendations with apply buttons |

### Modified Files
| File | Changes |
|------|---------|
| `packages/api/src/agent/types.ts` | Add 10 new block schemas |
| `packages/web/src/lib/types.ts` | Add 10 new block types |
| `packages/web/src/components/ui-renderer/blocks/index.ts` | Export new components |
| `packages/web/src/components/ui-renderer/ui-renderer.tsx` | Register new block renderers |
| `packages/web/src/components/chat/starter-prompts.tsx` | Update retirement prompts |

---

## Task 1: Add Block Schemas to API Types

**Files:**
- Modify: `packages/api/src/agent/types.ts`

- [ ] **Step 1: Add monte_carlo_chart schema**

In `packages/api/src/agent/types.ts`, before the `uiBlockSchema` definition, add:
```typescript
export const monteCarloChartSchema = z.object({
  type: z.literal("monte_carlo_chart"),
  variant: z.enum(["fan", "histogram"]),
  title: z.string().optional(),
  data: z.object({
    successRate: z.number(),
    percentiles: z.object({
      p5: z.array(z.number()),
      p25: z.array(z.number()),
      p50: z.array(z.number()),
      p75: z.array(z.number()),
      p95: z.array(z.number()),
    }).optional(),
    distribution: z.object({
      buckets: z.array(z.number()),
      counts: z.array(z.number()),
    }).optional(),
  }),
  showPaths: z.boolean().optional(),
});
```

- [ ] **Step 2: Add backtest_table schema**

```typescript
export const backtestTableSchema = z.object({
  type: z.literal("backtest_table"),
  title: z.string().optional(),
  data: z.object({
    totalPeriods: z.number(),
    successfulPeriods: z.number(),
    successRate: z.number(),
    periods: z.array(z.object({
      startYear: z.number(),
      endBalance: z.number(),
      yearsLasted: z.number(),
      status: z.enum(["success", "failed", "close"]),
      worstDrawdown: z.object({
        year: z.number(),
        percent: z.number(),
      }),
      bestYear: z.object({
        year: z.number(),
        percent: z.number(),
      }),
    })),
  }),
  defaultSort: z.enum(["startYear", "endBalance", "status"]).optional(),
  defaultFilter: z.enum(["all", "failed", "close", "success"]).optional(),
  showCount: z.number().optional(),
});
```

- [ ] **Step 3: Add slider_control schema**

```typescript
export const sliderControlSchema = z.object({
  type: z.literal("slider_control"),
  controlType: z.enum(["swr", "retirement_age", "contribution"]),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  currentValue: z.number(),
  unit: z.string().optional(),
  impactPreview: z.object({
    label: z.string(),
    values: z.array(z.object({
      value: z.number(),
      result: z.string(),
    })),
  }).optional(),
});
```

- [ ] **Step 4: Add remaining schemas**

```typescript
export const scenarioComparisonSchema = z.object({
  type: z.literal("scenario_comparison"),
  title: z.string().optional(),
  scenarios: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    successRate: z.number(),
    endBalance: z.number(),
    isRecommended: z.boolean().optional(),
  })),
});

export const sequenceRiskChartSchema = z.object({
  type: z.literal("sequence_risk_chart"),
  title: z.string().optional(),
  goodSequence: z.array(z.number()),
  badSequence: z.array(z.number()),
  labels: z.array(z.string()).optional(),
});

export const incomeBreakdownSchema = z.object({
  type: z.literal("income_breakdown"),
  title: z.string().optional(),
  sources: z.array(z.object({
    name: z.string(),
    annualAmount: z.number(),
    startAge: z.number().optional(),
  })),
  totalAnnual: z.number(),
  totalMonthly: z.number(),
});

export const accountSummarySchema = z.object({
  type: z.literal("account_summary"),
  totalBalance: z.number(),
  allocation: z.object({
    stocks: z.number(),
    bonds: z.number(),
    cash: z.number(),
  }),
  byType: z.array(z.object({
    type: z.string(),
    balance: z.number(),
    percentage: z.number(),
  })),
});

export const fireCalculatorSchema = z.object({
  type: z.literal("fire_calculator"),
  targetNumber: z.number(),
  currentBalance: z.number(),
  gap: z.number(),
  percentComplete: z.number(),
  withdrawalRate: z.number(),
  targetAge: z.number().optional(),
});

export const failureAnalysisSchema = z.object({
  type: z.literal("failure_analysis"),
  title: z.string().optional(),
  failedPeriods: z.array(z.object({
    startYear: z.number(),
    earlyReturns: z.array(z.number()),
    pattern: z.string(),
  })),
  insight: z.string(),
});

export const improvementActionsSchema = z.object({
  type: z.literal("improvement_actions"),
  title: z.string().optional(),
  actions: z.array(z.object({
    description: z.string(),
    impact: z.string(),
    tradeoff: z.string().optional(),
    actionType: z.string().optional(),
  })),
});
```

- [ ] **Step 5: Update uiBlockSchema union**

Update the `uiBlockSchema` to include new types:
```typescript
export const uiBlockSchema = z.discriminatedUnion("type", [
  statBlockSchema,
  chartBlockSchema,
  tableBlockSchema,
  textBlockSchema,
  projectionBlockSchema,
  actionBlockSchema,
  // New retirement blocks
  monteCarloChartSchema,
  backtestTableSchema,
  sliderControlSchema,
  scenarioComparisonSchema,
  sequenceRiskChartSchema,
  incomeBreakdownSchema,
  accountSummarySchema,
  fireCalculatorSchema,
  failureAnalysisSchema,
  improvementActionsSchema,
]);
```

- [ ] **Step 6: Export new types**

Add type exports:
```typescript
export type MonteCarloChartBlock = z.infer<typeof monteCarloChartSchema>;
export type BacktestTableBlock = z.infer<typeof backtestTableSchema>;
export type SliderControlBlock = z.infer<typeof sliderControlSchema>;
export type ScenarioComparisonBlock = z.infer<typeof scenarioComparisonSchema>;
export type SequenceRiskChartBlock = z.infer<typeof sequenceRiskChartSchema>;
export type IncomeBreakdownBlock = z.infer<typeof incomeBreakdownSchema>;
export type AccountSummaryBlock = z.infer<typeof accountSummarySchema>;
export type FireCalculatorBlock = z.infer<typeof fireCalculatorSchema>;
export type FailureAnalysisBlock = z.infer<typeof failureAnalysisSchema>;
export type ImprovementActionsBlock = z.infer<typeof improvementActionsSchema>;
```

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/agent/types.ts
git commit -m "feat(api): add retirement dashboard block schemas"
```

---

## Task 2: Add Block Types to Web Package

**Files:**
- Modify: `packages/web/src/lib/types.ts`

- [ ] **Step 1: Add new block types**

In `packages/web/src/lib/types.ts`, before `UIBlock` union, add:
```typescript
// ── Retirement Dashboard Blocks ──────────────────────────────────────────────

export type MonteCarloChartBlock = {
  type: "monte_carlo_chart";
  variant: "fan" | "histogram";
  title?: string;
  data: {
    successRate: number;
    percentiles?: {
      p5: number[];
      p25: number[];
      p50: number[];
      p75: number[];
      p95: number[];
    };
    distribution?: {
      buckets: number[];
      counts: number[];
    };
  };
  showPaths?: boolean;
};

export type BacktestTableBlock = {
  type: "backtest_table";
  title?: string;
  data: {
    totalPeriods: number;
    successfulPeriods: number;
    successRate: number;
    periods: {
      startYear: number;
      endBalance: number;
      yearsLasted: number;
      status: "success" | "failed" | "close";
      worstDrawdown: { year: number; percent: number };
      bestYear: { year: number; percent: number };
    }[];
  };
  defaultSort?: "startYear" | "endBalance" | "status";
  defaultFilter?: "all" | "failed" | "close" | "success";
  showCount?: number;
};

export type SliderControlBlock = {
  type: "slider_control";
  controlType: "swr" | "retirement_age" | "contribution";
  label: string;
  min: number;
  max: number;
  step: number;
  currentValue: number;
  unit?: string;
  impactPreview?: {
    label: string;
    values: { value: number; result: string }[];
  };
};

export type ScenarioComparisonBlock = {
  type: "scenario_comparison";
  title?: string;
  scenarios: {
    name: string;
    description?: string;
    successRate: number;
    endBalance: number;
    isRecommended?: boolean;
  }[];
};

export type SequenceRiskChartBlock = {
  type: "sequence_risk_chart";
  title?: string;
  goodSequence: number[];
  badSequence: number[];
  labels?: string[];
};

export type IncomeBreakdownBlock = {
  type: "income_breakdown";
  title?: string;
  sources: {
    name: string;
    annualAmount: number;
    startAge?: number;
  }[];
  totalAnnual: number;
  totalMonthly: number;
};

export type AccountSummaryBlock = {
  type: "account_summary";
  totalBalance: number;
  allocation: {
    stocks: number;
    bonds: number;
    cash: number;
  };
  byType: {
    type: string;
    balance: number;
    percentage: number;
  }[];
};

export type FireCalculatorBlock = {
  type: "fire_calculator";
  targetNumber: number;
  currentBalance: number;
  gap: number;
  percentComplete: number;
  withdrawalRate: number;
  targetAge?: number;
};

export type FailureAnalysisBlock = {
  type: "failure_analysis";
  title?: string;
  failedPeriods: {
    startYear: number;
    earlyReturns: number[];
    pattern: string;
  }[];
  insight: string;
};

export type ImprovementActionsBlock = {
  type: "improvement_actions";
  title?: string;
  actions: {
    description: string;
    impact: string;
    tradeoff?: string;
    actionType?: string;
  }[];
};
```

- [ ] **Step 2: Update UIBlock union**

Update the `UIBlock` type:
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
  | ImprovementActionsBlock;
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/types.ts
git commit -m "feat(web): add retirement dashboard block types"
```

---

## Task 3: Monte Carlo Chart Component

**Files:**
- Create: `packages/web/src/components/ui-renderer/blocks/monte-carlo-chart.tsx`

- [ ] **Step 1: Create Monte Carlo chart component**

Create `packages/web/src/components/ui-renderer/blocks/monte-carlo-chart.tsx`:
```typescript
import { useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { MonteCarloChartBlock } from "../../../lib/types.js";
import { colors } from "../../../styles/theme.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function FanChart({ data, title }: { data: MonteCarloChartBlock["data"]; title?: string }) {
  const chartData = useMemo(() => {
    if (!data.percentiles) return [];

    return data.percentiles.p50.map((_, idx) => ({
      year: idx,
      p5: data.percentiles!.p5[idx],
      p25: data.percentiles!.p25[idx],
      p50: data.percentiles!.p50[idx],
      p75: data.percentiles!.p75[idx],
      p95: data.percentiles!.p95[idx],
    }));
  }, [data.percentiles]);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        {title && (
          <h3 className="text-lg font-display font-semibold text-text">{title}</h3>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Success Rate:</span>
          <span className={`text-lg font-semibold ${
            data.successRate >= 0.9 ? "text-success" :
            data.successRate >= 0.8 ? "text-warning" : "text-danger"
          }`}>
            {(data.successRate * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="p95" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.accent.DEFAULT} stopOpacity={0.1} />
                <stop offset="95%" stopColor={colors.accent.DEFAULT} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="p75" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.accent.DEFAULT} stopOpacity={0.2} />
                <stop offset="95%" stopColor={colors.accent.DEFAULT} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="p50" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.accent.DEFAULT} stopOpacity={0.4} />
                <stop offset="95%" stopColor={colors.accent.DEFAULT} stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="year"
              stroke={colors.text.muted}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              label={{ value: "Years", position: "bottom", fill: colors.text.muted }}
            />
            <YAxis
              stroke={colors.text.muted}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCurrency}
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
                padding: "12px",
              }}
              labelFormatter={(label) => `Year ${label}`}
            />
            <Area
              type="monotone"
              dataKey="p95"
              stroke="none"
              fill="url(#p95)"
              name="95th percentile"
            />
            <Area
              type="monotone"
              dataKey="p75"
              stroke="none"
              fill="url(#p75)"
              name="75th percentile"
            />
            <Area
              type="monotone"
              dataKey="p50"
              stroke={colors.accent.DEFAULT}
              strokeWidth={2}
              fill="url(#p50)"
              name="Median"
            />
            <Area
              type="monotone"
              dataKey="p25"
              stroke="none"
              fill="url(#p75)"
              name="25th percentile"
            />
            <Area
              type="monotone"
              dataKey="p5"
              stroke="none"
              fill="url(#p95)"
              name="5th percentile"
            />
            <ReferenceLine y={0} stroke={colors.danger} strokeDasharray="3 3" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-center gap-6 mt-4 text-xs text-text-muted">
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: colors.accent.DEFAULT, opacity: 0.4 }} />
          Median
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: colors.accent.DEFAULT, opacity: 0.2 }} />
          25th-75th
        </span>
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: colors.accent.DEFAULT, opacity: 0.1 }} />
          5th-95th
        </span>
      </div>
    </div>
  );
}

function Histogram({ data, title }: { data: MonteCarloChartBlock["data"]; title?: string }) {
  const chartData = useMemo(() => {
    if (!data.distribution) return [];

    const labels = ["$0", "$250K", "$500K", "$1M", "$2M", "$3M+"];
    const statusColors = [
      colors.danger,
      colors.warning,
      colors.success,
      colors.success,
      colors.success,
      colors.success,
    ];

    return data.distribution.buckets.map((_, idx) => ({
      label: labels[idx] || `$${data.distribution!.buckets[idx]}`,
      count: data.distribution!.counts[idx],
      fill: statusColors[idx],
    }));
  }, [data.distribution]);

  const total = chartData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        {title && (
          <h3 className="text-lg font-display font-semibold text-text">{title}</h3>
        )}
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Success Rate:</span>
          <span className={`text-lg font-semibold ${
            data.successRate >= 0.9 ? "text-success" :
            data.successRate >= 0.8 ? "text-warning" : "text-danger"
          }`}>
            {(data.successRate * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <XAxis
              dataKey="label"
              stroke={colors.text.muted}
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke={colors.text.muted}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${((v / total) * 100).toFixed(0)}%`}
            />
            <Tooltip
              formatter={(value: number) => [`${((value / total) * 100).toFixed(1)}%`, "Probability"]}
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
              }}
            />
            <Bar
              dataKey="count"
              radius={[4, 4, 0, 0]}
              fill={colors.accent.DEFAULT}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-center gap-4 mt-4 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-danger" />
          <span className="text-text-muted">Depleted</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-warning" />
          <span className="text-text-muted">Struggling</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-success" />
          <span className="text-text-muted">Comfortable</span>
        </span>
      </div>
    </div>
  );
}

export function MonteCarloChartRenderer({ block }: { block: MonteCarloChartBlock }) {
  if (block.variant === "histogram") {
    return <Histogram data={block.data} title={block.title} />;
  }
  return <FanChart data={block.data} title={block.title} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/ui-renderer/blocks/monte-carlo-chart.tsx
git commit -m "feat(web): add Monte Carlo chart component"
```

---

## Task 4: Backtest Table Component

**Files:**
- Create: `packages/web/src/components/ui-renderer/blocks/backtest-table.tsx`

- [ ] **Step 1: Create backtest table component**

Create `packages/web/src/components/ui-renderer/blocks/backtest-table.tsx`:
```typescript
import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import type { BacktestTableBlock } from "../../../lib/types.js";

type SortField = "startYear" | "endBalance" | "status" | "worstDrawdown";
type FilterStatus = "all" | "failed" | "close" | "success";

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

const statusColors = {
  success: "text-success",
  failed: "text-danger",
  close: "text-warning",
};

const statusIcons = {
  success: "✅",
  failed: "❌",
  close: "⚠️",
};

export function BacktestTableRenderer({ block }: { block: BacktestTableBlock }) {
  const [sortField, setSortField] = useState<SortField>(block.defaultSort || "startYear");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>(block.defaultFilter || "all");
  const [showCount, setShowCount] = useState(block.showCount || 10);

  const filteredAndSorted = useMemo(() => {
    let periods = [...block.data.periods];

    // Filter
    if (filter !== "all") {
      periods = periods.filter((p) => p.status === filter);
    }

    // Sort
    periods.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "startYear":
          comparison = a.startYear - b.startYear;
          break;
        case "endBalance":
          comparison = a.endBalance - b.endBalance;
          break;
        case "status":
          const order = { failed: 0, close: 1, success: 2 };
          comparison = order[a.status] - order[b.status];
          break;
        case "worstDrawdown":
          comparison = a.worstDrawdown.percent - b.worstDrawdown.percent;
          break;
      }
      return sortAsc ? comparison : -comparison;
    });

    return periods;
  }, [block.data.periods, sortField, sortAsc, filter]);

  const visiblePeriods = filteredAndSorted.slice(0, showCount);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortAsc ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
  };

  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-2">
          {block.title}
        </h3>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-text-muted">
          {block.data.successfulPeriods} of {block.data.totalPeriods} periods successful ({formatPercent(block.data.successRate)})
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-text-muted" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterStatus)}
            className="bg-surface border border-border rounded-lg px-3 py-1 text-sm text-text"
          >
            <option value="all">All</option>
            <option value="failed">Failed Only</option>
            <option value="close">Close Calls</option>
            <option value="success">Successes</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th
                className="text-left py-3 px-2 text-sm text-text-muted font-medium cursor-pointer hover:text-text"
                onClick={() => handleSort("startYear")}
              >
                <span className="flex items-center gap-1">
                  Start Year <SortIcon field="startYear" />
                </span>
              </th>
              <th
                className="text-right py-3 px-2 text-sm text-text-muted font-medium cursor-pointer hover:text-text"
                onClick={() => handleSort("endBalance")}
              >
                <span className="flex items-center justify-end gap-1">
                  End Balance <SortIcon field="endBalance" />
                </span>
              </th>
              <th
                className="text-right py-3 px-2 text-sm text-text-muted font-medium cursor-pointer hover:text-text"
                onClick={() => handleSort("worstDrawdown")}
              >
                <span className="flex items-center justify-end gap-1">
                  Worst Drawdown <SortIcon field="worstDrawdown" />
                </span>
              </th>
              <th className="text-right py-3 px-2 text-sm text-text-muted font-medium">
                Best Year
              </th>
              <th
                className="text-center py-3 px-2 text-sm text-text-muted font-medium cursor-pointer hover:text-text"
                onClick={() => handleSort("status")}
              >
                <span className="flex items-center justify-center gap-1">
                  Status <SortIcon field="status" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visiblePeriods.map((period) => (
              <tr key={period.startYear} className="border-b border-border/50 hover:bg-surface/50">
                <td className="py-3 px-2 text-text font-medium">{period.startYear}</td>
                <td className="py-3 px-2 text-right text-text tabular-nums">
                  {formatCurrency(period.endBalance)}
                </td>
                <td className="py-3 px-2 text-right text-danger tabular-nums">
                  {formatPercent(period.worstDrawdown.percent)} ({period.worstDrawdown.year})
                </td>
                <td className="py-3 px-2 text-right text-success tabular-nums">
                  +{formatPercent(period.bestYear.percent)} ({period.bestYear.year})
                </td>
                <td className={`py-3 px-2 text-center ${statusColors[period.status]}`}>
                  {statusIcons[period.status]} {period.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCount < filteredAndSorted.length && (
        <button
          onClick={() => setShowCount((prev) => prev + 10)}
          className="mt-4 w-full py-2 text-sm text-accent hover:opacity-80"
        >
          Show more ({filteredAndSorted.length - showCount} remaining)
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/ui-renderer/blocks/backtest-table.tsx
git commit -m "feat(web): add backtest table component"
```

---

## Task 5: Slider Control Component

**Files:**
- Create: `packages/web/src/components/ui-renderer/blocks/slider-control.tsx`

- [ ] **Step 1: Create slider control component**

Create `packages/web/src/components/ui-renderer/blocks/slider-control.tsx`:
```typescript
import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import type { SliderControlBlock } from "../../../lib/types.js";

export function SliderControlRenderer({ block }: { block: SliderControlBlock }) {
  const [value, setValue] = useState(block.currentValue);

  const formatValue = useCallback((v: number) => {
    if (block.controlType === "swr") {
      return `${(v * 100).toFixed(1)}%`;
    }
    if (block.controlType === "retirement_age") {
      return `Age ${v}`;
    }
    return `$${v.toLocaleString()}${block.unit || ""}`;
  }, [block.controlType, block.unit]);

  const getImpactForValue = useCallback((v: number) => {
    if (!block.impactPreview) return null;
    const closest = block.impactPreview.values.reduce((prev, curr) =>
      Math.abs(curr.value - v) < Math.abs(prev.value - v) ? curr : prev
    );
    return closest.result;
  }, [block.impactPreview]);

  const percentage = ((value - block.min) / (block.max - block.min)) * 100;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <label className="text-sm font-medium text-text">{block.label}</label>
        <span className="text-lg font-semibold text-accent tabular-nums">
          {formatValue(value)}
        </span>
      </div>

      <div className="relative">
        <input
          type="range"
          min={block.min}
          max={block.max}
          step={block.step}
          value={value}
          onChange={(e) => setValue(parseFloat(e.target.value))}
          className="w-full h-2 bg-surface rounded-full appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-5
                     [&::-webkit-slider-thumb]:h-5
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-accent
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:shadow-lg
                     [&::-webkit-slider-thumb]:transition-transform
                     [&::-webkit-slider-thumb]:hover:scale-110"
        />
        <div
          className="absolute top-0 left-0 h-2 bg-accent/30 rounded-full pointer-events-none"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex justify-between text-xs text-text-muted mt-2">
        <span>{formatValue(block.min)}</span>
        <span>{formatValue(block.max)}</span>
      </div>

      {block.impactPreview && (
        <motion.div
          key={value}
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 bg-surface rounded-lg border border-border"
        >
          <span className="text-sm text-text-muted">{block.impactPreview.label}: </span>
          <span className="text-sm font-medium text-text">{getImpactForValue(value)}</span>
        </motion.div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/ui-renderer/blocks/slider-control.tsx
git commit -m "feat(web): add slider control component"
```

---

## Task 6: Remaining Components (Batch)

**Files:**
- Create: `packages/web/src/components/ui-renderer/blocks/scenario-comparison.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/sequence-risk-chart.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/income-breakdown.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/account-summary.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/fire-calculator.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/failure-analysis.tsx`
- Create: `packages/web/src/components/ui-renderer/blocks/improvement-actions.tsx`

- [ ] **Step 1: Create scenario comparison**

Create `packages/web/src/components/ui-renderer/blocks/scenario-comparison.tsx`:
```typescript
import { CheckCircle } from "lucide-react";
import type { ScenarioComparisonBlock } from "../../../lib/types.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function ScenarioComparisonRenderer({ block }: { block: ScenarioComparisonBlock }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4">
          {block.title}
        </h3>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {block.scenarios.map((scenario, idx) => (
          <div
            key={idx}
            className={`p-4 rounded-xl border ${
              scenario.isRecommended
                ? "border-accent bg-accent/5"
                : "border-border bg-surface"
            }`}
          >
            <div className="flex items-start justify-between">
              <h4 className="font-medium text-text">{scenario.name}</h4>
              {scenario.isRecommended && (
                <CheckCircle className="w-5 h-5 text-accent" />
              )}
            </div>
            {scenario.description && (
              <p className="text-sm text-text-muted mt-1">{scenario.description}</p>
            )}
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Success Rate</span>
                <span className={`font-medium ${
                  scenario.successRate >= 0.9 ? "text-success" :
                  scenario.successRate >= 0.8 ? "text-warning" : "text-danger"
                }`}>
                  {(scenario.successRate * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">End Balance</span>
                <span className="font-medium text-text">
                  {formatCurrency(scenario.endBalance)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create sequence risk chart**

Create `packages/web/src/components/ui-renderer/blocks/sequence-risk-chart.tsx`:
```typescript
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { SequenceRiskChartBlock } from "../../../lib/types.js";
import { colors } from "../../../styles/theme.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function SequenceRiskChartRenderer({ block }: { block: SequenceRiskChartBlock }) {
  const data = block.goodSequence.map((good, idx) => ({
    year: block.labels?.[idx] || `Year ${idx + 1}`,
    good,
    bad: block.badSequence[idx] || 0,
  }));

  return (
    <div className="glass-card p-6">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4">
          {block.title}
        </h3>
      )}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="year" stroke={colors.text.muted} fontSize={12} tickLine={false} />
            <YAxis stroke={colors.text.muted} fontSize={12} tickLine={false} tickFormatter={formatCurrency} />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="good" name="Good Sequence" stroke={colors.success} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="bad" name="Bad Sequence" stroke={colors.danger} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-text-muted mt-3 text-center">
        Same average returns, different order — the first 5 years matter most
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create income breakdown**

Create `packages/web/src/components/ui-renderer/blocks/income-breakdown.tsx`:
```typescript
import type { IncomeBreakdownBlock } from "../../../lib/types.js";

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

export function IncomeBreakdownRenderer({ block }: { block: IncomeBreakdownBlock }) {
  return (
    <div className="glass-card p-6">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4">
          {block.title}
        </h3>
      )}
      <div className="space-y-3">
        {block.sources.map((source, idx) => (
          <div key={idx} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
            <div>
              <span className="text-text">{source.name}</span>
              {source.startAge && (
                <span className="text-xs text-text-muted ml-2">(from age {source.startAge})</span>
              )}
            </div>
            <span className="font-medium text-text tabular-nums">
              {formatCurrency(source.annualAmount)}/yr
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex justify-between text-lg font-semibold">
          <span className="text-text">Total</span>
          <div className="text-right">
            <div className="text-accent">{formatCurrency(block.totalAnnual)}/yr</div>
            <div className="text-sm text-text-muted">{formatCurrency(block.totalMonthly)}/mo</div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create account summary**

Create `packages/web/src/components/ui-renderer/blocks/account-summary.tsx`:
```typescript
import type { AccountSummaryBlock } from "../../../lib/types.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function AccountSummaryRenderer({ block }: { block: AccountSummaryBlock }) {
  const allocationData = [
    { label: "Stocks", value: block.allocation.stocks, color: "#22c55e" },
    { label: "Bonds", value: block.allocation.bonds, color: "#3b82f6" },
    { label: "Cash", value: block.allocation.cash, color: "#a855f7" },
  ].filter((d) => d.value > 0);

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-6">
        <div className="text-sm text-text-muted">Total Portfolio</div>
        <div className="text-3xl font-display font-bold text-text">
          {formatCurrency(block.totalBalance)}
        </div>
      </div>

      <div className="mb-4">
        <div className="text-sm text-text-muted mb-2">Asset Allocation</div>
        <div className="flex h-3 rounded-full overflow-hidden">
          {allocationData.map((d, idx) => (
            <div
              key={idx}
              style={{ width: `${d.value * 100}%`, background: d.color }}
              title={`${d.label}: ${(d.value * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs">
          {allocationData.map((d, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />
              {d.label} {(d.value * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {block.byType.map((account, idx) => (
          <div key={idx} className="flex justify-between text-sm py-1">
            <span className="text-text-muted capitalize">{account.type}</span>
            <span className="text-text tabular-nums">{formatCurrency(account.balance)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create FIRE calculator**

Create `packages/web/src/components/ui-renderer/blocks/fire-calculator.tsx`:
```typescript
import type { FireCalculatorBlock } from "../../../lib/types.js";

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function FireCalculatorRenderer({ block }: { block: FireCalculatorBlock }) {
  const progressColor = block.percentComplete >= 80 ? "bg-success" :
                        block.percentComplete >= 50 ? "bg-warning" : "bg-accent";

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-6">
        <div className="text-sm text-text-muted">FIRE Number</div>
        <div className="text-3xl font-display font-bold text-accent">
          {formatCurrency(block.targetNumber)}
        </div>
        <div className="text-xs text-text-muted mt-1">
          at {(block.withdrawalRate * 100).toFixed(1)}% SWR
          {block.targetAge && ` • Target age ${block.targetAge}`}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-text-muted">Progress</span>
          <span className="font-medium text-text">{block.percentComplete.toFixed(1)}%</span>
        </div>
        <div className="h-4 bg-surface rounded-full overflow-hidden">
          <div
            className={`h-full ${progressColor} rounded-full transition-all duration-500`}
            style={{ width: `${Math.min(100, block.percentComplete)}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-center">
        <div className="p-3 bg-surface rounded-xl">
          <div className="text-xs text-text-muted">Current</div>
          <div className="text-lg font-semibold text-text">
            {formatCurrency(block.currentBalance)}
          </div>
        </div>
        <div className="p-3 bg-surface rounded-xl">
          <div className="text-xs text-text-muted">Gap</div>
          <div className={`text-lg font-semibold ${block.gap <= 0 ? "text-success" : "text-text"}`}>
            {block.gap <= 0 ? "🎉 Done!" : formatCurrency(block.gap)}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create failure analysis**

Create `packages/web/src/components/ui-renderer/blocks/failure-analysis.tsx`:
```typescript
import { AlertTriangle } from "lucide-react";
import type { FailureAnalysisBlock } from "../../../lib/types.js";

export function FailureAnalysisRenderer({ block }: { block: FailureAnalysisBlock }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-warning" />
          {block.title}
        </h3>
      )}

      <div className="space-y-4">
        {block.failedPeriods.map((period, idx) => (
          <div key={idx} className="p-4 bg-danger/10 rounded-xl border border-danger/20">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-text">Started {period.startYear}</span>
              <span className="text-xs text-text-muted">{period.pattern}</span>
            </div>
            <div className="flex gap-2">
              {period.earlyReturns.map((ret, i) => (
                <span
                  key={i}
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    ret < 0 ? "bg-danger/20 text-danger" : "bg-success/20 text-success"
                  }`}
                >
                  {ret >= 0 ? "+" : ""}{(ret * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 p-4 bg-accent/10 rounded-xl border border-accent/20">
        <p className="text-sm text-text">💡 {block.insight}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create improvement actions**

Create `packages/web/src/components/ui-renderer/blocks/improvement-actions.tsx`:
```typescript
import { ArrowRight } from "lucide-react";
import type { ImprovementActionsBlock } from "../../../lib/types.js";

export function ImprovementActionsRenderer({ block }: { block: ImprovementActionsBlock }) {
  return (
    <div className="glass-card p-6 col-span-full">
      {block.title && (
        <h3 className="text-lg font-display font-semibold text-text mb-4">
          {block.title}
        </h3>
      )}
      <div className="space-y-3">
        {block.actions.map((action, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between p-4 bg-surface rounded-xl border border-border hover:border-accent/50 transition-colors cursor-pointer"
          >
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <span className="text-text">{action.description}</span>
                <span className="px-2 py-0.5 bg-success/20 text-success text-xs rounded-full font-medium">
                  {action.impact}
                </span>
              </div>
              {action.tradeoff && (
                <p className="text-xs text-text-muted mt-1">{action.tradeoff}</p>
              )}
            </div>
            <button className="flex items-center gap-1 px-3 py-1.5 bg-accent text-bg rounded-lg text-sm font-medium hover:bg-accent-dim transition-colors">
              Apply <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Commit all components**

```bash
git add packages/web/src/components/ui-renderer/blocks/
git commit -m "feat(web): add remaining retirement dashboard components"
```

---

## Task 7: Register Components in UI Renderer

**Files:**
- Modify: `packages/web/src/components/ui-renderer/blocks/index.ts`
- Modify: `packages/web/src/components/ui-renderer/ui-renderer.tsx`

- [ ] **Step 1: Update blocks index**

Update `packages/web/src/components/ui-renderer/blocks/index.ts`:
```typescript
export { StatBlockRenderer } from "./stat-block.js";
export { ChartBlockRenderer } from "./chart-block.js";
export { TableBlockRenderer } from "./table-block.js";
export { TextBlockRenderer } from "./text-block.js";

// Retirement dashboard components
export { MonteCarloChartRenderer } from "./monte-carlo-chart.js";
export { BacktestTableRenderer } from "./backtest-table.js";
export { SliderControlRenderer } from "./slider-control.js";
export { ScenarioComparisonRenderer } from "./scenario-comparison.js";
export { SequenceRiskChartRenderer } from "./sequence-risk-chart.js";
export { IncomeBreakdownRenderer } from "./income-breakdown.js";
export { AccountSummaryRenderer } from "./account-summary.js";
export { FireCalculatorRenderer } from "./fire-calculator.js";
export { FailureAnalysisRenderer } from "./failure-analysis.js";
export { ImprovementActionsRenderer } from "./improvement-actions.js";
```

- [ ] **Step 2: Update ui-renderer.tsx**

In `packages/web/src/components/ui-renderer/ui-renderer.tsx`, add imports:
```typescript
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
} from "./blocks/index.js";
```

Update `BlockRenderer` function:
```typescript
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
      return <ProjectionBlockRenderer block={block} />;
    case "action":
      return <ActionBlockRenderer block={block} />;
    // Retirement dashboard blocks
    case "monte_carlo_chart":
      return <MonteCarloChartRenderer block={block} />;
    case "backtest_table":
      return <BacktestTableRenderer block={block} />;
    case "slider_control":
      return <SliderControlRenderer block={block} />;
    case "scenario_comparison":
      return <ScenarioComparisonRenderer block={block} />;
    case "sequence_risk_chart":
      return <SequenceRiskChartRenderer block={block} />;
    case "income_breakdown":
      return <IncomeBreakdownRenderer block={block} />;
    case "account_summary":
      return <AccountSummaryRenderer block={block} />;
    case "fire_calculator":
      return <FireCalculatorRenderer block={block} />;
    case "failure_analysis":
      return <FailureAnalysisRenderer block={block} />;
    case "improvement_actions":
      return <ImprovementActionsRenderer block={block} />;
    default:
      return null;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ui-renderer/
git commit -m "feat(web): register retirement components in UI renderer"
```

---

## Task 8: Update Starter Prompts

**Files:**
- Modify: `packages/web/src/components/chat/starter-prompts.tsx`

- [ ] **Step 1: Update retirement prompts**

In `packages/web/src/components/chat/starter-prompts.tsx`, update the retirement prompts:
```typescript
const promptsByType: Record<PlanType, string[]> = {
  net_worth: [
    "Show my net worth breakdown",
    "How has my net worth changed over time?",
    "What's my asset allocation?",
  ],
  retirement: [
    "Analyze my retirement readiness",
    "I want to retire early, am I on track?",
    "Stress test my retirement plan",
  ],
  debt_payoff: [
    "Create a debt payoff strategy",
    "Compare avalanche vs snowball methods",
    "When will I be debt-free?",
  ],
  custom: [
    "Help me set financial goals",
    "Analyze my spending patterns",
    "Create a savings plan",
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/starter-prompts.tsx
git commit -m "feat(web): update retirement starter prompts"
```

---

## Task 9: Type Check and Build Verification

- [ ] **Step 1: Type check API package**

Run: `cd packages/api && pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Type check web package**

Run: `cd packages/web && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Build web package**

Run: `cd packages/web && pnpm build`
Expected: Build succeeds

- [ ] **Step 4: Fix any issues and commit**

If issues found, fix and commit:
```bash
git add -A
git commit -m "fix: resolve type errors in retirement components"
```

---

## Task 10: Component Testing Note

**Note:** UI component testing is deferred to a separate testing task. Options include:
- Storybook stories for visual testing
- React Testing Library for interaction tests
- E2E tests (already planned in spec Section 8)

For now, manual testing via the development server is sufficient for validating component rendering.

---

## Task 11: Final Verification

- [ ] **Step 1: Final commit**

```bash
git add -A
git commit -m "feat: complete retirement UI components implementation"
```

---

## Summary

This plan implements:
1. 10 new UI block schemas in API and Web packages
2. 10 React components for retirement dashboard visualization
3. Interactive features: sortable tables, sliders, tooltips
4. Updated starter prompts for retirement plan type
5. Full integration with existing UIRenderer system

**Components created:**
- MonteCarloChartRenderer (fan chart + histogram)
- BacktestTableRenderer (sortable, filterable)
- SliderControlRenderer (SWR, age, contribution)
- ScenarioComparisonRenderer
- SequenceRiskChartRenderer
- IncomeBreakdownRenderer
- AccountSummaryRenderer
- FireCalculatorRenderer
- FailureAnalysisRenderer
- ImprovementActionsRenderer

**Next steps after implementation:**
- Connect slider interactions to API for live simulation updates
- Add loading states for simulation requests
- E2E tests for retirement dashboard flows
