import { RETIREMENT_INCOME_MULTIPLE, type GoalDetails } from '@lasagna/core';
import type { PathContext } from './path-context.js';
import type { DebtAccount } from './debt-accounts.js';
import type { PathReadiness } from '../services/retirement-readiness.js';

/**
 * The steps that apply to ONE person, and only those.
 *
 * A candidate is an instance, not a rung: one per debt account, one per active
 * goal, plus the situation steps whose precondition this person actually meets.
 * A candidate whose precondition is absent is never emitted — no employer match
 * on file means no match step, no debt accounts means no debt steps, no income
 * and no spending history means no savings-rate step. Pruning is the point:
 * two people should not get
 * the same path, and neither should get a step that does not apply to them.
 *
 * Order here is the deterministic default. Sizing runs over it as a waterfall,
 * so the order decides where the surplus lands.
 */

export type PathStepKind =
  | 'buffer'
  | 'match'
  | 'debt'
  | 'emergency-fund'
  | 'term-life'
  | 'will-trust'
  | 'savings-rate'
  | 'tax-advantaged'
  | 'contribution-limits'
  | 'brokerage'
  | 'goal'
  | 'independence';

/** What a debt account is, from its type and name alone. No rate involved. */
export type DebtKind =
  | 'payday'
  | 'collections'
  | 'card'
  | 'personal'
  | 'private_student'
  | 'federal_student'
  | 'auto'
  | 'mortgage'
  | 'medical';

export interface DebtFacts {
  accountId: string;
  name: string;
  mask: string | null;
  debtKind: DebtKind;
  balance: number;
  /** The rate on file, or null when the account has none. Never a substitute. */
  apr: number | null;
  minimumPayment: number;
  minimumPaymentEstimated: boolean;
  /** The rate the minimum was amortised at when we had to invent one, or null. */
  minimumPaymentAssumedApr: number | null;
  /** A payoff date the lender reports, when there is one. */
  payoffDate: string | null;
}

export interface GoalFacts {
  goalId: string;
  name: string;
  category: string;
  targetAmount: number;
  currentAmount: number;
  deadline: Date | null;
  details: GoalDetails | null;
}

/**
 * What the retirement simulation said, for the one step that reports it.
 *
 * Every figure here came out of `buildPathReadiness`, which runs the same engine
 * the retirement dashboard and the plan document run. Nothing on this shape is
 * derived a second time here.
 */
export interface ReadinessFacts {
  /** 0-100, at what is going in today. */
  successRate: number;
  /** The share that counts as on track. */
  targetSuccess: number;
  verdict: 'needs_attention' | 'at_risk';
  retirementAge: number;
  currentMonthlySavings: number;
  /** A contribution the simulation was actually run at, and cleared the target. */
  requiredMonthlySavings: number;
  requiredSuccessRate: number;
}

/**
 * The retirement simulation's median path, for the steps that price the pot it
 * projects.
 *
 * Every figure here came out of `buildPathReadiness`, the same run the page's
 * on-track verdict is read from. Nothing is projected a second time.
 */
export interface RetirementCurve {
  /** The age `median[0]` is measured at. */
  currentAge: number;
  /** Median projected balance at the start of each age from `currentAge`. */
  median: number[];
}

export interface PathCandidate {
  /** Stable across reads, so skip/complete bookkeeping survives a re-run. */
  key: string;
  kind: PathStepKind;
  title: string;
  subtitle: string;
  description: string;
  /** Why this step is on THIS person's path. */
  why: string;
  icon: string;
  accountId: string | null;
  goalId: string | null;
  debt?: DebtFacts;
  goal?: GoalFacts;
  readiness?: ReadinessFacts;
  /**
   * The simulation's median path for the pot THIS step targets.
   *
   * Set on the two steps that price the retirement portfolio, and only one of
   * them is ever on a path: a `retirement` goal takes the independence step's
   * place. Sizing dates those two off this curve rather than off the monthly
   * surplus, because the surplus alone credits none of the growth the same
   * page's on-track verdict is built on.
   */
  retirementCurve?: RetirementCurve;
  /**
   * The built-in step key this candidate SUPPRESSED by standing in for it.
   *
   * A goal that computes what a built-in step computes takes that step's place,
   * so only one of the two is ever emitted. That makes this candidate load
   * bearing: drop it and the job it covers is on the path in neither form.
   * `validateOrder` reads this and refuses to leave such a candidate out.
   */
  coversStep?: string;
}

// ── Debt kinds ────────────────────────────────────────────────────────────────

/** Whole-word `auto`/`car`/`vehicle`: `car` is a substring of "credit card". */
const AUTO_WORDS = /\b(auto|car|vehicle)s?\b/;

/**
 * What kind of debt an account is, from its type, subtype and name. Purely a
 * classification of the thing: the account's rate plays no part, so an account
 * with no rate on file is classified exactly like one that reports 0%.
 */
export function classifyDebtKind(account: Pick<DebtAccount, 'type' | 'subtype' | 'name'>): DebtKind {
  const text = (account.subtype || account.name || '').toLowerCase();

  if (text.includes('payday') || text.includes('bnpl')) return 'payday';
  if (text.includes('medical')) return 'medical';
  if (text.includes('collection')) return 'collections';

  // Revolving credit is a card whatever its name says, so a store card called
  // "Home Depot" is not read as a home loan.
  if (account.type === 'credit') return 'card';

  if (text.includes('student') || text.includes('sloan')) {
    const federal =
      text.includes('federal') || text.includes('direct') || text.includes('perkins');
    return federal ? 'federal_student' : 'private_student';
  }
  if (text.includes('mortgage') || text.includes('home')) return 'mortgage';
  if (AUTO_WORDS.test(text)) return 'auto';
  return 'personal';
}

/**
 * Where an account with NO rate on file sits in the payoff order: among the
 * accounts its own type is normally priced with. A card ranks with the cards, a
 * mortgage with the mortgages.
 *
 * Ordering only. It is never displayed, returned, summed or described. The
 * account still reports no rate everywhere a rate is shown, and its step says
 * so in words. An account that reports a rate is ordered by that rate however
 * low it is, so a 0% promo balance is not treated as if it were a 22% one.
 */
const ORDERING_APR_BY_KIND: Record<DebtKind, number> = {
  payday: 200,
  collections: 25,
  card: 22,
  personal: 12,
  private_student: 9,
  auto: 7,
  federal_student: 6,
  mortgage: 6,
  medical: 3,
};

export function orderingApr(facts: Pick<DebtFacts, 'apr' | 'debtKind'>): number {
  return facts.apr ?? ORDERING_APR_BY_KIND[facts.debtKind];
}

// ── Placement ─────────────────────────────────────────────────────────────────

/**
 * The deterministic default order. Debt sits at three points on this list by
 * its OWN rate rather than by a band: above 15% it beats saving, between 8 and
 * 15 it waits for this year's tax-advantaged space (which does not carry
 * forward), below that it is behind investing on the maths and is a preference.
 */
const TIER = {
  buffer: 10,
  match: 20,
  debtUrgent: 30,
  // Cover comes before the full reserve when someone depends on this income.
  // The reserve protects against a month with no pay; term life and a will
  // protect against there being no more pay at all, which is the larger loss
  // and the one a reserve cannot absorb.
  protection: 35,
  emergencyFund: 40,
  taxAdvantaged: 60,
  // The account is opened before the amount going into it is raised, because
  // "put more away" with nowhere named to put it is half an instruction.
  savingsRate: 62,
  debtMiddle: 70,
  contributionLimits: 80,
  brokerage: 85,
  goal: 90,
  debtPatient: 100,
  // With nobody depending on this income, a will is about what has been built
  // rather than who is left, so it waits until there is meaningfully something
  // to direct. It is still a step, just not an early one.
  willLate: 105,
  independence: 110,
} as const;

const DEBT_URGENT_ABOVE = 15;
const DEBT_PATIENT_AT_OR_BELOW = 8;

/**
 * The share of income a savings-rate step aims at. The same 20% the insights
 * engine measures a household against, so the app names one benchmark.
 */
export const SAVINGS_RATE_BENCHMARK = 20;

function debtTier(rate: number): number {
  if (rate > DEBT_URGENT_ABOVE) return TIER.debtUrgent;
  if (rate > DEBT_PATIENT_AT_OR_BELOW) return TIER.debtMiddle;
  return TIER.debtPatient;
}

/**
 * A balance whose rate beats any expected market return, which is what the
 * step's own copy says about it: "money put here beats money invested, with
 * none of the uncertainty".
 *
 * Exported because the weave enforces that sentence rather than hoping for it.
 * One definition, so the band the copy describes and the band the order holds
 * to can never be two different numbers.
 */
export function isUrgentDebt(candidate: PathCandidate): boolean {
  return candidate.kind === 'debt' && orderingApr(candidate.debt!) > DEBT_URGENT_ABOVE;
}

// ── Copy ──────────────────────────────────────────────────────────────────────

function usd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

/** A rate to at most 2 decimals, trailing zeros dropped. 0 is a real rate. */
function ratePct(apr: number): string {
  return `${Math.round(apr * 100) / 100}%`;
}

/** How far off a date is, in the words a person would use. */
function monthsUntil(date: Date): string {
  const now = new Date();
  const months =
    (date.getUTCFullYear() - now.getUTCFullYear()) * 12 + (date.getUTCMonth() - now.getUTCMonth());
  if (months <= 0) return 'already due';
  if (months === 1) return '1 month away';
  if (months < 24) return `${months} months away`;
  return `${Math.round(months / 12)} years away`;
}

function monthName(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The tax year every contribution limit and phase-out floor in this app is
 * taken from.
 *
 * It is a CONSTANT rather than the current year on purpose: the figures below
 * and in `contributionLimits` are that year's, and printing "this year" against
 * them silently misdates them the moment the calendar rolls over. Anything that
 * shows a limit to a person names this year, so the number and the label can
 * never disagree. Moving the figures forward means changing both together.
 *
 * Being a constant is also how it rots, and it did: the page went on offering
 * to "max out your 2025 contribution room" through 2026, next to a sentence
 * saying the room does not come back. So the constant is ASSERTED against the
 * calendar by `path-candidates.test.ts`, which fails the suite the moment a new
 * year opens and these figures are still last year's. The failure names the
 * IRS notice to read.
 */
export const CONTRIBUTION_TAX_YEAR = 2026;

/**
 * Where a Roth IRA contribution starts phasing out, by filing status. Below
 * these a full contribution is allowed, so below these we are willing to name
 * the account.
 *
 * `CONTRIBUTION_TAX_YEAR` figures, from IRS Notice 2025-67 (2026 amounts
 * relating to retirement plans and IRAs), as summarised at
 * https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500
 * Never printed: this is an eligibility gate, so it decides which account a
 * step names and nothing else.
 *
 * The test runs on gross annual income, which is at or above the modified AGI
 * the IRS actually measures, so it can only ever under-claim eligibility. A
 * filing status we do not hold means we do not name the account at all.
 */
const ROTH_PHASE_OUT_START: Record<NonNullable<PathContext['filingStatus']>, number> = {
  single: 153_000,
  head_of_household: 153_000,
  married_joint: 242_000,
  married_separate: 0,
};

export function canFullyFundRothIra(ctx: PathContext): boolean {
  if (ctx.filingStatus === null) return false;
  return ctx.annualIncome > 0 && ctx.annualIncome < ROTH_PHASE_OUT_START[ctx.filingStatus];
}

/**
 * Whether this household has a 401(k) at all.
 *
 * Their own answer decides it, and it is already collected: onboarding asks
 * "do you have a 401(k)?" and writes the match percent, 0 for a plan that
 * matches nothing, and null for no plan at all. Reading that column as `?? 0`
 * flattened the two, so a household with a plan and no match was told it had no
 * plan and lost the whole elective deferral limit out of its room.
 *
 * A BALANCE is deliberately not part of it. A 401(k) balance can be one left
 * behind at a former employer, which is no room to contribute to, so counting
 * it overstates in exactly the way the flattening understated. A household that
 * has told us nothing gets no 401(k) room, which under-claims rather than
 * ordering somebody to fill space they cannot reach.
 */
export function hasEmployerPlan(ctx: PathContext): boolean {
  return ctx.employerMatchPct !== null;
}

/**
 * The tax-advantaged room this household can ACTUALLY use, for
 * `CONTRIBUTION_TAX_YEAR`.
 *
 * Every account is gated on holding it or being eligible for it, which the
 * total was not: an IRA holder with no workplace plan was told to fill $30,500
 * of room, most of it in a 401(k) they do not have, and a household over the
 * Roth phase-out was counted an IRA the step above had just declined to name
 * for exactly that reason. The room is the one figure on the step, it sets the
 * monthly rate the waterfall takes, and it recurs every year, so room they
 * cannot reach starves their own dated goals for good.
 *
 * The gates are the same ones the tax-advantaged step names an account by, so
 * the two steps can never disagree about what is open to this person.
 *
 * Every figure is `CONTRIBUTION_TAX_YEAR`'s, from the IRS:
 *   - elective deferral $24,500, age 50+ catch-up $8,000, ages 60 to 63
 *     catch-up $11,250, IRA $7,500, IRA catch-up $1,100 — Notice 2025-67, per
 *     https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500
 *   - HSA self-only $4,400 — Rev. Proc. 2025-19 section 2.01,
 *     https://www.irs.gov/pub/irs-drop/rp-25-19.pdf (family coverage is $8,750
 *     there, and is not read here: we hold whether a household has an HDHP, not
 *     whether the cover is self-only or family, so the smaller of the two is
 *     the only one we can state without inventing the answer)
 *   - HSA age 55+ catch-up $1,000, fixed in statute by IRC 223(b)(3)(B) rather
 *     than adjusted, per https://www.irs.gov/publications/p969
 *
 * It lives here rather than with the sizing so that `buildPathCandidates` can
 * ask whether there is any room at all before it emits a step about filling it.
 */
export function contributionLimits(ctx: PathContext) {
  const years = ctx.age ?? 0;
  const rothMax = canFullyFundRothIra(ctx) ? (years >= 50 ? 8600 : 7500) : 0;
  const k401Max = hasEmployerPlan(ctx)
    ? years >= 60 && years <= 63 ? 35750 : years >= 50 ? 32500 : 24500
    : 0;
  const hsaMax = ctx.hasHDHP === true ? 4400 + (years >= 55 ? 1000 : 0) : 0;
  return { rothMax, k401Max, hsaMax, total: rothMax + k401Max + hsaMax };
}

/**
 * Whether any figure priced in months of spending is priced from spending we
 * have actually seen.
 *
 * False means the emergency fund and the independence number are both standing
 * on 70% of income, which is OUR assumption and not this person's spending.
 * Every step that quotes one says so rather than reading it back as theirs.
 */
export function hasSpendHistory(ctx: PathContext): boolean {
  const spend = ctx.stableMonthlyExpenses ?? ctx.monthlyExpenses;
  return spend !== null && spend > 0;
}

/** The share of income that stands in for spending when there is no history. */
export const ASSUMED_SPEND_SHARE_OF_INCOME = 0.7;

/** One tax-advantaged step, named for the account this person should use. */
export interface TaxAdvantagedChoice {
  title: string;
  subtitle: string;
  description: string;
  why: string;
  /** What the sizing pass tells them to do, in the same account's name. */
  action: string;
  /**
   * Whether this branch OPENS an account rather than putting more into one
   * already held. Only an opening is a step of its own: "raise what goes into
   * the 401(k) you have" is the amount step said twice.
   */
  opensAccount: boolean;
}

/**
 * Which tax-advantaged account to name, from what they hold and what we can tell
 * they are eligible for.
 *
 * Ordered the way the accounts are actually worth using: an HSA first, because
 * on a high-deductible plan it is the only account taxed at neither end, then a
 * Roth IRA, then the 401(k) beyond whatever the match step already covers. The
 * last branch names nothing, because a step that names the wrong account is
 * worse than one that names none.
 *
 * The candidate copy and the sizing action both read this, so the step and its
 * instruction can never name two different accounts.
 */
export function taxAdvantagedChoice(ctx: PathContext): TaxAdvantagedChoice {
  const hsaOpen = ctx.hasHDHP === true && ctx.hsaBalance <= 0;
  const roth = canFullyFundRothIra(ctx);

  if (hsaOpen) {
    return {
      title: 'Open and fund an HSA',
      subtitle: 'The one account taxed at neither end',
      description:
        'Contributions come off your taxable income, the balance grows untaxed, and withdrawals for medical costs are untaxed too. No other account does all three. Invest the balance rather than leaving it as cash, and pay small medical bills out of pocket so it can compound.',
      why: 'Your health plan is high-deductible, which is the only way this account is open to you.',
      action: 'Open an HSA through your employer or a provider, and set up a monthly contribution.',
      opensAccount: true,
    };
  }
  if (roth && ctx.rothIraBalance <= 0) {
    return {
      title: 'Open and fund a Roth IRA',
      subtitle: 'Contributions taxed now, everything after that untaxed',
      description:
        'You pay the tax on the way in and never again, so decades of growth come out untaxed. Contributions (not the growth) can also come back out at any time without penalty, which makes it the most forgiving retirement account to start with.',
      why: 'Your income is under the limit for a full Roth IRA contribution at your filing status.',
      action: 'Open a Roth IRA and set up a monthly contribution into a broad index fund.',
      opensAccount: true,
    };
  }
  if (roth) {
    return {
      title: 'Fund your Roth IRA for this year',
      subtitle: 'This year\'s allowance, before the filing deadline',
      description:
        'You already hold one, so this is a transfer rather than an opening. The allowance is annual and does not carry forward: what you do not put in by the filing deadline is gone.',
      why: 'You hold a Roth IRA and your income is under the limit to keep funding it.',
      action: 'Move this year\'s Roth IRA contribution across before the filing deadline.',
      opensAccount: false,
    };
  }
  // Whether there is a 401(k) to raise is `hasEmployerPlan`, the same answer the
  // contribution room is counted from. A BALANCE decided it here, which is the
  // reading `hasEmployerPlan` exists to rule out: a balance left at a former
  // employer is no room to contribute to, and this branch told somebody holding
  // one to raise a rate on a plan they no longer have, then took every other
  // investing step off the path for having named an account they already hold.
  if (hasEmployerPlan(ctx)) {
    const matched = (ctx.employerMatchPct ?? 0) > 0;
    return {
      title: matched ? 'Contribute to your 401(k) beyond the match' : 'Raise your 401(k) contribution',
      subtitle: matched
        ? 'The same plan, past the point the match stops'
        : 'The plan you have at work, with room left in it',
      description: matched
        ? 'The match is the first reason to contribute, not the last. Everything past it still comes off your taxable income and still compounds untaxed until you draw it.'
        : 'The 401(k) limit is several times an IRA\'s, and contributions come straight off your taxable income before you ever see the money. Raising the percentage is a single form, and the higher rate applies to every paycheck after it.',
      why: matched
        ? 'You have a 401(k) through work, and its limit is far above what the match alone puts in.'
        : 'You have a 401(k) through work, so raising the rate is the least friction of any move here.',
      action: matched
        ? 'Raise your 401(k) contribution rate past the percentage the match covers.'
        : 'Raise your 401(k) contribution rate with your payroll provider.',
      opensAccount: false,
    };
  }
  // Nothing on file names one account. Ask only for what we do NOT hold and
  // that would change the answer: a filing status opens the Roth branch above,
  // a high-deductible health plan opens the HSA one. Asking for a filing status
  // already on file was worse than asking for nothing, because supplying it
  // again changed neither the step nor the account it names.
  const askFor = [
    ctx.filingStatus === null ? 'filing status' : null,
    ctx.hasHDHP === null ? 'health plan' : null,
  ].filter((field): field is string => field !== null);
  return {
    title: 'Fund a tax-advantaged account',
    subtitle: 'An IRA, a 401(k) or an HSA, whichever you are eligible for',
    description:
      'These accounts shelter growth from tax for as long as you hold them, and their limits are annual: space you skip this year does not come back. Which one fits depends on your plan at work and your filing status.',
    why: 'You have earned income this year, so this year\'s tax-advantaged space is open. It does not carry forward.',
    action: askFor.length > 0
      ? `Add your ${askFor.join(' and ')} in your profile so we can name the right account.`
      : 'Check what retirement plan your employer offers, and open an IRA if there is none.',
    // Nothing is held here that could be topped up instead, so whatever this
    // resolves to is an opening.
    opensAccount: true,
  };
}

/** The emergency-fund target in months, from how steady the income is. */
export function emergencyFundMonths(employmentType: string | null): number {
  return employmentType === 'self_employed' || employmentType === '1099' ? 9 : 6;
}

// ── Candidates ────────────────────────────────────────────────────────────────

/**
 * The goal categories that compute exactly what a built-in step computes, and
 * the step each one covers.
 *
 * An `emergency_fund` goal is months of expenses times trailing spend, which is
 * what the emergency-fund step works out. A `retirement` goal is 25 times an
 * annual figure, which is what the independence step works out. Emitted
 * separately, they landed side by side and said the same job twice, and the
 * ordering model could not tell they were one job.
 *
 * Where a goal like this exists, the goal is the step: the person chose the
 * months and the target, so theirs is the more specific number, and the
 * built-in step is there for people who have not set one.
 *
 * This map is the only place the pairing is written down, so a third typed
 * category cannot reintroduce the duplicate by being added elsewhere.
 */
const STEP_COVERED_BY_GOAL_CATEGORY: Record<string, string> = {
  emergency_fund: 'emergency-fund',
  retirement: 'financial-independence',
};

interface Placed {
  tier: number;
  /** Breaks ties inside a tier. Lower runs first. */
  within: number;
  candidate: PathCandidate;
}

export function buildPathCandidates(
  ctx: PathContext,
  /**
   * What the retirement simulation said about this household, or null when it
   * could not be run on what they have given us. Null prunes both the readiness
   * step and every sentence that would otherwise report a verdict.
   */
  readiness: PathReadiness | null = null,
): PathCandidate[] {
  const placed: Placed[] = [];

  // One read of the simulation's median path, handed to whichever of the two
  // retirement-pot steps this household gets. Null readiness means the
  // simulation could not be run at all, and then neither step is dated: a
  // saving-rate date on a pot that compounds is the wrong answer, not a
  // partial one.
  const retirementCurve: RetirementCurve | undefined = readiness
    ? { currentAge: readiness.currentAge, median: readiness.medianByAge }
    : undefined;

  // `ctx.goals` is the active goals, so a completed or paused one covers
  // nothing and leaves the built-in step exactly where it was. The same
  // `targetAmount > 0` test the goal steps below are emitted under, so a goal
  // that never becomes a step never suppresses one either.
  const coveredByGoal = new Set(
    ctx.goals
      .filter((goal) => goal.targetAmount > 0)
      .map((goal) => STEP_COVERED_BY_GOAL_CATEGORY[goal.category])
      .filter((key): key is string => key !== undefined),
  );

  // Which built-in steps a goal actually took the place of. Recorded as they
  // are turned away, because whether a built-in would have been emitted at all
  // is not knowable when the goal's own step is built: the independence step is
  // itself gated on there being something to price it from, so a retirement
  // goal for a household with neither spending nor income displaced nothing.
  const suppressed = new Set<string>();

  const add = (tier: number, within: number, candidate: PathCandidate) => {
    if (coveredByGoal.has(candidate.key)) {
      suppressed.add(candidate.key);
      return;
    }
    placed.push({ tier, within, candidate });
  };

  // ── Starter emergency fund ──
  // No precondition: a first $1,000 applies to everyone who has money moving.
  // The guidance is $1,000 or the insurance deductible, whichever is higher.
  // We hold no deductible, so the copy names the rule and the maths marks this
  // done at $1,000 rather than inventing a deductible we were never told.
  add(TIER.buffer, 0, {
    key: 'stabilize',
    kind: 'buffer',
    title: 'Save a starter emergency fund',
    subtitle: '$1,000 liquid, or your insurance deductible if that is higher',
    description:
      'A deductible is the first bill most emergencies produce, which is why it sets the floor whenever it is the larger number. Keep this money liquid, and clear anything in collections before you build it.',
    why: 'Without a first cash buffer, the next surprise bill becomes new debt.',
    icon: 'wallet',
    accountId: null,
    goalId: null,
  });

  // ── Employer match ──
  // Pruned outright when there is no match on file. There is nothing to capture.
  if ((ctx.employerMatchPct ?? 0) > 0) {
    add(TIER.match, 0, {
      key: 'employer-match',
      kind: 'match',
      title: 'Capture your full employer match',
      subtitle: 'Contribute enough to your 401(k) to leave none of it behind',
      description:
        'Every paycheck that goes by without capturing the match is a permanent loss. A 100% match on 3% of salary is an instant double on those dollars, which no investment comes close to, so this comes before any other investing.',
      why: `Your employer matches ${ratePct(ctx.employerMatchPct ?? 0)} of pay. You only get it by contributing.`,
      icon: 'gift',
      accountId: null,
      goalId: null,
    });
  }

  // ── One step per debt account ──
  // No debt accounts means no debt steps at all.
  for (const account of ctx.debtAccounts) {
    if (Math.round(account.balance) <= 0) continue;
    const debtKind = classifyDebtKind(account);
    const facts: DebtFacts = {
      accountId: account.id,
      name: account.name,
      mask: account.mask,
      debtKind,
      balance: account.balance,
      apr: account.apr,
      minimumPayment: account.minimumPayment,
      minimumPaymentEstimated: account.minimumPaymentEstimated,
      minimumPaymentAssumedApr: account.minimumPaymentAssumedApr,
      payoffDate: account.payoffDate,
    };
    const rate = orderingApr(facts);
    const named = account.mask ? `${account.name} ••${account.mask}` : account.name;

    // Highest rate first inside the tier. Negated because `within` sorts
    // ascending, and 0 negates to 0, so a 0% balance sorts last among its own
    // tier exactly as it should.
    add(debtTier(rate), -rate, {
      key: `debt:${account.id}`,
      kind: 'debt',
      title: `Pay off ${named}`,
      subtitle:
        account.apr != null
          ? `${usd(account.balance)} at ${ratePct(account.apr)} APR`
          : `${usd(account.balance)}, no rate on file`,
      description:
        account.apr == null
          // No rate means no argument either way, and saying otherwise would be
          // reading a rate into an account that has none.
          ? 'Without a rate we cannot say whether clearing this beats investing. It sits where accounts of its type usually sit until you add one.'
          : account.apr > DEBT_URGENT_ABOVE
          ? 'A rate this high compounds against you faster than any expected market return. Money put here beats money invested, with none of the uncertainty.'
          : account.apr > DEBT_PATIENT_AT_OR_BELOW
          ? 'This rate is close to what the market is expected to return, but this year\'s tax-advantaged space expires and this balance does not. That is why investing goes first and this comes straight after.'
          : 'On the maths, investing usually beats clearing this. The case for clearing it is simplicity and the weight of carrying it. Your call.',
      why:
        account.apr == null
          ? `${usd(account.balance)} owing, with no rate on file, so what it costs you is unknown.`
          : account.apr > DEBT_PATIENT_AT_OR_BELOW
          ? `${usd(account.balance)} at ${ratePct(account.apr)} APR. Clearing it earns you that rate back, guaranteed.`
          : `${usd(account.balance)} at ${ratePct(account.apr)} APR, a guaranteed return but a modest one.`,
      icon:
        debtKind === 'mortgage'
          ? 'home'
          : account.apr != null && account.apr > DEBT_URGENT_ABOVE
          ? 'flame'
          : 'credit-card',
      accountId: account.id,
      goalId: null,
      debt: facts,
    });
  }

  // ── Emergency fund ──
  const months = emergencyFundMonths(ctx.employmentType);
  add(TIER.emergencyFund, 0, {
    key: 'emergency-fund',
    kind: 'emergency-fund',
    title: `Save ${months} months of expenses`,
    subtitle: 'Liquid and separate from your checking account',
    description:
      'A fund this size keeps job loss, medical bills or a major repair from pushing you back into high-rate debt. A high-yield savings account is the right home for it: you can reach it within 24 hours, and it earns while it waits.',
    why:
      ctx.employmentType === 'self_employed' || ctx.employmentType === '1099'
        ? 'Your income is your own, so it needs a deeper buffer than a salary does.'
        : 'Enough cash that losing your income for a while does not turn into debt.',
    icon: 'piggy-bank',
    accountId: null,
    goalId: null,
  });

  // ── Term life, and the will ──
  // Two steps, not one. Bundled, they moved together: a model reading a single
  // "insurance and will" step set the whole thing aside for anyone childless,
  // taking the will with it, and a person who bought cover still had an
  // unticked step because the will half was outstanding. They are bought from
  // different places, in an afternoon each, so each one is its own achievement.
  //
  // Only ONE of them turns on dependents. Term life replaces income for people
  // who rely on it, so with nobody relying on it, it waits. A will directs what
  // someone has built whoever is in their life, and where there is none the
  // state decides instead, so it is never gated on a count of dependents.
  // Term life exists for one reason: replacing income somebody else lives on.
  // With nobody in that position it is not an early step or a late one, it is
  // not a step. Suggesting it anyway sells a product against a risk this
  // household does not carry.
  // Their answer decides it, and an ANSWER is not the absence of one. The count
  // is what onboarding writes: a number, 0 for nobody, and null for a question
  // they skipped. Read as `?? 0`, the skip was taken as "nobody relies on me"
  // and the step was deleted from everyone who never filled the field in, which
  // is most people. Unknown offers the step and says what would settle it,
  // rather than answering on their behalf in either direction.
  const dependents = ctx.dependentCount;
  const dependentsUnknown = dependents === null;
  if ((dependents ?? 0) > 0 || (dependentsUnknown && ctx.annualIncome > 0)) {
    add(TIER.protection, 0, {
      key: 'term-life',
      kind: 'term-life',
      title: 'Take out term life insurance',
      subtitle: dependentsUnknown
        ? 'Enough to replace your income for anyone who relies on it'
        : `Enough to replace your income for the ${dependents === 1 ? 'person who relies' : 'people who rely'} on it`,
      description:
        'Term life costs $30 to $60 a month at most ages and replaces your income for the people who depend on it. Buy term, not whole life: the investment wrapper on a whole-life policy costs several times more for the same cover. Take the same afternoon to add disability cover, which is the more likely claim of the two, since 1 in 4 workers are disabled before they retire.',
      why: dependentsUnknown
        ? 'Your profile does not say whether anyone relies on your income. Add your dependents and this step is either sized or taken off.'
        : `${dependents} ${dependents === 1 ? 'person depends' : 'people depend'} on your income, so it needs replacing if it stops.`,
      icon: 'shield',
      accountId: null,
      goalId: null,
    });
  }

  // The will is never gated on dependents, because it directs what somebody
  // built whoever is or is not in their life. It is gated on there being
  // something to direct AT ALL: any cash, any investment, any property. That is
  // a low bar and stated as the low bar it is, rather than as an estate worth
  // the paperwork, which `transferableAssets` counts nothing like.
  //
  // What dependents move is WHEN it comes: with somebody relying on this income
  // it sits up with the cover, and otherwise it waits until after the
  // compounding steps.
  const hasDependents = (ctx.dependentCount ?? 0) > 0;
  if (hasDependents || ctx.propertyValue > 0 || transferableAssets(ctx) > 0) {
    add(hasDependents ? TIER.protection : TIER.willLate, 1, {
      key: 'will-trust',
      kind: 'will-trust',
      title: 'Put your will and trust in place',
      subtitle: 'Where what you own goes, decided by you rather than a court',
      description:
        'A will directs what you own to the people you choose, and without one the state decides instead. While you are writing it, name a beneficiary on every retirement account and policy: that name overrides the will, and setting it takes ten minutes. A revocable trust does what the will alone cannot, keeping your estate out of probate so what you leave reaches people in weeks rather than months.',
      why:
        hasDependents
          ? 'Someone depends on you, so where what you own lands is your decision to make, not a court\'s.'
          : ctx.propertyValue > 0
          ? 'You own property, which passes through probate unless you say otherwise.'
          : 'What you have built will pass to somebody, and with no will it goes through a court to get there.',
      icon: 'scroll-text',
      accountId: null,
      goalId: null,
    });
  }

  // ── What goes away each month ──
  // ONE step, from two tests that were two steps and said the same thing. The
  // savings-rate step asked for 20% of income; the readiness step asked for the
  // contribution the simulation needed. Side by side they read as two separate
  // orders to save more, and a household short on both got a third when the
  // tax-advantaged step said "raise your 401(k) contribution".
  //
  // So the step is the HIGHER of the two figures, which is the one that
  // satisfies both, and it says which test set it. Whichever binds, the action
  // a person takes is identical: move more per month.
  const shortForRetirement =
    readiness &&
    readiness.verdict !== 'on_track' &&
    readiness.requiredMonthlySavings !== null &&
    readiness.requiredSuccessRate !== null
      ? {
          successRate: readiness.successRate,
          targetSuccess: readiness.targetSuccess,
          verdict: readiness.verdict,
          retirementAge: readiness.retirementAge,
          currentMonthlySavings: readiness.currentMonthlySavings,
          requiredMonthlySavings: readiness.requiredMonthlySavings,
          requiredSuccessRate: readiness.requiredSuccessRate,
        }
      : null;
  // One predicate for the whole card. `current`, the copy, the icon and the
  // sizing instruction all read `retirementBinds`, so the figure on top and the
  // figure underneath it are always the same two quantities.
  const {
    target: savingTarget,
    current,
    retirementBinds,
  } = savingsRateMeasure(ctx, shortForRetirement);
  if (savingTarget > 0) {
    add(TIER.savingsRate, 0, {
      key: 'savings-rate',
      kind: 'savings-rate',
      title: `Put ${usd(savingTarget)} a month away`,
      subtitle:
        current >= savingTarget
          ? `Already there, at ${usd(current)} a month`
          : current > 0
          ? `Up from the ${usd(current)} a month going away now`
          : 'Nothing is going away each month today',
      description: retirementBinds
        ? `This is the amount the Monte Carlo simulation needed to clear the target, run against your own age, spending, retirement age and mix of holdings. At ${usd(savingTarget)} a month, ${shortForRetirement!.requiredSuccessRate} of 100 simulated markets carried you through. It is the amount, not the account: the steps above name where it goes.`
        : `${SAVINGS_RATE_BENCHMARK}% of what you earn is the benchmark this is measured against. What you keep each month is what pays for every other step on this path, so it sets the pace of all of them at once. The two levers are earning more and spending less, and spending is usually the faster of the two.`,
      why: retirementBinds
        ? `At ${usd(current)} a month, ${shortForRetirement!.successRate} of 100 simulated markets carry you through retirement at ${shortForRetirement!.retirementAge}. On track is ${shortForRetirement!.targetSuccess} of 100.`
        : ctx.savingsRate !== null && ctx.savingsRate > 0
        ? `You keep ${ratePct(ctx.savingsRate)} of what you earn, against a ${SAVINGS_RATE_BENCHMARK}% benchmark.`
        : 'Nothing is left over at the end of the month, so nothing is reaching any of these steps.',
      icon: retirementBinds ? 'alert-circle' : 'percent',
      accountId: null,
      goalId: null,
      ...(shortForRetirement ? { readiness: shortForRetirement } : {}),
    });
  }

  // ── Tax-advantaged investing ──
  // Pruned without earned income: there is nothing to contribute from. The step
  // names the one account this person should use, not the menu.
  // And pruned when it would only repeat the step above. The branches that
  // name an account this household ALREADY holds all resolve to "put more into
  // it", which is the amount step's whole instruction. The branches that open
  // one are a different act, done once, so they stay.
  //
  // And never pruned to nothing. The two steps below it are what make the
  // pruning safe: the room step prices the limits, the brokerage step names
  // where anything past them goes. Where NEITHER is emitted, this is the only
  // investing instruction there is, and taking it off left a household with
  // income, a surplus and a retirement balance being told nothing about where
  // to put any of it.
  const taxAdvantagedBalance = ctx.hsaBalance + ctx.rothIraBalance + ctx.trad401kBalance;
  const monthlySpare = ctx.monthlySurplus ?? 0;
  const roomStep = ctx.annualIncome > 0 && taxAdvantagedBalance > 0 && contributionLimits(ctx).total > 0;
  const brokerageStep = taxAdvantagedBalance > 0 && monthlySpare > 0 && ctx.taxableBrokerageBalance <= 0;
  const choice = ctx.annualIncome > 0 ? taxAdvantagedChoice(ctx) : null;
  if (choice && (choice.opensAccount || savingTarget <= 0 || (!roomStep && !brokerageStep))) {
    add(TIER.taxAdvantaged, 0, {
      key: 'tax-advantaged',
      kind: 'tax-advantaged',
      title: choice.title,
      subtitle: choice.subtitle,
      description: choice.description,
      why: choice.why,
      icon: 'sprout',
      accountId: null,
      goalId: null,
    });
  }

  // ── Contribution limits ──
  // Only once something is already going in. Otherwise the step above is the
  // whole job and this would be a second copy of it.
  //
  // And only where there is room to fill. Every account in the total is gated
  // on this household holding it or being eligible for it, so the total can be
  // zero: a Roth holder over the phase-out with no workplace plan reaches none
  // of it. The step then read "Fill $0 of contribution room" and claimed a $0
  // monthly share of the surplus, which is an order to do nothing.
  if (roomStep) {
    add(TIER.contributionLimits, 0, {
      key: 'max-contributions',
      kind: 'contribution-limits',
      title: `Max out your ${CONTRIBUTION_TAX_YEAR} contribution room`,
      subtitle: 'Every tax-advantaged account you can use, at its annual limit',
      description:
        `Every dollar in these accounts compounds with a structural tax advantage, and the room you skip for ${CONTRIBUTION_TAX_YEAR} does not come back. This is the one deadline on the path that a calendar enforces rather than you.`,
      why: 'You already contribute, so filling the annual limits is the next lever you have.',
      icon: 'trending-up',
      accountId: null,
      goalId: null,
    });
  }

  // ── Taxable brokerage ──
  // Pruned when it does not apply: nothing in the tax-advantaged accounts yet
  // (the step above is then the whole job), or nothing spare each month to
  // invest with.
  // Pruned once one is open, too. "Invest what is left" is not something a
  // person can finish, and somebody already holding a taxable account has done
  // the part of it that is an act. What is left over each month is the amount
  // step's job, and the sizing waterfall's.
  if (brokerageStep) {
    add(TIER.brokerage, 0, {
      key: 'taxable-brokerage',
      kind: 'brokerage',
      title: 'Open a taxable brokerage account',
      subtitle: 'No annual cap, and nothing locked until 59 and a half',
      description:
        'Nothing here is locked until 59 and a half, so this is the account that pays for anything before retirement. Hold broad index funds and hold them past a year, so gains are taxed at the long-term rate instead of as income.',
      why: `Your tax-advantaged accounts hold ${usd(taxAdvantagedBalance)}, and their limits are annual, so this is where anything past them goes.`,
      icon: 'line-chart',
      accountId: null,
      goalId: null,
    });
  }

  // ── One step per active goal ──
  ctx.goals.forEach((goal, index) => {
    if (!(goal.targetAmount > 0)) return;
    const deadline = goal.deadline;
    // ONE name for the step, everywhere on it. Renaming only the title left the
    // card headed "Retirement ready" above a link reading "Retirement Savings",
    // which is two names for one thing on one card, and a `why` claiming a
    // title as the reader's own words when they never wrote it.
    const renamed = goal.category === 'retirement';
    const stepName = renamed ? 'Retirement ready' : goal.name;
    add(
      TIER.goal,
      // Soonest deadline first, then the smallest target. Goals with no date
      // keep the order they were created in, behind the dated ones.
      deadline ? deadline.getTime() / 1e10 : 1e6 + index,
      {
        key: `goal:${goal.id}`,
        kind: 'goal',
        // A goal's own name is the title, because it is the person's own words
        // for it, EXCEPT where those words name a life stage rather than an
        // achievement. "Retirement" is a date that arrives whether or not
        // anything was done about it, so as a step it can never be ticked. The
        // achievement underneath it is being ready for it, which is what the
        // simulation actually measures, so that is what the step is called.
        title: stepName,
        subtitle: deadline
          ? `${usd(goal.targetAmount)} by ${monthName(deadline)}`
          : `${usd(goal.targetAmount)}, no date set`,
        description: goalDescription(goal.details),
        // Their FIGURE is theirs whatever the step is called, and the sentence
        // says so without attributing a name we chose to them.
        why: deadline
          ? `${renamed ? 'The target you set' : 'Your own goal'}: ${usd(goal.targetAmount)} by ${monthName(deadline)}, ${monthsUntil(deadline)}.`
          // The retirement step is dated by the simulation rather than by a
          // deadline, so asking for one to earn a date would ask for something
          // the same card already shows two lines further down.
          : renamed
          ? `The target you set: ${usd(goal.targetAmount)}.`
          : `Your own goal: ${usd(goal.targetAmount)}. Give it a date and it gets a monthly number.`,
        icon: 'target',
        accountId: null,
        goalId: goal.id,
        // Set only when this goal actually took a built-in step's place, which
        // is what makes it load bearing. A `savings` goal covers nothing and
        // stays as droppable as any other candidate.
        coversStep: STEP_COVERED_BY_GOAL_CATEGORY[goal.category],
        // Only the retirement goal: it is the one whose target is the portfolio
        // the simulation projects.
        ...(renamed && retirementCurve ? { retirementCurve } : {}),
        goal: {
          goalId: goal.id,
          name: stepName,
          category: goal.category,
          targetAmount: goal.targetAmount,
          currentAmount: goal.currentAmount,
          deadline,
          details: goal.details,
        },
      },
    );
  });

  // ── Financial independence ──
  // Pruned when nothing prices it: with neither spending nor income there is no
  // number to aim at.
  const spendBasis = ctx.stableMonthlyExpenses ?? ctx.monthlyExpenses;
  const hasFiBasis = (spendBasis !== null && spendBasis > 0) || ctx.annualIncome > 0;
  if (hasFiBasis) {
    add(TIER.independence, 0, {
      key: 'financial-independence',
      kind: 'independence',
      title: 'Reach financial independence',
      subtitle: 'A portfolio that covers your spending without work',
      description:
        `The 4% rule prices it: ${RETIREMENT_INCOME_MULTIPLE} times what you spend in a year, which is the point the portfolio can pay your costs indefinitely without being drawn down.`,
      // Independence is retirement readiness carried further: the same portfolio,
      // reached early enough that work becomes a choice. Said that way it stops
      // reading as an aspiration floating free of everything above it.
      why:
        readiness === null
          ? 'Your own spending sets the portfolio that would cover it without work.'
          : readiness.verdict === 'on_track'
          ? `You are already on track to retire at ${readiness.retirementAge}. This is the same portfolio, reached early enough that work becomes optional.`
          : `This comes after being ready to retire at ${readiness.retirementAge}, which you are not yet. Close that gap first and this becomes a question of when.`,
      icon: 'rocket',
      accountId: null,
      goalId: null,
      ...(retirementCurve ? { retirementCurve } : {}),
    });
  }

  // `coversStep` is load bearing: `validateOrder` refuses to leave such a
  // candidate out, because dropping it takes the job off the path in BOTH
  // forms. So it stands only where a built-in step was genuinely turned away,
  // and a goal that displaced nothing stays as droppable as any other.
  for (const { candidate } of placed) {
    if (candidate.coversStep !== undefined && !suppressed.has(candidate.coversStep)) {
      delete candidate.coversStep;
    }
  }

  placed.sort((a, b) => a.tier - b.tier || a.within - b.within || a.candidate.key.localeCompare(b.candidate.key));
  return placed.map((p) => p.candidate);
}

/**
 * The monthly dollars a 20% savings rate would be. Sizing and the step copy
 * both read this, so the figure they quote can never drift apart.
 */
export function savingsRateTarget(ctx: PathContext): number {
  return ctx.monthlyIncome * (SAVINGS_RATE_BENCHMARK / 100);
}

/**
 * The whole measurement behind the amount step: what has to go away each month,
 * what goes away now, and which of the two tests set the figure.
 *
 * ONE function because the two figures have to be on ONE basis, and they were
 * not. The target is the higher of the benchmark share and the simulation's
 * contribution, but `current` was taken from the simulation whenever a
 * simulation had run at all, and the simulation counts a different quantity:
 * `max(0, income * 0.75 - annual spend) / 12 + match`, rounded and capped,
 * against a surplus of `income - spending`. They differ by roughly a quarter of
 * gross plus the match. So a household the BENCHMARK binds on had its
 * retirement-contribution proxy measured against a total-savings target: the
 * same household read "already there, at $2,000 a month" with no simulation and
 * "up from the $900 a month going away now", 56% and an order to move $700 more,
 * with one attached. Nothing about them had changed.
 *
 * Whichever test binds now supplies BOTH figures, and every branch of the card,
 * its copy and its instruction reads `retirementBinds` rather than testing for
 * the presence of a readiness read. A figure can only be compared with one on
 * its own basis.
 */
export interface SavingsRateMeasure {
  /** The monthly figure to reach, the higher of the two tests. */
  target: number;
  /** What goes away each month, on the same basis as `target`. */
  current: number;
  /** True when the simulation's contribution is the binding figure, not the benchmark. */
  retirementBinds: boolean;
}

export function savingsRateMeasure(
  ctx: PathContext,
  readiness: Pick<ReadinessFacts, 'currentMonthlySavings' | 'requiredMonthlySavings'> | null,
): SavingsRateMeasure {
  const rateTarget = ctx.savingsRate !== null ? savingsRateTarget(ctx) : 0;
  const needTarget = readiness?.requiredMonthlySavings ?? null;
  const retirementBinds = needTarget !== null && needTarget >= rateTarget;
  return {
    target: Math.max(rateTarget, needTarget ?? 0),
    // The simulation's own reading only where the simulation is what set the
    // target. Otherwise a month that ends in the red keeps nothing, and a
    // negative rate is not a share of the benchmark.
    current: retirementBinds
      ? readiness!.currentMonthlySavings
      : Math.max(ctx.monthlySurplus ?? 0, 0),
    retirementBinds,
  };
}

/**
 * Annual spending the FI number is priced from.
 *
 * With no spending history this is a share of income, which is OUR assumption.
 * `hasSpendHistory` says which of the two a caller is holding, and every step
 * that prints this figure uses it rather than calling an assumption theirs.
 */
export function fiAnnualExpenses(ctx: PathContext): number {
  const spendBasis = ctx.stableMonthlyExpenses ?? ctx.monthlyExpenses;
  if (spendBasis !== null && spendBasis > 0) return spendBasis * 12;
  return ctx.annualIncome > 0 ? ctx.annualIncome * ASSUMED_SPEND_SHARE_OF_INCOME : 0;
}

export function fiTarget(ctx: PathContext): number {
  return fiAnnualExpenses(ctx) * RETIREMENT_INCOME_MULTIPLE;
}

/**
 * What this household would actually leave behind: cash, every invested
 * balance, and property.
 *
 * The ordering payload bands it, so the model can weigh how much a household
 * has actually built when it decides where the steps that only compound belong.
 *
 * Debt is deliberately not netted off. What a will has to direct somewhere is
 * the gross of these, because an estate is settled from the assets.
 */
export function transferableAssets(ctx: PathContext): number {
  return (
    ctx.cashTotal +
    ctx.rothIraBalance +
    ctx.trad401kBalance +
    ctx.brokerageBalance +
    ctx.hsaBalance +
    ctx.propertyValue
  );
}

/** The sentence a typed goal's own inputs already state, when it has them. */
function goalDescription(details: GoalDetails | null): string {
  if (!details) return '';
  switch (details.kind) {
    case 'home_purchase':
      return `A down payment on a home priced at ${usd(details.homePrice)}.`;
    case 'car':
      return details.payCash
        ? `The full price of a vehicle at ${usd(details.vehiclePrice)}.`
        : `A down payment on a vehicle priced at ${usd(details.vehiclePrice)}.`;
    case 'education':
      return `${details.years} year${details.years === 1 ? '' : 's'} at ${usd(details.annualCost)} a year, starting ${details.startYear}.`;
    case 'retirement':
      return `A portfolio that pays ${usd(details.targetAnnualIncome)} a year at the 4% rule.`;
    case 'emergency_fund':
      return `${details.months} month${details.months === 1 ? '' : 's'} at ${usd(details.monthlySpendUsed)} a month, your average spending over the last 3 months.`;
  }
}
