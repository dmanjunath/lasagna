import { useQuery, type QueryClient } from "@tanstack/react-query";
import type { GoalDetails } from "@lasagna/core/goal-target";
import type { Goal, GoalBalance } from "@/lib/goals";
import { markWebStale } from "@/lib/web-stale";
import { patch, post, request } from "./client";

// The Goals area's calls, mirroring packages/web/src/lib/api.ts.

export type GoalWrite = {
  name?: string;
  targetAmount?: number;
  currentAmount?: number;
  monthlyContribution?: number | null;
  deadline?: string | null;
  category?: string;
  icon?: string;
  status?: string;
  accountIds?: string[];
  details?: GoalDetails | null;
};

export const goalsApi = {
  list: () => request<{ goals: Goal[] }>("/goals"),
  create: (body: GoalWrite & { name: string; targetAmount: number }) => post<{ goal: { id: string } }>("/goals", body),
  update: (id: string, body: GoalWrite) => patch<{ ok: boolean }>(`/goals/${id}`, body),
  remove: (id: string) => request<{ ok: boolean }>(`/goals/${id}`, { method: "DELETE" }),
  history: (id: string) => request<{ history: Array<{ date: string; value: number }> }>(`/goals/${id}/history`),
  spendBaseline: () => request<{ monthlySpend: number | null; windowMonths: number }>("/goals/spend-baseline"),
  financialProfile: () =>
    request<{ financialProfile: { dateOfBirth: string | null; age: number | null; retirementAge: number | null } | null }>("/settings/financial-profile"),
  balances: () => request<{ balances: GoalBalance[] }>("/accounts/balances"),
};

/** Every goal. Home's goals card reads the same query. */
export function useGoals() {
  return useQuery({ queryKey: ["goals"], queryFn: goalsApi.list });
}

/** Account balances (the goal pages' linked accounts and the picker). Home reads the same query. */
export function useBalances() {
  return useQuery({ queryKey: ["accounts", "balances"], queryFn: goalsApi.balances });
}

/** After a goal changed: the goals, their histories, the actions that talk about them, and the web pages. */
export function invalidateGoals(qc: QueryClient) {
  markWebStale();
  for (const key of [["goals"], ["goal-history"], ["financial-path"]]) void qc.invalidateQueries({ queryKey: key });
}
