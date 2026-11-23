import type { CategoryRule, CategoryRuleInput, RulePreviewTxn } from "@web/lib/api";
import { patch, post } from "./client";

export const rulesApi = {
  create: (body: CategoryRuleInput) => post<{ rule: CategoryRule }>("/rules", body),
  // PATCH is replace semantics: always send the complete rule body.
  update: (id: string, body: CategoryRuleInput) => patch<{ rule: CategoryRule }>(`/rules/${id}`, body),
  preview: (id: string) => post<{ count: number; transactions: RulePreviewTxn[] }>(`/rules/${id}/preview`),
  apply: (id: string, excludeIds: string[] = []) => post<{ updated: number }>(`/rules/${id}/apply`, { excludeIds }),
};
