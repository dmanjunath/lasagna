import type { SpendingSummaryData, TrendPeriod } from "@/lib/spending";
import { request } from "./client";

// The Spending screen's calls, mirroring getSpendingSummary and getTrend in packages/web/src/lib/api.ts.
// `scope` is the universal filter as query params (filtersToApiQuery), the window aside.

export const spendingApi = {
  summary: (p: { startDate: string; endDate: string; scope?: string[] }) =>
    request<SpendingSummaryData>(
      `/transactions/spending-summary?${[`startDate=${encodeURIComponent(p.startDate)}`, `endDate=${encodeURIComponent(p.endDate)}`, ...(p.scope ?? [])].join("&")}`,
    ),
  trend: (p: { granularity: "month" | "year"; limit?: number; scope?: string[] }) => {
    const q = [`granularity=${p.granularity}`];
    if (p.limit !== undefined) q.push(`limit=${p.limit}`);
    q.push(...(p.scope ?? []));
    return request<{ periods?: TrendPeriod[] }>(`/transactions/monthly-trend?${q.join("&")}`).then((d) => d?.periods ?? []);
  },
};
