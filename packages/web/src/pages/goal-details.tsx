import { useEffect, useId, useState, type ReactElement } from 'react';
import {
  isTypedGoalCategory,
  resolveGoalTarget,
  resolveGoalDeadline,
  type GoalDetails,
  type TypedGoalCategory,
} from '@lasagna/core/goal-target';
import { api } from '../lib/api';
import { AlertCircle } from 'lucide-react';
import { Button, Field, Input, Label, SegmentedControl, Skeleton, type InputProps } from '../components/uikit';
import { cn } from '../lib/utils';
import { formatCurrency } from './goal-shared';

// ---------------------------------------------------------------------------
// Typed goals — the fields each kind needs, and the target they add up to.
//
// Five categories describe the thing being saved for, so the user states the
// house price or the months of expenses and we do the arithmetic. The number
// shown here comes from resolveGoalTarget in @lasagna/core, the same function
// the API writes target_amount with, so the readout and the stored goal can
// never disagree. Every other category keeps a plain target amount.
// ---------------------------------------------------------------------------

export { isTypedGoalCategory, resolveGoalTarget };
export type { GoalDetails, TypedGoalCategory };

// ── Draft state ───────────────────────────────────────────────────────────

/** Raw form strings for every typed kind. One draft per kind is held by the
 *  form, so switching category and back restores what was typed. */
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
  dateMode: 'age' | 'date';
  byAge: string;
  byDate: string;
}

export type DraftField = keyof DetailDraft;

const BLANK: DetailDraft = {
  homePrice: '',
  downPaymentPct: '',
  includeClosingCosts: true,
  closingCostPct: '',
  vehiclePrice: '',
  carPayCash: false,
  carDownPaymentPct: '',
  annualCost: '',
  years: '',
  startYear: '',
  targetAge: '',
  targetAnnualIncome: '',
  months: '',
  dateMode: 'age',
  byAge: '',
  byDate: '',
};

export function emptyDraft(kind: TypedGoalCategory, ctx: GoalFormContext): DetailDraft {
  const dateMode: DetailDraft['dateMode'] = ctx.dateOfBirth ? 'age' : 'date';
  switch (kind) {
    case 'home_purchase':
      return { ...BLANK, downPaymentPct: '20', closingCostPct: '3', includeClosingCosts: true, dateMode };
    case 'car':
      return { ...BLANK, carDownPaymentPct: '20', dateMode };
    case 'retirement':
      return {
        ...BLANK,
        dateMode,
        // Settings does not police this number, and a seeded value the form
        // would reject is worse than none: with no birth date the field is
        // not even on screen, so the error would have nowhere to show.
        targetAge: seedableAge(ctx) ?? '',
      };
    case 'emergency_fund':
      return { ...BLANK, months: '6' };
    default:
      return { ...BLANK, dateMode };
  }
}

/** The checks a plain goal's own fields need. The typed fields get these from
 *  resolveDraft; a hand-entered amount deserves the same answer, and the same
 *  words, rather than a 500 from a value the column cannot take. */
export function plainFieldErrors(fields: {
  target: string;
  deadline?: string;
  /** Present only on the edit panel, where the goal already holds a balance. */
  current?: string;
  monthly?: string;
}): { target?: string; deadline?: string; current?: string; monthly?: string; ok: boolean } {
  const amount = (raw: string, required: boolean, floor = MONEY_MIN): string | undefined => {
    // "0 or more" for a balance a goal may genuinely not have yet, "above 0"
    // for a target that would mean nothing at zero.
    const tooLow = floor === 0 ? CURRENT_ERROR : AMOUNT_ERROR;
    if (raw.trim() === '') return required ? tooLow : undefined;
    const value = num(raw);
    if (value === null || value < floor) return tooLow;
    // 0 can be a real answer, but a fraction of a cent is stored as 0.00 and
    // then shown as $0, which is not what was typed.
    if (value > 0 && value < MONEY_MIN) return tooLow;
    return value > MONEY_MAX ? AMOUNT_TOO_BIG : undefined;
  };
  const errors = {
    target: amount(fields.target, true),
    // A goal can genuinely hold nothing yet, so 0 is a real answer here.
    current: fields.current === undefined ? undefined : amount(fields.current, true, 0),
    // "Optional" has to mean it: the API already reads 0 as no plan at all,
    // so refusing it here would block a save that used to work.
    monthly:
      fields.monthly === undefined || num(fields.monthly) === 0
        ? undefined
        : amount(fields.monthly, false),
    deadline: fields.deadline && fields.deadline < TODAY ? PAST_DATE_ERROR : undefined,
  };
  return { ...errors, ok: !Object.values(errors).some(Boolean) };
}

/** The age a set of details is pinned to, if it is pinned to one at all. */
function draftAge(details: GoalDetails | null): number | null {
  if (!details) return null;
  if (details.kind === 'home_purchase' || details.kind === 'car') return details.byAge ?? null;
  if (details.kind === 'retirement') return details.targetAge ?? null;
  return null;
}

/** The profile's retirement age, but only when the form would accept it. */
function seedableAge(ctx: GoalFormContext): string | null {
  const age = ctx.retirementAge;
  if (age == null || !Number.isInteger(age) || age < 1 || age > 120) return null;
  if (ctx.currentAge != null && age <= ctx.currentAge) return null;
  return String(age);
}

/** Rebuild the form strings from a saved goal's details, for the edit form. */
export function draftFromDetails(details: GoalDetails, ctx: GoalFormContext): DetailDraft {
  const base = emptyDraft(details.kind, ctx);
  const hasDob = !!ctx.dateOfBirth;
  switch (details.kind) {
    case 'home_purchase':
      return {
        ...base,
        homePrice: String(details.homePrice),
        downPaymentPct: String(details.downPaymentPct),
        includeClosingCosts: details.includeClosingCosts,
        closingCostPct: String(details.closingCostPct),
        dateMode: details.byDate ? 'date' : details.byAge != null || hasDob ? 'age' : 'date',
        byAge: details.byAge != null ? String(details.byAge) : '',
        byDate: details.byDate ?? '',
      };
    case 'car':
      return {
        ...base,
        vehiclePrice: String(details.vehiclePrice),
        carPayCash: details.payCash,
        carDownPaymentPct: details.downPaymentPct != null ? String(details.downPaymentPct) : '',
        dateMode: details.byDate ? 'date' : details.byAge != null || hasDob ? 'age' : 'date',
        byAge: details.byAge != null ? String(details.byAge) : '',
        byDate: details.byDate ?? '',
      };
    case 'education':
      return {
        ...base,
        annualCost: String(details.annualCost),
        years: String(details.years),
        startYear: String(details.startYear),
      };
    case 'retirement':
      return {
        ...base,
        // A goal saved with no birth date has no age of its own, so it falls
        // back to the profile's rather than starting blank.
        targetAge: details.targetAge != null ? String(details.targetAge) : base.targetAge,
        targetAnnualIncome: String(details.targetAnnualIncome),
      };
    case 'emergency_fund':
      return { ...base, months: String(details.months) };
  }
}

// ── Form context (the two facts the fields need about the user) ────────────

export interface GoalFormContext {
  dateOfBirth: string | null;
  currentAge: number | null;
  /** The retirement age from the user's profile. A retirement goal starts
   *  from it so the goal and the retirement plan cannot disagree. */
  retirementAge: number | null;
  /** The household's stable monthly spend, from the server's one definition. */
  monthlySpend: number | null;
  loaded: boolean;
}

const EMPTY_CONTEXT: GoalFormContext = {
  dateOfBirth: null,
  currentAge: null,
  retirementAge: null,
  monthlySpend: null,
  loaded: false,
};

/** Loads the birth date and the monthly-spend baseline the moment a goal form
 *  opens. Both are only needed by the typed fields, so nothing is fetched
 *  until one is on screen. */
export function useGoalFormContext(active: boolean): GoalFormContext {
  const [ctx, setCtx] = useState<GoalFormContext>(EMPTY_CONTEXT);

  useEffect(() => {
    if (!active || ctx.loaded) return;
    let cancelled = false;
    Promise.all([
      api.getFinancialProfile().catch(() => ({ financialProfile: null })),
      api.getGoalSpendBaseline().catch(() => ({ monthlySpend: null, windowMonths: 3 })),
    ]).then(([profile, spend]) => {
      if (cancelled) return;
      setCtx({
        dateOfBirth: profile.financialProfile?.dateOfBirth ?? null,
        currentAge: profile.financialProfile?.age ?? null,
        retirementAge: profile.financialProfile?.retirementAge ?? null,
        monthlySpend: spend.monthlySpend,
        loaded: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [active, ctx.loaded]);

  return ctx;
}

// ── Resolving a draft ─────────────────────────────────────────────────────

export const AMOUNT_ERROR = 'Enter an amount above 0.';
/** What the goals table can hold: numeric(19,2). Anything larger is a typo,
 *  and reached the server as a 500 before it was refused here. Anything under
 *  a cent rounds to 0.00 on the way in, which is not what the field promised. */
const MONEY_MAX = 1_000_000_000_000;
const MONEY_MIN = 0.01;
export const AMOUNT_TOO_BIG = 'Enter an amount under $1 trillion.';
export const PAST_DATE_ERROR = 'Choose a date in the future.';
export const CURRENT_ERROR = 'Enter 0 or more.';
// 0 is rejected: a goal priced at 0% of something has no target.
const PERCENT_ERROR = 'Enter a percent above 0 and up to 100.';
const AGE_ERROR = 'Enter an age between 1 and 120.';
const YEARS_ERROR = 'Enter 1 to 10 years.';
const MONTHS_ERROR = 'Enter 1 to 24 months.';

export interface ResolvedDraft {
  /** Valid, complete details ready to send. Null while anything is missing. */
  details: GoalDetails | null;
  target: number | null;
  derivation: string | null;
  deadline: string | null;
  errors: Partial<Record<DraftField, string>>;
  /** What to show in the value slot while no target can be computed. */
  prompt: string | null;
  /** The target holds up but the goal has no date yet, so it can't be saved.
   *  Names the field that is missing, so the sentence points somewhere real. */
  dateNeeded: string | null;
  /** Emergency fund only: there is no spending to price months against. */
  spendUnavailable: boolean;
  /** Still waiting on the figures the target is priced from. */
  pending: boolean;
}

function num(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

interface FieldCheck {
  field: DraftField;
  value: number | null;
  error?: string;
  /** What the readout calls this field while it is holding the target up. */
  noun: string;
}

interface Problems {
  errors: Partial<Record<DraftField, string>>;
  /** Something in this group is empty or unusable. */
  unresolved: boolean;
  /** The field holding things up, and whether it is empty rather than wrong. */
  noun: string | null;
  empty: boolean;
}

/** Walk a group's fields in reading order: the first empty or bad one owns both
 *  the field error and the sentence that stands in for the number. */
function firstProblem(checks: FieldCheck[]): Problems {
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
  const error =
    value === null
      ? undefined
      : value < MONEY_MIN
        ? AMOUNT_ERROR
        : value > MONEY_MAX
          ? AMOUNT_TOO_BIG
          : undefined;
  return { field, value, error, noun };
}

function percentCheck(field: DraftField, raw: string, noun: string): FieldCheck {
  const value = num(raw);
  return {
    field,
    value,
    error: value !== null && !(value > 0 && value <= 100) ? PERCENT_ERROR : undefined,
    noun,
  };
}

function ageCheck(field: DraftField, raw: string, noun: string, currentAge: number | null): FieldCheck {
  const value = num(raw);
  // The range holds even with no birth date on file. Without this an age of
  // 999 looked fine, enabled the button, and came back as a 400 pointing at
  // nothing the user could see.
  const outOfRange = value !== null && !(Number.isInteger(value) && value >= 1 && value <= 120);
  const tooYoung = value !== null && currentAge !== null && value <= currentAge;
  return {
    field,
    value,
    error: outOfRange
      ? AGE_ERROR
      : tooYoung
        ? `Choose an age above your current age (${currentAge}).`
        : undefined,
    noun,
  };
}

function dateChecks(draft: DetailDraft, ctx: GoalFormContext): FieldCheck[] {
  // Age mode is only ever reachable with a birth date on file, or on a goal
  // that was already saved by age. In the second case the age still counts as
  // the goal's date even if we can no longer turn it into one, so an edit
  // does not demand a date the goal never had.
  if (draft.dateMode === 'age') {
    return [ageCheck('byAge', draft.byAge, 'age you want it by', ctx.currentAge)];
  }
  // A date already behind you is no more a target than an age you have passed,
  // which the age path already rejects.
  const past = !!draft.byDate && draft.byDate < new Date().toISOString().slice(0, 10);
  return [
    {
      field: 'byDate',
      value: draft.byDate ? 1 : null,
      error: past ? PAST_DATE_ERROR : undefined,
      noun: 'target date',
    },
  ];
}

export function resolveDraft(
  kind: TypedGoalCategory,
  draft: DetailDraft,
  ctx: GoalFormContext,
  /** What the goal being edited already holds. A live lookup that fails, or a
   *  birth date since removed, must not make a saved goal unsaveable, so the
   *  form falls back to the values it was saved with. */
  saved?: { monthlySpend?: number | null; deadline?: string | null; age?: number | null },
): ResolvedDraft {
  const empty: ResolvedDraft = {
    details: null,
    target: null,
    derivation: null,
    deadline: null,
    errors: {},
    prompt: null,
    dateNeeded: null,
    spendUnavailable: false,
    pending: false,
  };

  // Fields the target itself is built from, then the fields that only pin the
  // date. The number appears as soon as the first group is complete.
  let targetChecks: FieldCheck[] = [];
  let dateGroup: FieldCheck[] = [];
  let details: GoalDetails | null = null;

  switch (kind) {
    case 'home_purchase': {
      targetChecks = [
        moneyCheck('homePrice', draft.homePrice, 'home price'),
        percentCheck('downPaymentPct', draft.downPaymentPct, 'down payment percent'),
        ...(draft.includeClosingCosts
          ? [percentCheck('closingCostPct', draft.closingCostPct, 'closing costs percent')]
          : []),
      ];
      dateGroup = dateChecks(draft, ctx);
      const [price, down, closing] = [num(draft.homePrice), num(draft.downPaymentPct), num(draft.closingCostPct)];
      if (price !== null && down !== null && (!draft.includeClosingCosts || closing !== null)) {
        details = {
          kind: 'home_purchase',
          homePrice: price,
          downPaymentPct: down,
          includeClosingCosts: draft.includeClosingCosts,
          // Kept even when excluded, so toggling closing costs off and back
          // on returns the rate the user set. It is only kept if it is a rate
          // the goal could actually be saved with: an excluded field shows no
          // error, so shipping a bad one would fail with nothing to point at.
          closingCostPct: closing !== null && closing > 0 && closing <= 100 ? closing : 3,
          byAge: draft.dateMode === 'age' ? num(draft.byAge) : null,
          byDate: draft.dateMode === 'date' ? draft.byDate || null : null,
        };
      }
      break;
    }

    case 'car': {
      targetChecks = [
        moneyCheck('vehiclePrice', draft.vehiclePrice, 'vehicle price'),
        ...(draft.carPayCash
          ? []
          : [percentCheck('carDownPaymentPct', draft.carDownPaymentPct, 'down payment percent')]),
      ];
      dateGroup = dateChecks(draft, ctx);
      const [price, down] = [num(draft.vehiclePrice), num(draft.carDownPaymentPct)];
      if (price !== null && (draft.carPayCash || down !== null)) {
        details = {
          kind: 'car',
          vehiclePrice: price,
          payCash: draft.carPayCash,
          downPaymentPct: draft.carPayCash ? null : down,
          byAge: draft.dateMode === 'age' ? num(draft.byAge) : null,
          byDate: draft.dateMode === 'date' ? draft.byDate || null : null,
        };
      }
      break;
    }

    case 'education': {
      const years = num(draft.years);
      const thisYear = new Date().getFullYear();
      const startYear = num(draft.startYear);
      targetChecks = [
        moneyCheck('annualCost', draft.annualCost, 'yearly cost'),
        {
          field: 'years',
          value: years,
          error: years !== null && !(Number.isInteger(years) && years >= 1 && years <= 10) ? YEARS_ERROR : undefined,
          noun: 'number of years',
        },
      ];
      dateGroup = [
        {
          field: 'startYear',
          value: startYear,
          error:
            startYear !== null && !(startYear >= thisYear && startYear <= thisYear + 30)
              ? `Enter a year between ${thisYear} and ${thisYear + 30}.`
              : undefined,
          noun: 'year it starts',
        },
      ];
      const cost = num(draft.annualCost);
      if (cost !== null && years !== null) {
        // The target is cost x years; the start year only sets the deadline.
        // Standing one in lets the number appear while that field is still
        // empty. It can never be saved: `details` is only handed back once the
        // date group resolves, which means a real year was entered.
        details = { kind: 'education', annualCost: cost, years, startYear: startYear ?? thisYear };
      }
      break;
    }

    case 'retirement': {
      targetChecks = [
        moneyCheck('targetAnnualIncome', draft.targetAnnualIncome, 'yearly income in retirement'),
      ];
      // The retirement age exists to pin a date, which needs a birth date.
      // Without one it can only sit there, so it is not asked for and does
      // not hold the goal back. The target is the income either way.
      // The retirement age is only *required* when a birth date can turn it
      // into one, but whatever is in the field is always checked: an unasked
      // for value still travels, and the server refuses a bad one.
      const ageOfRetirement = ageCheck('targetAge', draft.targetAge, 'target retirement age', ctx.currentAge);
      dateGroup = ctx.dateOfBirth ? [ageOfRetirement] : [];
      const income = num(draft.targetAnnualIncome);
      if (income !== null && !ageOfRetirement.error) {
        details = { kind: 'retirement', targetAge: ageOfRetirement.value, targetAnnualIncome: income };
      }
      break;
    }

    case 'emergency_fund': {
      if (!ctx.loaded) return { ...empty, pending: true };
      const spend = ctx.monthlySpend ?? saved?.monthlySpend ?? null;
      if (spend === null || !(spend > 0)) {
        return { ...empty, spendUnavailable: true };
      }
      const months = num(draft.months);
      targetChecks = [
        {
          field: 'months',
          value: months,
          error:
            months !== null && !(Number.isInteger(months) && months >= 1 && months <= 24) ? MONTHS_ERROR : undefined,
          noun: 'number of months',
        },
      ];
      if (months !== null) {
        details = { kind: 'emergency_fund', months, monthlySpendUsed: spend };
      }
      break;
    }
  }

  const targetProblem = firstProblem(targetChecks);
  const dateProblem = firstProblem(dateGroup);
  // A field can be optional and still be wrong. Its error belongs on it
  // either way, or the button goes dead with nothing marked.
  const strayErrors: Partial<Record<DraftField, string>> = {};
  if (kind === 'retirement') {
    const age = ageCheck('targetAge', draft.targetAge, 'target retirement age', ctx.currentAge);
    if (age.error) strayErrors.targetAge = age.error;
  }
  const resolved = targetProblem.unresolved ? null : resolveGoalTarget(kind, details);

  return {
    // Only a fully described goal is ready to save: the target holds up, and
    // the goal has a date.
    details: resolved && !dateProblem.unresolved ? details : null,
    target: resolved?.target ?? null,
    derivation: resolved?.derivation ?? null,
    // Without a birth date an age cannot be turned into a date, but the goal
    // already has one, and the page must not say two different things. The
    // moment that age is edited the old date stops describing it, so it is
    // dropped rather than left contradicting the age beside it.
    deadline: resolved
      ? resolveGoalDeadline(details, ctx.dateOfBirth) ??
        (draftAge(details) != null && draftAge(details) === saved?.age ? saved?.deadline ?? null : null)
      : null,
    errors: { ...targetProblem.errors, ...dateProblem.errors, ...strayErrors },
    // "Add" when the field is empty, "Fix" when what's there can't be used —
    // so the sentence never tells someone to add a value they already typed.
    prompt: targetProblem.unresolved
      ? `${targetProblem.empty ? 'Add' : 'Fix'} the ${targetProblem.noun} to see your target.`
      : // Every field holds a legal value and the target still comes to
        // nothing, which happens when the numbers round to zero. Saying so
        // beats an empty card under a heading.
        resolved === null && targetChecks[0]
        ? `Fix the ${targetChecks[0].noun} to see your target.`
        : null,
    // Only when the date is missing. A date that's present but wrong already
    // has a red error on its own field, and saying it twice would nag.
    dateNeeded:
      !targetProblem.unresolved && dateProblem.unresolved && dateProblem.empty
        ? `Add the ${dateProblem.noun} to save this goal.`
        : null,
    spendUnavailable: false,
    pending: false,
  };
}

// ── Inputs ────────────────────────────────────────────────────────────────

type TextFieldProps = Omit<InputProps, 'onChange' | 'value' | 'type' | 'inputMode'> & {
  value: string;
  onChange: (v: string) => void;
};

const DIGITS = (v: string) => v.replace(/[^0-9]/g, '');
export const DECIMAL = (v: string) => {
  const [whole, ...rest] = v.replace(/[^0-9.]/g, '').split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
};

/** Today, as the date inputs' floor: a target date behind you is not a target. */
export const TODAY = new Date().toISOString().slice(0, 10);

// Money is stored to the cent and a percent is shown to two places, so a
// third decimal in either can only disagree with what is finally kept.
export const DECIMAL_2DP = (v: string) => {
  const [whole, ...rest] = DECIMAL(v).split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
};

// The submit buttons point at the readout to say why they are disabled.
export const READOUT_ID = 'goal-target-readout';
const PACE_ID = 'goal-target-pace';

/** Money field — mirrors the account editor's amount input exactly. */
function MoneyInput({ value, onChange, ...rest }: TextFieldProps) {
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(DECIMAL_2DP(e.target.value))}
      className="ui-tnum"
      leadingIcon={<span className="text-[13px]">$</span>}
    />
  );
}

/** Percent field — the money input's idiom with the unit on the trailing edge. */
function PercentInput({ value, onChange, className, ...rest }: TextFieldProps) {
  return (
    <div className="relative">
      <Input
        {...rest}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(DECIMAL_2DP(e.target.value))}
        className={cn('ui-tnum pr-9', className)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3.5 text-[13px] text-content-muted">
        %
      </span>
    </div>
  );
}

/** Whole-number field (years, ages, months). */
function CountInput({ value, onChange, className, ...rest }: TextFieldProps) {
  return (
    <Input
      {...rest}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(DIGITS(e.target.value))}
      className={cn('ui-tnum', className)}
    />
  );
}

// ── The fields ────────────────────────────────────────────────────────────

/** A segmented control with a label, plus the input it reveals and that input's
 *  error. Not a `Field`: Field wires its <label for> to a single child control,
 *  and a radiogroup has no id to point at, which would leave a dangling `for`.
 *  Everything lives in this one cell, so nothing it owns can become a sibling
 *  grid item and force the auto-fit grid to grow a track it has no room for. */
function ChoiceField({
  label,
  value,
  onChange,
  options,
  error,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  error?: string;
  /** Receives the id to point `aria-describedby` at when there is an error. */
  children?: (descId: string | undefined) => ReactElement | false | null;
}) {
  const id = useId();
  const descId = error ? `${id}-err` : undefined;
  const input = children ? children(descId) : null;
  return (
    // One ordinary cell. The pair holds together because it lives in the same
    // cell and the inner row wraps when the track is narrow. Asking the grid
    // for a second track instead would dictate its column count at every width.
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {/* The row keeps an input's height even when the input is hidden, or
          the toggle jumps up under the finger that just hid it. */}
      <div className="flex min-h-11 flex-wrap items-center gap-2 [&>*:nth-child(2)]:flex-1">
        <SegmentedControl
          aria-label={label}
          stretch={false}
          value={value}
          onChange={onChange}
          options={options}
        />
        {input}
      </div>
      {error && (
        <p id={descId} className="flex items-center gap-1.5 text-[12px] font-medium text-negative">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

export function GoalDetailFields({
  kind,
  draft,
  onChange,
  resolved,
  ctx,
  savedByAge = false,
}: {
  kind: TypedGoalCategory;
  draft: DetailDraft;
  onChange: (patch: Partial<DetailDraft>) => void;
  resolved: ResolvedDraft;
  ctx: GoalFormContext;
  /** The goal being edited was already saved by age. Its age stays offered
   *  even with no birth date on file, or editing one would mean losing it. */
  savedByAge?: boolean;
}): ReactElement {
  const err = resolved.errors;
  // "By age" needs a birth date to land on a calendar date. Without one the
  // segment would be a dead control, so the date input stands alone. This is
  // a fact about the goal, never about how the toggle is currently set: read
  // the draft here and picking "Date" would unmount the way back.
  const canUseAge = !!ctx.dateOfBirth || savedByAge;

  const byAge = draft.dateMode === 'age';

  const dateFields = canUseAge ? (
    <ChoiceField
      label="Reach it by"
      value={draft.dateMode}
      onChange={(v) => onChange({ dateMode: v as DetailDraft['dateMode'] })}
      options={[
        { value: 'age', label: 'Age' },
        { value: 'date', label: 'Date' },
      ]}
      error={byAge ? err.byAge : err.byDate}
    >
      {(descId) =>
        byAge ? (
          <CountInput
            value={draft.byAge}
            onChange={(v) => onChange({ byAge: v })}
            invalid={!!err.byAge}
            aria-label="Age you want it by"
            aria-describedby={descId}
            placeholder="30"
            maxLength={3}
            className="min-w-[92px] flex-1"
          />
        ) : (
          <Input
            type="date"
            min={TODAY}
            value={draft.byDate}
            invalid={!!err.byDate}
            aria-label="Target date"
            aria-describedby={descId}
            onChange={(e) => onChange({ byDate: e.target.value })}
            className="min-w-[92px] flex-1"
          />
        )
      }
    </ChoiceField>
  ) : (
    // No birth date, so "by age" would be a dead control and the date stands
    // alone as an ordinary field.
    <Field label="Target date" error={err.byDate}>
      <Input
        type="date"
        min={TODAY}
        value={draft.byDate}
        invalid={!!err.byDate}
        onChange={(e) => onChange({ byDate: e.target.value })}
      />
    </Field>
  );

  switch (kind) {
    case 'home_purchase':
      return (
        <>
          <Field label="Home price" error={err.homePrice}>
            <MoneyInput
              value={draft.homePrice}
              onChange={(v) => onChange({ homePrice: v })}
              invalid={!!err.homePrice}
              placeholder="450000"
            />
          </Field>
          <Field label="Down payment" error={err.downPaymentPct}>
            <PercentInput
              value={draft.downPaymentPct}
              onChange={(v) => onChange({ downPaymentPct: v })}
              invalid={!!err.downPaymentPct}
              placeholder="20"
            />
          </Field>
          <ChoiceField
            label="Closing costs"
            value={draft.includeClosingCosts ? 'yes' : 'no'}
            onChange={(v) => onChange({ includeClosingCosts: v === 'yes' })}
            options={[
              { value: 'yes', label: 'Include' },
              { value: 'no', label: 'Skip' },
            ]}
            error={draft.includeClosingCosts ? err.closingCostPct : undefined}
          >
            {(descId) =>
              draft.includeClosingCosts && (
                <PercentInput
                  value={draft.closingCostPct}
                  onChange={(v) => onChange({ closingCostPct: v })}
                  invalid={!!err.closingCostPct}
                  aria-label="Closing costs percent"
                  aria-describedby={descId}
                  placeholder="3"
                  className="min-w-[92px] flex-1"
                />
              )
            }
          </ChoiceField>
          {dateFields}
        </>
      );

    case 'car':
      return (
        <>
          <Field label="Vehicle price" error={err.vehiclePrice}>
            <MoneyInput
              value={draft.vehiclePrice}
              onChange={(v) => onChange({ vehiclePrice: v })}
              invalid={!!err.vehiclePrice}
              placeholder="32000"
            />
          </Field>
          <ChoiceField
            label="Paying"
            value={draft.carPayCash ? 'cash' : 'down'}
            onChange={(v) => onChange({ carPayCash: v === 'cash' })}
            options={[
              { value: 'down', label: 'Down payment' },
              { value: 'cash', label: 'Cash' },
            ]}
            error={draft.carPayCash ? undefined : err.carDownPaymentPct}
          >
            {(descId) =>
              !draft.carPayCash && (
                <PercentInput
                  value={draft.carDownPaymentPct}
                  onChange={(v) => onChange({ carDownPaymentPct: v })}
                  invalid={!!err.carDownPaymentPct}
                  aria-label="Down payment percent"
                  aria-describedby={descId}
                  placeholder="20"
                  className="min-w-[92px] flex-1"
                />
              )
            }
          </ChoiceField>
          {dateFields}
        </>
      );

    case 'education':
      return (
        <>
          <Field label="Yearly cost" error={err.annualCost}>
            <MoneyInput
              value={draft.annualCost}
              onChange={(v) => onChange({ annualCost: v })}
              invalid={!!err.annualCost}
              placeholder="30000"
            />
          </Field>
          <Field label="Number of years" error={err.years}>
            <CountInput
              value={draft.years}
              onChange={(v) => onChange({ years: v })}
              invalid={!!err.years}
              placeholder="4"
              maxLength={2}
            />
          </Field>
          <Field label="Year it starts" error={err.startYear}>
            <CountInput
              value={draft.startYear}
              onChange={(v) => onChange({ startYear: v })}
              invalid={!!err.startYear}
              placeholder={String(new Date().getFullYear() + 5)}
              maxLength={4}
            />
          </Field>
        </>
      );

    case 'retirement':
      return (
        <>
          <Field
            label="Yearly income in retirement"
            error={err.targetAnnualIncome}
            hint={
              canUseAge
                ? undefined
                : 'Add your date of birth in Settings to see a target date and a monthly pace.'
            }
          >
            <MoneyInput
              value={draft.targetAnnualIncome}
              onChange={(v) => onChange({ targetAnnualIncome: v })}
              invalid={!!err.targetAnnualIncome}
              placeholder="80000"
            />
          </Field>
          {/* Same rule as "Reach it by": an age only becomes a date if we
              know the birth date, so without one the field is not shown. */}
          {canUseAge && (
            <Field
              label="Target retirement age"
              error={err.targetAge}
              hint={
                ctx.retirementAge != null && draft.targetAge === String(ctx.retirementAge)
                  ? 'From your retirement plan in Settings. Changing it here only changes this goal.'
                  : undefined
              }
            >
              <CountInput
                value={draft.targetAge}
                onChange={(v) => onChange({ targetAge: v })}
                invalid={!!err.targetAge}
                placeholder="62"
                maxLength={3}
              />
            </Field>
          )}
        </>
      );

    case 'emergency_fund':
      return (
        <Field label="Months of expenses" error={err.months}>
          <CountInput
            value={draft.months}
            onChange={(v) => onChange({ months: v })}
            invalid={!!err.months}
            placeholder="6"
            maxLength={2}
          />
        </Field>
      );
  }
}

// ── The readout ───────────────────────────────────────────────────────────

function monthYear(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The monthly amount that reaches `target` by `deadline`, or null when the
 *  date has passed or nothing is left to save. */
export function monthlyPace(target: number, saved: number, deadline: string | null): { amount: number; by: string } | null {
  if (!deadline) return null;
  const due = new Date(`${deadline.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(due)) return null;
  const months = Math.ceil((due - Date.now()) / (1000 * 60 * 60 * 24 * 30.44));
  const remaining = target - saved;
  if (months < 1 || remaining <= 0) return null;
  return { amount: Math.ceil(remaining / months), by: monthYear(deadline) };
}

/**
 * The computed target, under the fields it comes from. An incomplete
 * description never shows a number: the value slot says what is still missing
 * instead, and neither the derivation nor the pace is claimed.
 */
export function GoalTargetReadout({
  resolved,
  saved = 0,
  onUseMonthlyPlan,
}: {
  resolved: ResolvedDraft;
  saved?: number;
  onUseMonthlyPlan?: (amount: number) => void;
}): ReactElement {
  const pace =
    resolved.target !== null ? monthlyPace(resolved.target, saved, resolved.deadline) : null;

  const showPace = !resolved.pending && resolved.target !== null && !resolved.dateNeeded && pace;

  return (
    <div className="rounded-ui-lg border border-line bg-canvas-sunken p-4">
      <p className="text-[13px] font-medium text-content-secondary">Target amount</p>
      {/* The number and the sentence that gates saving are what change as you
          type, so they are the live region. The button below is deliberately
          outside it: a live region that contains a control re-announces the
          control on every keystroke. */}
      <div id={READOUT_ID} role="status" aria-live="polite">
        {resolved.pending ? (
          <Skeleton className="mt-1.5 h-8 w-40 bg-panel" />
        ) : resolved.target === null ? (
          resolved.prompt && <p className="mt-1.5 text-[13.5px] text-content-muted">{resolved.prompt}</p>
        ) : (
          <>
            <div className="mt-1 font-editorial text-[28px] font-extrabold tracking-[-0.02em] ui-tnum">
              {formatCurrency(resolved.target)}
            </div>
            {resolved.derivation && (
              <p className="mt-1 text-[12.5px] text-content-muted">{resolved.derivation}</p>
            )}
            {resolved.dateNeeded && (
              <p className="mt-1.5 text-[12.5px] font-semibold text-content-secondary">
                {resolved.dateNeeded}
              </p>
            )}
          </>
        )}
      </div>
      {showPace && pace && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p
            id={PACE_ID}
            role="status"
            aria-live="polite"
            className="text-[12.5px] font-semibold text-content-secondary ui-tnum"
          >
            {formatCurrency(pace.amount)} a month reaches this by {pace.by}.
          </p>
          {onUseMonthlyPlan && (
            // A ghost button would be invisible here: its only hover state
            // is this well's own background. Secondary on bg-panel keeps it
            // reading as a control against the sunken well.
            <Button
              variant="secondary"
              size="sm"
              className="w-full bg-panel sm:w-auto"
              onClick={() => onUseMonthlyPlan(pace.amount)}
            >
              Use as my monthly plan
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Emergency fund with nothing to price against ──────────────────────────

export function NoSpendData({ onSetPlainTarget }: { onSetPlainTarget: () => void }): ReactElement {
  return (
    <div className="rounded-ui-lg border border-line bg-canvas-sunken p-4">
      <p className="text-[13.5px] text-content-secondary">
        We do not have enough categorized spending yet to price this in months. Enter a target amount instead.
      </p>
      <div className="mt-2.5">
        <Button variant="secondary" size="sm" className="w-full bg-panel sm:w-auto" onClick={onSetPlainTarget}>
          Set a target amount
        </Button>
      </div>
    </div>
  );
}

// ── Legacy goals ──────────────────────────────────────────────────────────

const CALCULATE_LABELS: Record<TypedGoalCategory, string> = {
  home_purchase: 'Calculate from a home price',
  car: 'Calculate from a vehicle price',
  education: 'Calculate from a yearly cost',
  retirement: 'Calculate from a yearly income',
  emergency_fund: 'Calculate from months of expenses',
};

/** Opt-in for a goal saved before its category could describe itself. Nothing
 *  changes until the user asks, so an old goal keeps rendering as it always has. */
export function CalculateFromDetails({
  category,
  onStart,
}: {
  category: string;
  onStart: () => void;
}): ReactElement | null {
  if (!isTypedGoalCategory(category)) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onStart}>
      {CALCULATE_LABELS[category]}
    </Button>
  );
}
