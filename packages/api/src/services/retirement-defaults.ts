/**
 * Server-side mirror of the dashboard's sim-input derivation.
 *
 * The `/retirement-v2` page (packages/web/src/pages/retirement-v2.tsx) composes
 * its Monte Carlo inputs from five client API calls and DERIVES several values
 * client-side (Social Security estimate, savings rate, clamped spend, defaults).
 * For the dashboard and the AI chat to agree, the server must replicate those
 * derivations EXACTLY. This module is that replica.
 *
 * INVARIANT: `estimateSSMonthly` and the savings/spend/age derivations here must
 * stay in lockstep with retirement-v2.tsx (lines ~26-40 and ~1284-1345). If you
 * change one, change the other.
 *
 * `deriveSimInputs` is PURE (no DB / IO) so it can be unit-tested against static
 * fixtures — it is the testable core of dashboard↔chat consistency. The DB
 * fetching lives in `resolve-sim-inputs.ts`.
 */

import type { AssetAllocation } from "./market-assumptions.js";
import type { SimInputs } from "./retirement-sim.js";

// ── Social Security quick estimate ────────────────────────────────────────────
// Ported VERBATIM from retirement-v2.tsx:26-40 (2025 bend points + wage cap).
const SS_WAGE_CAP = 176_100;
export function estimateSSMonthly(annualIncome: number, claimAge: number): number {
  if (annualIncome <= 0) return 0;
  const aime = Math.min(annualIncome, SS_WAGE_CAP) / 12;
  const pia =
    0.9 * Math.min(aime, 1226) +
    0.32 * Math.max(0, Math.min(aime, 7391) - 1226) +
    0.15 * Math.max(0, aime - 7391);
  // Claim-age adjustment vs full retirement age 67: −5/9% per month for the
  // first 36 early months, −5/12% beyond; +8%/yr delayed credits to 70.
  const months = Math.round((claimAge - 67) * 12);
  const factor =
    months >= 0
      ? 1 + Math.min(months, 36) * (0.08 / 12)
      : 1 - Math.min(-months, 36) * (5 / 900) - Math.max(0, -months - 36) * (5 / 1200);
  return Math.round(pia * factor);
}

/**
 * Raw values fetched from the five data sources, before any derivation.
 * `age`/`dateOfBirth`/`annualIncome`/`employerMatchPercent`/`retirementAge` come
 * from the financial profile; `spendingTotal` from the spending summary;
 * `startingBalance` (investable total) from balances; `allocation` from the
 * aggregated portfolio.
 */
export interface RawResolverData {
  age: number | null;
  dateOfBirth: string | null;
  annualIncome: number | null;
  employerMatchPercent: number | null;
  retirementAge: number | null;
  spendingTotal: number | null;
  startingBalance: number;
  allocation: AssetAllocation;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Apply the dashboard's derivations + defaults to raw data, then `overrides`
 * last. PURE — no DB, no IO.
 */
export function deriveSimInputs(
  raw: RawResolverData,
  overrides?: Partial<SimInputs>,
): SimInputs {
  // ── currentAge (retirement-v2.tsx:1285-1298) ────────────────────────────────
  // Prefer explicit age; else derive from dob floored at 18; else default 40.
  let currentAge = 40;
  if (raw.age) {
    currentAge = raw.age;
  } else if (raw.dateOfBirth) {
    const dob = new Date(raw.dateOfBirth);
    if (!Number.isNaN(dob.getTime())) {
      currentAge = Math.max(18, Math.floor((Date.now() - dob.getTime()) / MS_PER_YEAR));
    }
  }

  const income = raw.annualIncome && raw.annualIncome > 0 ? raw.annualIncome : 0;
  const matchPct = raw.employerMatchPercent ?? 0;
  const retirementAge = raw.retirementAge ?? 65;

  // ── monthlySpend (retirement-v2.tsx:1302-1304) ──────────────────────────────
  // Any non-zero positive amount is allowed: floor at $1, no upper cap, so a
  // high earner's real spend is never silently capped.
  const monthlyRaw =
    raw.spendingTotal && raw.spendingTotal > 0 ? Math.round(raw.spendingTotal) : 5000;
  const monthlySpend = Math.max(1, monthlyRaw);

  // ── monthlySavings (retirement-v2.tsx:1306-1311) ────────────────────────────
  let monthlySavings = 0;
  if (income > 0) {
    const annualSavings =
      Math.max(0, income * 0.75 - monthlySpend * 12) + income * (matchPct / 100);
    monthlySavings = Math.max(0, Math.min(15000, Math.round(annualSavings / 12 / 50) * 50));
  }

  // ── ssMonthly (retirement-v2.tsx:1345, default ssClaimAge 67) ────────────────
  const ssClaimAge = 67;
  const ssMonthly = estimateSSMonthly(income, ssClaimAge);

  const derived: SimInputs = {
    currentAge,
    retirementAge,
    planThroughAge: 90,
    startingBalance: raw.startingBalance,
    monthlySavings,
    monthlySpend,
    strategy: "constant_dollar",
    ssMonthly,
    ssClaimAge,
    otherMonthly: 0,
    otherStartAge: retirementAge,
    allocation: raw.allocation,
    inflationAdjusted: true,
    numSimulations: 1000,
  };

  return { ...derived, ...overrides };
}
