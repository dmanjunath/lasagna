import { RETIREMENT_INCOME_MULTIPLE } from '@lasagna/core';
import type { PathContext } from './path-context.js';
import type { PathStepMark } from './path-generator.js';
import {
  ASSUMED_SPEND_SHARE_OF_INCOME,
  CONTRIBUTION_TAX_YEAR,
  type PathCandidate,
  type PathStepKind,
  type RetirementCurve,
  SAVINGS_RATE_BENCHMARK,
  contributionLimits,
  emergencyFundMonths,
  fiAnnualExpenses,
  fiTarget,
  hasSpendHistory,
  savingsRateMeasure,
  taxAdvantagedChoice,
} from './path-candidates.js';

// Re-exported from where it now lives: `buildPathCandidates` has to ask whether
// there is any room before it emits a step about filling it, and a step that
// prices the room has to read the same answer.
export { contributionLimits };

/**
 * What each step costs, where it stands, and when it lands.
 *
 * Funding is a waterfall over the monthly surplus in path order: the first
 * unfinished step takes the surplus until it is done, then the next one starts.
 * Projected dates cascade the same way, so a step's date includes the wait for
 * everything ahead of it. Debt minimums are outside the waterfall — they are
 * already leaving the account every month whatever else is being funded.
 */

export type StepStatus = 'complete' | 'in_progress' | 'not_started';

export interface SizedStep extends PathCandidate {
  status: StepStatus;
  /** 0–100. */
  progress: number;
  current: number | null;
  target: number | null;
  /** Dollars a month flowing to this step once the waterfall reaches it. */
  monthlyFunding: number;
  /** First of the month this step is projected to finish, "YYYY-MM-DD". Null when it has no end or none is reachable. */
  projectedDate: string | null;
  action: string;
  /** What is true of this step whatever state it is in. Never an instruction. */
  fact: string;
  /** Anything the figures above would otherwise imply but not state. */
  notes: string[];
  /** What the person wrote when they marked this step. Empty when nothing. */
  note: string;
}

/** Where the person says they stand on a step, and what they wrote about it. */
export interface StepMark {
  mark: PathStepMark;
  note: string;
}

const STARTER_BUFFER = 1000;
/** Past this the projection stops meaning anything, so it is not shown. */
const MAX_PROJECTION_MONTHS = 600;

function usd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function monthsFromNow(months: number): string {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  return at.toISOString().slice(0, 10);
}

function readableMonth(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** The monthly spend an emergency fund is priced from. Our own share of income when there is no history. */
function emergencyFundBasis(ctx: PathContext): number {
  const spend = ctx.stableMonthlyExpenses ?? ctx.monthlyExpenses;
  if (spend !== null && spend > 0) return spend;
  return ctx.annualIncome > 0 ? (ctx.annualIncome / 12) * ASSUMED_SPEND_SHARE_OF_INCOME : 0;
}

/** The emergency-fund target: months of the figure above. */
export function emergencyFundTarget(ctx: PathContext): number {
  return emergencyFundBasis(ctx) * emergencyFundMonths(ctx.employmentType);
}

/**
 * A step whose target is a MONTHLY RATE rather than a pot to fill.
 *
 * Two things follow from it, and both are why this is one named predicate
 * rather than a test repeated in three files.
 *
 * It never takes the "you are here" pointer. `currentStepKey` is the first step
 * that is not complete, and a rate is a standing condition that can sit short
 * for years: the retirement gap in particular is BY CONSTRUCTION the smallest
 * contribution that clears the threshold, so it is always above what is going
 * in and can never read complete. Whichever of these came first therefore held
 * the pointer permanently, and because the page renders an instruction only on
 * the step you are standing on, every step below it was silent.
 *
 * And it renders its instruction anyway. Losing the pointer would otherwise
 * silence the rate step itself, which is the one place its number is an order
 * rather than a reading.
 */
export function isRateShaped(kind: PathStepKind): boolean {
  return kind === 'savings-rate';
}

/**
 * A step whose target IS the retirement portfolio.
 *
 * Only one of the two is ever on a path: a `retirement` goal takes the
 * independence step's place. Both aim at the pot the readiness simulation
 * projects, so both take their date from that simulation and neither may fall
 * back to the waterfall's. Straight-lining $4,998,000 at $11,071 a month put
 * one household's retirement in 2068, on a page whose own verdict said they
 * were on track to retire at 58, because the arithmetic credited no growth to
 * the $1,252,000 already invested or to any dollar added after it.
 */
function isRetirementPot(step: PathCandidate): boolean {
  return (
    step.kind === 'independence' ||
    (step.kind === 'goal' && step.goal!.category === 'retirement')
  );
}

/**
 * The first age the simulation's median path is worth at least `target`, and
 * how far off that is. Null when it never gets there inside the plan horizon,
 * which is not a date we have.
 */
function medianCrosses(
  curve: RetirementCurve,
  target: number,
): { age: number; months: number } | null {
  const index = curve.median.findIndex((balance) => balance >= target);
  return index === -1 ? null : { age: curve.currentAge + index, months: index * 12 };
}

/**
 * How far a retirement goal's own pricing may sit from what this household
 * spends before the two are worth telling apart. Inside it the goal IS their
 * spending at the 4% rule, and a sentence saying otherwise tells them nothing.
 */
const RETIREMENT_PRICING_GAP = 0.1;

/**
 * The disclosure a retirement goal owes when its target buys a different
 * retirement from the one the page's verdict is run on.
 *
 * The verdict answers "can you stop working at 58", priced off what this
 * household spends. The target is a pot the person set, and at the 4% rule it
 * buys whatever income it buys. Where those are not the same retirement, the
 * page carries two readings of one event with nothing saying they answer
 * different questions.
 */
function retirementPricingNote(target: number, ctx: PathContext): string[] {
  const theirOwnSpending = fiTarget(ctx);
  if (!(theirOwnSpending > 0)) return [];
  if (Math.abs(target - theirOwnSpending) <= theirOwnSpending * RETIREMENT_PRICING_GAP) return [];
  return [
    // The pot figure is already on the card twice. What is NOT anywhere on it
    // is the income that pot was priced to buy, which is the whole difference.
    `This target buys ${usd(target / RETIREMENT_INCOME_MULTIPLE)} a year at the 4% rule. The retirement verdict on this page runs on what you spend now instead, so the two are not pricing the same retirement.`,
  ];
}

// ── The measured position of one step, before funding ─────────────────────────

interface Measure {
  status: StepStatus;
  progress: number;
  current: number | null;
  target: number | null;
  action: string;
  notes: string[];
  /** Dollars still to find. Null when the step has no dollar target. */
  remaining: number | null;
  /** The most this step can absorb in one month. Null = whatever is left. */
  monthlyCap: number | null;
  /** A step that recurs every year rather than finishing on a date. */
  recurring: boolean;
}

/**
 * The disclosure a step priced in months of spending owes when there is no
 * spending to price it from.
 *
 * Both steps that use it went on calling the figure "your expenses" and "the
 * $X a year you spend" when it was a flat 70% of income we picked. Every other
 * estimate on this page announces itself, and an assumption stated back to
 * somebody as their own figure is the one kind that cannot be checked.
 */
function assumedSpendNotes(ctx: PathContext): string[] {
  if (hasSpendHistory(ctx) || ctx.annualIncome <= 0) return [];
  return [
    `We have no spending history for you yet, so this is priced at ${Math.round(ASSUMED_SPEND_SHARE_OF_INCOME * 100)}% of your income. Link a spending account and it is priced from what you actually spend.`,
  ];
}

function towardTarget(current: number, target: number): Pick<Measure, 'status' | 'progress'> {
  if (target > 0 && current >= target) return { status: 'complete', progress: 100 };
  if (current <= 0) return { status: 'not_started', progress: 0 };
  return { status: 'in_progress', progress: Math.min(99, Math.round((current / target) * 100)) };
}

function measure(step: PathCandidate, ctx: PathContext): Measure {
  const base = { notes: [] as string[], monthlyCap: null, recurring: false };

  switch (step.kind) {
    case 'buffer': {
      const current = ctx.cashTotal;
      const inCollections = ctx.debtAccounts.some(
        (a) => (a.subtype || a.name || '').toLowerCase().includes('collection'),
      );
      const { status, progress } = towardTarget(current, STARTER_BUFFER);
      const short = Math.max(STARTER_BUFFER - current, 0);
      return {
        ...base,
        status: inCollections ? 'not_started' : status,
        progress: inCollections ? 0 : progress,
        current,
        target: STARTER_BUFFER,
        remaining: short,
        // Two independent things gate this step, so the instruction names only
        // the ones still outstanding. With the buffer already funded there is
        // nothing left to save, and the sentence used to ask for $0 of it.
        action: inCollections && short > 0
          ? `Clear what is in collections first, then save ${usd(short)} to reach the ${usd(STARTER_BUFFER)} starter fund.`
          : inCollections
          ? 'Clear what is in collections. Your starter fund is already there behind it.'
          : short > 0
          ? `Save ${usd(short)} more to reach the ${usd(STARTER_BUFFER)} starter fund.`
          : '',
      };
    }

    case 'match': {
      const contributing = ctx.trad401kBalance > 0;
      return {
        ...base,
        status: contributing ? 'in_progress' : 'not_started',
        // Nothing here is measurable in dollars, so no share of it is claimed.
        progress: 0,
        current: null,
        target: null,
        remaining: null,
        action: contributing
          ? 'Check your contribution rate is at least enough to capture the full match.'
          : 'Start contributing to your 401(k) to capture the employer match.',
      };
    }

    case 'debt': {
      const facts = step.debt!;
      const notes: string[] = [];
      if (facts.minimumPaymentEstimated) {
        notes.push(
          facts.minimumPaymentAssumedApr !== null
            // The one estimate on the page that was itself built on an invented
            // figure. Saying only that the payment is an estimate hides that
            // the rate under it is one too.
            ? `The ${usd(facts.minimumPayment)} minimum is our estimate, worked out over 30 years at ${facts.minimumPaymentAssumedApr}% a year. Your lender has reported neither a payment nor a rate.`
            : `The ${usd(facts.minimumPayment)} minimum is our estimate. Your lender has not reported one.`,
        );
      }
      return {
        ...base,
        notes,
        status: 'in_progress',
        progress: 0,
        current: facts.balance,
        target: 0,
        remaining: facts.balance,
        action: '',
      };
    }

    case 'emergency-fund': {
      const months = emergencyFundMonths(ctx.employmentType);
      const target = emergencyFundTarget(ctx);
      const current = ctx.cashTotal;
      if (target <= 0) {
        return {
          ...base,
          status: 'not_started',
          progress: 0,
          current,
          target: null,
          remaining: null,
          action: 'Add your income or link a spending account so this can be sized.',
        };
      }
      const { status, progress } = towardTarget(current, target);
      const short = Math.max(target - current, 0);
      return {
        ...base,
        notes: assumedSpendNotes(ctx),
        status,
        progress,
        current,
        target,
        remaining: short,
        action: short > 0 ? `Save ${usd(short)} more to reach ${months} months of expenses.` : '',
      };
    }

    case 'term-life':
      return {
        ...base,
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        remaining: null,
        // The step is offered on an unanswered question, so the instruction is
        // the answer, the way the tax-advantaged step asks for the fields that
        // would name an account.
        action: ctx.dependentCount === null
          ? 'Add your dependents in your profile, so this can be sized or taken off your path.'
          : 'Review and mark complete when done.',
      };

    case 'will-trust':
      return {
        ...base,
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        remaining: null,
        action: 'Review and mark complete when done.',
      };

    case 'savings-rate': {
      // The same call the candidate builder made, so the figures under the
      // title are the figures the title was built from and the instruction is
      // the one the copy above it explains. Deriving either half here a second
      // time is what let the target come off the benchmark while `current` and
      // the wording came off the simulation.
      const { target, current, retirementBinds } = savingsRateMeasure(ctx, step.readiness ?? null);
      const { status, progress } = towardTarget(current, target);
      const short = Math.max(target - current, 0);
      return {
        ...base,
        status,
        progress,
        current,
        target,
        // The surplus IS this step. Funding it out of the surplus would be
        // circular, so it takes no share of the waterfall and carries no date.
        remaining: null,
        action: short > 0
          ? retirementBinds
            ? `Move ${usd(short)} a month more into savings to reach ${usd(target)}.`
            : `Free up ${usd(short)} a month to save ${SAVINGS_RATE_BENCHMARK}% of what you earn.`
          : '',
      };
    }

    case 'brokerage': {
      // The taxable figure, which is what this step is about. The catch-all
      // bucket holds a traditional IRA and a crypto account too, and reading it
      // here told somebody with neither a brokerage account nor any way to open
      // one that they already had one.
      const funded = ctx.taxableBrokerageBalance > 0;
      return {
        ...base,
        // How much belongs in a taxable account depends on what it is for, so
        // there is no target to measure against and no share of one to claim.
        status: funded ? 'in_progress' : 'not_started',
        progress: 0,
        current: ctx.taxableBrokerageBalance,
        target: null,
        remaining: null,
        action: funded
          // Names the year the step above it names. "This year" beside a step
          // headed with a tax year is two labels for one deadline, and they
          // disagree the moment the constant and the calendar do.
          ? `Keep adding to your brokerage account once your ${CONTRIBUTION_TAX_YEAR} tax-advantaged room is used.`
          : 'Open a taxable brokerage account and set up a monthly transfer into broad index funds.',
      };
    }

    case 'tax-advantaged': {
      const combined = ctx.hsaBalance + ctx.rothIraBalance + ctx.trad401kBalance;
      return {
        ...base,
        status: combined > 0 ? 'in_progress' : 'not_started',
        // Having a balance is not a fraction of a target we can name.
        progress: 0,
        current: null,
        target: null,
        remaining: null,
        // The same choice the step's title was named from, so the instruction
        // can never send them to a different account than the title.
        action: taxAdvantagedChoice(ctx).action,
      };
    }

    case 'contribution-limits': {
      const { total } = contributionLimits(ctx);
      // No current/target pair: what an account HOLDS is not what was paid into
      // it this year, and we do not track contributions to date. Stating a
      // balance against an annual limit read as progress and was not one. The
      // room itself is real, so it sets the monthly rate and the action.
      return {
        ...base,
        status: 'not_started',
        progress: 0,
        current: null,
        target: null,
        // An annual limit resets rather than finishing, so it takes at most the
        // monthly rate that fills it and never carries a completion date.
        remaining: total,
        monthlyCap: total / 12,
        recurring: true,
        action: `Fill ${usd(total)} of ${CONTRIBUTION_TAX_YEAR} contribution room across your tax-advantaged accounts.`,
      };
    }

    case 'goal': {
      const goal = step.goal!;
      const { status, progress } = towardTarget(goal.currentAmount, goal.targetAmount);
      const short = Math.max(goal.targetAmount - goal.currentAmount, 0);
      return {
        ...base,
        // Only where a verdict is on the page to disagree with. The curve is
        // set on the retirement goal alone, and only when the simulation ran.
        notes: step.retirementCurve ? retirementPricingNote(goal.targetAmount, ctx) : [],
        status,
        progress,
        current: goal.currentAmount,
        target: goal.targetAmount,
        remaining: short,
        action: short > 0 ? `Save ${usd(short)} more to reach ${usd(goal.targetAmount)}.` : '',
      };
    }

    case 'independence': {
      const target = fiTarget(ctx);
      const current = ctx.rothIraBalance + ctx.trad401kBalance + ctx.brokerageBalance + ctx.hsaBalance;
      const { status, progress } = towardTarget(current, target);
      const annual = fiAnnualExpenses(ctx);
      return {
        ...base,
        notes: assumedSpendNotes(ctx),
        status,
        progress,
        current,
        target,
        remaining: Math.max(target - current, 0),
        // "you spend" is only true of a figure read off their own spending.
        // With no history this number is a share of their income, so the
        // sentence states it without claiming it is theirs and the note above
        // says where it came from.
        action: hasSpendHistory(ctx)
          ? `Build the portfolio to ${usd(target)}, 25 times the ${usd(annual)} a year you spend.`
          : `Build the portfolio to ${usd(target)}, 25 times ${usd(annual)} a year.`,
      };
    }
  }
}

/**
 * Whether the figures decide where this step stands.
 *
 * The one definition, off the same `measure` the waterfall runs, so nothing can
 * disagree with it: `sizePath` applies a tick only where this is false, and the
 * page offers a tick only where this is false.
 */
export function stepIsMeasured(step: PathCandidate, ctx: PathContext): boolean {
  return measure(step, ctx).target !== null;
}

/**
 * What a step states about itself, in the same register as the debt minimum: a
 * figure, never an order. Every unfinished measured step needs one, because
 * `action` renders only on the step the user is standing on, so off that step a
 * measured card had no figure on it at all.
 */
function factFor(step: PathCandidate, m: Measure): string {
  // A finished step already says it is finished, so where it stands adds
  // nothing, and a target run well past reads as a lopsided ratio nobody would
  // say out loud. A cleared debt goes with it: it has no minimum left to pay.
  if (m.status === 'complete') return '';
  // The minimum is owed whatever the balance does, so it holds on a step the
  // user has not reached as well as the one they are standing on.
  if (step.kind === 'debt') {
    return `Minimum payment ${usd(step.debt!.minimumPayment)} a month.`;
  }
  // Nothing measures the step, so there is no position to state.
  if (m.target === null || m.current === null) return '';
  // A rate is what moves each month, not a pot that has been put aside.
  if (isRateShaped(step.kind)) {
    return `${usd(m.current)} a month of the ${usd(m.target)} target.`;
  }
  return `${usd(m.current)} saved of the ${usd(m.target)} target.`;
}

// ── The waterfall ─────────────────────────────────────────────────────────────

/**
 * @param marks Where the person says they stand on each step, by candidate key.
 *   Steps they marked not applicable must already be OUT of `candidates`: the
 *   waterfall walks this list in order, so leaving one in would push every date
 *   behind it out by a step nobody is working on.
 */
export function sizePath(
  candidates: PathCandidate[],
  ctx: PathContext,
  marks: ReadonlyMap<string, StepMark> = new Map(),
): SizedStep[] {
  const surplus = Math.max(ctx.monthlySurplus ?? 0, 0);

  // Months from now that the waterfall reaches the next step, how much of the
  // surplus is still unclaimed, and whether a step ahead has already absorbed
  // it for longer than we project.
  let cursor = 0;
  let available = surplus;
  let blocked = available <= 0;

  return candidates.map((candidate) => {
    const m = measure(candidate, ctx);
    // A stored tick is a note about a step nothing measures — an insurance
    // policy, a will. Where the figures DO measure the step, the figures win,
    // in both directions: an emergency fund that gets spent drops back to
    // in_progress on its own, and a tick can never pin a step complete against
    // the balance behind it.
    const marked = marks.get(candidate.key);
    const manual = m.target === null && marked?.mark === 'done';

    let status = m.status;
    let progress = m.progress;
    if (manual) {
      status = 'complete';
      progress = 100;
    }

    const done = status === 'complete';

    // A finished step does not issue an order. Measured steps kept quoting the
    // instruction that got them there long after they were done, so a completed
    // independence step still read "Build the portfolio to $1,200,000". What a
    // completed step has to say is the note the user left, and the page renders
    // that on its own.
    let action = status === 'complete' ? '' : m.action;

    let monthlyFunding = 0;
    let projectedDate: string | null = null;
    // The age the simulation put this step's target within reach, when a
    // simulation is what dated it. It is what the instruction quotes, because
    // the reading is an age and the pill beside it is an age.
    let reachedAtAge: number | null = null;
    const notes = [...m.notes];

    // A fact is a property of the step, not of where the step sits, so it holds
    // on a step you have finished, are on, or have not reached.
    const fact = factFor(candidate, m);

    if (candidate.kind === 'debt' && !done) {
      const facts = candidate.debt!;
      const minimum = facts.minimumPayment;
      // Minimums leave the account from month zero, so by the time the surplus
      // reaches this step there is less of it left to clear.
      const leftWhenReached = facts.balance - minimum * cursor;

      if (leftWhenReached <= 0 && minimum > 0) {
        // Cleared by its minimums before the waterfall ever gets here.
        monthlyFunding = minimum;
        const months = Math.ceil(facts.balance / minimum);
        projectedDate = months <= MAX_PROJECTION_MONTHS ? monthsFromNow(months) : null;
      } else {
        const extra = blocked ? 0 : available;
        monthlyFunding = minimum + extra;
        if (monthlyFunding > 0) {
          const months = cursor + Math.ceil(leftWhenReached / monthlyFunding);
          if (months <= MAX_PROJECTION_MONTHS) {
            projectedDate = monthsFromNow(months);
            if (extra > 0) cursor = Math.max(cursor, months);
          } else {
            blocked = true;
          }
        }
      }
      const extraFunding = monthlyFunding - minimum;
      if (!projectedDate) {
        action = `Pay off ${usd(facts.balance)}. Free up more each month to give this a date.`;
      } else if (monthlyFunding >= facts.balance) {
        // A month of funding covers the whole balance: quoting a monthly rate
        // for it would describe payments that never happen.
        action = `One payment of ${usd(facts.balance)} clears this.`;
      } else if (extraFunding > 0) {
        action = `Add ${usd(extraFunding)} a month to the ${usd(minimum)} minimum and it clears by ${readableMonth(projectedDate)}.`;
      } else {
        action = `The ${usd(minimum)} minimum clears this by ${readableMonth(projectedDate)}.`;
      }
    } else if (!done && m.remaining !== null && m.remaining > 0) {
      const share = blocked ? 0 : m.monthlyCap !== null ? Math.min(m.monthlyCap, available) : available;
      monthlyFunding = share;
      if (m.recurring) {
        // A step that repeats every year keeps its share for good, so what is
        // left for everything below it is genuinely smaller.
        available -= share;
        if (available <= 0) blocked = true;
      } else if (isRetirementPot(candidate)) {
        // Dated off the simulation, never off the surplus. The pot compounds
        // whether or not the waterfall has reached it, so the date does not
        // turn on this step's share, and where the simulation cannot produce
        // one there is NO date: a saving-rate figure in its place would be a
        // number nothing on this page believes. Nothing below can be dated
        // then either, on the same rule an over-horizon step already follows.
        const crossing =
          candidate.retirementCurve && m.target !== null
            ? medianCrosses(candidate.retirementCurve, m.target)
            : null;
        if (crossing && crossing.months <= MAX_PROJECTION_MONTHS) {
          projectedDate = monthsFromNow(crossing.months);
          reachedAtAge = crossing.age;
          // Only where the surplus is actually flowing here. The waterfall
          // cursor is about when the MONEY frees up for the steps below, and
          // the curve can land ahead of where the cursor already stands.
          if (share > 0) cursor = Math.max(cursor, crossing.months);
        } else {
          blocked = true;
        }
      } else if (share > 0) {
        const months = cursor + Math.ceil(m.remaining / share);
        if (months <= MAX_PROJECTION_MONTHS) {
          projectedDate = monthsFromNow(months);
          cursor = months;
        } else {
          blocked = true;
        }
      }
    }

    if (projectedDate && !m.recurring && candidate.kind !== 'debt') {
      // Each date says what produced it. A monthly rate reached a pot on a
      // rate; a retirement pot was reached by a simulation that compounds, and
      // quoting a rate for it would name a model this figure did not come from.
      action = reachedAtAge !== null
        ? `${action} The retirement simulation's median path reaches it at age ${reachedAtAge}.`.trim()
        : `${action} At ${usd(monthlyFunding)} a month that is ${readableMonth(projectedDate)}.`.trim();
    }

    return {
      ...candidate,
      status,
      progress,
      current: m.current,
      target: m.target,
      monthlyFunding: Math.round(monthlyFunding),
      projectedDate,
      action,
      fact,
      notes,
      // Theirs whether or not the tick still decides the status. When the
      // figures take the decision back the note is still the sentence they
      // typed, and dropping it silently loses their own words.
      note: marked?.note ?? '',
    };
  });
}
