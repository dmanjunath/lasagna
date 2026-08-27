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
import type { PathCandidate } from './path-candidates.js';
import type { PathContext } from './path-context.js';
import { sizePath, type SizedStep } from './path-sizing.js';
import { buildAliasMap, type AliasMap } from './pii-scrubber.js';
import { llmGenerateObject } from './llm.js';

/**
 * Who does what, in what order, and once.
 *
 * The CONTENTS of a path are computed: `buildPathCandidates` emits the steps
 * that apply to one household and prunes the rest. The ORDER is the part that
 * genuinely varies between two people in the same position — a first-time buyer
 * with a dated deposit and a sole earner with dependents do not walk the same
 * rail — so the order is a model's call over the validated candidate set.
 *
 * Three things keep that honest:
 *
 *  1. The chosen order is PERSISTED. Asking a model twice must never reshuffle
 *     a plan somebody is standing in the middle of, so the path is generated
 *     once and read back after that.
 *  2. The model never decides a NUMBER, and never names a thing. It returns
 *     candidate keys it was given and, per step, one clause on where that step
 *     sits relative to the others. Every target, balance, monthly figure and
 *     date is computed by `sizePath` AFTER the order is fixed, and every title
 *     comes from the household, so nothing it wrote is ever a name or a figure.
 *  3. Generation RESERVES before it spends. A tenant is locked before the model
 *     is asked, so simultaneous first-reads produce one call between them
 *     rather than one each.
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

/** Where the person stands on one step, as they said so themselves. */
export type PathStepMark = 'pending' | 'done' | 'not_applicable';

export type PathOrderSource = 'model' | 'deterministic';

// ── What the model is allowed to see ─────────────────────────────────────────
//
// Keys, kinds, a generic label, a relative size, and the situation facts an
// ordering decision turns on. Every figure is banded before it leaves: the
// payload carries an income band, a surplus band and a t-shirt size per step,
// never a balance, a salary, a surplus, a rate or the name on an account. A
// goal's date changes the order. The exact dollars do not.

const DEBT_LABELS: Record<string, string> = {
  payday: 'Payday or buy-now-pay-later balance',
  collections: 'Balance in collections',
  card: 'Credit card balance',
  personal: 'Personal loan',
  private_student: 'Private student loan',
  federal_student: 'Federal student loan',
  auto: 'Auto loan',
  mortgage: 'Mortgage',
  medical: 'Medical debt',
};

const KIND_LABELS: Record<string, string> = {
  buffer: 'Starter emergency fund',
  match: 'Employer retirement match',
  'emergency-fund': 'Full emergency fund',
  protection: 'Insurance and will',
  'savings-rate': 'Savings rate',
  'retirement-readiness': 'Retirement funding gap',
  'tax-advantaged': 'Tax-advantaged account',
  'contribution-limits': 'Annual contribution room',
  brokerage: 'Taxable brokerage investing',
  independence: 'Financial independence',
  estate: 'Estate plan',
};

/** A name for the step that carries no account name and no balance. */
function candidateLabel(candidate: PathCandidate): string {
  if (candidate.kind === 'debt') return DEBT_LABELS[candidate.debt!.debtKind] ?? 'Loan balance';
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
  'insurance-will': 'Get insured and write your will',
  'savings-rate': 'Raise your savings rate',
  'retirement-readiness': 'Raise what you put toward retirement',
  'tax-advantaged': 'Fund a tax-advantaged account',
  'max-contributions': "Max out this year's contribution room",
  'taxable-brokerage': 'Invest what is left in a brokerage account',
  'financial-independence': 'Reach financial independence',
  'estate-legacy': 'Put your estate plan in place',
};

/**
 * What one step of a stored path is, from its key alone.
 *
 * `names` supplies the account or goal a `debt:`/`goal:` key points at. A key
 * whose row is gone falls back to the generic wording rather than dropping the
 * step, because the caller is naming a step that is still on the path.
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
    candidate.kind === 'debt'
      ? candidate.debt!.balance
      : candidate.kind === 'goal'
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

export function buildOrderPayload(candidates: PathCandidate[], ctx: PathContext) {
  return {
    situation: {
      age: ctx.age,
      incomeBand: incomeBand(ctx.annualIncome),
      surplusBand: surplusBand(ctx.monthlySurplus),
      employmentType: ctx.employmentType,
      dependents: ctx.dependentCount,
    },
    candidates: candidates.map((candidate) => ({
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
// Refusing to let it name an account is not only style. The reason is stored and
// rendered verbatim, and an account name it wrote would be one it invented.
const SYSTEM_PROMPT = `You order one person's financial path.

You are given the steps that already apply to this person and the facts about their situation. Decide the sequence. Then, for each step, write the one clause that says why it sits WHERE YOU PUT IT relative to the other steps.

Rules:
- Return EVERY key you were given, exactly once, in the order this person should work through them. Never invent a key, never repeat one, never leave one out.
- Order for THIS person. A goal with a near target date can rightly come before a protective step, and for someone else the protective steps come first. There is no fixed rail.
- The line is about POSITION and nothing else. Say what this step comes before or after, and why that order is right for this person.
- Never describe the step, what it is for, what it involves or what it is worth. The page already says all of that next to your line, so repeating it wastes the reader's time.
- One sentence, written to the person in the second person, opening on the position rather than on the step: "This comes before...", "This waits until...", "Nothing here moves until...", "You can turn to this once...", "Once your other balances are gone...".
- Vary how you open. A reader goes down these one after another, and a page where every line starts the same way reads as a form letter rather than a decision.
- Never name an account, a provider, a product or a goal. Point at the other steps by what they are for: your other balances, the goal you put a date on, the steps that protect you.
- Never state an amount, a balance, a date or a percentage. You were not given those and any you write would be invented.
- You are given no rate, no terms and no cost. Never call a balance high interest or low interest, cheap or expensive, never say what terms it carries, and never say what carrying it costs. The page says plainly when a rate is not on file, and a line of yours guessing at one contradicts it.
- Never justify a position by restating it. "This is second because you do it second" tells the reader nothing they cannot see from the number on the card.
- The path is worked in order, one step at a time. Never say a step runs alongside, in parallel with, or at the same time as another. The card next to your line carries the step's number, so a line hedging the order contradicts it.
- Do not use em dashes, en dashes, middots or semicolons. Write plain sentences.`;

const orderSchema = z.object({
  steps: z.array(
    z.object({
      key: z.string(),
      reason: z.string(),
    }),
  ),
});

/** One ordered step as the model returned it, before validation. */
export interface ProposedStep {
  key: string;
  reason: string;
}

/**
 * Whether this candidate set is worth paying to order.
 *
 * The order varies between two people because of the things they own: a debt
 * account and a dated goal are what push a step ahead of the one that would
 * otherwise come first. A set with neither is nothing but situation steps, each
 * already placed by the precondition that emitted it, and a model asked to
 * order them hands back the sequence it was given. A brand new account is the
 * clearest case: three unconditional steps, one fixed order, and a bill for it.
 */
export function isWorthOrdering(candidates: PathCandidate[]): boolean {
  return candidates.some((c) => c.accountId !== null || c.goalId !== null);
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
): Promise<ProposedStep[] | null> {
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
      // "Goal 1" and a numbered debt all carry a digit.
      { tenantId, aliasMap, descrubOutput: false },
      {
        model: getModel(ORDER_LEVEL),
        schema: orderSchema,
        system: SYSTEM_PROMPT,
        prompt: JSON.stringify(buildOrderPayload(candidates, ctx)),
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

  return result.object.steps ?? null;
}

// ── Validation ───────────────────────────────────────────────────────────────

/** A reason that states a figure is a figure the model decided. Drop it. */
const REASON_HAS_FIGURE = /[\d$%]/;
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
const REASON_CLAIMS_A_RATE =
  /\b(?:high|higher|highest|low|lower|lowest|steep|punishing)[- ](?:interest|rate|apr|cost)|\b(?:expensive|costly|pricey|terms)\b/i;
const REASON_MAX_LENGTH = 220;

/**
 * Whether this line can go on the step's card.
 *
 * A reason is dropped rather than repaired, because the card reads correctly
 * with nothing there. Four things disqualify one: a figure, which would be a
 * figure the model decided, punctuation the product does not write in, a length
 * past one sentence, and a claim about what a balance costs on an account that
 * reports no rate. The last one is the one a user would catch: the card already
 * says twice that the rate is unknown, so a line in between calling the same
 * balance expensive contradicts the two sentences around it.
 */
function reasonIsUsable(reason: string, candidate: PathCandidate): boolean {
  if (reason.length === 0 || reason.length > REASON_MAX_LENGTH) return false;
  if (REASON_HAS_FIGURE.test(reason)) return false;
  if (REASON_HAS_BANNED_PUNCTUATION.test(reason)) return false;
  if (candidate.kind === 'debt' && candidate.debt!.apr === null) {
    return !REASON_CLAIMS_A_RATE.test(reason);
  }
  return true;
}

export interface ValidatedOrder {
  ordered: Array<{ candidate: PathCandidate; reason: string }>;
  source: PathOrderSource;
}

/**
 * Turn what the model said into an order that can be persisted, or fall back.
 *
 * Nothing here trusts the response: a key that is not in the candidate set and
 * a key returned twice are both dropped before anything reaches the database.
 * Candidates the model left out are appended rather than lost, because WHICH
 * steps a person gets is computed and is not the model's to change.
 *
 * A key naming a deleted account or goal needs no separate guard. The candidate
 * set is built from the household as it stands, so a deleted row has no
 * candidate, and any key naming one fails the lookup below like any other key
 * that was never offered. A row deleted after the set was built is fine too:
 * a step stores its candidate key and nothing else, and `applyStoredOrder`
 * drops a stored key with no candidate behind it on the next read.
 */
export function validateOrder(
  proposed: ProposedStep[] | null,
  candidates: PathCandidate[],
): ValidatedOrder {
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const taken = new Set<string>();
  const ordered: ValidatedOrder['ordered'] = [];

  for (const step of proposed ?? []) {
    const candidate = byKey.get(step?.key);
    if (!candidate) continue;
    if (taken.has(candidate.key)) continue;
    taken.add(candidate.key);
    const reason = (step.reason ?? '').trim();
    ordered.push({
      candidate,
      reason: reasonIsUsable(reason, candidate) ? reason : '',
    });
  }

  // Nothing survived, so there is no model order to persist.
  if (ordered.length === 0) {
    return {
      ordered: candidates.map((candidate) => ({ candidate, reason: '' })),
      source: 'deterministic',
    };
  }

  // Mandatory steps first among what was left out, then the rest, each in the
  // deterministic order it was emitted in. WHICH steps a person gets is
  // computed, so a candidate the model skipped is appended rather than lost.
  for (const candidate of candidates) {
    if (candidate.mandatory && !taken.has(candidate.key)) {
      taken.add(candidate.key);
      ordered.push({ candidate, reason: '' });
    }
  }
  for (const candidate of candidates) {
    if (!taken.has(candidate.key)) ordered.push({ candidate, reason: '' });
  }

  return { ordered, source: 'model' };
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
 */
export function pathFingerprint(ctx: PathContext, candidates: PathCandidate[]): string {
  return createHash('sha256')
    .update(JSON.stringify(buildOrderPayload(candidates, ctx)))
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
  /** Keyed by candidate key. A step with no line is simply absent. */
  reasons: Map<string, string>;
  /** When this order was chosen, and what caused it to be. */
  generatedAt: Date;
  reason: PathGenerationReason;
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
  const onPath = stored.steps.filter((s) => s.mark !== 'not_applicable');

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
  // Split before sizing, not after. The waterfall pours the monthly surplus
  // down the steps in order, so a step that is not on the path must not be in
  // the list the waterfall walks, or it would push every date behind it out.
  const notApplicable = ordered.filter((c) => marks.get(c.key)?.mark === 'not_applicable');
  const applicable = ordered.filter((c) => marks.get(c.key)?.mark !== 'not_applicable');
  return {
    steps: sizePath(applicable, ctx, marks),
    notApplicable,
    reasons: new Map(stored.steps.filter((s) => s.reason).map((s) => [s.key, s.reason])),
    generatedAt: stored.generatedAt,
    reason: stored.reason,
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

    const proposed = aliasMap ? await proposeOrder(tenantId, aliasMap, candidates, ctx) : null;
    const { ordered, source } = validateOrder(proposed, candidates);

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
        inputsFingerprint: pathFingerprint(ctx, candidates),
        model: source === 'model' ? getModelSlug(ORDER_LEVEL) : null,
        orderSource: source,
      })
      .returning({ id: financialPaths.id });

    await tx.insert(financialPathSteps).values(
      ordered.map(({ candidate }, index) => {
        const was = carried.get(candidate.key);
        return {
          pathId: path.id,
          tenantId,
          position: index,
          candidateKey: candidate.key,
          reason: reasons.get(candidate.key) ?? '',
          status: was?.mark ?? ('pending' as const),
          note: was?.note ?? '',
          statusAt: was?.markedAt ?? null,
        };
      }),
    );

    return { steps, notApplicable, reasons, generatedAt, reason };
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
