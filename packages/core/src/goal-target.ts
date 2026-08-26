import { z } from "zod";

/**
 * Goal targets, computed once.
 *
 * Five goal categories are "typed": the user describes the thing they are
 * saving for (a house at this price, this many months of expenses) and we do
 * the arithmetic. Everything else keeps a plain target amount and stores no
 * details.
 *
 * This module is the ONLY place that turns a description into dollars. The
 * create form, the edit form and the API all call `resolveGoalTarget`, so the
 * number a user sees while typing is byte-for-byte the number that gets stored
 * in `goals.target_amount`.
 */

export const TYPED_GOAL_CATEGORIES = [
  "home_purchase",
  "car",
  "education",
  "retirement",
  "emergency_fund",
] as const;

export type TypedGoalCategory = (typeof TYPED_GOAL_CATEGORIES)[number];

export const TYPED_GOAL_CATEGORY_SET: ReadonlySet<string> = new Set(TYPED_GOAL_CATEGORIES);

export function isTypedGoalCategory(category: string): category is TypedGoalCategory {
  return TYPED_GOAL_CATEGORY_SET.has(category);
}

// ── Shapes ────────────────────────────────────────────────────────────────

const money = z.number().finite().positive();
const percent = z.number().finite().min(0).max(100);
/** ISO calendar date, "YYYY-MM-DD". */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A deadline expressed as an age to reach, or a calendar date. Both optional. */
const byAge = z.number().int().min(1).max(120).nullish();
const byDate = isoDate.nullish();

export const homePurchaseDetailsSchema = z.object({
  kind: z.literal("home_purchase"),
  homePrice: money,
  downPaymentPct: percent,
  includeClosingCosts: z.boolean(),
  closingCostPct: percent,
  byAge,
  byDate,
});

export const carDetailsSchema = z.object({
  kind: z.literal("car"),
  vehiclePrice: money,
  payCash: z.boolean(),
  downPaymentPct: percent.nullish(),
  byAge,
  byDate,
});

export const educationDetailsSchema = z.object({
  kind: z.literal("education"),
  annualCost: money,
  years: z.number().int().min(1).max(10),
  startYear: z.number().int().min(1900).max(9999),
});

export const retirementDetailsSchema = z.object({
  kind: z.literal("retirement"),
  targetAge: z.number().int().min(1).max(120).nullish(),
  targetAnnualIncome: money,
});

export const emergencyFundDetailsSchema = z.object({
  kind: z.literal("emergency_fund"),
  months: z.number().int().min(1).max(24),
  /**
   * The monthly spend the target was priced from, captured at save time. Stored
   * so the derivation line stays true to the number in `target_amount` even
   * after the user's trailing spend moves.
   */
  monthlySpendUsed: money,
});

export const goalDetailsSchema = z.discriminatedUnion("kind", [
  homePurchaseDetailsSchema,
  carDetailsSchema,
  educationDetailsSchema,
  retirementDetailsSchema,
  emergencyFundDetailsSchema,
]);

export type GoalDetails = z.infer<typeof goalDetailsSchema>;
export type HomePurchaseDetails = z.infer<typeof homePurchaseDetailsSchema>;
export type CarDetails = z.infer<typeof carDetailsSchema>;
export type EducationDetails = z.infer<typeof educationDetailsSchema>;
export type RetirementDetails = z.infer<typeof retirementDetailsSchema>;
export type EmergencyFundDetails = z.infer<typeof emergencyFundDetailsSchema>;

/** The 4% rule: a portfolio 25x your annual spend. Mirrors the priorities
 *  ladder's financial-independence layer, so the app says one thing. */
export const RETIREMENT_INCOME_MULTIPLE = 25;

// ── Formatting ────────────────────────────────────────────────────────────

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Percents read as people write them: "20%", "3.5%" — never "20.00%". */
function pct(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

/** Round to whole cents so the stored numeric never carries float dust. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── The calculator ────────────────────────────────────────────────────────

export interface ResolvedGoalTarget {
  /** Dollars to store in `goals.target_amount`. */
  target: number;
  /** One plain sentence stating how the target was derived. */
  derivation: string;
}

/**
 * Turn a goal's details into its target amount plus a sentence explaining it.
 * Returns null when the category and the details disagree, or when the details
 * do not describe a positive target.
 */
export function resolveGoalTarget(
  category: string,
  details: GoalDetails | null | undefined,
): ResolvedGoalTarget | null {
  if (!details) return null;
  if (category !== details.kind) return null;

  switch (details.kind) {
    case "home_purchase": {
      const down = details.homePrice * (details.downPaymentPct / 100);
      const closing = details.includeClosingCosts
        ? details.homePrice * (details.closingCostPct / 100)
        : 0;
      const target = cents(down + closing);
      if (!(target > 0)) return null;
      return {
        target,
        derivation: details.includeClosingCosts
          ? `${pct(details.downPaymentPct)} of ${usd(details.homePrice)} plus ${pct(details.closingCostPct)} closing costs.`
          : `${pct(details.downPaymentPct)} of ${usd(details.homePrice)}.`,
      };
    }

    case "car": {
      if (details.payCash) {
        const target = cents(details.vehiclePrice);
        if (!(target > 0)) return null;
        return { target, derivation: `The full price of ${usd(details.vehiclePrice)}.` };
      }
      if (details.downPaymentPct == null) return null;
      const target = cents(details.vehiclePrice * (details.downPaymentPct / 100));
      if (!(target > 0)) return null;
      return {
        target,
        derivation: `${pct(details.downPaymentPct)} of ${usd(details.vehiclePrice)}.`,
      };
    }

    case "education": {
      const target = cents(details.annualCost * details.years);
      if (!(target > 0)) return null;
      return {
        target,
        derivation: `${details.years} year${details.years === 1 ? "" : "s"} at ${usd(details.annualCost)} a year.`,
      };
    }

    case "retirement": {
      const target = cents(details.targetAnnualIncome * RETIREMENT_INCOME_MULTIPLE);
      if (!(target > 0)) return null;
      return {
        target,
        derivation: `${RETIREMENT_INCOME_MULTIPLE} times ${usd(details.targetAnnualIncome)} a year (the 4% rule).`,
      };
    }

    case "emergency_fund": {
      const target = cents(details.months * details.monthlySpendUsed);
      if (!(target > 0)) return null;
      return {
        target,
        derivation: `${details.months} month${details.months === 1 ? "" : "s"} at ${usd(details.monthlySpendUsed)} a month, your average spending over the last 3 months.`,
      };
    }
  }
}

// ── Deadlines ─────────────────────────────────────────────────────────────

/** The calendar date someone born on `dob` turns `age`, as "YYYY-MM-DD". */
export function dateAtAge(dob: string, age: number): string | null {
  const born = new Date(`${dob.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const at = new Date(born);
  at.setUTCFullYear(born.getUTCFullYear() + age);
  return at.toISOString().slice(0, 10);
}

/**
 * The deadline a typed goal implies, as "YYYY-MM-DD", or null when it has none.
 * Education always lands on the September the school year starts.
 */
export function resolveGoalDeadline(
  details: GoalDetails | null | undefined,
  dateOfBirth: string | null | undefined,
): string | null {
  if (!details) return null;
  switch (details.kind) {
    case "home_purchase":
    case "car":
      if (details.byDate) return details.byDate;
      if (details.byAge != null && dateOfBirth) return dateAtAge(dateOfBirth, details.byAge);
      return null;
    case "education":
      return `${details.startYear}-09-01`;
    case "retirement":
      if (details.targetAge != null && dateOfBirth) return dateAtAge(dateOfBirth, details.targetAge);
      return null;
    case "emergency_fund":
      return null;
  }
}

// ── Request parsing ───────────────────────────────────────────────────────

export type ParsedGoalDetails =
  | { ok: true; details: GoalDetails | null }
  | { ok: false; error: string };

/**
 * Validate a `details` blob off the wire against the goal's own category.
 * A blob for the wrong category, a malformed blob, or details on a category
 * that does not take them are all rejected — callers return 400 and write
 * nothing, so a goal can never carry details that contradict it.
 */
export function parseGoalDetails(category: string, raw: unknown): ParsedGoalDetails {
  if (raw === undefined || raw === null) return { ok: true, details: null };

  if (!isTypedGoalCategory(category)) {
    return { ok: false, error: `Goal category "${category}" does not take details` };
  }

  const parsed = goalDetailsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "details is not a valid goal detail shape" };
  }
  if (parsed.data.kind !== category) {
    return {
      ok: false,
      error: `details.kind "${parsed.data.kind}" does not match goal category "${category}"`,
    };
  }
  if (!resolveGoalTarget(category, parsed.data)) {
    return { ok: false, error: "details do not resolve to a target above zero" };
  }
  return { ok: true, details: parsed.data };
}
