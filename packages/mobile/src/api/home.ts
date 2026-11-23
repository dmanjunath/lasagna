import type { ApiActionRow } from "@web/lib/action-rows";
import type { AccountFacts, FinancialPath } from "@web/lib/api";
import type { SpendingSummary } from "@/lib/home";
import { viewerTimeZone } from "@/lib/format";
import { patch, post, request } from "./client";

// The calls the home screen makes, mirroring packages/web/src/lib/api.ts.

export interface Goal {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  category: string;
  status: string;
}

export interface Balance {
  accountId: string;
  name: string;
  type: string;
  balance: string | null;
  effectiveBalance: number | null;
  invertBalance: boolean;
}

export interface Recurring {
  id: string;
  accountId: string | null;
  name: string;
  amount: string;
  category: string | null;
  nextDueDate: string | null;
}

export const homeApi = {
  facts: () => request<AccountFacts>("/facts"),
  balances: () => request<{ balances: Balance[] }>("/accounts/balances"),
  netWorthHistory: () =>
    request<{ history: Array<{ date: string; value: number }> }>(
      `/accounts/net-worth/history?tz=${encodeURIComponent(viewerTimeZone())}`,
    ),
  lastVisit: () => request<{ lastVisitAt: string | null }>("/page-views/last-visit"),
  recordPageView: (path: string) => post<{ ok: true }>("/page-views", { path }),
  goals: () => request<{ goals: Goal[] }>("/goals"),
  recurring: () => request<{ recurring: Recurring[] }>("/recurring"),
  householdMembers: () => request<{ members: Array<{ id: string }> }>("/household/members"),
  householdInvites: () => request<{ invites: Array<{ id: string; expiresAt: string }> }>("/household/invites"),
  spendingSummary: (p: { startDate: string; endDate: string }) =>
    request<SpendingSummary>(
      `/transactions/spending-summary?startDate=${encodeURIComponent(p.startDate)}&endDate=${encodeURIComponent(p.endDate)}`,
    ),
  onboardingDeferred: (deferred: boolean) => patch<{ onboardingDeferred: boolean }>("/auth/onboarding-deferred", { deferred }),
};

export const insightsApi = {
  /** `refreshing`: a refresh waits for the scheduled run (absent on an older API). */
  list: () => request<{ insights: ApiActionRow[]; lastActionsGeneratedAt: string | null; refreshing?: boolean }>("/insights"),
  acted: (id: string) => post<{ ok: boolean }>(`/insights/${id}/acted`),
  snooze: (id: string, hours: number) => post<{ ok: boolean }>(`/insights/${id}/snooze`, { hours }),
  dismiss: (id: string) => post<{ ok: boolean }>(`/insights/${id}/dismiss`),
  /** Runs the model. Costs money, so only on an explicit press. */
  generate: () => post<{ ok: boolean; generated: number }>("/insights/generate"),
  /** Redoes the detected savings. Paid and throttled (429), so only beside generate on an explicit, confirmed press. */
  refreshSpendCuts: () => post<{ ok: boolean; generated: number }>("/insights/refresh-spend-cuts"),
};

export const pathApi = {
  get: () => request<FinancialPath>("/financial-path"),
  mark: (stepId: string, status: "pending" | "done" | "not_applicable") =>
    patch<FinancialPath>(`/financial-path/steps/${encodeURIComponent(stepId)}`, { status }),
};
