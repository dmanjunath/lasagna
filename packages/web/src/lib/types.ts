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

export type FilingStatus = "single" | "married_joint" | "married_separate" | "head_of_household";
export type TaxReturnStatus = "draft" | "complete";

export interface TaxReturn {
  id: string;
  tenantId: string;
  taxYear: number;
  filingStatus: FilingStatus | null;
  status: TaxReturnStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractedField {
  value: number;
  line: string;
  verified: boolean;
}

export interface ExtractedData {
  confidence: number;
  fields: Record<string, ExtractedField>;
}

export interface TaxDocument {
  id: string;
  taxReturnId: string;
  documentType: string;
  extractedData: ExtractedData | null;
  extractedAt: string | null;
  createdAt: string;
}
