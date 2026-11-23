import {
  isTypedGoalCategory,
  resolveGoalDeadline,
  resolveGoalTarget,
  type GoalDetails,
  type TypedGoalCategory,
} from "@lasagna/core/goal-target";
import { formatMoney, formatStoredMonth } from "./format";

// The goal forms' logic, ported from packages/web/src/pages/goal-details.tsx
// (the typed fields, their checks and the live target) without its React.
// The target itself comes from resolveGoalTarget in @lasagna/core, the same
// function the API stores target_amount with, so the sheet's number and the
// saved goal cannot disagree.

export { isTypedGoalCategory };
export type { GoalDetails, TypedGoalCategory };

/** Raw field strings for every typed kind. The form keeps one per kind, so switching back restores what was typed. */
export interface DetailDraft {
  homePrice: string;
  downPaymentPct: string;
  includeClosingCosts: boolean;
  closingCostPct: string;
  vehiclePrice: string;
  carPayCash: boolean;
  carDownPaymentPct: string;
  annualCost: string;
  years: string;
  startYear: string;
  targetAge: string;
  targetAnnualIncome: string;
  months: string;
  dateMode: "age" | "date";
  byAge: string;
  byDate: string;
}

export type DraftField = keyof DetailDraft;

/** The two facts the typed fields need about the user. */
export interface GoalFormContext {
  dateOfBirth: string | null;
  currentAge: number | null;
  /** The profile's retirement age: a retirement goal starts from it. */
  retirementAge: number | null;
  /** The household's monthly spend, the server's one definition. */
  monthlySpend: number | null;
  loaded: boolean;
}

export const EMPTY_CONTEXT: GoalFormContext = { dateOfBirth: null, currentAge: null, retirementAge: null, monthlySpend: null, loaded: false };

const BLANK: DetailDraft = {
  homePrice: "",
  downPaymentPct: "",
  includeClosingCosts: true,
  closingCostPct: "",
  vehiclePrice: "",
  carPayCash: false,
  carDownPaymentPct: "",
  annualCost: "",
  years: "",
  startYear: "",
  targetAge: "",
  targetAnnualIncome: "",
  months: "",
  dateMode: "age",
  byAge: "",
  byDate: "",
};

/** The profile's retirement age, but only one the form would accept. */
function seedableAge(ctx: GoalFormContext): string | null {
  const age = ctx.retirementAge;
  if (age == null || !Number.isInteger(age) || age < 1 || age > 120) return null;
  if (ctx.currentAge != null && age <= ctx.currentAge) return null;
  return String(age);
}

export function emptyDraft(kind: TypedGoalCategory, ctx: GoalFormContext): DetailDraft {
  const dateMode: DetailDraft["dateMode"] = ctx.dateOfBirth ? "age" : "date";
  switch (kind) {
    case "home_purchase":
      return { ...BLANK, downPaymentPct: "20", closingCostPct: "3", includeClosingCosts: true, dateMode };
    case "car":
      return { ...BLANK, carDownPaymentPct: "20", dateMode };
    case "retirement":
      return { ...BLANK, dateMode, targetAge: seedableAge(ctx) ?? "" };
    case "emergency_fund":
      return { ...BLANK, months: "6" };
    default:
      return { ...BLANK, dateMode };
  }
}

/** The form strings for a saved goal's details. */
export function draftFromDetails(details: GoalDetails, ctx: GoalFormContext): DetailDraft {
  const base = emptyDraft(details.kind, ctx);
  const hasDob = !!ctx.dateOfBirth;
  switch (details.kind) {
    case "home_purchase":
      return {
        ...base,
        homePrice: String(details.homePrice),
        downPaymentPct: String(details.downPaymentPct),
        includeClosingCosts: details.includeClosingCosts,
        closingCostPct: String(details.closingCostPct),
        dateMode: details.byDate ? "date" : details.byAge != null || hasDob ? "age" : "date",
        byAge: details.byAge != null ? String(details.byAge) : "",
        byDate: details.byDate ?? "",
      };
    case "car":
      return {
        ...base,
        vehiclePrice: String(details.vehiclePrice),
        carPayCash: details.payCash,
        carDownPaymentPct: details.downPaymentPct != null ? String(details.downPaymentPct) : "",
        dateMode: details.byDate ? "date" : details.byAge != null || hasDob ? "age" : "date",
        byAge: details.byAge != null ? String(details.byAge) : "",
        byDate: details.byDate ?? "",
      };
    case "education":
      return { ...base, annualCost: String(details.annualCost), years: String(details.years), startYear: String(details.startYear) };
    case "retirement":
      return { ...base, targetAge: details.targetAge != null ? String(details.targetAge) : base.targetAge, targetAnnualIncome: String(details.targetAnnualIncome) };
    case "emergency_fund":
      return { ...base, months: String(details.months) };
  }
}

/** The age a set of details is pinned to, if any. */
export function detailsAge(details: GoalDetails | null | undefined): number | null {
  if (!details) return null;
  if (details.kind === "home_purchase" || details.kind === "car") return details.byAge ?? null;
  if (details.kind === "retirement") return details.targetAge ?? null;
  return null;
}

// ── Checks ─────────────────────────────────────────────────────────────────

export const AMOUNT_ERROR = "Enter an amount above 0.";
export const AMOUNT_TOO_BIG = "Enter an amount under $1 trillion.";
export const PAST_DATE_ERROR = "Choose a date in the future.";
export const CURRENT_ERROR = "Enter 0 or more.";
const PERCENT_ERROR = "Enter a percent above 0 and up to 100.";
const AGE_ERROR = "Enter an age between 1 and 120.";
const YEARS_ERROR = "Enter 1 to 10 years.";
const MONTHS_ERROR = "Enter 1 to 24 months.";
/** numeric(19,2): anything larger is a typo, anything under a cent rounds to 0. */
const MONEY_MAX = 1_000_000_000_000;
const MONEY_MIN = 0.01;

/** Today as YYYY-MM-DD, the floor for a target date. */
export const todayKey = (now: Date = new Date()) => now.toISOString().slice(0, 10);

function num(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Digits only (years, ages, months). */
export const digits = (v: string) => v.replace(/[^0-9]/g, "");

/** A decimal with at most two places: money is kept to the cent, a percent shown to two places. */
export function decimal2(v: string): string {
  const [whole, ...rest] = v.replace(/[^0-9.]/g, "").split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
}

/** The checks a plain goal's own fields need, worded as the typed fields are. */
export function plainFieldErrors(
  fields: { target: string; deadline?: string; current?: string; monthly?: string },
  today: string = todayKey(),
): { target?: string; deadline?: string; current?: string; monthly?: string; ok: boolean } {
  const amount = (raw: string, required: boolean, floor = MONEY_MIN): string | undefined => {
    const tooLow = floor === 0 ? CURRENT_ERROR : AMOUNT_ERROR;
    if (raw.trim() === "") return required ? tooLow : undefined;
    const value = num(raw);
    if (value === null || value < floor) return tooLow;
    if (value > 0 && value < MONEY_MIN) return tooLow;
    return value > MONEY_MAX ? AMOUNT_TOO_BIG : undefined;
  };
  const errors = {
    target: amount(fields.target, true),
    current: fields.current === undefined ? undefined : amount(fields.current, true, 0),
    // Optional means optional: the API reads 0 as no plan.
    monthly: fields.monthly === undefined || num(fields.monthly) === 0 ? undefined : amount(fields.monthly, false),
    deadline: fields.deadline && fields.deadline < today ? PAST_DATE_ERROR : undefined,
  };
  return { ...errors, ok: !Object.values(errors).some(Boolean) };
}

export interface ResolvedDraft {
  /** Complete details ready to send, or null while anything is missing. */
  details: GoalDetails | null;
  target: number | null;
  derivation: string | null;
  deadline: string | null;
  errors: Partial<Record<DraftField, string>>;
  /** What the target slot says while there is no number. */
  prompt: string | null;
  /** The target holds but the goal has no date yet. */
  dateNeeded: string | null;
  /** Emergency fund only: no spending to price months against. */
  spendUnavailable: boolean;
  /** Still waiting on the figures the target is priced from. */
  pending: boolean;
}

interface FieldCheck {
  field: DraftField;
  value: number | null;
  error?: string;
  noun: string;
}

function firstProblem(checks: FieldCheck[]) {
  const errors: Partial<Record<DraftField, string>> = {};
  let unresolved = false;
  let noun: string | null = null;
  let empty = false;
  for (const check of checks) {
    if (check.error) errors[check.field] = check.error;
    if (check.value === null || check.error) {
      if (!unresolved) {
        noun = check.noun;
        empty = check.value === null;
      }
      unresolved = true;
    }
  }
  return { errors, unresolved, noun, empty };
}

function moneyCheck(field: DraftField, raw: string, noun: string): FieldCheck {
  const value = num(raw);
  const error = value === null ? undefined : value < MONEY_MIN ? AMOUNT_ERROR : value > MONEY_MAX ? AMOUNT_TOO_BIG : undefined;
  return { field, value, error, noun };
}

function percentCheck(field: DraftField, raw: string, noun: string): FieldCheck {
  const value = num(raw);
  return { field, value, error: value !== null && !(value > 0 && value <= 100) ? PERCENT_ERROR : undefined, noun };
}

function ageCheck(field: DraftField, raw: string, noun: string, currentAge: number | null): FieldCheck {
  const value = num(raw);
  const outOfRange = value !== null && !(Number.isInteger(value) && value >= 1 && value <= 120);
  const tooYoung = value !== null && currentAge !== null && value <= currentAge;
  return {
    field,
    value,
    error: outOfRange ? AGE_ERROR : tooYoung ? `Choose an age above your current age (${currentAge}).` : undefined,
    noun,
  };
}

function dateChecks(draft: DetailDraft, ctx: GoalFormContext, today: string): FieldCheck[] {
  if (draft.dateMode === "age") return [ageCheck("byAge", draft.byAge, "age you want it by", ctx.currentAge)];
  const past = !!draft.byDate && draft.byDate < today;
  return [{ field: "byDate", value: draft.byDate ? 1 : null, error: past ? PAST_DATE_ERROR : undefined, noun: "target date" }];
}

/**
 * A typed draft turned into its target, derivation, deadline and field errors.
 * `saved` is what the goal being edited already holds, so a failed lookup or a
 * birth date since removed cannot make a saved goal unsaveable.
 */
export function resolveDraft(
  kind: TypedGoalCategory,
  draft: DetailDraft,
  ctx: GoalFormContext,
  saved?: { monthlySpend?: number | null; deadline?: string | null; age?: number | null },
  now: Date = new Date(),
): ResolvedDraft {
  const today = todayKey(now);
  const empty: ResolvedDraft = { details: null, target: null, derivation: null, deadline: null, errors: {}, prompt: null, dateNeeded: null, spendUnavailable: false, pending: false };
  let targetChecks: FieldCheck[] = [];
  let dateGroup: FieldCheck[] = [];
  let details: GoalDetails | null = null;

  switch (kind) {
    case "home_purchase": {
      targetChecks = [
        moneyCheck("homePrice", draft.homePrice, "home price"),
        percentCheck("downPaymentPct", draft.downPaymentPct, "down payment percent"),
        ...(draft.includeClosingCosts ? [percentCheck("closingCostPct", draft.closingCostPct, "closing costs percent")] : []),
      ];
      dateGroup = dateChecks(draft, ctx, today);
      const [price, down, closing] = [num(draft.homePrice), num(draft.downPaymentPct), num(draft.closingCostPct)];
      if (price !== null && down !== null && (!draft.includeClosingCosts || closing !== null)) {
        details = {
          kind: "home_purchase",
          homePrice: price,
          downPaymentPct: down,
          includeClosingCosts: draft.includeClosingCosts,
          closingCostPct: closing !== null && closing > 0 && closing <= 100 ? closing : 3,
          byAge: draft.dateMode === "age" ? num(draft.byAge) : null,
          byDate: draft.dateMode === "date" ? draft.byDate || null : null,
        };
      }
      break;
    }
    case "car": {
      targetChecks = [
        moneyCheck("vehiclePrice", draft.vehiclePrice, "vehicle price"),
        ...(draft.carPayCash ? [] : [percentCheck("carDownPaymentPct", draft.carDownPaymentPct, "down payment percent")]),
      ];
      dateGroup = dateChecks(draft, ctx, today);
      const [price, down] = [num(draft.vehiclePrice), num(draft.carDownPaymentPct)];
      if (price !== null && (draft.carPayCash || down !== null)) {
        details = {
          kind: "car",
          vehiclePrice: price,
          payCash: draft.carPayCash,
          downPaymentPct: draft.carPayCash ? null : down,
          byAge: draft.dateMode === "age" ? num(draft.byAge) : null,
          byDate: draft.dateMode === "date" ? draft.byDate || null : null,
        };
      }
      break;
    }
    case "education": {
      const years = num(draft.years);
      const thisYear = now.getFullYear();
      const startYear = num(draft.startYear);
      targetChecks = [
        moneyCheck("annualCost", draft.annualCost, "yearly cost"),
        { field: "years", value: years, error: years !== null && !(Number.isInteger(years) && years >= 1 && years <= 10) ? YEARS_ERROR : undefined, noun: "number of years" },
      ];
      dateGroup = [
        {
          field: "startYear",
          value: startYear,
          error: startYear !== null && !(startYear >= thisYear && startYear <= thisYear + 30) ? `Enter a year between ${thisYear} and ${thisYear + 30}.` : undefined,
          noun: "year it starts",
        },
      ];
      const cost = num(draft.annualCost);
      // The start year only sets the deadline, so the number shows before it is typed. It can't be saved until it is.
      if (cost !== null && years !== null) details = { kind: "education", annualCost: cost, years, startYear: startYear ?? thisYear };
      break;
    }
    case "retirement": {
      targetChecks = [moneyCheck("targetAnnualIncome", draft.targetAnnualIncome, "yearly income in retirement")];
      // The age pins a date only with a birth date, so only then is it required. It is always checked.
      const age = ageCheck("targetAge", draft.targetAge, "target retirement age", ctx.currentAge);
      dateGroup = ctx.dateOfBirth ? [age] : [];
      const income = num(draft.targetAnnualIncome);
      if (income !== null && !age.error) details = { kind: "retirement", targetAge: age.value, targetAnnualIncome: income };
      break;
    }
    case "emergency_fund": {
      if (!ctx.loaded) return { ...empty, pending: true };
      const spend = ctx.monthlySpend ?? saved?.monthlySpend ?? null;
      if (spend === null || !(spend > 0)) return { ...empty, spendUnavailable: true };
      const months = num(draft.months);
      targetChecks = [
        { field: "months", value: months, error: months !== null && !(Number.isInteger(months) && months >= 1 && months <= 24) ? MONTHS_ERROR : undefined, noun: "number of months" },
      ];
      if (months !== null) details = { kind: "emergency_fund", months, monthlySpendUsed: spend };
      break;
    }
  }

  const targetProblem = firstProblem(targetChecks);
  const dateProblem = firstProblem(dateGroup);
  const strayErrors: Partial<Record<DraftField, string>> = {};
  if (kind === "retirement") {
    const age = ageCheck("targetAge", draft.targetAge, "target retirement age", ctx.currentAge);
    if (age.error) strayErrors.targetAge = age.error;
  }
  const resolved = targetProblem.unresolved ? null : resolveGoalTarget(kind, details);
  const age = detailsAge(details);

  return {
    details: resolved && !dateProblem.unresolved ? details : null,
    target: resolved?.target ?? null,
    derivation: resolved?.derivation ?? null,
    deadline: resolved ? resolveGoalDeadline(details, ctx.dateOfBirth) ?? (age != null && age === saved?.age ? saved?.deadline ?? null : null) : null,
    errors: { ...targetProblem.errors, ...dateProblem.errors, ...strayErrors },
    prompt: targetProblem.unresolved
      ? `${targetProblem.empty ? "Add" : "Fix"} the ${targetProblem.noun} to see your target.`
      : resolved === null && targetChecks[0]
        ? `Fix the ${targetChecks[0].noun} to see your target.`
        : null,
    dateNeeded: !targetProblem.unresolved && dateProblem.unresolved && dateProblem.empty ? `Add the ${dateProblem.noun} to save this goal.` : null,
    spendUnavailable: false,
    pending: false,
  };
}

/** The monthly amount that reaches `target` by `deadline`, or null when the date has passed or nothing is left. */
export function monthlyPace(target: number, saved: number, deadline: string | null, now: Date = new Date()): { amount: number; by: string } | null {
  if (!deadline) return null;
  const due = new Date(`${deadline.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(due)) return null;
  const months = Math.ceil((due - now.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  const remaining = target - saved;
  if (months < 1 || remaining <= 0) return null;
  return { amount: Math.ceil(remaining / months), by: formatStoredMonth(deadline, { month: "long" }) };
}

export const paceText = (pace: { amount: number; by: string }) => `${formatMoney(pace.amount, true)} a month reaches this by ${pace.by}.`;

/** The opt-in for a goal saved before its kind could describe itself. */
export const CALCULATE_LABELS: Record<TypedGoalCategory, string> = {
  home_purchase: "Calculate from a home price",
  car: "Calculate from a vehicle price",
  education: "Calculate from a yearly cost",
  retirement: "Calculate from a yearly income",
  emergency_fund: "Calculate from months of expenses",
};
