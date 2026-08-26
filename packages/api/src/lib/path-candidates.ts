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
 * on file means no match step, no debt accounts means no debt steps, nothing to
 * leave means no estate step. Pruning is the point: two people should not get
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
  | 'protection'
  | 'savings-rate'
  | 'retirement-readiness'
  | 'tax-advantaged'
  | 'contribution-limits'
  | 'brokerage'
  | 'goal'
  | 'independence'
  | 'estate';

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
  /** A step whose absence would undo the rest. Never quietly dropped. */
  mandatory: boolean;
  accountId: string | null;
  goalId: string | null;
  debt?: DebtFacts;
  goal?: GoalFacts;
  readiness?: ReadinessFacts;
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
  emergencyFund: 40,
  protection: 50,
  savingsRate: 55,
  retirementReadiness: 57,
  taxAdvantaged: 60,
  debtMiddle: 70,
  contributionLimits: 80,
  brokerage: 85,
  goal: 90,
  debtPatient: 100,
  independence: 110,
  estate: 120,
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
 * Where a Roth IRA contribution starts phasing out, by filing status. Below
 * these a full contribution is allowed, so below these we are willing to name
 * the account.
 *
 * The test runs on gross annual income, which is at or above the modified AGI
 * the IRS actually measures, so it can only ever under-claim eligibility. A
 * filing status we do not hold means we do not name the account at all.
 */
const ROTH_PHASE_OUT_START: Record<NonNullable<PathContext['filingStatus']>, number> = {
  single: 150_000,
  head_of_household: 150_000,
  married_joint: 236_000,
  married_separate: 0,
};

function canFullyFundRothIra(ctx: PathContext): boolean {
  if (ctx.filingStatus === null) return false;
  return ctx.annualIncome > 0 && ctx.annualIncome < ROTH_PHASE_OUT_START[ctx.filingStatus];
}

/** One tax-advantaged step, named for the account this person should use. */
export interface TaxAdvantagedChoice {
  title: string;
  subtitle: string;
  description: string;
  why: string;
  /** What the sizing pass tells them to do, in the same account's name. */
  action: string;
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
    };
  }
  if (ctx.trad401kBalance > 0) {
    return {
      title: 'Raise your 401(k) contribution',
      subtitle: 'The account you already have, with room left in it',
      description:
        'The 401(k) limit is several times an IRA\'s, and contributions come straight off your taxable income before you ever see the money. Raising the percentage is a single form, and the higher rate applies to every paycheck after it.',
      why: 'You already contribute to a 401(k), so raising the rate is the least friction of any move here.',
      action: 'Raise your 401(k) contribution rate with your payroll provider.',
    };
  }
  if (ctx.employerMatchPct > 0) {
    return {
      title: 'Contribute to your 401(k) beyond the match',
      subtitle: 'The same plan, past the point the match stops',
      description:
        'The match is the first reason to contribute, not the last. Everything past it still comes off your taxable income and still compounds untaxed until you draw it.',
      why: 'You have a 401(k) through work, and its limit is far above what the match alone puts in.',
      action: 'Raise your 401(k) contribution rate past the percentage the match covers.',
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
  };
}

/** The emergency-fund target in months, from how steady the income is. */
export function emergencyFundMonths(employmentType: string | null): number {
  return employmentType === 'self_employed' || employmentType === '1099' ? 9 : 6;
}

// ── Candidates ────────────────────────────────────────────────────────────────

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
  const add = (tier: number, within: number, candidate: PathCandidate) =>
    placed.push({ tier, within, candidate });

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
    mandatory: true,
    accountId: null,
    goalId: null,
  });

  // ── Employer match ──
  // Pruned outright when there is no match on file. There is nothing to capture.
  if (ctx.employerMatchPct > 0) {
    add(TIER.match, 0, {
      key: 'employer-match',
      kind: 'match',
      title: 'Capture your full employer match',
      subtitle: 'Contribute enough to your 401(k) to leave none of it behind',
      description:
        'Every paycheck that goes by without capturing the match is a permanent loss. A 100% match on 3% of salary is an instant double on those dollars, which no investment comes close to, so this comes before any other investing.',
      why: `Your employer matches ${ratePct(ctx.employerMatchPct)} of pay. You only get it by contributing.`,
      icon: 'gift',
      mandatory: true,
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
      payoffDate: account.payoffDate,
    };
    const rate = orderingApr(facts);
    const named = account.mask ? `${account.name} ••${account.mask}` : account.name;

    add(debtTier(rate), rate === 0 ? 0 : -rate, {
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
      mandatory: account.apr != null && account.apr > DEBT_URGENT_ABOVE,
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
    mandatory: true,
    accountId: null,
    goalId: null,
  });

  // ── Insurance and will ──
  add(TIER.protection, 0, {
    key: 'insurance-will',
    kind: 'protection',
    title: 'Get insured and write your will',
    subtitle: 'Term life, disability cover, and named beneficiaries',
    description:
      'One uninsured event can reset your entire financial journey to the first step. Term life costs $30 to $60/month and replaces your income for dependents. Disability insurance is even more likely to be needed: 1 in 4 workers are disabled before retirement. A will ensures your assets go where you intend.',
    why:
      ctx.dependentCount > 0
        ? `${ctx.dependentCount} ${ctx.dependentCount === 1 ? 'person depends' : 'people depend'} on your income, so it needs replacing if it stops.`
        : 'A will and the right cover keep one bad event from undoing everything behind it.',
    icon: 'shield',
    mandatory: true,
    accountId: null,
    goalId: null,
  });

  // ── Savings rate ──
  // Pruned when no rate can be computed: a rate needs both an income and some
  // spending history, and a rate we cannot work out is never shown as 0%.
  if (ctx.savingsRate !== null) {
    add(TIER.savingsRate, 0, {
      key: 'savings-rate',
      kind: 'savings-rate',
      title: `Save ${SAVINGS_RATE_BENCHMARK}% of your income`,
      subtitle: `${usd(savingsRateTarget(ctx))} a month, out of the ${usd(ctx.monthlyIncome)} you earn`,
      description:
        'What you keep each month is what pays for every other step on this path, so your savings rate sets the pace of all of them at once. The two levers are earning more and spending less, and spending is usually the faster of the two.',
      why:
        ctx.savingsRate > 0
          ? `You keep ${ratePct(ctx.savingsRate)} of what you earn.`
          : 'Nothing is left over at the end of the month, so nothing is reaching any of these steps.',
      icon: 'percent',
      mandatory: false,
      accountId: null,
      goalId: null,
    });
  }

  // ── Retirement readiness ──
  // Only when the simulation says they are short, and only when it could solve
  // for a contribution that closes the gap. On track, or no verdict at all, and
  // there is no step: an aspiration nobody can act on is not one.
  if (
    readiness &&
    readiness.verdict !== 'on_track' &&
    readiness.requiredMonthlySavings !== null &&
    readiness.requiredSuccessRate !== null
  ) {
    const required = readiness.requiredMonthlySavings;
    const current = readiness.currentMonthlySavings;
    add(TIER.retirementReadiness, 0, {
      key: 'retirement-readiness',
      kind: 'retirement-readiness',
      title: `Raise retirement saving to ${usd(required)} a month`,
      subtitle:
        current > 0
          ? `Up from the ${usd(current)} a month going in now`
          : 'Nothing is going into retirement today',
      description:
        `This is the amount the Monte Carlo simulation needed to clear the target, run against your own age, spending, retirement age and mix of holdings. At ${usd(required)} a month, ${readiness.requiredSuccessRate} of 100 simulated markets carried you through. It is the amount, not the account. The tax-advantaged step names where to put it.`,
      why:
        `At ${usd(current)} a month, ${readiness.successRate} of 100 simulated markets carry you through retirement at ${readiness.retirementAge}. On track is ${readiness.targetSuccess} of 100.`,
      icon: 'alert-circle',
      // Everything below this step assumes retirement is funded. It is not.
      mandatory: true,
      accountId: null,
      goalId: null,
      readiness: {
        successRate: readiness.successRate,
        targetSuccess: readiness.targetSuccess,
        verdict: readiness.verdict,
        retirementAge: readiness.retirementAge,
        currentMonthlySavings: current,
        requiredMonthlySavings: required,
        requiredSuccessRate: readiness.requiredSuccessRate,
      },
    });
  }

  // ── Tax-advantaged investing ──
  // Pruned without earned income: there is nothing to contribute from. The step
  // names the one account this person should use, not the menu.
  if (ctx.annualIncome > 0) {
    const choice = taxAdvantagedChoice(ctx);
    add(TIER.taxAdvantaged, 0, {
      key: 'tax-advantaged',
      kind: 'tax-advantaged',
      title: choice.title,
      subtitle: choice.subtitle,
      description: choice.description,
      why: choice.why,
      icon: 'sprout',
      mandatory: false,
      accountId: null,
      goalId: null,
    });
  }

  // ── Contribution limits ──
  // Only once something is already going in. Otherwise the step above is the
  // whole job and this would be a second copy of it.
  const taxAdvantagedBalance = ctx.hsaBalance + ctx.rothIraBalance + ctx.trad401kBalance;
  if (ctx.annualIncome > 0 && taxAdvantagedBalance > 0) {
    add(TIER.contributionLimits, 0, {
      key: 'max-contributions',
      kind: 'contribution-limits',
      title: "Max out this year's contribution room",
      subtitle: 'Every tax-advantaged account at its annual limit',
      description:
        'Every dollar in these accounts compounds with a structural tax advantage, and the room you skip this year does not come back. This is the one deadline on the path that a calendar enforces rather than you.',
      why: 'You already contribute, so filling the annual limits is the next lever you have.',
      icon: 'trending-up',
      mandatory: false,
      accountId: null,
      goalId: null,
    });
  }

  // ── Taxable brokerage ──
  // Pruned when it does not apply: nothing in the tax-advantaged accounts yet
  // (the step above is then the whole job), or nothing spare each month to
  // invest with.
  const monthlySpare = ctx.monthlySurplus ?? 0;
  if (taxAdvantagedBalance > 0 && monthlySpare > 0) {
    add(TIER.brokerage, 0, {
      key: 'taxable-brokerage',
      kind: 'brokerage',
      title: 'Invest what is left in a brokerage account',
      subtitle: 'A taxable account, with no annual contribution cap',
      description:
        'Nothing here is locked until 59 and a half, so this is the account that pays for anything before retirement. Hold broad index funds and hold them past a year, so gains are taxed at the long-term rate instead of as income.',
      why: ctx.brokerageBalance > 0
        ? `You hold ${usd(ctx.brokerageBalance)} in a taxable account, with ${usd(monthlySpare)} a month spare to add to it.`
        : `Your tax-advantaged accounts hold ${usd(taxAdvantagedBalance)}, and ${usd(monthlySpare)} a month has nowhere else to go.`,
      icon: 'line-chart',
      mandatory: false,
      accountId: null,
      goalId: null,
    });
  }

  // ── One step per active goal ──
  ctx.goals.forEach((goal, index) => {
    if (!(goal.targetAmount > 0)) return;
    const deadline = goal.deadline;
    add(
      TIER.goal,
      // Soonest deadline first, then the smallest target. Goals with no date
      // keep the order they were created in, behind the dated ones.
      deadline ? deadline.getTime() / 1e10 : 1e6 + index,
      {
        key: `goal:${goal.id}`,
        kind: 'goal',
        title: goal.name,
        subtitle: deadline
          ? `${usd(goal.targetAmount)} by ${monthName(deadline)}`
          : `${usd(goal.targetAmount)}, no date set`,
        description: goalDescription(goal.details),
        why: deadline
          ? `Your own goal: ${usd(goal.targetAmount)} by ${monthName(deadline)}, ${monthsUntil(deadline)}.`
          : `Your own goal: ${usd(goal.targetAmount)}. Give it a date and it gets a monthly number.`,
        icon: 'target',
        mandatory: false,
        accountId: null,
        goalId: goal.id,
        goal: {
          goalId: goal.id,
          name: goal.name,
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
      mandatory: false,
      accountId: null,
      goalId: null,
    });
  }

  // ── Estate and legacy ──
  // Pruned when there is nobody to leave anything to, no property, and no
  // portfolio that has outgrown a will. A renter with no dependents does not
  // get an estate step.
  const invested = ctx.rothIraBalance + ctx.trad401kBalance + ctx.brokerageBalance + ctx.hsaBalance;
  const fiNumber = fiTarget(ctx);
  const estateReason =
    ctx.dependentCount > 0
      ? 'Someone depends on you, so where your assets land is a decision you should make, not a court.'
      : ctx.propertyValue > 0
      ? 'You own property, which passes through probate unless you say otherwise.'
      : fiNumber > 0 && invested >= fiNumber
      ? 'Your portfolio has outgrown what a will alone handles well.'
      : null;
  if (estateReason) {
    add(TIER.estate, 0, {
      key: 'estate-legacy',
      kind: 'estate',
      title: 'Put your estate plan in place',
      subtitle: 'A trust, beneficiary designations, and a giving plan',
      description:
        'Optimize for what outlasts you: a revocable trust avoids probate, donor-advised funds maximize charitable tax efficiency, and beneficiary designations ensure assets transfer as intended.',
      why: estateReason,
      icon: 'landmark',
      mandatory: false,
      accountId: null,
      goalId: null,
    });
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

/** Annual spending the FI number is priced from, and the number itself. */
export function fiAnnualExpenses(ctx: PathContext): number {
  const spendBasis = ctx.stableMonthlyExpenses ?? ctx.monthlyExpenses;
  if (spendBasis !== null && spendBasis > 0) return spendBasis * 12;
  return ctx.annualIncome > 0 ? ctx.annualIncome * 0.7 : 0;
}

export function fiTarget(ctx: PathContext): number {
  return fiAnnualExpenses(ctx) * RETIREMENT_INCOME_MULTIPLE;
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
