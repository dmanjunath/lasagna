import { createHash } from 'node:crypto';
import {
  and,
  asc,
  eq,
  financialPathSteps,
  financialPaths,
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

/** What a generation was for. Only one cause exists while nothing regenerates. */
export type PathGenerationReason = 'no_active_path';

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
 * A digest of the figures the sizing pass ran on. Stored so a later slice can
 * tell a path built on this household from one built on an older version of it.
 */
function fingerprintInputs(ctx: PathContext, candidates: PathCandidate[]): string {
  const subject = {
    keys: candidates.map((c) => c.key),
    age: ctx.age,
    annualIncome: Math.round(ctx.annualIncome),
    monthlySurplus: ctx.monthlySurplus === null ? null : Math.round(ctx.monthlySurplus),
    stableMonthlyExpenses:
      ctx.stableMonthlyExpenses === null ? null : Math.round(ctx.stableMonthlyExpenses),
    cashTotal: Math.round(ctx.cashTotal),
    invested: Math.round(
      ctx.hsaBalance + ctx.rothIraBalance + ctx.trad401kBalance + ctx.brokerageBalance,
    ),
    employmentType: ctx.employmentType,
    dependentCount: ctx.dependentCount,
    debts: ctx.debtAccounts.map((a) => [a.id, Math.round(a.balance), a.apr]),
    goals: ctx.goals.map((g) => [
      g.id,
      Math.round(g.targetAmount),
      g.deadline ? g.deadline.toISOString().slice(0, 10) : null,
    ]),
  };
  return createHash('sha256').update(JSON.stringify(subject)).digest('hex');
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * One stored step: the candidate it names, and why the model put it there.
 *
 * Nothing else is stored. Every figure a step shows is recomputed on read
 * because balances move and a finished step can reopen, so a stored target or
 * date would only be a snapshot of a household that has since changed.
 */
export interface StoredStep {
  key: string;
  /** The model's placement line, or empty when the order was deterministic. */
  reason: string;
}

/** A path as the page consumes it: sized steps, plus the line behind each one. */
export interface PathOrder {
  steps: SizedStep[];
  /** Keyed by candidate key. A step with no line is simply absent. */
  reasons: Map<string, string>;
}

/** This tenant's stored order. Null when they have no path. */
export async function readActivePath(
  tenantId: string,
  reader: Pick<typeof db, 'query'> = db,
): Promise<StoredStep[] | null> {
  const path = await reader.query.financialPaths.findFirst({
    where: and(eq(financialPaths.tenantId, tenantId), eq(financialPaths.status, 'active')),
  });
  if (!path) return null;
  const rows = await reader.query.financialPathSteps.findMany({
    where: eq(financialPathSteps.pathId, path.id),
    orderBy: [asc(financialPathSteps.position)],
  });
  return rows.map((r) => ({ key: r.candidateKey, reason: r.reason }));
}

/** Today's candidates in the stored order, sized, with the stored lines. */
export function storedPath(
  candidates: PathCandidate[],
  ctx: PathContext,
  stored: StoredStep[],
): PathOrder {
  return {
    steps: sizePath(applyStoredOrder(candidates, stored.map((s) => s.key)), ctx),
    reasons: new Map(stored.filter((s) => s.reason).map((s) => [s.key, s.reason])),
  };
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
): Promise<PathOrder> {
  // Built before the lock, not during it. `lib/llm.ts` otherwise builds this
  // map partway through the ordering call, which would mean reaching into the
  // connection pool while already holding one of its connections open for the
  // length of that call. Enough simultaneous generations doing that would wait
  // on a pool they are themselves holding. Inside the transaction, nothing
  // touches the pool but the transaction.
  const aliasMap = isWorthOrdering(candidates) ? await buildAliasMap(tenantId) : null;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${LOCK_NAMESPACE}, ${tenantLockKey(tenantId)})`,
    );

    // Read inside the lock. A request that queued ahead of this one has already
    // generated and paid, and its order is the tenant's path, not ours.
    const already = await readActivePath(tenantId, tx);
    if (already) return storedPath(candidates, ctx, already);

    const proposed = aliasMap ? await proposeOrder(tenantId, aliasMap, candidates, ctx) : null;
    const { ordered, source } = validateOrder(proposed, candidates);

    const steps = sizePath(
      ordered.map((o) => o.candidate),
      ctx,
    );
    const reasons = new Map(ordered.filter((o) => o.reason).map((o) => [o.candidate.key, o.reason]));

    const [path] = await tx
      .insert(financialPaths)
      .values({
        tenantId,
        reason,
        inputsFingerprint: fingerprintInputs(ctx, candidates),
        model: source === 'model' ? getModelSlug(ORDER_LEVEL) : null,
        orderSource: source,
      })
      .returning({ id: financialPaths.id });

    await tx.insert(financialPathSteps).values(
      steps.map((step, index) => ({
        pathId: path.id,
        tenantId,
        position: index,
        candidateKey: step.key,
        reason: reasons.get(step.key) ?? '',
      })),
    );

    return { steps, reasons };
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
