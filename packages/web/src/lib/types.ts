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

export type UIBlock =
  | StatBlock
  | ChartBlock
  | TableBlock
  | TextBlock
  | ProjectionBlock
  | ActionBlock;

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
