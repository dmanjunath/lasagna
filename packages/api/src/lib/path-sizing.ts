import type { PathContext } from './path-context.js';
import type { PathStepMark } from './path-generator.js';
import {
  type PathCandidate,
  SAVINGS_RATE_BENCHMARK,
  emergencyFundMonths,
  fiAnnualExpenses,
  fiTarget,
  savingsRateTarget,
  taxAdvantagedChoice,
} from './path-candidates.js';

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

/** Annual tax-advantaged contribution room, by age. */
export function contributionLimits(age: number | null, hasHDHP: boolean | null) {
  const years = age ?? 0;
  const rothMax = years >= 50 ? 8000 : 7000;
  const k401Max = years >= 60 && years <= 63 ? 34750 : years >= 50 ? 31000 : 23500;
  const hsaMax = hasHDHP === true ? 4300 + (years >= 55 ? 1000 : 0) : 0;
  return { rothMax, k401Max, hsaMax, total: rothMax + k401Max + hsaMax };
}

/** The emergency-fund target: months of the stable spend figure, or 70% of income when there is no spend history. */
export function emergencyFundTarget(ctx: PathContext): number {
  const months = emergencyFundMonths(ctx.employmentType);
  const spend = ctx.stableMonthlyExpenses ?? ctx.monthlyExpenses;
  const base = spend !== null && spend > 0
    ? spend
    : ctx.annualIncome > 0 ? (ctx.annualIncome / 12) * 0.7 : 0;
  return base * months;
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
        action: inCollections
          ? `Clear what is in collections first, then save ${usd(short)} to reach the ${usd(STARTER_BUFFER)} starter fund.`
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
          `The ${usd(facts.minimumPayment)} minimum is our estimate. Your lender has not reported one.`,
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
        status,
        progress,
        current,
        target,
        remaining: short,
        action: short > 0 ? `Save ${usd(short)} more to reach ${months} months of expenses.` : '',
      };
    }

    case 'protection':
    case 'estate':
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
      const target = savingsRateTarget(ctx);
      // What is actually being kept each month. A month that ends in the red
      // keeps nothing, and a negative rate is not a share of the benchmark.
      const current = Math.max(ctx.monthlySurplus ?? 0, 0);
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
          ? `Free up ${usd(short)} a month to save ${SAVINGS_RATE_BENCHMARK}% of what you earn.`
          : '',
      };
    }

    case 'retirement-readiness': {
      const facts = step.readiness!;
      const short = Math.max(facts.requiredMonthlySavings - facts.currentMonthlySavings, 0);
      return {
        ...base,
        ...towardTarget(facts.currentMonthlySavings, facts.requiredMonthlySavings),
        current: facts.currentMonthlySavings,
        target: facts.requiredMonthlySavings,
        // A monthly rate, not a pot to fill. Funding it out of the surplus would
        // be circular in exactly the way the savings-rate step is, so it takes
        // no share of the waterfall and carries no completion date.
        remaining: null,
        action: `Move ${usd(short)} a month more into retirement to reach ${usd(facts.requiredMonthlySavings)}.`,
      };
    }

    case 'brokerage': {
      const funded = ctx.brokerageBalance > 0;
      return {
        ...base,
        // How much belongs in a taxable account depends on what it is for, so
        // there is no target to measure against and no share of one to claim.
        status: funded ? 'in_progress' : 'not_started',
        progress: 0,
        current: ctx.brokerageBalance,
        target: null,
        remaining: null,
        action: funded
          ? 'Keep adding to your brokerage account once this year\'s tax-advantaged room is used.'
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
      const { total } = contributionLimits(ctx.age, ctx.hasHDHP);
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
        action: `Fill ${usd(total)} of contribution room this year across your tax-advantaged accounts.`,
      };
    }

    case 'goal': {
      const goal = step.goal!;
      const { status, progress } = towardTarget(goal.currentAmount, goal.targetAmount);
      const short = Math.max(goal.targetAmount - goal.currentAmount, 0);
      return {
        ...base,
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
      return {
        ...base,
        status,
        progress,
        current,
        target,
        remaining: Math.max(target - current, 0),
        action: `Build the portfolio to ${usd(target)}, 25 times the ${usd(fiAnnualExpenses(ctx))} a year you spend.`,
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
  if (step.kind === 'savings-rate' || step.kind === 'retirement-readiness') {
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
      action = `${action} At ${usd(monthlyFunding)} a month that is ${readableMonth(projectedDate)}.`.trim();
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
