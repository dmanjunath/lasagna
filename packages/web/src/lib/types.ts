// ── UI Payload Types ──────────────────────────────────────────────────────

export type StatBlock = {
  type: "stat";
  label: string;
  value: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
  description?: string;
};

export type DataPoint = {
  label: string;
  value: number;
  [key: string]: string | number;
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
  columns?: Column[];
  headers?: string[];
  rows: (Record<string, string | number> | (string | number)[])[];
};

export type TextBlock = {
  type: "text";
  content: string;
  variant?: "prose" | "callout";
};

export type Scenario = {
  name: string;
  value?: string;
  description?: string;
  [key: string]: unknown;
};

export type ProjectionBlock = {
  type: "projection";
  title?: string;
  description?: string;
  scenarios: Scenario[];
};

export type ActionBlock = {
  type: "action";
  // Old format
  label?: string;
  action?: string;
  // New format
  title?: string;
  description?: string;
  actions?: string[];
  params?: Record<string, unknown>;
};

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

// ── Dynamic Chart Blocks ──────────────────────────────────────────────────

export type RechartsComponent = {
  type: "Area" | "Bar" | "Line" | "Scatter" | "Pie" | "Radar" | "Cell" | "Treemap" | "Funnel" | "Sankey";
  dataKey: string;
  fill?: string;
  stroke?: string;
  stackId?: string;
  yAxisId?: string;
  nameKey?: string;
  innerRadius?: number;
  outerRadius?: number;
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

export type WealthProjectionCategory = {
  id: string;
  label: string;
  color: string;
};

export type WealthProjectionData = {
  year: number;
  total: number;
  [key: string]: number;
};

export type WealthProjectionBlock = {
  type: "wealth_projection";
  title?: string;
  currentAge?: number;
  retirementAge?: number;
  categories: WealthProjectionCategory[];
  data: WealthProjectionData[];
  scenarios?: { id: string; label: string }[];
};

// FI Calc style retirement visualizations
export type PortfolioHistogramBlock = {
  type: "portfolio_histogram";
  title?: string;
  data: number[]; // Array of end portfolio values
  initialPortfolio?: number;
  successThreshold?: number;
};

export type QuantileData = {
  year: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
};

export type QuantileChartBlock = {
  type: "quantile_chart";
  title?: string;
  data: QuantileData[];
  retirementYear?: number;
  initialPortfolio?: number;
};

export type WithdrawalData = {
  year: number;
  age?: number;
  withdrawal: number;
  portfolioValue: number;
  socialSecurity?: number;
  pension?: number;
  otherIncome?: number;
};

export type WithdrawalTimelineBlock = {
  type: "withdrawal_timeline";
  title?: string;
  data: WithdrawalData[];
  targetWithdrawal?: number;
  retirementAge?: number;
};

export type SimulationResult = {
  startYear: number;
  endYear: number;
  endPortfolio: number;
  yearsLasted: number;
  targetYears: number;
  worstYear?: { year: number; return: number };
  bestYear?: { year: number; return: number };
  maxDrawdown?: number;
  inflationAdjustedEnd?: number;
};

export type SimulationTableBlock = {
  type: "simulation_table";
  title?: string;
  simulations: SimulationResult[];
  showCount?: number;
  defaultSort?: "startYear" | "endPortfolio" | "status";
  defaultFilter?: "all" | "failed" | "close" | "success";
};

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
  | DynamicChartBlock
  | WealthProjectionBlock
  | PortfolioHistogramBlock
  | QuantileChartBlock
  | WithdrawalTimelineBlock
  | SimulationTableBlock;

export type UIPayload = {
  layout: "single" | "split" | "grid";
  blocks: UIBlock[];
};

// ── Plan Types ────────────────────────────────────────────────────────────

export type PlanType = "net_worth" | "retirement" | "debt_payoff" | "custom";
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

// ── Tax Types ──────────────────────────────────────────────────────────

export interface TaxDocument {
  id: string;
  tenantId: string;
  fileName: string;
  fileType: string;
  gcsPath: string;
  rawExtraction: Array<{ key: string; value: string }>;
  llmFields: Record<string, unknown>;
  llmSummary: string;
  taxYear: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaxDocumentSummary {
  id: string;
  fileName: string;
  llmSummary: string;
  taxYear: number | null;
  createdAt: string;
}

export interface UploadResult {
  id: string;
  llmFields: Record<string, unknown>;
  llmSummary: string;
  taxYear: number | null;
}
