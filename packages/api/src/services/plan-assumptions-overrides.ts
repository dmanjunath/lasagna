/**
 * The pure, leaf half of plan-change assumptions: the `PlanAssumptions` shape
 * and its derivation into engine overrides. Kept in its OWN module (importing
 * only the `SimInputs` type) so both `plan-assumptions.ts` (the regeneration
 * harness) and `plan-grounding.ts` can use it WITHOUT dragging in the heavy
 * builder graph (portfolio.ts -> security-classifier.ts, which reads @lasagna/
 * core exports at module load). A static import of the harness into grounding
 * would eagerly load that graph and break test suites that partially mock
 * @lasagna/core.
 */

import type { SimInputs } from "./retirement-sim.js";

/**
 * The scalar plan-change assumptions, persisted as a JSON string on the plan.
 * Every field is optional — only supplied fields are active; an omitted field
 * means "no override" (the plan's derived default stands).
 *
 * Slice (a) fields only. Later slices add more (e.g. soldPropertyAccountIds)
 * without a schema change, since the column is free-form JSON.
 */
export interface PlanAssumptions {
  /** false → exclude Social Security from the projection (ssMonthly forced 0). */
  includeSocialSecurity?: boolean;
  /** Override the retirement age used by the projection. */
  retirementAge?: number;
  /** Override the expected return (decimal, e.g. 0.06 for 6%). */
  expectedReturn?: number;
  /** Override monthly retirement spend (dollars). */
  monthlySpend?: number;
}

/** The engine-level overrides an assumptions set derives to. */
export interface SimOverrideSet {
  /** Direct `Partial<SimInputs>` overrides (ssMonthly, retirementAge, monthlySpend). */
  overrides: Partial<SimInputs>;
  /** Flat expected-return decimal, applied over every asset class (or undefined). */
  flatReturn?: number;
}

/**
 * Derive the engine overrides from a `PlanAssumptions`.
 *  - includeSocialSecurity === false → ssMonthly: 0 (deriveSimInputs spreads
 *    `{...derived, ...overrides}`, so 0 wins over the income-derived estimate).
 *  - retirementAge / monthlySpend → direct Partial<SimInputs> overrides.
 *  - expectedReturn → a flat per-class return applied AFTER the holdings-derived
 *    re-attach in resolveSimInputs (see its `flatReturn` param).
 */
export function deriveSimOverrides(assumptions: PlanAssumptions | null): SimOverrideSet {
  const overrides: Partial<SimInputs> = {};
  if (!assumptions) return { overrides };

  if (assumptions.includeSocialSecurity === false) overrides.ssMonthly = 0;
  if (assumptions.retirementAge !== undefined) overrides.retirementAge = assumptions.retirementAge;
  if (assumptions.monthlySpend !== undefined) overrides.monthlySpend = assumptions.monthlySpend;

  return { overrides, flatReturn: assumptions.expectedReturn };
}
