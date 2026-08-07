/**
 * Builds the "Financial Snapshot" section of a Financial Plan document from data
 * that already exists — net worth, assets vs debt, and monthly spending. Reuses
 * the same server utilities the accounts/debts route and the retirement resolver
 * read, so the numbers match those surfaces exactly rather than re-deriving them.
 *
 *  - assets/debt: fetchAccountsWithBalances + LIABILITY_TYPES (mirrors the
 *    /accounts/debts route's totalDebt and the net-worth aggregation)
 *  - spending:    computeSpendingTotal over defaultSpendingWindow (previous
 *    calendar month, same default as the dashboard)
 *  - age/income:  readUserPersonalProfile (cheap personal-profile read)
 */

import { fetchAccountsWithBalances, LIABILITY_TYPES } from "../lib/account-balances.js";
import { computeSpendingTotal, defaultSpendingWindow } from "../lib/spending.js";
import { readUserPersonalProfile } from "../lib/profile-resolver.js";
import type { PropertySaleAdjustment } from "./plan-assumptions-overrides.js";

export interface SnapshotBreakdownItem {
  /** "asset" or "debt" — drives the assets-vs-debt visual. */
  kind: "asset" | "debt";
  /** Account type (depository, investment, real_estate, credit, loan, …). */
  type: string;
  /** Positive magnitude in dollars. */
  value: number;
}

export interface FinancialSnapshotSection {
  section: "snapshot";
  totalAssets: number;
  totalDebt: number;
  netWorth: number;
  monthlySpend: number;
  age: number | null;
  annualIncome: number | null;
  /** Per-type magnitudes for charts, largest first. */
  breakdown: SnapshotBreakdownItem[];
  /**
   * Properties the reader hypothetically sold (name + net equity reclassified
   * into investable). Present only when a sale assumption is applied; drives the
   * on-screen chip and the PDF assumptions note. Empty/absent when none sold.
   */
  soldProperties?: { id: string; name: string; netEquity: number }[];
  generatedAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ageFromDob(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

export async function buildFinancialSnapshot(
  tenantId: string,
  userId: string,
  // A property-sale reclassification (net equity moved into investable, the sold
  // property + its mortgage excluded from the asset/debt sums). Net worth is
  // UNCHANGED — a sale reclassifies value, it doesn't create or destroy it. When
  // omitted, the snapshot is the plan's raw balances.
  saleAdjustment?: PropertySaleAdjustment,
): Promise<FinancialSnapshotSection> {
  const accts = await fetchAccountsWithBalances(tenantId);
  const excludedIds = new Set(saleAdjustment?.excludedAccountIds ?? []);

  // Aggregate assets vs debt per account type. Excluded accounts drop out
  // (matching net-worth conventions); liabilities count toward debt on their
  // absolute magnitude (mirrors /accounts/debts totalDebt).
  const assetByType = new Map<string, number>();
  const debtByType = new Map<string, number>();
  let totalAssets = 0;
  let totalDebt = 0;

  for (const a of accts) {
    if (a.excludeFromNetWorth) continue;
    // Sold property + its linked mortgage drop out; their net equity is added
    // back below as investable, so net worth stays unchanged (a reclassification).
    if (excludedIds.has(a.id)) continue;
    if (LIABILITY_TYPES.has(a.type)) {
      const bal = Math.abs(a.effectiveBalance);
      if (bal === 0) continue;
      totalDebt += bal;
      debtByType.set(a.type, (debtByType.get(a.type) ?? 0) + bal);
    } else {
      const bal = a.effectiveBalance;
      if (bal <= 0) continue;
      totalAssets += bal;
      assetByType.set(a.type, (assetByType.get(a.type) ?? 0) + bal);
    }
  }

  // Reclassify the sold properties' net equity into investable. Added to total
  // assets AND to the investment breakdown bucket so the assets-vs-debt visual
  // reconciles; net worth is unchanged because the excluded property value and
  // mortgage that used to net to this same equity were dropped above.
  const netEquity = saleAdjustment?.netEquity ?? 0;
  if (netEquity !== 0) {
    totalAssets += netEquity;
    assetByType.set("investment", (assetByType.get("investment") ?? 0) + netEquity);
  }

  const breakdown: SnapshotBreakdownItem[] = [
    ...[...assetByType].map(([type, value]) => ({ kind: "asset" as const, type, value: round2(value) })),
    ...[...debtByType].map(([type, value]) => ({ kind: "debt" as const, type, value: round2(value) })),
  ].sort((x, y) => y.value - x.value);

  const { startDate, endDate } = defaultSpendingWindow();
  const monthlySpend = await computeSpendingTotal(tenantId, startDate, endDate);

  const profile = await readUserPersonalProfile(tenantId, userId);
  const age = profile?.dateOfBirth ? ageFromDob(profile.dateOfBirth) : null;
  const annualIncome = profile?.annualIncome ? parseFloat(profile.annualIncome) : null;

  return {
    section: "snapshot",
    totalAssets: round2(totalAssets),
    totalDebt: round2(totalDebt),
    netWorth: round2(totalAssets - totalDebt),
    monthlySpend,
    age,
    annualIncome,
    breakdown,
    ...(saleAdjustment && saleAdjustment.soldProperties.length > 0
      ? { soldProperties: saleAdjustment.soldProperties }
      : {}),
    generatedAt: new Date().toISOString(),
  };
}
