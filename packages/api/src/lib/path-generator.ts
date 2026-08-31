import { createHash } from 'node:crypto';
import {
  accounts,
  and,
  asc,
  eq,
  financialPathSteps,
  financialPaths,
  financialProfiles,
  goals,
  inArray,
  isTypedGoalCategory,
  sql,
} from '@lasagna/core';
import { z } from 'zod';
import { getModel, getModelSlug } from '../agent/index.js';
import { logLlmUsage } from './activity.js';
import { db } from './db.js';
import { CONTRIBUTION_TAX_YEAR, isUrgentDebt, transferableAssets, type PathCandidate } from './path-candidates.js';
import type { PathContext } from './path-context.js';
import type { PathReadiness } from '../services/retirement-readiness.js';
import { sizePath, type SizedStep } from './path-sizing.js';
import { buildAliasMap, type AliasMap } from './pii-scrubber.js';
import { llmGenerateObject } from './llm.js';

/**
 * Who does what, in what order, and once.
 *
 * `buildPathCandidates` emits the steps that COULD apply to one household and
 * prunes the rest, on facts alone: no debt accounts, no debt steps. Which of
 * those belong in this person's plan, and in what order, is a model's call over
 * that validated set. It may leave a candidate out.
 *
 * Letting it leave one out is what a threshold cannot do. Whether a taxable
 * brokerage belongs above a patient balance, or an independence step belongs in
 * a sequence at all, is not a number anybody can hand-set: too high and a
 * household that plainly qualifies never sees the step, too low and it lands in
 * front of people with nothing. So the judgement is made against the whole
 * situation instead: the banded assets, whether a home is owned, and the
 * retirement verdict the simulation already produced for this read.
 *
 * Five things keep that safe:
 *
 *  1. DEBT IS NOT ITS CALL AT ALL. Balances hold the positions their own APR
 *     bands give them, they are not in the payload, and the model orders
 *     everything else AROUND them. So a balance cannot be left out, cannot be
 *     misplaced, and carries no line the model wrote. `modelOrders` is where
 *     that is decided and why.
 *  2. NOTHING ELSE VANISHES EITHER. A candidate left out is stored with the
 *     model's own line on why, listed off the path, and put back in one click.
 *     Every goal somebody set is on the page one way or the other.
 *  3. A step the person PUT BACK is theirs. The next generation cannot leave it
 *     out again, exactly as it cannot overrule a step they called not
 *     applicable. Once somebody says they want a step, they have it.
 *  4. The chosen order is PERSISTED. Asking a model twice must never reshuffle
 *     a plan somebody is standing in the middle of, so the path is generated
 *     once and read back after that.
 *  5. The model never decides a NUMBER, and never names a thing. It returns
 *     candidate keys it was given and, per step, one clause on where that step
 *     sits or why it is not there. Every target, balance, monthly figure and
 *     date is computed by `sizePath` AFTER the order is fixed, and every title
 *     comes from the household, so nothing it wrote is ever a name or a figure.
 *
 * Generation also RESERVES before it spends: a tenant is locked before the
 * model is asked, so simultaneous first-reads produce one call between them
 * rather than one each.
 */

const ORDER_LEVEL = 'medium' as const;

/**
 * What a generation was for.
 *
 * These are the ONLY causes. A path that reshuffled on anything else would be
 * a plan that moves under the person walking it, and one that never reshuffled
 * would be a plan that ignores the household it was built for. Three of these
 * are a deliberate act by the user, three are read off the household, and the
 * last is the first path a tenant ever gets.
 */
export type PathGenerationReason =
  | 'no_active_path'
  | 'goal_added'
  | 'goal_updated'
  | 'goal_removed'
  | 'step_completed'
  | 'debt_added'
  | 'debt_cleared'
  | 'inputs_changed';

const GENERATION_REASONS: readonly PathGenerationReason[] = [
  'no_active_path',
  'goal_added',
  'goal_updated',
  'goal_removed',
  'step_completed',
  'debt_added',
  'debt_cleared',
  'inputs_changed',
];

export function isGenerationReason(value: string | null): value is PathGenerationReason {
  return value !== null && (GENERATION_REASONS as readonly string[]).includes(value);
}

/**
 * Where one step of a stored path stands.
 *
 * The first three are the person's own word. `left_out` is the model's: a step
 * that applies to this household but that it judged does not belong in their
 * sequence. It is not a mark they can make, and any mark they DO make on that
 * key replaces it, which is how putting a step back overrules the model.
 */
export type PathStepMark = 'pending' | 'done' | 'not_applicable' | 'left_out';

export type PathOrderSource = 'model' | 'deterministic';

// ── What the model is allowed to see ─────────────────────────────────────────
//
// Keys, kinds, a generic label, a relative size, and the situation facts an
// ordering decision turns on. Every figure is banded before it leaves: the
// payload carries an income band, a surplus band and a t-shirt size per step,
// never a balance, a salary, a surplus, a rate or the name on an account. A
// goal's date changes the order. The exact dollars do not.
//
// DEBT IS NOT IN IT AT ALL. See `modelOrders` below.

const KIND_LABELS: Record<string, string> = {
  buffer: 'Starter emergency fund',
  match: 'Employer retirement match',
  'emergency-fund': 'Full emergency fund',
  'term-life': 'Term life cover',
  'will-trust': 'Will, beneficiaries, and a trust',
  'savings-rate': 'What goes away each month',
  'tax-advantaged': 'Tax-advantaged account',
  'contribution-limits': 'Annual contribution room',
  brokerage: 'Taxable brokerage investing',
  independence: 'Financial independence',
};

/**
 * Whether this candidate's POSITION is the model's to choose.
 *
 * Debt is not, and is taken back out of the model's hands deliberately.
 *
 * Payoff order is a solved problem: highest rate first, which is what
 * `buildPathCandidates` already computes from each account's own APR. The model
 * was never in a position to do it as well, because it was never given a rate
 * to do it with. The payload carries a t-shirt `size` against a month of income
 * and nothing else, and the prompt then forbids reasoning about rates at all,
 * so a model asked to sequence five balances was choosing between them on how
 * big they are. It duly ordered by balance, and wrote lines about "terms" and
 * "attention" to justify an order it had no basis for.
 *
 * The hardcoded copy on a debt step already asserts a position in so many
 * words: above 15% it says money here beats money invested, between 8 and 15 it
 * says this year's tax-advantaged space expires and the balance does not, below
 * that it says investing usually wins. Those three sentences were being printed
 * next to a sequence chosen without reference to any of them. Fixing the
 * positions to the bands the copy describes is what makes the copy true again.
 *
 * The model still orders everything else, and it orders it AROUND these
 * positions rather than after them. A debt cannot be left off the path either,
 * which is a guarantee the previous arrangement could only ever promise.
 */
function modelOrders(candidate: PathCandidate): boolean {
  return candidate.kind !== 'debt';
}

/** A name for the step that carries no account name and no balance. */
function candidateLabel(candidate: PathCandidate): string {
  if (candidate.kind === 'goal') {
    const category = candidate.goal!.category;
    // The category is free text on the goal, so only the typed set is quoted.
    return isTypedGoalCategory(category)
      ? `${category.replace(/_/g, ' ')} goal`
      : 'Savings goal';
  }
  return KIND_LABELS[candidate.kind] ?? candidate.kind;
}

/**
 * The keys a path can carry that name no account and no goal, and what each one
 * is, in words.
 *
 * Separate from `KIND_LABELS` above because it answers a different question. A
 * `PathCandidate` is not always to hand: a stored path is a list of KEYS, and
 * naming those needs the household rebuilt. `buildPathCandidates` writes the
 * title a person reads, which carries this household's own figures ("Save 6
 * months of expenses"); these are the same steps said without one, for a
 * payload that is not allowed to carry a figure.
 */
const KEY_LABELS: Record<string, string> = {
  stabilize: 'Save a starter emergency fund',
  'employer-match': 'Capture your full employer match',
  'emergency-fund': 'Save a full emergency fund',
  'term-life': 'Take out term life insurance',
  'will-trust': 'Put your will and trust in place',
  'savings-rate': 'Raise what you put away each month',
  'tax-advantaged': 'Fund a tax-advantaged account',
  'max-contributions': `Max out your ${CONTRIBUTION_TAX_YEAR} contribution room`,
  'taxable-brokerage': 'Open a taxable brokerage account',
  'financial-independence': 'Reach financial independence',
};

/**
 * Whether a stored key still names a step this product builds.
 *
 * A step key is retired when the step it named is gone: `insurance-will` split
 * into term life and a will, `estate-legacy` folded into the will, and
 * `retirement-readiness` merged into the amount step. Rows against those keys
 * are still in the table, and they will be until each tenant's path is next
 * generated, because a mark on a retired key expires with the step rather than
 * being migrated onto a step it may not have meant.
 *
 * `storedPath` already drops them, because they match no candidate. Anything
 * else reading the stored rows has to drop them too, or it names a step by its
 * key: the actions engine put a step titled `"insurance-will"` in front of the
 * insights model, in a list of steps otherwise written in English.
 */
export function isLiveStepKey(key: string): boolean {
  return key.startsWith('debt:') || key.startsWith('goal:') || key in KEY_LABELS;
}

/**
 * What one step of a stored path is, from its key alone.
 *
 * `names` supplies the account or goal a `debt:`/`goal:` key points at. A key
 * whose row is gone falls back to the generic wording rather than dropping the
 * step, because the caller is naming a step that is still on the path.
 *
 * Callers filter with `isLiveStepKey` first: a retired key has no name to give,
 * and the raw key is not one.
 */
export function stepLabelForKey(key: string, names: ReadonlyMap<string, string>): string {
  if (key.startsWith('debt:')) return `Pay off ${names.get(key.slice(5)) ?? 'a balance you owe'}`;
  if (key.startsWith('goal:')) return names.get(key.slice(5)) ?? 'A savings goal';
  return KEY_LABELS[key] ?? key;
}

/** How big the step is against a month of income. Never the amount itself. */
function candidateSize(candidate: PathCandidate, ctx: PathContext): string | undefined {
  if (ctx.monthlyIncome <= 0) return undefined;
  const amount =
    candidate.kind === 'goal'
      ? Math.max(candidate.goal!.targetAmount - candidate.goal!.currentAmount, 0)
      : null;
  if (amount === null || amount <= 0) return undefined;
  const months = amount / ctx.monthlyIncome;
  if (months < 1) return 'small';
  if (months < 6) return 'medium';
  if (months < 24) return 'large';
  return 'very large';
}

/** The income band, so no exact salary leaves the boundary. */
function incomeBand(annualIncome: number): string {
  if (annualIncome <= 0) return 'not on file';
  const step = annualIncome < 100_000 ? 25_000 : 50_000;
  const floor = Math.floor(annualIncome / step) * step;
  return `$${floor / 1000}k to $${(floor + step) / 1000}k`;
}

/**
 * How much room there is each month, banded.
 *
 * Ordering turns on whether there is room to spare, not on how much: nothing in
 * the sequence changes between $1,240 and $1,310 left over. The exact figure was
 * a raw balance in all but name, so it is banded like income is.
 */
function surplusBand(monthlySurplus: number | null): string {
  if (monthlySurplus === null) return 'not on file';
  if (monthlySurplus <= 0) return 'nothing left over';
  if (monthlySurplus < 500) return 'under $500 a month';
  if (monthlySurplus < 1_500) return '$500 to $1.5k a month';
  if (monthlySurplus < 4_000) return '$1.5k to $4k a month';
  return 'over $4k a month';
}

/**
 * What this household would leave behind, banded.
 *
 * The steps that only compound turn on whether anything has been built, which
 * the payload could not say at all before: it carried an income and a surplus,
 * and nothing about what is already there. The band is the whole of what
 * a judgement of that kind needs. Nothing changes between $412,000 and
 * $418,000, and the exact figure would be a balance leaving the boundary.
 */
function assetsBand(ctx: PathContext): string {
  const total = transferableAssets(ctx);
  if (total <= 0) return 'nothing on file';
  if (total < 25_000) return 'under $25k';
  if (total < 100_000) return '$25k to $100k';
  if (total < 250_000) return '$100k to $250k';
  if (total < 1_000_000) return '$250k to $1m';
  return 'over $1m';
}

/**
 * The order the candidates are LISTED IN to the model: ascending by key, which
 * is to say no order at all.
 *
 * They used to be listed in the order they were emitted, which is the order of
 * the tiers they carry, which is a worked-out sequence. The model was free to
 * reorder them and the tier decides nothing any more, but a list handed over
 * already in a defensible order is a suggestion, and the last-tier step sat
 * last in it every single time. Sorting on the key breaks that: it is arbitrary with
 * respect to what any step is FOR, so the sequence that comes back is the
 * model's own rather than a nudge it declined to fight.
 *
 * It has to be STABLE, not merely tier-free. This payload is what the
 * fingerprint digests, and the fingerprint is compared on every read to decide
 * whether to regenerate, so an order that varied per call would move the
 * fingerprint on every read and rebuild the path forever. Sorting on the key is
 * a pure function of the candidate set: same household, same bytes.
 *
 * Compared by code point rather than `localeCompare`, whose result depends on
 * the runtime's default locale. The digest is stored and read back by whichever
 * process serves the next request, so it can hold no opinion about where it ran.
 *
 * The DETERMINISTIC order is untouched. `buildPathCandidates` still returns
 * tier order, and that is what `validateOrder` falls back to when the call fails
 * or is skipped, because a path nobody chose still needs a worked-out one.
 */
function listedNeutrally(candidates: PathCandidate[]): PathCandidate[] {
  return [...candidates].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The candidates whose order this call is being asked for: everything except
 * debt, whose position is fixed. See `modelOrders`.
 */
export function orderableCandidates(candidates: PathCandidate[]): PathCandidate[] {
  return candidates.filter(modelOrders);
}

export function buildOrderPayload(
  candidates: PathCandidate[],
  ctx: PathContext,
  /**
   * What the retirement simulation said, or null when it could not be run.
   *
   * Passed in rather than computed. `buildPathReadiness` has already run for
   * this read, and a Monte Carlo is thousands of times the cost of everything
   * else here, so the verdict is reused and no second simulation is paid for.
   */
  readiness: PathReadiness | null,
) {
  return {
    situation: {
      age: ctx.age,
      incomeBand: incomeBand(ctx.annualIncome),
      surplusBand: surplusBand(ctx.monthlySurplus),
      employmentType: ctx.employmentType,
      // "not on file" rather than null, the same way the income band and the
      // retirement outlook say it. A bare null was read as the answer zero: the
      // model left the cover step out of a path saying "you have no dependents
      // relying on your income", which is a fact about this household that
      // nobody has ever told us.
      dependents: ctx.dependentCount ?? 'not on file',
      // What they have built, and whether any of it is a house. Both matter to
      // whether a step belongs at all, and neither is a figure.
      transferableAssets: assetsBand(ctx),
      ownsProperty: ctx.propertyValue > 0,
      // Where they are HEADING, which nothing in the payload said before. A
      // household on track and one at risk can hold the same accounts and want
      // different steps, and this is the only line that can tell them apart.
      retirementOutlook: readiness?.verdict ?? 'not on file',
    },
    // Debt is filtered out here rather than by the caller so that NOTHING in
    // what leaves this boundary can imply a balance is movable: no debt key, no
    // debt label, no debt size, and so nothing for the model to place, mention
    // or leave out.
    candidates: listedNeutrally(orderableCandidates(candidates)).map((candidate) => ({
      key: candidate.key,
      kind: candidate.kind,
      label: candidateLabel(candidate),
      size: candidateSize(candidate, ctx),
      targetDate:
        candidate.kind === 'goal' && candidate.goal!.deadline
          ? candidate.goal!.deadline.toISOString().slice(0, 7)
          : undefined,
    })),
  };
}

// The line asked for here is deliberately narrow. The card already carries two
// explanations of the step: `why`, which is this person's own reason in their
// own figures, and `description`, which is the general argument for it. A third
// paragraph saying much the same thing is the model paid to repeat the product.
// What nothing else on the page can say is where the step sits RELATIVE to the
// others, because that is the one part of the path a model chose. So the prompt
// asks for a placement clause and rules out everything the card already says.
//
// A line for a step it LEFT OUT is the opposite case and the rules say so: that
// step has no card, so its line is the only thing anyone will ever read about
// it, and it has to carry its own reason rather than point at a position.
//
// Refusing to let it name an account is not only style. The reason is stored and
// rendered verbatim, and an account name it wrote would be one it invented.
const SYSTEM_PROMPT = `You build one person's financial path: which steps belong in it, and in what order.

You are given the steps that COULD apply to this person and the facts about their situation. Some of them will not be worth their attention now. Put the ones that are into the sequence they should work through, and for each one write the one clause that says why it sits WHERE YOU PUT IT relative to the other steps. Put the rest under leftOut, each with the one sentence that says why it is not on their path.

Nothing is lost by leaving a step out. Every key under leftOut is shown to the person below their path with the line you wrote for it, and one click puts it back. So leave out what does not belong, and say plainly why.

Rules:
- Every key you were given belongs in exactly one of the two lists. Never invent a key and never repeat one.
- Decide inclusion against THIS person's situation, not against a rule. What they have built, whether they own their home, how many people depend on them and whether their retirement is on track all bear on whether a step is worth their attention now. A step is in the sequence because it earns a place there, not because it was offered.
- Term life and the will are separate steps and are judged separately. Term life replaces income for people who rely on it, so a count of dependents is a fair reason to set THAT one aside. The will is not: it directs whatever someone has built, whoever is or is not in their life, and where there is no will the state decides instead. Never leave the will out on a count of dependents.
- A leftOut line is the ONLY thing the person will read about that step, so it has to stand on its own: one sentence, second person, saying what about their situation puts it aside. Never say a step is not applicable without saying what makes it so.
- A leftOut line says what THE PLAN judged, never what the person decided. They did not choose this and have not been asked, so never write that they set it aside, leave it out, skip it, or are holding off. Say what about their situation puts it below their attention: "There is no income to replace yet and nothing built to direct."
- Order for THIS person. A goal with a near target date can rightly come before a protective step, and for someone else the protective steps come first. There is no fixed rail.
- A sequence line is about POSITION and nothing else. Say what this step comes before or after, and why that order is right for this person.
- Say where a step sits RELATIVE to other steps, never where it sits absolutely. Your list is not the whole path: their balances hold fixed places in it that you cannot see, and they can be anywhere, including below everything you were given. So never write that a step comes first or last, is the first or final one, closes the path, or comes after everything else.
- Never describe the step, what it is for, what it involves or what it is worth. The page already says all of that next to your line, so repeating it wastes the reader's time.
- One sentence, written to the person in the second person, opening on the position rather than on the step: "This comes before...", "This waits until...", "Nothing here moves until...", "You can turn to this once...", "Once the steps above are in hand...".
- Vary how you open, and never write the same sentence for two steps. A reader goes down these one after another, and a page where two lines are word for word identical reads as a form letter rather than a decision.
- Never name an account, a provider, a product or a goal. Point at the other steps by what they are for: the goal you put a date on, the steps that protect you, the work above this one.
- Never state an amount, a balance, a date or a percentage. You were not given those and any you write would be invented.
- The person also has balances they owe, and those are NOT in your list. Their places in the sequence are already fixed and you cannot see them, so never place a step relative to a balance, a loan, a card or a mortgage, and never say a balance is cleared, outstanding or first.
- You are given no rate, no terms and no cost. Never call anything high interest or low interest, cheap or expensive, never say what terms something carries, and never say what carrying it costs.
- Never justify a position by restating it. "This is second because you do it second" tells the reader nothing they cannot see from the number on the card.
- The path is worked in order, one step at a time. Never say a step runs alongside, in parallel with, or at the same time as another. The card next to your line carries the step's number, so a line hedging the order contradicts it.
- Do not use em dashes, en dashes, middots or semicolons. Write plain sentences.`;

const proposedStepSchema = z.object({ key: z.string(), reason: z.string() });

const orderSchema = z.object({
  steps: z.array(proposedStepSchema),
  leftOut: z.array(proposedStepSchema),
});

/** One step as the model returned it, before validation. */
export interface ProposedStep {
  key: string;
  reason: string;
}

/** A whole answer: the sequence it chose, and what it set aside. */
export interface ProposedOrder {
  steps: ProposedStep[];
  /** Keys it judged do not belong, each with the line saying why. */
  leftOut: ProposedStep[];
}

/**
 * The two steps every household gets, whatever we know about them. They have no
 * precondition, they are emitted in one fixed order, and neither is a judgement
 * call: everybody needs a first buffer and then a full one.
 *
 * Cover and the will are NOT in here. Term life turns on somebody depending on
 * this income and the will on there being something to direct, so a household
 * that gets either has something to decide and is worth asking about.
 */
const UNIVERSAL_KEYS = new Set(['stabilize', 'emergency-fund']);

/**
 * Whether this candidate set is worth paying to decide.
 *
 * A brand new account emits exactly the three steps above, in one order, with
 * nothing to leave out. A model asked about that hands back what it was given
 * and sends a bill for it.
 *
 * Anything MORE than those four is a question. It is not only about the things
 * a person owns any more: a household with no debt and no goals but a portfolio
 * behind them has a brokerage step and an independence step whose place in
 * their plan is exactly the judgement this call exists to make. Testing for an
 * account or a goal, as this did, would hand that household the deterministic
 * rail and never ask.
 *
 * Balances do not count toward it, because their positions are computed and
 * nothing about them is being asked. Somebody whose only steps are the four
 * universal ones and a stack of debt gets a fully worked-out path and no bill.
 */
export function isWorthOrdering(candidates: PathCandidate[]): boolean {
  return orderableCandidates(candidates).some((c) => !UNIVERSAL_KEYS.has(c.key));
}

/**
 * Ask the model to order the candidate set. Returns null on any failure, which
 * the caller reads as "use the deterministic order".
 */
async function proposeOrder(
  tenantId: string,
  aliasMap: AliasMap,
  candidates: PathCandidate[],
  ctx: PathContext,
  readiness: PathReadiness | null,
): Promise<ProposedOrder | null> {
  let result;
  try {
    result = await llmGenerateObject(
      // Nothing that comes back is descrubbed. The prompt forbids naming an
      // account, so a correct response carries no alias to restore, and an
      // incorrect one is better left as it came: a debt's alias is its subtype,
      // so the reverse map turns the ordinary words "auto" and "credit card"
      // into the name on the account and doubles the noun the model already
      // wrote ("your auto loan" became "your Auto Loan loan"). The remaining
      // aliases cannot survive the guards below either way, since "Account 1",
      // "Goal 1" and a numbered debt all end in a count, and a bare count is
      // never one of the bands the payload sent.
      { tenantId, aliasMap, descrubOutput: false },
      {
        model: getModel(ORDER_LEVEL),
        schema: orderSchema,
        system: SYSTEM_PROMPT,
        prompt: JSON.stringify(buildOrderPayload(candidates, ctx, readiness)),
        temperature: 0,
        maxOutputTokens: 1500,
      },
    );
  } catch (e) {
    console.error('[path] order call failed:', e instanceof Error ? e.message : e);
    return null;
  }

  logLlmUsage({
    tenantId,
    source: 'financial-path',
    model: getModelSlug(ORDER_LEVEL),
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    costUsd: result.costUsd,
  });

  const steps = result.object.steps;
  if (!steps) return null;
  return { steps, leftOut: result.object.leftOut ?? [] };
}

// ── Validation ───────────────────────────────────────────────────────────────

/** A figure as anything written in digits, currency or percent. */
const HAS_FIGURE = /[\d$%]/;
/**
 * A figure written out in words.
 *
 * A digit test alone could never see this half: "over four thousand a month"
 * and "under five hundred a month" were reaching the page verbatim while the
 * same sentences in digits were being dropped.
 */
const SPELLS_A_FIGURE = /\b(?:hundred|thousand|million|billion)\b/i;

/**
 * Whether this line states a figure at all.
 *
 * It used to allow one, on the narrow ground that a band the payload had just
 * handed over was this household's own figure read back correctly, and killing
 * "You are already putting over $4k a month aside" left the reader a blank.
 *
 * The band it was validated against was the band at GENERATION time, and the
 * line it approved is then stored and rendered on every read after that. The
 * bands move. A surplus that crosses from "over $4k a month" down to "$500 to
 * $1.5k" leaves the sentence on the page asserting a figure that is no longer
 * true of the person reading it, and nothing revalidates it, because the whole
 * point of a stored path is that it is not regenerated on a read.
 *
 * A stored line therefore has to be true whenever it is read, and the only
 * lines with that property are the ones that state no figure. Which is the
 * prompt's own rule, so this is the guard finally matching it. Nothing is lost
 * that the page does not already say: every figure a step has is on the card
 * beside this line, recomputed on every read.
 */
function statesAFigure(reason: string): boolean {
  return HAS_FIGURE.test(reason) || SPELLS_A_FIGURE.test(reason);
}

/** House style for anything a user reads: no dashes, middots or semicolons. */
const REASON_HAS_BANNED_PUNCTUATION = /[\u2014\u2013\u00b7;]/;
/**
 * A line characterising what a balance costs. The payload never said.
 *
 * "Terms" is in here for the same reason the rest is. Asked for placement, the
 * model reaches for the borrowing itself to justify one, and "private education
 * debt typically carries terms that reward earlier attention" is a claim about
 * this account's borrowing on an account whose rate it was never given.
 */
const REASON_CLAIMS_A_RATE = new RegExp(
  [
    '\\b(?:high|higher|highest|low|lower|lowest|steep|punishing)[- ](?:interest|rate|apr|cost)',
    '\\b(?:expensive|costly|pricey)\\b',
    // "Terms" only where the borrowing is being said to HAVE them, which is the
    // claim. A bare `\\bterms\\b` also caught the ordinary sense, so a line
    // saying a step happens on the reader's own terms was dropped for a claim
    // it never made.
    '\\b(?:carr(?:y|ies|ied|ying)|comes?\\s+with|came\\s+with|has|have|had|offers?)\\b[^.]{0,24}\\bterms\\b',
    '\\b(?:favou?rable|unfavou?rable|better|worse|good|bad|poor|punishing|harsh|generous|steep|attractive)\\s+terms\\b',
  ].join('|'),
  'i',
);

/**
 * A line claiming an ABSOLUTE place in the sequence, which the model is in no
 * position to know.
 *
 * It orders the list it was given, and that list is not the path. Balances are
 * held out of it and woven back in at the positions their own rates put them
 * in, so anything the model calls the end of the path can have four debt steps
 * under it. One household read "This comes last because you open it once
 * contribution limits are reached" on step 10 of 14.
 *
 * The same shape as the rate guard, and there for the same reason: a stored
 * line has to be true whenever it is READ, and this one was not even true when
 * it was written. A relative claim survives the weave, because whatever ends up
 * above a step is still above it. An absolute one cannot.
 */
const REASON_CLAIMS_AN_ABSOLUTE_POSITION = new RegExp(
  [
    // "This comes last", "That step is first", "..., and it sits last."
    // Anchored to the head of a clause on purpose: a line is allowed to say
    // that the work ABOVE a step comes first, which is a relative claim and
    // survives the weave. Only the step talking about ITSELF is the problem.
    '(?:^|[,.]\\s+)(?:this|it|that)\\s+(?:step\\s+)?(?:comes?|sits?|goes|stays?|lands?|belongs?|is|ranks?)\\s+(?:dead\\s+)?(?:last|first)\\b',
    '\\bnothing\\s+(?:comes?|goes|sits?|follows?)\\s+after\\s+(?:this|it)\\b',
    '\\bcloses?\\s+(?:out\\s+)?(?:the|your)\\s+(?:path|plan|sequence)\\b',
    '\\bat\\s+the\\s+(?:very\\s+)?(?:end|bottom)\\s+of\\s+(?:the|your)\\s+(?:path|plan|sequence|list)\\b',
    '\\b(?:the\\s+)?(?:final|last)\\s+step\\s+(?:on|of|in)\\s+(?:the|your)\\s+(?:path|plan|sequence|list)\\b',
  ].join('|'),
  'i',
);
const REASON_MAX_LENGTH = 220;

/**
 * Whether this line can be shown, whether it places a step or says why one is
 * not on the path at all.
 *
 * A reason is dropped rather than repaired, because both places read correctly
 * without one. Five things disqualify one: any figure, punctuation the product
 * does not write in, a length past one sentence, a claim about what borrowing
 * costs, and a claim to an absolute place in the sequence.
 *
 * The rate test runs on EVERY line, not just a debt step's, and not just one
 * whose account reports no rate. It used to fire on `apr === null`, which is a
 * fact about our data rather than about what the model was told, so a 2.5%
 * mortgage could be called high interest purely because that account happened
 * to have a rate on file. The invariant the guard actually protects is that the
 * model is never sent a rate for anything, which is true of every line it
 * writes, so the guard belongs on every line it writes.
 */
function reasonIsUsable(reason: string): boolean {
  if (reason.length === 0 || reason.length > REASON_MAX_LENGTH) return false;
  if (statesAFigure(reason)) return false;
  if (REASON_HAS_BANNED_PUNCTUATION.test(reason)) return false;
  if (REASON_CLAIMS_A_RATE.test(reason)) return false;
  if (REASON_CLAIMS_AN_ABSOLUTE_POSITION.test(reason)) return false;
  return true;
}

/** A candidate and the line the model wrote about it. */
export interface PlacedCandidate {
  candidate: PathCandidate;
  reason: string;
}

export interface ValidatedOrder {
  /** The sequence, in the order it is walked. */
  ordered: PlacedCandidate[];
  /** What the model judged does not belong, each with its reason. */
  leftOut: PlacedCandidate[];
  source: PathOrderSource;
}

/**
 * Turn what the model said into a path that can be persisted, or fall back.
 *
 * Nothing here trusts the response: a key that is not in the candidate set and
 * a key returned twice are both dropped before anything reaches the database.
 *
 * A candidate the model put in NEITHER list is not silently gone. It is not in
 * the sequence it chose, so it is off the path, and it is listed as left out
 * with nothing said about it. That is the honest reading of a key it never
 * mentioned, and it is what keeps the guarantee absolute: every candidate that
 * came in is in exactly one of the two lists that go out, so a debt somebody
 * owes cannot disappear because a response was short.
 *
 * A key naming a deleted account or goal needs no separate guard. The candidate
 * set is built from the household as it stands, so a deleted row has no
 * candidate, and any key naming one fails the lookup below like any other key
 * that was never offered. A row deleted after the set was built is fine too:
 * a step stores its candidate key and nothing else, and `applyStoredOrder`
 * drops a stored key with no candidate behind it on the next read.
 */
export function validateOrder(
  proposed: ProposedOrder | null,
  candidates: PathCandidate[],
  /**
   * Keys this generation may NOT leave out, because the person has already
   * answered for them: put back, ticked done, or set aside. Empty on a first
   * path, and empty for every caller that is not `generatePath`.
   */
  mustInclude: ReadonlySet<string> = new Set(),
): ValidatedOrder {
  const orderable = orderableCandidates(candidates);
  const byKey = new Map(orderable.map((c) => [c.key, c]));
  const taken = new Set<string>();
  const placed: PlacedCandidate[] = [];
  // One sentence, once. Three balances came back with a byte-identical line
  // between them, and a reader going down the list reads the same excuse three
  // times. The first keeps it and the rest fall back to the page's own wording.
  const written = new Set<string>();

  const place = (step: ProposedStep, into: PlacedCandidate[]) => {
    const candidate = byKey.get(step?.key);
    if (!candidate || taken.has(candidate.key)) return;
    taken.add(candidate.key);
    const reason = (step.reason ?? '').trim();
    const usable = reasonIsUsable(reason) && !written.has(reason.toLowerCase());
    if (usable) written.add(reason.toLowerCase());
    into.push({ candidate, reason: usable ? reason : '' });
  };

  for (const step of proposed?.steps ?? []) place(step, placed);

  // Nothing survived, so there is no model path to persist. The deterministic
  // rail is every candidate, in the order they were emitted: a response we
  // could not read is not a judgement that anything should be left out.
  if (placed.length === 0) {
    return {
      ordered: candidates.map((candidate) => ({ candidate, reason: '' })),
      leftOut: [],
      source: 'deterministic',
    };
  }

  const omitted: PlacedCandidate[] = [];
  for (const step of proposed?.leftOut ?? []) place(step, omitted);
  for (const candidate of orderable) {
    if (!taken.has(candidate.key)) omitted.push({ candidate, reason: '' });
  }

  // Two kinds of omission cannot stand.
  //
  // A key the person has answered for is theirs, and a later generation does
  // not get to overrule them.
  //
  // A candidate carrying `coversStep` SUPPRESSED a built-in step by standing in
  // for it, so leaving it out takes both off the path at once. A household with
  // an emergency-fund goal had no emergency-fund step, because the goal covers
  // it, and then the goal itself was left out with nothing said about it: the
  // page showed no emergency fund anywhere and the line under the goal read
  // that the plan did not place it. Neither is a state a path may reach, so the
  // substitute is reinstated rather than the built-in step being restored,
  // because the person chose the goal's months and its target and theirs is the
  // more specific number.
  const reinstate = (o: PlacedCandidate) =>
    mustInclude.has(o.candidate.key) || o.candidate.coversStep !== undefined;
  const reinstated = new Set(omitted.filter(reinstate).map((o) => o.candidate.key));
  const leftOut = omitted.filter((o) => !reinstate(o));

  return {
    ordered: rateBeforeRetirement(urgentDebtFirst(weave(candidates, placed, reinstated))),
    leftOut,
    source: 'model',
  };
}

/**
 * The final sequence: the model's order threaded through the positions that
 * were not its to choose.
 *
 * `candidates` arrives in the DETERMINISTIC order, which is the worked-out one:
 * tier by tier, with each balance sitting at the tier its own APR band puts it
 * in. Walking it and emitting the fixed steps where they fall, while every
 * other slot takes the next step the model chose, is what "the model orders
 * everything else around the fixed positions" means in code.
 *
 * Two kinds of step are fixed. A balance, always, because payoff order is
 * computed rather than judged. And a step the model omitted that is being put
 * back, which has no placement line and so no position of the model's choosing
 * to honour. Those used to go on the END of the sequence, which is the position
 * least likely to be right for a step somebody had explicitly asked to keep.
 * Its deterministic slot is a worked-out answer, and it is the same answer the
 * whole path falls back to when there is no model order at all.
 *
 * What this preserves is each fixed step's INDEX among the slots, which is not
 * the same as its rank against the steps around it. The slots above a balance
 * take the model's first few steps whatever those are, so a balance above 15%
 * could land under the brokerage step while its own card said money put there
 * beats money invested. `urgentDebtFirst` below is what closes that gap.
 */
function weave(
  candidates: PathCandidate[],
  placed: PlacedCandidate[],
  reinstated: ReadonlySet<string>,
): PlacedCandidate[] {
  const isFixed = (c: PathCandidate) => !modelOrders(c) || reinstated.has(c.key);
  const ordered: PlacedCandidate[] = [];
  let next = 0;
  for (const candidate of candidates) {
    if (isFixed(candidate)) ordered.push({ candidate, reason: '' });
    else if (next < placed.length) ordered.push(placed[next++]);
  }
  return ordered;
}

/**
 * The steps whose entire argument is compounding, and which a balance above
 * `DEBT_URGENT_ABOVE` therefore beats outright.
 *
 * Named by key rather than by tier because that is what the page shows. Each
 * one is emitted at a tier below the urgent debt band already, so this is the
 * deterministic rail's own answer, held to after the weave.
 */
const AFTER_URGENT_DEBT = new Set([
  'max-contributions',
  'taxable-brokerage',
  'financial-independence',
]);

/**
 * The one ordering claim the page makes out loud, enforced rather than hoped
 * for: a balance whose rate beats the market sits above the steps that only
 * compound.
 *
 * The weave holds each balance's INDEX, not its rank, so under a model order
 * that opened on the compounding steps an urgent balance landed below them
 * about half the time, next to its own copy saying the opposite. Anything that
 * ended up above the last urgent balance and belongs below it is moved down to
 * just after it, in the order the model put them in. Nothing else moves, so the
 * model's sequence survives everywhere the claim is not at stake.
 */
function urgentDebtFirst(ordered: PlacedCandidate[]): PlacedCandidate[] {
  let lastUrgent = -1;
  ordered.forEach((o, at) => { if (isUrgentDebt(o.candidate)) lastUrgent = at; });
  if (lastUrgent < 0) return ordered;

  const above = ordered.slice(0, lastUrgent + 1);
  const misplaced = above.filter((o) => AFTER_URGENT_DEBT.has(o.candidate.key));
  if (misplaced.length === 0) return ordered;

  return [
    ...above.filter((o) => !AFTER_URGENT_DEBT.has(o.candidate.key)),
    ...misplaced,
    ...ordered.slice(lastUrgent + 1),
  ];
}

/**
 * The steps that are only reached, never worked at: being ready to retire, and
 * the independence that is the same portfolio carried further.
 */
const RETIREMENT_OUTCOMES = new Set(['financial-independence']);

function isRetirementOutcome(candidate: PathCandidate): boolean {
  return RETIREMENT_OUTCOMES.has(candidate.key) || candidate.coversStep === 'financial-independence';
}

/**
 * The savings rate sits above the retirement outcomes, always.
 *
 * The rate is the LEVER and readiness is the READING. Ordered the other way
 * round the page tells somebody to raise what they keep after it has already
 * told them they are retirement ready, at which point the instruction has
 * nothing left to change: the outcome it was there to move has been reached and
 * the step below it reads as busywork. Every dollar of the rate acts through
 * the outcomes above, so it cannot be placed after them and still be an action.
 *
 * The model gets no say in this one. It is a dependency between two steps, not
 * a judgement about a household, and it held right on its own only sometimes.
 * Everything either side of the pair keeps the order the model chose.
 */
function rateBeforeRetirement(ordered: PlacedCandidate[]): PlacedCandidate[] {
  const rate = ordered.findIndex((o) => o.candidate.key === 'savings-rate');
  if (rate < 0) return ordered;

  const outcome = ordered.findIndex((o) => isRetirementOutcome(o.candidate));
  if (outcome < 0 || outcome > rate) return ordered;

  const moved = ordered[rate];
  const rest = ordered.filter((_, at) => at !== rate);
  return [...rest.slice(0, outcome), moved, ...rest.slice(outcome)];
}

// ── Fingerprint ──────────────────────────────────────────────────────────────

/**
 * A digest of the inputs an ORDER turns on. Stored, and compared on every read,
 * so a path built on this household can be told from one built on an older
 * version of it.
 *
 * What counts as material is not a judgement call here: it is exactly the
 * payload the model was shown. If those inputs are unchanged, asking again
 * would produce the same sequence, so there is nothing to regenerate and
 * nothing to pay for. If they have changed, the sequence may rightly differ.
 *
 * That definition is also what keeps the path still. The payload is banded on
 * purpose — income to $25k/$50k steps, surplus to four bands, each step's
 * amount to a t-shirt size against a month of income — so the figures that
 * drift daily cannot move it. A balance falling by a dollar, a goal gaining a
 * contribution, a quiet month of spending: none of them change a band, so none
 * of them regenerate. What does change it is a step appearing or disappearing
 * (a debt account opened, a balance cleared, a goal added or removed), a goal's
 * target month moving, an income or surplus that crosses a band, a birthday,
 * a change of employment, or a dependent. Those are the events a person would
 * expect their plan to answer to.
 *
 * It deliberately does NOT digest the things only the sizing pass reads —
 * cash, invested totals, exact balances, exact spend. Those decide the figures
 * on each card, which are recomputed on every read anyway, and they move
 * every day.
 *
 * CHANGING WHAT THIS DIGESTS INVALIDATES EVERY STORED PATH. The digest is
 * compared, not versioned, so a release that alters its shape makes every
 * active row mismatch on its first read: one paid ordering call per active
 * tenant, and every sequence rebuilt. That is the cost of the key list below,
 * and it is also load bearing here. It is what heals the `left_out` rows the
 * old carry-forward bug wrote, because `storedPath` does not heal them on a
 * read, only a regeneration does. Weigh both before touching this.
 *
 * The candidate KEYS in deterministic order go in alongside the payload, and
 * carry the half of the order the payload no longer describes. Balances are not
 * in the payload at all now, so on the payload alone a mortgage opening or a
 * card being cleared changed nothing, the digest still matched, and the path
 * was never rebuilt for either. The key list is where a balance appearing,
 * disappearing, or moving between APR bands shows up.
 */
export function pathFingerprint(
  ctx: PathContext,
  candidates: PathCandidate[],
  readiness: PathReadiness | null,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        payload: buildOrderPayload(candidates, ctx, readiness),
        sequence: candidates.map((c) => c.key),
      }),
    )
    .digest('hex');
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * One stored step: the candidate it names, why the model put it there, and
 * where the person says they stand on it.
 *
 * Nothing else is stored. Every figure a step shows is recomputed on read
 * because balances move and a finished step can reopen, so a stored target or
 * date would only be a snapshot of a household that has since changed. The mark
 * is the exception, and has to be: nothing in the household records that
 * somebody bought term life or that a step does not apply to them.
 */
export interface StoredStep {
  key: string;
  /** The model's placement line, or empty when the order was deterministic. */
  reason: string;
  mark: PathStepMark;
  /** What they wrote when they marked it. Empty when they wrote nothing. */
  note: string;
  markedAt: Date | null;
}

/** This tenant's active path, as it stands in the database. */
export interface StoredPath {
  id: string;
  generatedAt: Date;
  /** What caused this path to be generated. */
  reason: PathGenerationReason;
  inputsFingerprint: string;
  /** Why it is already due to be replaced, parked by whatever knew. */
  pendingReason: PathGenerationReason | null;
  /** Who chose this order. `deterministic` when no model call decided it. */
  orderSource: PathOrderSource;
  steps: StoredStep[];
}

/** A path as the page consumes it: sized steps, plus the line behind each one. */
export interface PathOrder {
  steps: SizedStep[];
  /**
   * The steps this person said do not apply to them, in path order. They are
   * NOT part of `steps`, so they take no number, no segment and no share of the
   * monthly surplus. A step struck through forever is still a step you read.
   */
  notApplicable: PathCandidate[];
  /**
   * The steps the model judged do not belong in this person's sequence, each
   * with the line it wrote saying why.
   *
   * Also off `steps`, for the same reasons, and shown in the same place. The
   * difference from the list above is only whose call it was, and that is why
   * the reason travels with these and not with those: the person knows why they
   * took a step off their own path.
   */
  leftOut: PlacedCandidate[];
  /** Keyed by candidate key. A step with no line is simply absent. */
  reasons: Map<string, string>;
  /** When this order was chosen, and what caused it to be. */
  generatedAt: Date;
  reason: PathGenerationReason;
  /**
   * Who chose this order. The page says which, because on a deterministic path
   * nothing weighed this household at all, and telling somebody their order was
   * chosen for their situation when it was the fallback rail is simply false.
   */
  orderSource: PathOrderSource;
}

/**
 * Whether the person has answered for this step themselves.
 *
 * `pending` is the column default, so a pending row on its own says nothing: it
 * is every step nobody has touched. Only the timestamp tells one they put back
 * from one they have never seen, which is why every mark stamps it, `pending`
 * included. `done` and `not_applicable` are statements whatever their
 * timestamp, including the ones carried over from before there were paths,
 * where nothing recorded when they were made.
 */
function personSpokeFor(was: StoredStep | undefined): boolean {
  if (!was) return false;
  return was.mark === 'done' || was.mark === 'not_applicable' || was.markedAt !== null;
}

/** This tenant's stored path. Null when they have no path. */
export async function readActivePath(
  tenantId: string,
  reader: Pick<typeof db, 'query'> = db,
): Promise<StoredPath | null> {
  const path = await reader.query.financialPaths.findFirst({
    where: and(eq(financialPaths.tenantId, tenantId), eq(financialPaths.status, 'active')),
  });
  if (!path) return null;
  const rows = await reader.query.financialPathSteps.findMany({
    where: eq(financialPathSteps.pathId, path.id),
    orderBy: [asc(financialPathSteps.position)],
  });
  const legacy = await readLegacyMarks(tenantId, reader);
  return {
    id: path.id,
    generatedAt: path.generatedAt,
    reason: isGenerationReason(path.reason) ? path.reason : 'no_active_path',
    inputsFingerprint: path.inputsFingerprint,
    pendingReason: isGenerationReason(path.pendingReason) ? path.pendingReason : null,
    orderSource: path.orderSource === 'model' ? 'model' : 'deterministic',
    steps: rows.map((r) => {
      // A row nobody has ever said anything about: not marked, nothing written
      // on it, and no moment it was marked at. That is where what they recorded
      // before there were paths still stands, and the only place it is read.
      const untouched = r.status === 'pending' && r.note === '' && r.statusAt === null;
      const before = untouched ? legacy.get(r.candidateKey) : undefined;
      return {
        key: r.candidateKey,
        reason: r.reason,
        mark: before?.mark ?? r.status,
        note: before?.note ?? r.note,
        markedAt: before?.markedAt ?? r.statusAt,
      };
    }),
  };
}

/** One step of a stored path, for a reader that is not the path page. */
export interface PathStepRef {
  key: string;
  /** 1 based, in the order the path is walked. */
  step: number;
  /** What the step is, in words, carrying no figure. */
  title: string;
}

/**
 * The steps of this tenant's active path, in order, named. Empty when they have
 * no path.
 *
 * This exists so that something OUTSIDE the path pages can talk about a step
 * without rebuilding the household. `readFinancialPath` is the full answer, and
 * it is the expensive one: it builds the context, runs a retirement simulation
 * and will generate a path when the stored one is stale. Reading actions must
 * not pay for any of that, so this reads the stored rows and names them.
 *
 * A step somebody took off their path is not on it, so it is not here and takes
 * no number, which is how the path page counts too.
 *
 * KNOWN LIMIT: a stored key whose candidate is gone but whose row is not (a
 * debt paid to zero, an employer match removed from the profile) still counts
 * here, and the path page drops it. That disagreement lasts until the next read
 * of the path, which regenerates on exactly those events, and it can only ever
 * shift a number by one. Closing it properly would mean building the candidate
 * set, and the simulation with it, on every read of the actions list.
 */
export async function readPathSteps(tenantId: string): Promise<PathStepRef[]> {
  const stored = await readActivePath(tenantId);
  if (!stored) return [];
  const onPath = stored.steps.filter(
    // A retired key names no step this product builds any more, so it is not a
    // step on anybody's path and it has no title to give. `storedPath` drops
    // the same rows, which is what the path page counts.
    (s) => s.mark !== 'not_applicable' && s.mark !== 'left_out' && isLiveStepKey(s.key),
  );

  const accountIds = onPath.filter((s) => s.key.startsWith('debt:')).map((s) => s.key.slice(5));
  const goalIds = onPath.filter((s) => s.key.startsWith('goal:')).map((s) => s.key.slice(5));
  const names = new Map<string, string>();
  if (accountIds.length > 0) {
    for (const row of await db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, accountIds)))) {
      names.set(row.id, row.name);
    }
  }
  if (goalIds.length > 0) {
    for (const row of await db
      .select({ id: goals.id, name: goals.name })
      .from(goals)
      .where(and(eq(goals.tenantId, tenantId), inArray(goals.id, goalIds)))) {
      names.set(row.id, row.name);
    }
  }

  return onPath.map((s, index) => ({
    key: s.key,
    step: index + 1,
    title: stepLabelForKey(s.key, names),
  }));
}

/**
 * Where this person stood on their steps BEFORE a path was ever stored.
 *
 * Until this table existed, a tick and a note lived on the profile row against
 * a step id, and a step someone had put aside lived beside it. Those columns
 * still hold the only record that somebody bought term life or wrote themselves
 * a will, and a step row carrying nobody's mark is not a statement that they
 * never made one. So they are read as a FALLBACK, for steps this path has never
 * been told anything about, and they stop being consulted for a step the moment
 * it is marked here.
 *
 * A fallback rather than a backfill on purpose. Nothing is written back and
 * nothing is cleared, so there is no pass over everyone's rows that can get a
 * mapping wrong, and a person who never returns is left exactly as they are.
 * It fades on its own: the first regeneration writes what it found onto the
 * steps it stores, and from then on the stored mark is what answers.
 *
 * A tick is carried only where its id is EXACTLY a candidate key. Every id of
 * the old list is one, bar the three that named a rate band rather than a step
 * ("high-rate-debt", "mid-rate-debt", "low-interest-debt"). A band stood for a
 * group of accounts, so there is no one step it means, and it is dropped rather
 * than landed on a debt the person may never have been talking about.
 */
async function readLegacyMarks(
  tenantId: string,
  reader: Pick<typeof db, 'query'> = db,
): Promise<Map<string, StoredStep>> {
  const profile = await reader.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, tenantId),
    columns: { skippedPrioritySteps: true, completedPrioritySteps: true },
  });
  if (!profile) return new Map();

  const marks = new Map<string, StoredStep>();
  for (const id of profile.skippedPrioritySteps ?? []) {
    if (id) marks.set(id, { key: id, reason: '', mark: 'not_applicable', note: '', markedAt: null });
  }
  // Second, so a step they finished is finished even if it was also put aside.
  for (const tick of profile.completedPrioritySteps ?? []) {
    if (!tick?.id) continue;
    const at = tick.completedAt ? new Date(tick.completedAt) : null;
    marks.set(tick.id, {
      key: tick.id,
      reason: '',
      mark: 'done',
      note: tick.note ?? '',
      markedAt: at && !Number.isNaN(at.getTime()) ? at : null,
    });
  }
  return marks;
}

/** Today's candidates in the stored order, sized, with the stored lines. */
export function storedPath(
  candidates: PathCandidate[],
  ctx: PathContext,
  stored: StoredPath,
): PathOrder {
  const marks = new Map(stored.steps.map((s) => [s.key, s]));
  const ordered = applyStoredOrder(candidates, stored.steps.map((s) => s.key));
  const markOf = (c: PathCandidate) => marks.get(c.key)?.mark;
  // Split before sizing, not after. The waterfall pours the monthly surplus
  // down the steps in order, so a step that is not on the path must not be in
  // the list the waterfall walks, or it would push every date behind it out.
  // Both kinds of off-path step are taken out here, for that one reason.
  //
  // A candidate with no stored row at all is new to this path and is ON it. It
  // is nobody's judgement yet, and `applyStoredOrder` has already put it at the
  // end, where it stays until the path is next generated.
  const leftOut = ordered.filter((c) => markOf(c) === 'left_out');
  const notApplicable = ordered.filter((c) => markOf(c) === 'not_applicable');
  const applicable = ordered.filter(
    (c) => markOf(c) !== 'not_applicable' && markOf(c) !== 'left_out',
  );
  return {
    steps: sizePath(applicable, ctx, marks),
    notApplicable,
    leftOut: leftOut.map((c) => ({ candidate: c, reason: marks.get(c.key)?.reason ?? '' })),
    // Placement lines only. A left-out row's `reason` says why the step is NOT
    // on the path, and it travels with that step rather than as the line under
    // a card that does not exist.
    //
    // And run past the guard again on the way out, not only on the way in. A
    // stored line has to be true whenever it is READ, which is the rule the
    // guard exists to keep, and a path is not regenerated on a read: a line
    // the guard learns to catch would otherwise stay on the page until
    // something unrelated moved the fingerprint. Nothing that passed at
    // generation time fails here, so this costs a stored path nothing and
    // heals every one of them the moment the guard is tightened.
    reasons: new Map(
      stored.steps
        .filter((s) => s.reason && s.mark !== 'left_out' && reasonIsUsable(s.reason))
        .map((s) => [s.key, s.reason]),
    ),
    generatedAt: stored.generatedAt,
    reason: stored.reason,
    orderSource: stored.orderSource,
  };
}

/**
 * Record where the person stands on one step of their active path.
 *
 * Returns false when no step on the active path carries that key, which is the
 * only failure this has: a key naming an account or goal that is gone, or a
 * step that was never on this tenant's path.
 *
 * A tick is deliberately NOT applied to a step the figures measure. `sizePath`
 * decides those from the balances every read, in both directions, so pinning
 * one here would let a full emergency fund read as done long after it was
 * spent. The mark is still stored, and the note with it, because they are the
 * person's own words about the step.
 *
 * `note` left out means the note is left ALONE. Undo and "put back" say where
 * the person stands and say nothing about what they wrote, and blanking the
 * sentence they typed because they did not retype it destroys their own words.
 * Only an empty string clears one, which is what the composer sends.
 *
 * KNOWN LIMIT: this does not take the generation lock, so a mark made in the
 * same instant that another request is regenerating the path can land on the
 * row that request is about to supersede, and be lost. Taking the lock would
 * make every tick wait behind a model call that runs eleven to fourteen
 * seconds, which is a certain cost paid against an uncertain one. The window is
 * the length of one regeneration, and reaching it needs a tick and a
 * regeneration for the same tenant at the same moment.
 */
export async function markPathStep(
  tenantId: string,
  key: string,
  mark: PathStepMark,
  note?: string,
): Promise<boolean> {
  const path = await db.query.financialPaths.findFirst({
    where: and(eq(financialPaths.tenantId, tenantId), eq(financialPaths.status, 'active')),
    columns: { id: true },
  });
  if (!path) return false;

  // First, and only while the row still says what it was: a `left_out` row's
  // `reason` is the model's line for keeping the step OFF the path, and the
  // person is about to overrule it. Left in place, `storedPath` reads it back
  // as a placement line the moment the mark is no longer `left_out`, and the
  // step renders on the path under "Why it sits here" with the sentence saying
  // why it is not on it. Nothing later clears it either: a put-back
  // deliberately never regenerates, so the window has no end.
  await db
    .update(financialPathSteps)
    .set({ reason: '' })
    .where(
      and(
        eq(financialPathSteps.pathId, path.id),
        eq(financialPathSteps.candidateKey, key),
        eq(financialPathSteps.status, 'left_out'),
      ),
    );

  const updated = await db
    .update(financialPathSteps)
    .set({
      status: mark,
      ...(note === undefined ? {} : { note }),
      // Stamped for every mark, `pending` included. It is when they last said
      // where they stand, not when they finished, and putting a step back is
      // them saying so. It is also what tells a step they have answered for
      // from one nobody has ever touched, which is the only place the older
      // bookkeeping is still read.
      statusAt: new Date(),
    })
    .where(
      and(eq(financialPathSteps.pathId, path.id), eq(financialPathSteps.candidateKey, key)),
    )
    .returning({ id: financialPathSteps.id });
  return updated.length > 0;
}

/**
 * Park a reason on this tenant's path, so the read that next regenerates knows
 * what to call it.
 *
 * Two of the three triggers cannot be seen in the fingerprint at all. A goal
 * whose target moves without crossing a t-shirt size, and a step somebody ticks
 * done, both leave the ordering inputs identical, so nothing on a later read
 * could tell that anything happened. Whatever performed the act says so here.
 */
export async function invalidatePath(
  tenantId: string,
  reason: PathGenerationReason,
): Promise<void> {
  await db
    .update(financialPaths)
    .set({ pendingReason: reason })
    .where(and(eq(financialPaths.tenantId, tenantId), eq(financialPaths.status, 'active')));
}

// ── Reserving a tenant before spending on one ────────────────────────────────
//
// The unique index on `financial_paths` stops a tenant ending up with two
// active orders, but it cannot stop them being PAID for twice: by the time an
// insert conflicts, the losing request has already made its own model call. The
// spend has to be guarded ahead of itself, so a tenant is locked, re-read, and
// only then ordered.
//
// The lock is transaction-scoped on purpose. Postgres drops it at commit or at
// rollback, so a model call that throws, a request that is abandoned, or a
// process that dies mid-generation all release the tenant and leave nothing
// half-written for the next read to trip over. Only one lock is ever taken, on
// one key, so nothing here can deadlock.
//
// KNOWN LIMIT: one pool connection per in-flight generation, held for the
// length of the model call. An advisory lock lives on a connection, so holding
// one across the call means holding a connection across it. Measured locally:
//
//   - the ordering call runs 11 to 14 seconds, and the connection is held for
//     all of it (peak `idle in transaction` of 1 per generating tenant, with
//     every request queued behind the same tenant's lock showing as `active`
//     and holding a connection of its own);
//   - the postgres.js pool is its default `max: 10`. Nine held transactions
//     leave an unrelated query unaffected (25 ms). The tenth makes it wait for
//     one to finish (2,634 ms of a 3,000 ms hold).
//
// So ten simultaneous first-reads stall EVERY other query in the process until
// the slowest of them returns. They queue rather than fail, so it presents as
// the API hanging for ten-odd seconds and then recovering. First-reads happen
// once per tenant, which is why this is a scale risk and not a present one.
//
// Moving the call outside the transaction is not free, and neither obvious
// route was worth taking blind:
//
//   - A durable reservation row (claim the tenant, release the lock, call, then
//     persist) needs a lease with an expiry, or a process that dies mid-call
//     blocks that tenant forever. An expiry re-opens the double-spend it exists
//     to prevent, and the requests that lost the race have to poll for the
//     winner's result or they answer with a different order than it does.
//   - Bounding the call with a timeout caps the hold but persists the
//     deterministic order when it fires, and nothing regenerates a path, so a
//     single slow call would fix that tenant's order permanently.

/** Namespace half of the advisory lock key, so nothing else collides with it. */
const LOCK_NAMESPACE = 0x70617468;

/** The tenant half. A 32 bit digest of their id, which the lock takes as int4. */
function tenantLockKey(tenantId: string): number {
  return createHash('sha256').update(tenantId).digest().readInt32BE(0);
}

/**
 * Order the candidates, size them, and store the result as this tenant's active
 * path.
 *
 * Sizing runs AFTER ordering on purpose: funding is a waterfall down the path,
 * so the order the model chose is what decides each step's monthly figure and
 * its date.
 */
export async function generatePath(
  tenantId: string,
  ctx: PathContext,
  candidates: PathCandidate[],
  /**
   * What the retirement simulation said for this read, or null. Reused, never
   * re-run: it is the trajectory signal the decision turns on and it is also
   * the most expensive thing the read did.
   */
  readiness: PathReadiness | null,
  reason: PathGenerationReason,
  /**
   * The path this generation replaces, as the caller read it. Null on a
   * tenant's first path.
   *
   * Passing it rather than re-deriving it inside the lock is what makes the
   * race safe. Under the lock we re-read the active row: if it is no longer the
   * one the caller judged stale, another request has already regenerated and
   * paid, so its order is the tenant's path and ours is not asked for.
   */
  supersedes: StoredPath | null = null,
): Promise<PathOrder> {
  // Built before the lock, not during it. `lib/llm.ts` otherwise builds this
  // map partway through the ordering call, which would mean reaching into the
  // connection pool while already holding one of its connections open for the
  // length of that call. Enough simultaneous generations doing that would wait
  // on a pool they are themselves holding. Inside the transaction, nothing
  // touches the pool but the transaction.
  const aliasMap = isWorthOrdering(candidates) ? await buildAliasMap(tenantId) : null;
  // Read here rather than in the transaction, for the same reason the alias map
  // is: nothing should reach into the pool while holding one of its connections
  // open for the length of a model call.
  const legacy = await readLegacyMarks(tenantId);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${tenantLockKey(tenantId)})`,
    );

    // Read inside the lock. A request that queued ahead of this one has already
    // generated and paid, and its order is the tenant's path, not ours.
    const already = await readActivePath(tenantId, tx);
    if (already && already.id !== supersedes?.id) return storedPath(candidates, ctx, already);

    const proposed = aliasMap
      ? await proposeOrder(tenantId, aliasMap, candidates, ctx, readiness)
      : null;

    // What the person said about each step, carried forward by key. A step they
    // ticked done or took off the path stays that way through a reshuffle: the
    // order is the model's to change, the marks are not. A key that is gone
    // from the household drops out with its candidate, and a key that is new to
    // this path starts pending, which is what it is.
    const carried = new Map((already?.steps ?? []).map((s) => [s.key, s]));

    // Then, only for a key nothing on this path has ever said anything about,
    // what the person said before there were paths. This is the one place the
    // old bookkeeping is read, so it lands on the stored steps once and the
    // stored steps answer for it after that: a step they later put back to
    // pending stays pending, because its key now has a mark of its own.
    for (const [key, mark] of legacy) {
      if (!carried.has(key)) carried.set(key, mark);
    }

    // The person's own word outranks the model's omission. A step they put back,
    // ticked done, or took off the path is a step they have answered for, and a
    // later generation does not get to overrule any of those answers: it may
    // leave out only a step nobody has ever said anything about. Handed to
    // `validateOrder`, so such a step is put back at its deterministic position
    // rather than appended behind everything else.
    const spokenFor = new Set(
      [...carried.keys()].filter((key) => personSpokeFor(carried.get(key))),
    );
    const { ordered, leftOut, source } = validateOrder(proposed, candidates, spokenFor);

    const notApplicable = ordered
      .map((o) => o.candidate)
      .filter((c) => carried.get(c.key)?.mark === 'not_applicable');
    const applicable = ordered
      .map((o) => o.candidate)
      .filter((c) => carried.get(c.key)?.mark !== 'not_applicable');

    const steps = sizePath(applicable, ctx, carried);
    const reasons = new Map(ordered.filter((o) => o.reason).map((o) => [o.candidate.key, o.reason]));
    const generatedAt = new Date();

    // The old order stops being the tenant's path before the new one becomes
    // it, in the same transaction, because the partial unique index allows one
    // active row per tenant and this is what keeps a reshuffle a visible event
    // rather than a silent edit of the row somebody was reading.
    if (already) {
      await tx
        .update(financialPaths)
        .set({ status: 'superseded', pendingReason: null })
        .where(eq(financialPaths.id, already.id));
    }

    const [path] = await tx
      .insert(financialPaths)
      .values({
        tenantId,
        generatedAt,
        reason,
        inputsFingerprint: pathFingerprint(ctx, candidates, readiness),
        model: source === 'model' ? getModelSlug(ORDER_LEVEL) : null,
        orderSource: source,
      })
      .returning({ id: financialPaths.id });

    // Both lists are stored, the sequence first and what was left out behind
    // it, so a left-out step has a row of its own to carry the model's line and
    // to take the person's mark when they put it back.
    await tx.insert(financialPathSteps).values(
      [
        ...ordered.map(({ candidate }) => ({
          candidate,
          reason: reasons.get(candidate.key) ?? '',
          onPath: true,
        })),
        ...leftOut.map(({ candidate, reason }) => ({ candidate, reason, onPath: false })),
      ].map(({ candidate, reason: line, onPath }, index) => {
        const was = carried.get(candidate.key);
        // `left_out` is not a mark the PERSON can make: it is the previous
        // generation's own omission, and this generation has just placed the
        // step in the sequence, which supersedes it. Carrying it forward stored
        // a step that IS on the path as off it, `storedPath` filtered it
        // straight back off, and nothing could rescue it, because a left-out
        // row stores no `statusAt` and so never reads as one the person spoke
        // for. Two households lost a student loan and a car loan that way, each
        // shown under "not on your path" beneath a sentence saying when to pay
        // it. Every other mark is the person's own and carries forward as it is.
        const held = was && was.mark !== 'left_out' ? was : undefined;
        return {
          pathId: path.id,
          tenantId,
          position: index,
          candidateKey: candidate.key,
          reason: line,
          status: onPath ? held?.mark ?? ('pending' as const) : ('left_out' as const),
          // `was`, not `held`: the note is the only field the `left_out` test
          // does not gate, and deliberately. A mark is a judgement this
          // generation supersedes, but a note is the person's own sentence
          // about the step, and a `left_out` row can hold one (they wrote it,
          // then a later generation left the step out around it). Dropping it
          // for that would destroy their words to tidy up ours.
          note: was?.note ?? '',
          statusAt: onPath ? held?.markedAt ?? null : null,
        };
      }),
    );

    return { steps, notApplicable, leftOut, reasons, generatedAt, reason, orderSource: source };
  });
}

/**
 * The candidates of this read, in the stored order.
 *
 * A stored key with no candidate behind it is gone from this household, and a
 * candidate the stored path never saw is new to it. Neither reshuffles what is
 * already there: the new step goes on the end, where it stays until the path is
 * regenerated.
 */
export function applyStoredOrder(candidates: PathCandidate[], keys: string[]): PathCandidate[] {
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const ordered: PathCandidate[] = [];
  const taken = new Set<string>();
  for (const key of keys) {
    const candidate = byKey.get(key);
    if (candidate && !taken.has(key)) {
      taken.add(key);
      ordered.push(candidate);
    }
  }
  for (const candidate of candidates) {
    if (!taken.has(candidate.key)) ordered.push(candidate);
  }
  return ordered;
}
