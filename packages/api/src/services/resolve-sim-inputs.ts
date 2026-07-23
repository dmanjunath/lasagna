/**
 * Server-side resolver for retirement Monte Carlo inputs.
 *
 * Fetches the same five data sources the dashboard reads (balances, financial
 * profile, spending summary, portfolio allocation), assembles a RawResolverData,
 * and runs the PURE `deriveSimInputs` to produce a `SimInputs`. This lets the
 * chat agent and the dashboard start from identical inputs.
 *
 * All data access here goes through the same server functions the existing
 * routes/tools use — NOT the client `api.*` HTTP calls:
 *  - allocation:  getHoldingsInput → aggregatePortfolio → extractAllocation
 *                 (same pipeline as the portfolio tab and get_portfolio_summary)
 *  - balances:    fetchAccountsWithBalances (same source as /accounts/balances)
 *  - profile:     financialProfiles row (same as /settings/financial-profile)
 *  - spending:    computeSpendingTotal (mirrors /transactions/spending-summary)
 */

import { eq, financialProfiles } from "@lasagna/core";
import { db } from "../lib/db.js";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import { computeSpendingTotal, defaultSpendingWindow } from "../lib/spending.js";
import { getHoldingsInput } from "../routes/portfolio.js";
import { aggregatePortfolio, extractAllocation } from "./portfolio-aggregator.js";
import { deriveSimInputs, type RawResolverData } from "./retirement-defaults.js";
import type { SimInputs } from "./retirement-sim.js";
import type { AssetAllocation } from "./market-assumptions.js";

// Account types the dashboard treats as investable (property/loans/credit are
// excluded). Mirrors retirement-v2.tsx:1263.
const INVESTABLE_TYPES = new Set(["investment", "depository"]);

const ZERO_ALLOCATION: AssetAllocation = {
  usStocks: 0,
  intlStocks: 0,
  bonds: 0,
  reits: 0,
  cash: 0,
};

export async function resolveSimInputs(
  tenantId: string,
  overrides?: Partial<SimInputs>,
): Promise<SimInputs> {
  // ── Allocation ──────────────────────────────────────────────────────────────
  const holdingsInput = await getHoldingsInput(tenantId);
  const allocation =
    holdingsInput.length === 0
      ? ZERO_ALLOCATION
      : extractAllocation(aggregatePortfolio(holdingsInput));

  // ── Investable balance ──────────────────────────────────────────────────────
  // Sum raw balances over investment/depository accounts with balance > 0.
  // Uses rawBalance (not effectiveBalance) to match the client, which reads the
  // raw `balance` string from /accounts/balances.
  const accts = await fetchAccountsWithBalances(tenantId);
  let startingBalance = 0;
  for (const a of accts) {
    if (!INVESTABLE_TYPES.has(a.type)) continue;
    if (!(a.rawBalance > 0)) continue;
    startingBalance += a.rawBalance;
  }
  startingBalance = Math.round(startingBalance);

  // ── Financial profile ───────────────────────────────────────────────────────
  const profile = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, tenantId),
  });

  // ── Spending total (previous calendar month, same default as the dashboard) ──
  const { startDate, endDate } = defaultSpendingWindow();
  const spendingTotal = await computeSpendingTotal(tenantId, startDate, endDate);

  const raw: RawResolverData = {
    age: null, // derived from dateOfBirth below, matching the profile route
    dateOfBirth: profile?.dateOfBirth ? profile.dateOfBirth.toISOString() : null,
    annualIncome: profile?.annualIncome ? parseFloat(profile.annualIncome) : null,
    employerMatchPercent:
      profile?.employerMatch != null ? parseFloat(profile.employerMatch) : null,
    retirementAge: profile?.retirementAge ?? null,
    spendingTotal,
    startingBalance,
    allocation,
  };

  return deriveSimInputs(raw, overrides);
}
