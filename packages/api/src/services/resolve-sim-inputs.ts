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

import { readUserPersonalProfile } from "../lib/profile-resolver.js";
import { fetchAccountsWithBalances } from "../lib/account-balances.js";
import { computeSpendingTotal, defaultSpendingWindow } from "../lib/spending.js";
import { getHoldingsInput } from "../routes/portfolio.js";
import { aggregatePortfolio, extractAllocation, extractClassReturns } from "./portfolio-aggregator.js";
import { deriveSimInputs, type RawResolverData } from "./retirement-defaults.js";
import type { SimInputs } from "./retirement-sim.js";
import { ASSET_CLASSES, type AssetAllocation } from "./market-assumptions.js";

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
  userId: string,
  overrides?: Partial<SimInputs>,
  // A flat expected-return override (decimal, e.g. 0.06). The engine has no
  // scalar return — it reads per-class `assetClassReturns` — so this is applied
  // as a flat map over EVERY asset class. It must land AFTER the holdings-derived
  // `assetClassReturns` re-attach below, which would otherwise clobber it.
  flatReturn?: number,
  // Extra investable dollars to fold into the starting balance — e.g. the net
  // equity from a hypothetically SOLD property, reinvested at the current
  // allocation. It just grows as part of startingBalance at the blended return
  // (no allocation change), so the reinvest-at-current-mix assumption holds.
  extraInvestable?: number,
): Promise<SimInputs> {
  // ── Allocation + holdings-derived returns ────────────────────────────────────
  const holdingsInput = await getHoldingsInput(tenantId);
  const composition = holdingsInput.length === 0 ? null : aggregatePortfolio(holdingsInput);
  const allocation = composition ? extractAllocation(composition) : ZERO_ALLOCATION;

  // Per-bucket expected returns from the user's actual holdings. Applied only
  // when the caller is simulating the REAL portfolio (no allocation override) —
  // a hypothetical preset/custom mix uses flat capital-market assumptions.
  // Keeps the dashboard and the chat agent in lockstep on the same number.
  const assetClassReturns =
    composition && overrides?.allocation === undefined
      ? extractClassReturns(composition)
      : undefined;

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
  // Fold in reinvested property-sale net equity. Real estate was never in the
  // investment/depository sum above, so this is a clean add — the sim grows it at
  // the blended return alongside the rest of the portfolio.
  if (extraInvestable) startingBalance += extraInvestable;
  startingBalance = Math.round(startingBalance);

  // ── Personal profile (per-user) ─────────────────────────────────────────────
  // dateOfBirth/annualIncome/employerMatch/retirementAge are PERSONAL fields —
  // they live on the requesting user's userProfiles row, not the shared tenant
  // financialProfiles row. Reading by userId keeps a household member's sim
  // scoped to their own data instead of the owner's.
  const profile = await readUserPersonalProfile(tenantId, userId);

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

  const inputs = deriveSimInputs(raw, overrides);
  const withHoldingsReturns = assetClassReturns ? { ...inputs, assetClassReturns } : inputs;

  // Flat expected-return override, applied LAST so it wins over the holdings-
  // derived `assetClassReturns` just re-attached above. Force every class (incl.
  // cash) to the same decimal; the sim's `blendedExpectedReturn` then reconciles
  // to ~that value.
  if (flatReturn !== undefined) {
    const flat: Partial<Record<keyof AssetAllocation, number>> = {};
    for (const cls of ASSET_CLASSES) flat[cls] = flatReturn;
    return { ...withHoldingsReturns, assetClassReturns: flat };
  }
  return withHoldingsReturns;
}
