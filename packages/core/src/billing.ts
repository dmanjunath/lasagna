// Subscription tier policy — the single source of truth for what each plan
// can do. Pure: no DB, no env. (Distinct from the financial `plans` table.)

export type Plan = "free" | "pro";

/**
 * The OpenRouter model level free tenants are pinned to.
 * NOTE: this level must also exist in the API's `MODEL_LEVELS` (added in the
 * model-gate task). Until then, `allowedModelLevels("free", MODEL_LEVELS)`
 * would return `[]` — don't wire up the chat gate before that level is added.
 */
export const FREE_MODEL_LEVEL = "free";

/** Pro can hit "Sync now" at most once per this window. */
export const PRO_MANUAL_SYNC_COOLDOWN_MS = 5 * 60 * 1000;

export interface PlanLimits {
  maxAccounts: number;
  manualSync: boolean;
  autoSyncRunsPerDay: number;
  /** Allowed chat model levels, or "all" for every level. */
  models: readonly string[] | "all";
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxAccounts: 3, manualSync: false, autoSyncRunsPerDay: 1, models: [FREE_MODEL_LEVEL] },
  pro: { maxAccounts: 50, manualSync: true, autoSyncRunsPerDay: 2, models: "all" },
};

export function maxAccounts(plan: Plan): number {
  return PLAN_LIMITS[plan].maxAccounts;
}

export function canManualSync(plan: Plan): boolean {
  return PLAN_LIMITS[plan].manualSync;
}

export function isModelAllowed(plan: Plan, level: string): boolean {
  const models = PLAN_LIMITS[plan].models;
  return models === "all" || models.includes(level);
}

/** Filter a full list of model levels down to those allowed for the plan. */
export function allowedModelLevels(plan: Plan, allLevels: readonly string[]): string[] {
  return allLevels.filter((l) => isModelAllowed(plan, l));
}
