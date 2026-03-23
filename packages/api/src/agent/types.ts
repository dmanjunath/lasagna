import { z } from "zod";

// ── UI Block Schemas ──────────────────────────────────────────────────────

export const statBlockSchema = z.object({
  type: z.literal("stat"),
  label: z.string(),
  value: z.string(),
  change: z.string().optional(),
  trend: z.enum(["up", "down", "neutral"]).optional(),
  description: z.string().optional(),
});

export const dataPointSchema = z.object({
  label: z.string(),
  value: z.number(),
});

export const chartBlockSchema = z.object({
  type: z.literal("chart"),
  chartType: z.enum(["area", "bar", "donut"]),
  title: z.string().optional(),
  data: z.array(dataPointSchema),
});

export const columnSchema = z.object({
  key: z.string(),
  label: z.string(),
});

export const tableBlockSchema = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  // Accept either columns (structured) or headers (simple string array)
  columns: z.array(columnSchema).optional(),
  headers: z.array(z.string()).optional(),
  // Accept rows as either records or arrays (AI sometimes generates arrays)
  rows: z.array(
    z.union([
      z.record(z.string(), z.union([z.string(), z.number()])),
      z.array(z.union([z.string(), z.number()])),
    ])
  ),
});

export const textBlockSchema = z.object({
  type: z.literal("text"),
  content: z.string(),
  variant: z.enum(["prose", "callout"]).optional(),
});

export const scenarioSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

export const projectionBlockSchema = z.object({
  type: z.literal("projection"),
  title: z.string().optional(),
  description: z.string().optional(),
  scenarios: z.array(scenarioSchema),
});

export const actionBlockSchema = z.object({
  type: z.literal("action"),
  // Support both formats: simple (label/action) and rich (title/description/actions)
  label: z.string().optional(),
  action: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  actions: z.array(z.string()).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

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
export type UIBlock = z.infer<typeof uiBlockSchema>;
export type UIPayload = z.infer<typeof uiPayloadSchema>;
