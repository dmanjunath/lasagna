/**
 * Journey v2 — the trial engine.
 *
 * v1 decides a path in two halves: `buildPathCandidates` gates each step behind
 * a condition and stamps it with a tier number, and a model then reorders what
 * survived inside `weave`, `urgentDebtFirst` and `rateBeforeRetirement`. Roughly
 * eleven hundred lines of it are eligibility rules and a priority table.
 *
 * This engine has neither. Every step in the catalog is offered for every
 * household, and ONE model call decides which of them belong, in what order,
 * and what each one is aiming at. Nothing here ranks, gates or reorders after
 * the fact.
 *
 * Three things it does NOT hand over, because handing them over would make the
 * page lie rather than make it simpler:
 *
 *  - The step vocabulary. The catalog below is fixed, so a step still maps to a
 *    `kind` that `measure()` knows how to price and the chat agent knows how to
 *    read. The model may add its own steps on top, and those carry no `kind`
 *    and are priced only from what it set as their target.
 *  - The arithmetic. The model sets a TARGET; `sizePath` still computes what is
 *    there now, the progress, the dollars a month reaching the step and the
 *    date it lands, off the real balances and the real surplus.
 *  - Account names. The payload describes a balance by kind, rate and size, and
 *    never by the name on it, so there is no name in the answer to restore.
 */

import { z } from 'zod';
import { getModel, getModelSlug } from '../agent/index.js';
import { llmGenerateText } from './llm.js';
import {
  classifyDebtKind,
  contributionLimits,
  emergencyFundMonths,
  fiTarget,
  savingsRateTarget,
  SAVINGS_RATE_BENCHMARK,
  DEBT_PATIENT_AT_OR_BELOW,
  DEBT_URGENT_ABOVE,
  type DebtFacts,
  type GoalFacts,
  type PathCandidate,
  type PathStepKind,
} from './path-candidates.js';
import { isTypedGoalCategory } from '@lasagna/core';
import type { PathContext } from './path-context.js';
import { emergencyFundTarget, sizePath } from './path-sizing.js';
import type { PathReadiness } from '../services/retirement-readiness.js';

// The journey is one call that decides a whole plan, and several of the rules
// in the prompt below only started holding on the stronger model. It is also
// the cheapest place in the app to spend on quality: one generation per
// household, reused on every read until their situation changes.
const LEVEL = 'frontier' as const;

function usd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

// ── The catalog ───────────────────────────────────────────────────────────────
//
// The standardized steps, said once. Every household is offered all of them,
// whatever their situation: there is no condition on this table, and that is
// the point of the engine. What is true of a household decides whether the
// MODEL keeps a step, not whether the step is ever seen.
//
// `title`, `subtitle` and `description` stay ours rather than the model's, so
// the same step reads the same way for everybody and two households comparing
// notes see one product. The model writes `why`, which is the part that is
// about them.

interface CatalogEntry {
  kind: PathStepKind;
  /**
   * The step's name, and where there is a figure that makes it actionable, the
   * figure with it: "Cut spending by $715 a month", not "Cut spending".
   *
   * A function of the household rather than the model's words, for the same
   * reason every other figure on the card is. The model's prose is written once
   * and stored; a title is rebuilt from today's balances on every read. Had the
   * model written these, the most prominent line on the card would have been the
   * one that went stale first.
   *
   * Plain string where no figure applies. A will is a will.
   */
  title: string | ((ctx: PathContext) => string);
  /** Same rule as the title: a function only where the household changes it. */
  subtitle: string | ((ctx: PathContext) => string);
  description: string;
  icon: string;
  /** What the model is being asked to size, in words. Empty when nothing is. */
  targetMeans: string;
}

const CATALOG: Record<string, CatalogEntry> = {
  stabilize: {
    kind: 'buffer',
    title: `Save a starter emergency fund of ${usd(1000)}`,
    subtitle: 'Cash set aside for the first surprise bill',
    description:
      'A surprise bill will come. With cash ready you pay it and move on. Without it you put the bill on a card and pay interest on it for a year. This comes first because every step below it comes undone without it.',
    icon: 'shield',
    targetMeans: 'the size of the first cash cushion, usually about $1,000',
  },
  'employer-match': {
    kind: 'match',
    title: (ctx) =>
      ctx.employerMatchPct && ctx.employerMatchPct > 0
        ? `Capture your full employer match of ${ctx.employerMatchPct}%`
        : 'Capture your full employer match',
    subtitle: 'Money your employer adds, if you contribute first',
    description:
      'Your employer pays into your retirement account, but only on the money you put in yourself. Nothing else doubles your money the day you contribute it. Every payday you miss it, that match is gone for good.',
    icon: 'gift',
    targetMeans: '',
  },
  'emergency-fund': {
    kind: 'emergency-fund',
    title: (ctx) => {
      const target = emergencyFundTarget(ctx);
      return target > 0
        ? `Save a full emergency fund of ${usd(target)}`
        : 'Save a full emergency fund';
    },
    subtitle: (ctx) => `${emergencyFundMonths(ctx.employmentType)} months of what you spend`,
    description:
      'This is what turns losing a job into a problem rather than a disaster. Keep it in a savings account you can reach the same day, not in investments, because you will need it when markets are at their worst.',
    icon: 'piggy-bank',
    targetMeans: 'the total cash to keep saved, normally three to six months of their spending',
  },
  'term-life': {
    kind: 'term-life',
    title: 'Take out term life insurance',
    subtitle: 'Replaces your income for the people who depend on it',
    description:
      'Term life replaces your income for anyone who relies on it. It costs about $30 to $60 a month at most ages. Buy term, not whole life: the investment wrapper on a whole-life policy costs several times more for the same cover. Add disability cover at the same time, which is the likelier claim of the two.',
    icon: 'heart-pulse',
    targetMeans: '',
  },
  'will-trust': {
    kind: 'will-trust',
    title: 'Put in place a will and trust',
    subtitle: 'You direct what you own, rather than a court',
    description:
      'A will directs what you own to the people you choose. Without one the state decides instead, through probate, which takes months. Name a beneficiary on every retirement account and policy at the same time, because that name overrides the will. A revocable trust keeps your estate out of probate entirely.',
    icon: 'scroll-text',
    targetMeans: '',
  },
  'savings-rate': {
    kind: 'savings-rate',
    title: (ctx) => {
      // Two different jobs wear this step. Somebody short is being asked to
      // close a gap; somebody with room to spare is being asked to put more of
      // it away. Naming the wrong one is worse than naming neither.
      const surplus = ctx.monthlySurplus;
      if (surplus !== null && surplus < 0) {
        return `Cut spending by ${usd(-surplus)} a month so you spend less than you make`;
      }
      const target = savingsRateTarget(ctx);
      return target > 0
        ? `Raise your savings rate to ${usd(target)} a month`
        : 'Spend less than you earn';
    },
    subtitle: (ctx) =>
      ctx.monthlySurplus !== null && ctx.monthlySurplus < 0
        ? 'Close the gap between what you earn and what you spend'
        : `${SAVINGS_RATE_BENCHMARK}% of what you earn`,
    description:
      'How much you keep each month sets how fast every step below this one finishes. It is the single change with the widest reach.',
    icon: 'percent',
    targetMeans: 'the dollars a month they should keep instead of spending',
  },
  'tax-advantaged': {
    kind: 'tax-advantaged',
    title: (ctx) => {
      const { total } = contributionLimits(ctx);
      return total > 0
        ? `Fund a tax-advantaged account with ${usd(total)}`
        : 'Fund a tax-advantaged account';
    },
    subtitle: 'A Roth, a 401(k) or an HSA, where growth is not taxed yearly',
    description:
      'A Roth, a workplace plan or an HSA compounds without a tax drag every year. Over decades that difference is large. The room resets each year and does not carry over, so an unused year is gone.',
    icon: 'sprout',
    targetMeans: 'the dollars to put into tax-free accounts this year',
  },
  'max-contributions': {
    kind: 'contribution-limits',
    title: (ctx) => {
      const { total } = contributionLimits(ctx);
      return total > 0
        ? `Max out your contribution room of ${usd(total)}`
        : 'Max out your contribution room';
    },
    subtitle: 'Fill it before December, or lose it',
    description:
      'Each account has a yearly contribution limit, and unused room does not roll over. Past the match and your first account, filling the rest is the cheapest growth available to you.',
    icon: 'target',
    targetMeans: 'the dollars of tax-free room left to fill this year',
  },
  'taxable-brokerage': {
    kind: 'brokerage',
    title: 'Open a taxable brokerage account',
    subtitle: 'Where money goes once the yearly limits are full',
    description:
      'Once the tax-advantaged limits are full, an ordinary brokerage account holds the rest. No contribution limit and no withdrawal age. You do pay tax on what it earns.',
    icon: 'line-chart',
    targetMeans: 'the dollars a month to invest here, or the balance to build',
  },
  'debt-free': {
    kind: 'debt-free',
    // No figure. The total is the sum of the payoff steps above it, so quoting
    // it here says the same number the journey has already said once per
    // balance. A milestone is named, not priced.
    title: 'Become debt free',
    subtitle: 'No card, no loan, no mortgage',
    description:
      'The point where nothing you owe is charging you anything. The payoff steps above do the work. This is the finish line they are all heading for.',
    icon: 'flame',
    targetMeans: '',
  },
  'financial-independence': {
    kind: 'independence',
    title: (ctx) => {
      const target = fiTarget(ctx);
      return target > 0
        ? `Reach financial independence at ${usd(target)}`
        : 'Reach financial independence';
    },
    subtitle: 'A portfolio that covers what you spend',
    description:
      'The point where what you hold covers what you spend, and working becomes a choice. Everything above this step is what gets you here.',
    icon: 'rocket',
    targetMeans: 'the savings total that covers their yearly spending',
  },
};

// ── Candidates, ungated ───────────────────────────────────────────────────────

/**
 * Every step this household COULD have, with no judgement about whether they
 * should. The two families that cannot be offered unconditionally are the ones
 * that name a thing: a payoff step needs a balance to pay off and a goal step
 * needs a goal, so those are built from what they actually hold.
 */
export function buildJourneyCatalog(ctx: PathContext): PathCandidate[] {
  const out: PathCandidate[] = [];

  for (const [key, entry] of Object.entries(CATALOG)) {
    out.push({
      key,
      kind: entry.kind,
      title: typeof entry.title === 'function' ? entry.title(ctx) : entry.title,
      subtitle: typeof entry.subtitle === 'function' ? entry.subtitle(ctx) : entry.subtitle,
      description: entry.description,
      why: '',
      icon: entry.icon,
      accountId: null,
      goalId: null,
    });
  }

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
      termMonths: account.termMonths,
      originationDate: account.originationDate,
    };
    const named = account.mask ? `${account.name} ••${account.mask}` : account.name;
    out.push({
      key: `debt:${account.id}`,
      kind: 'debt',
      title: `Pay off ${named} of ${usd(account.balance)}`,
      // The balance is in the title now, so the subtitle carries only what the
      // title does not: what it costs. Repeating the figure here put it on the
      // card twice, the same way pricing the debt-free milestone restated every
      // payoff step above it.
      subtitle: account.apr != null ? `${account.apr}% APR` : 'No rate on file',
      description:
        account.apr == null
          ? 'Nobody has told us what this one charges, so we cannot say whether paying it off beats investing the money instead.'
          : 'Paying this off is like earning its interest rate, with none of the guesswork that comes with investing.',
      why: '',
      icon: debtKind === 'mortgage' ? 'home' : 'credit-card',
      accountId: account.id,
      goalId: null,
      debt: facts,
    });
  }

  for (const goal of ctx.goals) {
    const facts: GoalFacts = {
      goalId: goal.id,
      name: goal.name,
      category: goal.category,
      targetAmount: goal.targetAmount,
      currentAmount: goal.currentAmount,
      deadline: goal.deadline,
      details: goal.details,
    };
    out.push({
      key: `goal:${goal.id}`,
      kind: 'goal',
      title: goal.name,
      subtitle: `${usd(goal.currentAmount)} of ${usd(goal.targetAmount)}`,
      description: 'Something you told us you are saving for. It gets money alongside the rest of your plan.',
      why: '',
      icon: 'target',
      accountId: null,
      goalId: goal.id,
      goal: facts,
    });
  }

  return out;
}

// ── The one call ──────────────────────────────────────────────────────────────

/**
 * Everything about this household, and how every step of the catalog stands
 * against it today.
 *
 * The engine is the model. So the payload's job is not to pre-digest a decision
 * for it, it is to leave nothing out that a decision could turn on. Bands, which
 * v1 uses to keep figures off the wire, are gone: a model asked to SET a target
 * cannot divide a band, and a model asked whether a step is worth someone's
 * attention cannot weigh "over $1m" against a mortgage.
 *
 * `state` is the addition that matters most. Without it the model was writing a
 * reason for a starter fund it could not see was already funded, and it did:
 * "you need to stop the slide" landed on a step reading Done. Every figure here
 * is `sizePath`'s own, so what the model is told about a step is exactly what
 * the card will say about it.
 *
 * What still does not go: names. No account, goal, provider or property name is
 * in here, so nothing comes back carrying one.
 */
export function buildJourneyPayload(
  ctx: PathContext,
  catalog: PathCandidate[],
  readiness: PathReadiness | null,
) {
  // Every catalog step measured against today's balances. The waterfall figures
  // (what a month puts in, when it lands) are deliberately NOT read off this:
  // they depend on an order, and choosing that order is the question being
  // asked. Status, what is there and what it is aiming at do not.
  const state = new Map(sizePath(catalog, ctx).map((s) => [s.key, s]));

  const money = (n: number) => Math.round(n);

  return {
    profile: {
      age: ctx.age,
      dependents: ctx.dependentCount ?? 'not on file',
      filingStatus: ctx.filingStatus,
      state: ctx.stateOfResidence,
      employmentType: ctx.employmentType,
      riskTolerance: ctx.riskTolerance,
      retirementAge: ctx.retirementAgeSet ? ctx.retirementAge : 'not set',
      employerMatchPercent: ctx.employerMatchPct ?? 'no plan on file',
      hasHighDeductibleHealthPlan: ctx.hasHDHP ?? 'not on file',
      pslfEligible: ctx.isPSLFEligible,
    },
    cashFlow: {
      monthlyIncome: money(ctx.monthlyIncome),
      annualIncome: money(ctx.annualIncome),
      monthlySpending:
        ctx.stableMonthlyExpenses !== null ? money(ctx.stableMonthlyExpenses) : 'no history',
      // The number that decides whether ANY of this is fundable. It is stated
      // twice, as a figure and as a fact, because a journey was once built for a
      // household $715 a month short without a single step mentioning it.
      monthlySurplus: ctx.monthlySurplus !== null ? money(ctx.monthlySurplus) : 'no history',
      spendingMoreThanEarning: ctx.monthlySurplus !== null && ctx.monthlySurplus < 0,
      savingsRatePercent: ctx.savingsRate,
      // How long the cash absorbs a shortfall. A deficit on its own says
      // nothing about danger: $715 a month against $568,042 of cash is 794
      // months of cover, and a journey told only the deficit opened with
      // "this is the only step you can actually fund today", which was untrue
      // and frightening. Null when they are not short at all.
      monthsOfCashCoveringTheShortfall:
        ctx.monthlySurplus !== null && ctx.monthlySurplus < 0 && ctx.cashTotal > 0
          ? Math.round(ctx.cashTotal / Math.abs(ctx.monthlySurplus))
          : null,
    },
    balances: {
      cash: money(ctx.cashTotal),
      roth: money(ctx.rothIraBalance),
      workplacePlan: money(ctx.trad401kBalance),
      hsa: money(ctx.hsaBalance),
      taxableBrokerage: money(ctx.taxableBrokerageBalance),
      allInvestments: money(ctx.brokerageBalance),
      property: money(ctx.propertyValue),
      // The three accounts above being zero on a large income is a fact about
      // this household that no single balance states.
      nothingInAnyTaxAdvantagedAccount:
        ctx.rothIraBalance + ctx.trad401kBalance + ctx.hsaBalance === 0,
    },
    // What we take a rate to be worth, so a rate is weighed against a number
    // rather than against a guess. The first run said a 4.875% mortgage cost
    // less than they would earn investing; the second said the same rate beat
    // it. Both were invented, because nothing here told it what a return is.
    howWeReadARate: {
      aboveThisBeatsAnyExpectedReturn: DEBT_URGENT_ABOVE,
      atOrBelowThisLosesToExpectedReturn: DEBT_PATIENT_AT_OR_BELOW,
      note: 'Between the two, clearing the balance and investing are close enough that certainty, cash flow and how long they would carry it decide.',
    },
    // The REAL room, worked out from their plan, their income and their age.
    // Without it the first run invented $54,500 for a household whose only open
    // shelter is an HSA, and sized two separate steps at that figure.
    contributionRoomThisYear: (() => {
      const { rothMax, k401Max, hsaMax, total } = contributionLimits(ctx);
      return { roth: rothMax, workplacePlan: k401Max, hsa: hsaMax, total };
    })(),
    flags: {
      overdrafting: ctx.hasOverdraft,
      inCollections: ctx.debtAccounts.some((a) =>
        (a.subtype || a.name || '').toLowerCase().includes('collection'),
      ),
      hasESPP: ctx.hasESPP,
      hasPension: ctx.hasPension,
      has457b: ctx.has457b,
      has403b: ctx.has403b,
      hasInheritedIRA: ctx.hasInheritedIRA,
    },
    // What the retirement simulation says, when it could be run. Without it a
    // model has no way to tell a household that has already arrived from one
    // twenty years short, and it will write both the same way.
    retirementOutlook: readiness
      ? {
          // The two answers can disagree, and on an early retirement they will:
          // the multiple below assumes a normal-length retirement and the
          // simulation does not. Both are here so the disagreement is visible
          // rather than resolved behind the model's back.
          fourPercentRuleTarget: Math.round(fiTarget(ctx)),
          verdict: readiness.verdict,
          successRatePercent: readiness.successRate,
          targetSuccessPercent: readiness.targetSuccess,
          savingEachMonthNow: money(readiness.currentMonthlySavings),
          savingNeededEachMonth:
            readiness.requiredMonthlySavings !== null
              ? money(readiness.requiredMonthlySavings)
              : 'nothing in reach gets there',
        }
      : 'could not be run',
    steps: catalog.map((c) => {
      const m = state.get(c.key);
      return {
        key: c.key,
        // The catalog title, which now carries this household's own figures, but
        // NEVER the payoff or goal title: those name the account and the goal,
        // and no name leaves here. The scrubber would alias them, and the rule
        // is that nothing to alias is sent in the first place.
        what: c.debt
          ? `Pay off ${usd(c.debt.balance)} on a ${c.debt.debtKind.replace(/_/g, ' ')}`
          : c.goal
          ? 'A goal they set'
          : c.title,
        // A balance is what it is and what it costs, never whose it is.
        detail: c.debt
          ? `${c.debt.debtKind.replace(/_/g, ' ')}, ${usd(c.debt.balance)} owing${
              c.debt.apr != null ? ` at ${c.debt.apr}% APR` : ', no rate on file'
            }, ${usd(c.debt.minimumPayment)} a month minimum`
          : c.goal
          // The category column takes whatever the request body said, with no
          // allowlist, so only the typed ones are named. Anything else is a
          // string this household chose and is not ours to forward.
          ? `${isTypedGoalCategory(c.goal.category) ? c.goal.category.replace(/_/g, ' ') : 'savings'} goal of ${usd(c.goal.targetAmount)}, ${usd(
              c.goal.currentAmount,
            )} saved so far${
              c.goal.deadline ? `, wanted by ${c.goal.deadline.toISOString().slice(0, 7)}` : ''
            }`
          : undefined,
        // How this step stands RIGHT NOW. A step reading complete needs no
        // argument for urgency, and one reading not started cannot be praised.
        //
        // The figure is NAMED rather than called `current`, because the same
        // word means opposite things on the two kinds of step: money put toward
        // a fund, and money still owed on a balance. Called `current` on a
        // payoff step, the model read what was owed as what had been paid, and
        // told a household with $1.3m of mortgages that they had "paid off
        // $1,349,209 so far".
        state: m
          ? (m.target === 0
              ? { status: m.status, stillOwed: m.current, aimingFor: 'nothing owed' }
              : {
                  status: m.status,
                  alreadyPutToward: m.current,
                  targetIfYouSetNone: m.target,
                  percentDone: m.progress,
                })
          : undefined,
        targetMeans: CATALOG[c.key]?.targetMeans || undefined,
      };
    }),
  };
}

export const SYSTEM_PROMPT = `You build one person's financial journey: which steps belong in it, in what order, and what each one is aiming at.

You are given everything we know about their money and a list of steps that could apply. You decide the whole sequence. There is no ordering underneath yours and nothing reorders you afterwards.

## The shape of a journey

Work through four phases in this order. They are a guide to priority, not a rule to apply mechanically, and how a household's steps divide between them is your judgement.

1. GET OUT OF DANGER. Anything where standing still makes things worse and the household cannot absorb it: no cash buffer at all, overdrafting, an account in collections, or spending more than they earn with nothing set aside to cover the difference.
   Judge a shortfall against the reserves, never on its own. You are told how many months of it their cash covers. A few months of cover is danger and belongs here. Years of cover is not danger, it is a drawdown, and it belongs in the BUILD phase said calmly, without telling them their journey is blocked or that nothing else can be funded. Never call a household with years of cover unable to fund its own plan.
2. PAY OFF HIGH RATE DEBT. Balances whose rate beats any return they could reasonably expect. Clearing one is a guaranteed return at that rate.
3. BUILD. This is the bulk of most journeys and the part that varies most between people. Investing, the rest of the debt, their goals and the protective steps all belong here, interleaved rather than grouped. Weigh them against each other:
   - A goal with a near deadline outranks one with a distant one, and can outrank investing.
   - Money invested earlier compounds longer, so a step that starts growth early is worth more than the same step later. Set that against a debt rate: clearing a rate above what they would expect to earn wins, below it loses.
   - Protection is not optional and not last. Cover replaces income for people who rely on it, and a will directs what someone has built whoever is in their life. Place them by what this household would actually lose, not by habit.
   - Tax-advantaged room expires at the end of the year and does not carry over, so an unused year is gone for good.
4. FREEDOM. What is left once the work above is done: independence, low rate debt they may simply carry, and optimizations.

## What to write

For each step you include:
- "why": one sentence, second person, on why THIS step matters to THIS person. It must agree with the step's own state, which you were given. For a step reading complete, say what they have already done and what it means for them, in the past tense. Never argue that a finished step is urgent, and never congratulate somebody on a step they have not started.
- "targetAmountUsd": the dollar amount the step is aiming at, as a bare number such as 28000. Never write a sentence or an instruction in this field. The list says what a target means for each step, and gives the one we would compute if you set none. Set null only where no dollar amount applies, such as insurance or a will.

You may add steps of your own where their situation calls for something the list does not cover. Give a short lowercase slug as the key, plus a title, a one-line subtitle, a two or three sentence description, and a why. Add one only when it earns its place.

## Rules

- The starter emergency fund is ALWAYS step one. Not usually, not when it is unfinished: always, for every household, whatever state it is in. It is the foundation the rest of the journey stands on, and somebody who has it already should open their journey seeing it ticked. Nothing you write, and nothing about their situation, moves it off the first position.
- Two more steps ALWAYS appear in the journey, whatever state they are in: the full emergency fund, and becoming debt free.
- Appearing always does not mean appearing twice. Where a goal they set aims at the same thing as one of these steps, such as an emergency fund goal beside the emergency fund step, that is one milestone said two ways: keep the step, leave the goal out saying it is the same reserve, and never show the same money as two separate steps. They are the two milestones every household is walking toward, and seeing one already behind them is worth as much as being told to do it. Never put either in leftOut.
- A finished step is not automatically left out, and the test is what the step NAMES. A step naming a standing condition, such as holding a fund or owing nothing, stays in the journey when it is met, ticked, with a why in the past tense saying what they have done. A step naming a one-off act they have already carried out, such as opening an account they hold or capturing a match they take, is left out saying it is done. Never leave a met condition out merely because it is met, and never leave a done act in as though it were still to do.
- Becoming debt free is a milestone across every balance, and the payoff steps are the work that gets there. Those are not the same step, so both belong, and the milestone sits after the balances it is counting.
- Never place two steps that are aiming at the same pot of money, and never size two steps from the same allowance. A retirement goal and reaching independence are the same thing said twice. So are funding a tax-advantaged account and filling the contribution room, which draw on ONE yearly allowance and must never both be given it. Keep whichever fits them better and leave the other out saying so.
- On that pair, EXACTLY ONE of the retirement goal and reaching independence is in the journey. Never both, and never neither. Leaving both out takes retirement off a journey entirely, and for somebody the simulation calls at risk that is the one thing their journey exists to say.
- If your reason for a step is that they may simply carry it, that it is cheap, or that it is not worth doing, that step belongs in leftOut and NOT at the end of the journey. Putting it last does not resolve this: every step in the sequence is one you are telling them to work on, so a reason arguing against a step contradicts the step it is attached to wherever you place it. Move it out and give that same sentence as the reason it is not there.
- Where the simulation and the multiple disagree about retirement, the simulation is the answer. The multiple assumes a retirement of normal length; the simulation knows how long theirs is, and for somebody stopping early it is the only one of the two that does. A household the multiple calls finished and the simulation calls at risk is at risk, and their journey has to say so.
- Order balances by rate, the one charging most first, every time. Two balances a rate apart are the same job done in a different order, and the more expensive one first is the one that costs them less.
- A journey must be fundable, and you know what they have spare each month. If that figure is negative, say so on the first step and put the work that fixes it above everything else. Never hand somebody a sequence they have no money to start.
- Every step you were given goes in "steps" or "leftOut", never both and never neither.
- A leftOut line is the only thing they will ever read about that step, so say what about their situation puts it aside: "There is no income to replace yet." Never say they chose to skip it, because they have not been asked.
- Having no account of a kind is not the same as having no room in one. Somebody with no workplace plan and no Roth has all of that room still open, which is a reason to include a step and never a reason to leave one out.
- Never name an account, a bank, a provider, a card or a goal. You were given none of those names. Describe a balance by what it is: the card, the balance charging the most, the loan.
- Quote only figures you were given, or arithmetic on them. Never invent one.
- Do NOT restate a balance, a target or a progress figure that the card already shows beside your sentence. Those are recomputed from the accounts every time the page is read and your sentence is not, so the two drift apart and the card ends up showing two different numbers for the same money. Name what the figure MEANS and let the card carry the figure: "you are three quarters of the way there", not "you have $5,958,753 of the $8,000,000". Figures the card does not show, such as a rate, a monthly payment or a count of people, are yours to quote.
- If you add several figures together, the sum must cover everything your sentence claims it covers. A sentence saying every balance disappears, next to a total of only some of them, is worse than giving no total at all. When in doubt, describe rather than total.
- Income does not end because a retirement age is set. Somebody aged 34 planning to stop at 36 is earning today and for two more years, and a step that protects income is about the years they are still earning. Never argue a protective step away on the grounds that pay stops later.
- Treat every balance in the same rate band the same way. If you carry one because its rate is below what investing earns, you carry all of them, and if you clear one you explain why that reason does not apply to the others. Giving two balances in the same band opposite advice reads as a mistake, because it is one.
- When the simulation says no reachable saving rate gets them there, say so, and name what would change it: retiring later, or spending less in retirement. Telling somebody to keep going is not an answer to being told that going is not enough.
- A step that spends more than their cash has to say where the money comes from. Selling investments to fund a step has a tax cost, and a plan that quietly assumes the sale never mentions the bill.

## How to write

Everything you write is read by somebody who has never been taught any of this. Write so a thirteen year old understands it on the first read, and so an adult does not feel talked down to.

- Short sentences. One idea in each. Start an instruction with the verb: "Pay off", "Save", "Buy", "Cut".
- Use the proper name for a thing. Emergency fund, employer match, term life insurance, will and trust, contribution room, brokerage account. These are what they are called, a reader can look any of them up, and inventing a plainer phrase for one only makes it harder to recognise. Explain the term in the sentence after it, never instead of it.
- Do not pad a sentence to sound approachable. "Put in place a will and trust" is clear. "Write a will that says who gets what" explains a will to somebody who did not ask, and reads as talking down.
- A step you invent is named with its figure at the END: "Pay off Primary Mortgage of $770,000", not "Pay off $770,000 on Primary Mortgage". If the step has no figure, name the thing plainly.
- Use the plain word. Money you owe, not "liabilities". What you spend, not "expenditure". Pay, not "income stream". Savings that cut your taxes, not "tax-advantaged vehicles".
- Where a term is unavoidable because it is what the thing is called, say what it is in the same breath: "a Roth IRA, an account that grows without tax".
- No idioms and no figures of speech. Not "max out", "free up", "put away", "take out a policy", "capture the match", "on track". Say the literal action: use all of it, spend less, save, buy insurance, get the match.
- No hedging. Not "you may want to consider". Say what to do.
- Active voice. "Pay this card off", never "this card should be paid off".
- Numbers stay exact. Writing simply never means rounding a figure or dropping one.
- Do not use em dashes, en dashes, middots or semicolons. Write plain sentences.
- Answer with the raw JSON object and nothing else. No markdown fence, no commentary before or after it.`;

// `target` was the field's name, and beside a `targetMeans` written in words the
// frontier model read it as a place for an instruction: it answered
// "Pay the full $4,635 from cash", the schema rejected the string, and the whole
// journey was lost over one field. The name now says what it holds, the
// description says it again, and the type below accepts what a model is likely
// to send instead of failing the entire answer over it.
const targetAmount = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .describe(
    'A NUMBER of dollars and nothing else, for example 28000. Never a sentence, never a currency symbol. Use null where no dollar amount applies.',
  );

const stepSchema = z.object({
  key: z.string().max(120),
  why: z.string().max(600).optional(),
  reason: z.string().max(600).optional(),
  targetAmountUsd: targetAmount,
  // Only read for a step the model added itself.
  title: z.string().max(200).optional(),
  subtitle: z.string().max(200).optional(),
  description: z.string().max(800).optional(),
});

/**
 * A target as a number, whatever shape it arrived in.
 *
 * "$28,000" and "28000" are both the figure it meant. A sentence is not, and
 * comes back null: the step keeps its place and the server's own sizing takes
 * over, which is a step missing one figure rather than a household missing a
 * journey.
 */
export function readTargetAmount(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

// `why` on both lists is what the prompt asks for. `reason` is accepted beside
// it because the frontier model answers with that key for the left-out list, and
// losing a whole journey over a synonym is not a trade worth making.
const eitherWording = z.object({
  key: z.string(),
  why: z.string().optional(),
  reason: z.string().optional(),
});

// Bounded so one answer cannot persist hundreds of invented steps into the
// jsonb row, to be re-sized and re-served on every page load afterwards.
export const journeySchema = z.object({
  steps: z.array(stepSchema).max(40),
  leftOut: z.array(eitherWording).max(40).optional(),
});

/** The sentence, whichever key it arrived under. */
function saidWhy(entry: { why?: string; reason?: string }): string {
  return (entry.why ?? entry.reason ?? '').trim();
}

/**
 * The model's answer, dug out of whatever it wrapped it in.
 *
 * `generateObject` hands the response straight to the schema, and the frontier
 * model returns valid JSON inside a markdown fence. That is not a malformed
 * answer, it is a well formed one in a wrapper, and failing the whole journey
 * over the wrapper cost a full generation every time. Prose either side of the
 * object is stripped on the same principle.
 */
export function parseJourneyJson(text: string): unknown | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface JourneyAnswer {
  steps: Array<z.infer<typeof stepSchema>>;
  leftOut: Array<{ key: string; why: string }>;
}

/** Ask for the whole journey. Null on any failure, which the caller reads as "no v2 journey". */
export async function proposeJourney(
  tenantId: string,
  ctx: PathContext,
  catalog: PathCandidate[],
  readiness: PathReadiness | null,
): Promise<{ answer: JourneyAnswer; model: string } | null> {
  let result;
  try {
    result = await llmGenerateText(
      // An EMPTY alias map, deliberately, and it is the payload's name-free
      // construction that earns it. The scrubber strips account masks by whole
      // word from the raw string, and this payload is JSON full of bare
      // integers: a household whose card ends 1000 has `"targetIfYouSetNone":1000`
      // rewritten to `"targetIfYouSetNone":,` and the model is handed malformed
      // JSON. The starter buffer target IS 1000, so that collision is certain
      // rather than unlucky, and any four digit mask can collide with any
      // figure. v1 never met this because it sends bands, not numbers.
      //
      // Safe only because `buildJourneyPayload` sends no name of any kind, which
      // the "describes a balance by what it is and never by the name on it" test
      // holds it to. Nothing comes back carrying a name either, so there is
      // nothing to restore.
      { tenantId, source: 'financial-journey-v2', aliasMap: { forward: new Map(), reverse: new Map() }, descrubOutput: false },
      {
        model: getModel(LEVEL),
        system: SYSTEM_PROMPT,
        prompt: JSON.stringify(buildJourneyPayload(ctx, catalog, readiness)),
        temperature: 0,
        // A whole journey is a long answer: every step carries a sentence and
        // every step left out carries another, and this runs on the frontier
        // model, which writes more of both. At 6000 the JSON was cut mid-object
        // and the parse failed, which reads as "no journey" and costs the call
        // anyway. There is no charge for headroom that goes unused.
        maxOutputTokens: 16000,
      },
    );
  } catch (e) {
    console.error('[journey-v2] generation failed:', e instanceof Error ? e.message : e);
    return null;
  }

  const raw = parseJourneyJson(result.text);
  if (raw === null) {
    console.error('[journey-v2] answer was not JSON we could read');
    return null;
  }
  const parsed = journeySchema.safeParse(raw);
  if (!parsed.success) {
    console.error('[journey-v2] answer did not match the schema:', parsed.error.issues[0]?.message);
    return null;
  }
  if (!parsed.data.steps.length) return null;

  return {
    answer: {
      steps: parsed.data.steps.map((s) => ({ ...s, why: saidWhy(s) })),
      leftOut: (parsed.data.leftOut ?? []).map((o) => ({ key: o.key, why: saidWhy(o) })),
    },
    model: getModelSlug(LEVEL),
  };
}

// ── Turning the answer into steps the page can render ─────────────────────────

/** A step the model wrote from scratch, kept whole because nothing can rebuild it. */
const CUSTOM_ICON = 'layers';

/**
 * The model's answer as candidates, ready for `sizePath`.
 *
 * A catalog step is rebuilt from the catalog and from THIS READ's balances, so
 * a payoff step shows what is owing today rather than what was owing when the
 * journey was generated. Only `why` and `targetOverride` come from the answer.
 *
 * A step the model invented has no catalog entry and no facts, so its words are
 * taken as they were written. It is the one place in either engine where copy
 * on the page came from a model, which is what "free-form" costs.
 */
export function journeyCandidates(
  answer: JourneyAnswer,
  catalog: PathCandidate[],
): { steps: PathCandidate[]; leftOut: Array<{ candidate: PathCandidate; reason: string }> } {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const taken = new Set<string>();
  const steps: PathCandidate[] = [];

  for (const proposed of answer.steps) {
    const key = (proposed.key ?? '').trim();
    if (!key || taken.has(key)) continue;

    const known = byKey.get(key);
    if (known) {
      taken.add(key);
      steps.push({
        ...known,
        why: proposed.why?.trim() || known.why,
        targetOverride: readTargetAmount(proposed.targetAmountUsd),
      });
      continue;
    }

    // A key that is not in the catalog is a step the model added. It needs a
    // title to be one at all: without it there is nothing to render, and a card
    // reading only a slug is worse than no card.
    const title = proposed.title?.trim();
    if (!title) continue;
    const slug = key.startsWith('custom:') ? key : `custom:${key}`;
    if (taken.has(slug)) continue;
    taken.add(slug);
    steps.push({
      key: slug,
      kind: 'custom',
      title,
      subtitle: proposed.subtitle?.trim() ?? '',
      description: proposed.description?.trim() ?? '',
      why: proposed.why?.trim() ?? '',
      icon: CUSTOM_ICON,
      accountId: null,
      goalId: null,
      targetOverride: readTargetAmount(proposed.targetAmountUsd),
    });
  }

  // The debt-free milestone counts only the payoff steps that made it onto the
  // journey, so it can never draw a finish line through a balance the plan left
  // off. Set after the sequence is decided, because that is when it is known.
  const debtScope = steps.filter((c) => c.kind === 'debt' && c.accountId).map((c) => c.accountId!);
  for (const c of steps) if (c.kind === 'debt-free') c.debtScopeIds = debtScope;

  const leftOut: Array<{ candidate: PathCandidate; reason: string }> = [];
  for (const dropped of answer.leftOut) {
    const known = byKey.get((dropped.key ?? '').trim());
    if (!known || taken.has(known.key)) continue;
    taken.add(known.key);
    leftOut.push({ candidate: known, reason: dropped.why?.trim() ?? '' });
  }
  // A catalog step the answer mentioned in neither list is left out with
  // nothing said, rather than silently reappearing in the sequence.
  for (const candidate of catalog) {
    if (!taken.has(candidate.key)) leftOut.push({ candidate, reason: '' });
  }

  return { steps, leftOut };
}
