// ── Shared Types for Layer Home Screen ───────────────────────────────────────

export interface PriorityStep {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  status: string;
  skipped: boolean;
  current: number | null;
  target: number | null;
  progress: number;
  action: string;
  detail: string;
  priority: string;
  note: string;
}

export interface PrioritySummary {
  monthlyIncome: number;
  monthlyExpenses: number | null;
  monthlySurplus: number | null;
  totalCash: number;
  totalInvested: number;
  totalHighInterestDebt: number;
  totalMediumInterestDebt: number;
  age: number | null;
  retirementAge: number;
  filingStatus: string | null;
}

export interface MockPersona {
  name: string;
  steps: PriorityStep[];
  summary: PrioritySummary;
  debts: MockDebt[];
  insights: MockInsight[];
}

export interface MockDebt {
  id: string;
  name: string;
  balance: number;
  apr: number;
  minPayment: number;
  type: 'credit' | 'loan';
  subtype: string | null;
}

export interface MockInsight {
  id: string;
  layerId: string;
  urgency: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
  actionText: string;
}

export interface CascadeDebt extends MockDebt {
  suggestedPayment: number;
  monthsToPayoff: number;
  totalInterest: number;
  payoffDate: Date;
  rolledOverAmount: number;
}
