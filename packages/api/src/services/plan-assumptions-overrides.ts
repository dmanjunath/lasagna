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
  /**
   * Real-estate account ids the reader has hypothetically SOLD. Each sold
   * property (and its linked mortgage) drops out of net worth as an asset/debt
   * and its net equity is reclassified into investable — net worth is unchanged,
   * only where the value sits changes. See computePropertySaleAdjustment.
   */
  soldPropertyAccountIds?: string[];
}

/**
 * The net-equity reclassification a set of sold properties produces, computed
 * ONCE from the accounts-with-balances snapshot so every surface (snapshot, sim
 * starting balance, grounding narrative) threads the SAME number and can't drift.
 */
export interface PropertySaleAdjustment {
  /** Sum over each sold property of (its value − its linked mortgage balance). */
  netEquity: number;
  /** The sold real-estate account ids plus their linked mortgage account ids. */
  excludedAccountIds: string[];
  /** The sold properties' display info, for the on-screen chip / PDF note. */
  soldProperties: { id: string; name: string; netEquity: number }[];
}

/** Minimal account shape computePropertySaleAdjustment reads (a subset of AccountWithBalance). */
interface SaleAccount {
  id: string;
  type: string;
  name: string;
  rawBalance: number;
  propertyAccountId: string | null;
}

/**
 * Compute the net-equity reclassification for a set of sold real-estate accounts.
 *
 * For each id in `soldIds` that is a `real_estate` account, nets its market value
 * (its balance) against the balances of every debt account LINKED to it via
 * `propertyAccountId` (the SAME linkage plan-grounding uses). Returns the total
 * `netEquity` to add to investable and the full set of `excludedAccountIds` (the
 * sold properties + their linked mortgages) to drop from the asset/debt sums, so
 * a sale reclassifies value rather than creating or destroying it.
 *
 * Guard: only `real_estate` accounts are honored; unknown or non-property ids are
 * ignored (so a stale id can't corrupt the totals).
 */
export function computePropertySaleAdjustment(
  accounts: SaleAccount[],
  soldIds: string[] | undefined,
): PropertySaleAdjustment {
  const empty: PropertySaleAdjustment = { netEquity: 0, excludedAccountIds: [], soldProperties: [] };
  if (!soldIds || soldIds.length === 0) return empty;

  // Sum every linked debt's balance per property (a property may carry more than
  // one linked loan), keyed by the property account id it points at.
  const mortgageByProperty = new Map<string, number>();
  for (const a of accounts) {
    if (!a.propertyAccountId) continue;
    mortgageByProperty.set(
      a.propertyAccountId,
      (mortgageByProperty.get(a.propertyAccountId) ?? 0) + Math.abs(a.rawBalance),
    );
  }

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const soldSet = new Set(soldIds);

  let netEquity = 0;
  const excludedAccountIds: string[] = [];
  const soldProperties: { id: string; name: string; netEquity: number }[] = [];

  for (const id of soldSet) {
    const prop = byId.get(id);
    if (!prop || prop.type !== "real_estate") continue; // guard: only real estate
    const mortgage = mortgageByProperty.get(id) ?? 0;
    const equity = prop.rawBalance - mortgage;
    netEquity += equity;
    excludedAccountIds.push(id);
    // Exclude the linked mortgage accounts too (their debt no longer stands).
    for (const a of accounts) {
      if (a.propertyAccountId === id) excludedAccountIds.push(a.id);
    }
    soldProperties.push({ id, name: prop.name, netEquity: equity });
  }

  return { netEquity, excludedAccountIds, soldProperties };
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
