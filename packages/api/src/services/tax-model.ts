/**
 * 2025 Federal Tax Model — planning estimates only.
 * NOT tax advice. Does not include state tax, NIIT (3.8%), AMT, or IRMAA.
 * Sources: IRS Rev. Proc. 2024-40 (2025 inflation adjustments).
 */

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type FilingStatus =
  | "single"
  | "married_joint"
  | "married_separate"
  | "head_of_household";

export const FILING_STATUSES: FilingStatus[] = [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
];

export const TAX_YEAR = 2025;
export const DEFERRED_401K_LIMIT = 23_500;
export const RULE_OF_55 = 55;
export const PENALTY_FREE_AGE = 59.5;
export const HSA_NONMEDICAL_AGE = 65;
export const RMD_AGE = 73;

// ---------------------------------------------------------------------------
// Standard deduction (2025)
// ---------------------------------------------------------------------------

const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 15_000,
  married_joint: 30_000,
  married_separate: 15_000,
  head_of_household: 22_500,
};

export function standardDeduction(fs: FilingStatus): number {
  return STANDARD_DEDUCTION[fs];
}

// ---------------------------------------------------------------------------
// Ordinary income brackets (2025)
// Each entry: [rate, upperBoundary] — last entry has Infinity as boundary.
// Tax on income in a band = rate * min(income_remaining, band_width).
// ---------------------------------------------------------------------------

type Bracket = [rate: number, upperBoundary: number];

const ORDINARY_BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    [0.10,  11_925],
    [0.12,  48_475],
    [0.22, 103_350],
    [0.24, 197_300],
    [0.32, 250_525],
    [0.35, 626_350],
    [0.37, Infinity],
  ],
  married_joint: [
    [0.10,  23_850],
    [0.12,  96_950],
    [0.22, 206_700],
    [0.24, 394_600],
    [0.32, 501_050],
    [0.35, 751_600],
    [0.37, Infinity],
  ],
  married_separate: [
    // Same as single through 32%, then 35% to $375,800
    [0.10,  11_925],
    [0.12,  48_475],
    [0.22, 103_350],
    [0.24, 197_300],
    [0.32, 250_525],
    [0.35, 375_800],
    [0.37, Infinity],
  ],
  head_of_household: [
    [0.10,  17_000],
    [0.12,  64_850],
    [0.22, 103_350],
    [0.24, 197_300],
    [0.32, 250_500],
    [0.35, 626_350],
    [0.37, Infinity],
  ],
};

export function ordinaryTax(taxableOrdinary: number, fs: FilingStatus): number {
  if (taxableOrdinary <= 0) return 0;
  const brackets = ORDINARY_BRACKETS[fs];
  let tax = 0;
  let prev = 0;
  let remaining = taxableOrdinary;
  for (const [rate, upper] of brackets) {
    const bandWidth = upper === Infinity ? remaining : upper - prev;
    const inBand = Math.min(remaining, bandWidth);
    tax += rate * inBand;
    remaining -= inBand;
    if (remaining <= 0) break;
    prev = upper;
  }
  return tax;
}

// ---------------------------------------------------------------------------
// Long-term capital gains (LTCG) brackets (2025)
// Income thresholds are taxable-income levels (ordinary + LTCG stacked).
// ---------------------------------------------------------------------------

/** Upper boundary of the 0% LTCG band (taxable income level). */
const LTCG_0_CEILING: Record<FilingStatus, number> = {
  single:            48_350,
  married_joint:     96_700,
  married_separate:  48_350,
  head_of_household: 64_750,
};

/** Upper boundary of the 15% LTCG band (taxable income level). */
const LTCG_15_CEILING: Record<FilingStatus, number> = {
  single:            533_400,
  married_joint:     600_050,
  married_separate:  300_000,
  head_of_household: 566_700,
};

/** Maximum additional ordinary taxable income that can be offset against 0% LTCG. */
export function zeroLtcgCeiling(ordinaryTaxable: number, fs: FilingStatus): number {
  return Math.max(0, LTCG_0_CEILING[fs] - ordinaryTaxable);
}

/**
 * Federal LTCG tax on `gain` dollars of long-term capital gains when the
 * filer already has `ordinaryTaxable` dollars of ordinary taxable income.
 * Gains stack on top of ordinary income for rate determination.
 */
export function ltcgTax(
  gain: number,
  ordinaryTaxable: number,
  fs: FilingStatus,
): number {
  if (gain <= 0) return 0;
  const c0 = LTCG_0_CEILING[fs];
  const c15 = LTCG_15_CEILING[fs];

  // Amount of gain in the 0% band
  const in0 = Math.max(0, Math.min(c0 - ordinaryTaxable, gain));
  // Amount of gain in the 15% band
  const in15 = Math.max(0, Math.min(c15 - Math.max(ordinaryTaxable, c0), gain - in0));
  // Remainder at 20%
  const in20 = gain - in0 - in15;

  return 0 * in0 + 0.15 * in15 + 0.20 * in20;
}

// ---------------------------------------------------------------------------
// Social Security taxability (provisional income formula)
// ---------------------------------------------------------------------------

/**
 * Thresholds: [base, second] of provisional income above which SS becomes taxable.
 * married_separate is treated as always taxable at 85% cap (base = 0, second = 0).
 */
const SS_THRESHOLDS: Record<FilingStatus, [base: number, second: number]> = {
  single:            [25_000, 34_000],
  married_joint:     [32_000, 44_000],
  head_of_household: [25_000, 34_000],
  married_separate:  [0,      0],
};

/**
 * Returns the taxable portion of Social Security benefits.
 * `otherOrdinaryIncome` = AGI minus SS benefits (wages, interest, distributions, etc.).
 * Provisional income = otherOrdinaryIncome + 0.5 * ssBenefit.
 */
export function taxableSocialSecurity(
  ssBenefit: number,
  otherOrdinaryIncome: number,
  fs: FilingStatus,
): number {
  if (ssBenefit <= 0) return 0;
  const [base, second] = SS_THRESHOLDS[fs];
  const provisional = otherOrdinaryIncome + 0.5 * ssBenefit;

  // married_separate: thresholds are 0/0 — falls immediately into 85% territory
  if (provisional <= base) return 0;

  const max85 = Math.round(0.85 * ssBenefit);

  if (provisional > second) {
    // Above second threshold → up to 85%
    // IRS formula: 85% of (provisional - second) + lesser of (0.5*SS or 4,500/6,000)
    // Per IRS Pub 915 Worksheet (single/HoH: $4,500; MFJ: $6,000)
    const tier2Cap = fs === "married_joint" ? 6_000 : 4_500;
    const tier1 = Math.min(0.5 * ssBenefit, tier2Cap);
    const tier2 = 0.85 * (provisional - second) + tier1;
    return Math.min(Math.round(tier2), max85);
  }

  // Between base and second → up to 50%
  const max50 = Math.min(0.5 * ssBenefit, 0.5 * (provisional - base));
  return Math.round(max50);
}

// ---------------------------------------------------------------------------
// Roth conversion headroom
// ---------------------------------------------------------------------------

/**
 * Returns how much additional ordinary income (e.g., a Roth conversion) can
 * be added before crossing into a higher bracket.
 * `bracketTopPct` is 12 or 22 (the bracket whose ceiling we target).
 */
export function rothConversionRoom(
  otherOrdinaryIncome: number,
  fs: FilingStatus,
  bracketTopPct: 10 | 12 | 22 | 24 | 32 | 35,
): number {
  const brackets = ORDINARY_BRACKETS[fs];
  const rateTarget = bracketTopPct / 100;
  const bracket = brackets.find(([rate]) => rate === rateTarget);
  if (!bracket) return 0;
  const [, upper] = bracket;
  return Math.max(0, upper - otherOrdinaryIncome);
}

// ---------------------------------------------------------------------------
// 72(t) SEPP — amortization method
// ---------------------------------------------------------------------------

/**
 * Computes the annual SEPP payment under the amortization method.
 *   payment = balance * r / (1 - (1+r)^-n)
 * where r = 5% (IRS-selected interest rate for planning) and
 * n = single-life expectancy approximated as max(1, 84 - age).
 * At age 45 → n = 39, yielding ~$58,000 on a $1M balance.
 * This is a planning estimate; actual SEPP uses IRS 72(t) guidance.
 */
export function sepp72tAnnual(balance: number, age: number): number {
  const r = 0.05;
  const n = Math.max(1, 84 - age);
  return balance * r / (1 - Math.pow(1 + r, -n));
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Maps raw profile enum values (from the DB) to a FilingStatus.
 * "qualifying_widow" is treated as "married_joint" (same tax treatment for 2 years).
 */
export function toFilingStatus(raw: string | null | undefined): FilingStatus {
  switch (raw) {
    case "single":             return "single";
    case "married_joint":      return "married_joint";
    case "married_separate":   return "married_separate";
    case "head_of_household":  return "head_of_household";
    case "qualifying_widow":   return "married_joint";
    default:                   return "single";
  }
}
