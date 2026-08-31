import { describe, it, expect, vi, beforeEach } from 'vitest';

// The generator's only side effects are the model call, the usage log and the
// two inserts. Mock the model + telemetry, and stand a recording fake in for
// the database so what DOES and does not reach it can be asserted directly.
const generateObject = vi.fn();
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
vi.mock('../activity.js', () => ({ logLlmUsage: vi.fn(), actualLlmCostUsd: () => undefined }));
vi.mock('../../agent/index.js', () => ({
  getModel: () => ({}) as never,
  getModelSlug: () => 'anthropic/claude-sonnet-4.5',
}));
// lib/llm.ts builds the tenant alias map before every call, which is a DB read.
// Identity stubs keep the payload readable and the database out of it, and the
// descrub stub is a spy because the ordering call must opt OUT of descrubbing.
const descrubObject = vi.fn((x: unknown) => x);
vi.mock('../pii-scrubber.js', () => ({
  buildAliasMap: async () => ({ forward: new Map(), reverse: new Map() }),
  scrub: (x: unknown) => x,
  descrub: (x: unknown) => x,
  descrubObject: (x: unknown) => descrubObject(x),
}));

// A standing-in database, small enough to assert against directly and honest
// about the two things this module leans on Postgres for: `pg_advisory_xact_lock`
// serialises everything holding the same key, and a transaction's writes are
// there for whoever comes next. Both are what stop a second first-read paying
// for an ordering call the first one already made.
interface Recorded {
  paths: Record<string, unknown>[];
  steps: Record<string, unknown>[];
}
const recorded: Recorded = { paths: [], steps: [] };
let activePath: { id: string; orderSource: string } | null = null;
let activeSteps: Array<{
  candidateKey: string;
  reason: string;
  status?: string;
  note?: string;
  statusAt?: Date | null;
}> = [];

/** Set to fail the write, so the reservation has to roll back with it. */
let insertFails = false;

/** Every `pg_advisory_xact_lock` argument list the module asked for. */
const lockCalls: string[] = [];
const lockQueue = new Map<string, Promise<void>>();

/** FIFO, and held until the caller releases it, exactly as the real lock is. */
async function takeLock(key: string): Promise<() => void> {
  const ahead = lockQueue.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  lockQueue.set(key, ahead.then(() => mine));
  await ahead;
  return release;
}

function insertInto(_table: unknown) {
  return {
    values(rows: Record<string, unknown> | Record<string, unknown>[]) {
      if (insertFails) throw new Error('insert failed');
      const list = Array.isArray(rows) ? rows : [rows];
      // Step rows are the only ones carrying a candidate key.
      const isStepRow = list.length > 0 && 'candidateKey' in list[0];
      let returned: Record<string, unknown>[] = [];
      if (isStepRow) {
        recorded.steps.push(...list);
        activeSteps = recorded.steps.map((r) => ({
          candidateKey: String(r.candidateKey),
          reason: String(r.reason ?? ''),
          status: String(r.status),
          note: String(r.note ?? ''),
          statusAt: (r.statusAt as Date | null) ?? null,
        }));
      } else {
        recorded.paths.push(...list);
        returned = [{ id: 'path-1' }];
        activePath = { id: 'path-1', orderSource: String(list[0].orderSource) };
      }
      const chain = {
        returning: () => Promise.resolve(returned),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(returned).then(res, rej),
      };
      return chain;
    },
  };
}

/** A declaration, not a const: `vi.mock`'s factory is hoisted above both. */
function makeQuery() {
  return {
    financialPaths: { findFirst: async () => activePath },
    financialPathSteps: { findMany: async () => activeSteps },
    // Nobody here came from the older bookkeeping. What happens when they did
    // is driven end to end in the regeneration suite.
    financialProfiles: { findFirst: async () => undefined },
  };
}

async function transaction(fn: (tx: unknown) => unknown) {
  const held: { release: (() => void) | null } = { release: null };
  const tx = {
    insert: insertInto,
    // Superseding the row this generation replaces. Nothing here reads the old
    // row again, so retiring it is a no-op the module still has to be able to
    // perform.
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    query: makeQuery(),
    execute: async (statement: unknown) => {
      const { sql: text, params } = new PgDialect().sqlToQuery(statement as never);
      expect(text).toContain('pg_advisory_xact_lock');
      const key = params.join(':');
      lockCalls.push(key);
      held.release = await takeLock(key);
    },
  };
  try {
    return await fn(tx);
  } finally {
    // The real lock goes at commit or at rollback, never before.
    held.release?.();
  }
}

vi.mock('../db.js', () => ({
  db: { insert: insertInto, transaction, query: makeQuery() },
}));

import { PgDialect } from '@lasagna/core';
import { buildPathContextDefaults, type PathContext } from '../path-context.js';
import { CONTRIBUTION_TAX_YEAR, buildPathCandidates, type PathCandidate } from '../path-candidates.js';
import type { DebtAccount } from '../debt-accounts.js';
import {
  applyStoredOrder,
  buildOrderPayload,
  generatePath,
  isLiveStepKey,
  stepLabelForKey,
  storedPath,
  validateOrder,
  type ProposedStep,
  type StoredPath,
} from '../path-generator.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CARD_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const DELETED_GOAL_ID = '33333333-3333-4333-8333-333333333333';

function debt(overrides: Partial<DebtAccount> & { id: string; name: string }): DebtAccount {
  return {
    mask: null,
    type: 'credit',
    subtype: null,
    balance: 8_000,
    apr: 22,
    minimumPayment: 200,
    minimumPaymentEstimated: false,
    minimumPaymentAssumedApr: null,
    termMonths: null,
    originationDate: null,
    payoffDate: null,
    propertyAccountId: null,
    liabilitySource: null,
    liabilityLastSyncedAt: null,
    lastUpdated: null,
    ...overrides,
  };
}

/** A 24 year old with a card, a dated house deposit and money left each month. */
function firstBuyer(): PathContext {
  return buildPathContextDefaults({
    age: 24,
    // Answered, so these fixtures are about ordering rather than about the
    // term-life step an unanswered dependants question puts on the path.
    dependentCount: 0,
    annualIncome: 72_000,
    monthlyIncome: 72_000 / 12,
    stableMonthlyExpenses: 3_400,
    monthlySurplus: 72_000 / 12 - 3_400,
    savingsRate: 43,
    employmentType: 'w2',
    cashTotal: 2_500,
    debtAccounts: [debt({ id: CARD_ID, name: 'Rewards card' })],
    goals: [
      {
        id: GOAL_ID,
        name: 'First home',
        category: 'home_purchase',
        targetAmount: 60_000,
        currentAmount: 4_000,
        deadline: new Date('2030-06-01T00:00:00Z'),
        details: null,
      },
    ],
  });
}

function modelReturns(steps: ProposedStep[], leftOut: ProposedStep[] = []) {
  generateObject.mockResolvedValue({
    object: { steps, leftOut },
    usage: { inputTokens: 400, outputTokens: 200 },
  });
}

/** The whole candidate set placed, which is what most of these tests want. */
function modelPlacesAll(candidates: PathCandidate[], reason = 'Placed.') {
  modelReturns(candidates.map((c) => ({ key: c.key, reason })));
}

const keysOf = (candidates: PathCandidate[]) => candidates.map((c) => c.key);

beforeEach(() => {
  generateObject.mockReset();
  recorded.paths = [];
  recorded.steps = [];
  activePath = null;
  activeSteps = [];
  insertFails = false;
  descrubObject.mockClear();
  lockCalls.length = 0;
  lockQueue.clear();
});

// ── Naming a step from its key alone ─────────────────────────────────────────

describe('a stored step, named from its key', () => {
  it('has a name for every key the candidate set can emit', () => {
    const ctx = firstBuyer();
    const names = new Map([
      [CARD_ID, 'Rewards card'],
      [GOAL_ID, 'First home'],
    ]);
    for (const candidate of buildPathCandidates(ctx)) {
      const label = stepLabelForKey(candidate.key, names);
      // Falling back to the key itself is the failure this guards: a step added
      // to the candidate set and not named here would reach a model, and a
      // reader, as `max-contributions`.
      expect(label).not.toBe(candidate.key);
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it('names the account or goal a key points at, and carries no figure', () => {
    const names = new Map([[CARD_ID, 'Rewards card']]);
    expect(stepLabelForKey(`debt:${CARD_ID}`, names)).toBe('Pay off Rewards card');
    // A row that is gone still leaves a step on the path, so it is still named.
    expect(stepLabelForKey(`debt:${DELETED_GOAL_ID}`, names)).toBe('Pay off a balance you owe');
    expect(stepLabelForKey(`goal:${DELETED_GOAL_ID}`, names)).toBe('A savings goal');
    for (const candidate of buildPathCandidates(firstBuyer())) {
      expect(stepLabelForKey(candidate.key, names)).not.toMatch(/[\d$%]/);
    }
  });

  it('names the room step for the year the step itself names', () => {
    // The label feeds the actions engine, which puts it in front of the model
    // as this step's title. Saying "this year's" beside a card headed with a
    // tax year is two labels for one deadline, and they disagree the moment the
    // constant and the calendar do.
    expect(stepLabelForKey('max-contributions', new Map()))
      .toBe(`Max out your ${CONTRIBUTION_TAX_YEAR} contribution room`);
  });

  it('knows a retired key from a live one, so no reader has to print the key', () => {
    // `insurance-will` split into two steps, `estate-legacy` folded into the
    // will and `retirement-readiness` merged into the amount step. Rows against
    // them are still stored, because a mark on a retired key expires with the
    // step rather than being moved onto a step it may not have meant.
    for (const retired of ['insurance-will', 'estate-legacy', 'retirement-readiness']) {
      expect(isLiveStepKey(retired)).toBe(false);
    }
    for (const candidate of buildPathCandidates(firstBuyer())) {
      expect(isLiveStepKey(candidate.key)).toBe(true);
    }
    expect(isLiveStepKey(`debt:${CARD_ID}`)).toBe(true);
    expect(isLiveStepKey(`goal:${GOAL_ID}`)).toBe(true);
  });
});

// ── What the model is shown ──────────────────────────────────────────────────

describe('the ordering payload', () => {
  it('carries no account name, no goal name and no exact balance', () => {
    const ctx = firstBuyer();
    const payload = JSON.stringify(buildOrderPayload(buildPathCandidates(ctx), ctx, null));

    expect(payload).not.toContain('Rewards card');
    expect(payload).not.toContain('First home');
    expect(payload).not.toContain('8000');
    expect(payload).not.toContain('72000');
    // The surplus is $2,600 a month. A band is all an ordering decision needs.
    expect(payload).not.toContain('2600');
    // What it does carry: the kind, a relative size, and the goal's date.
    expect(payload).toContain('"size":"large"');
    expect(payload).toContain('"targetDate":"2030-06"');
    expect(payload).toContain('"incomeBand":"$50k to $75k"');
    expect(payload).toContain('"surplusBand":"$1.5k to $4k a month"');
  });

  it('says a dependants count is not on file rather than sending a bare null', () => {
    // Read as zero, the model wrote "You have no dependents relying on your
    // income" onto a live path as the reason the cover step was left off it.
    // Nobody ever told us that.
    const unanswered = { ...firstBuyer(), dependentCount: null };
    const payload = buildOrderPayload(buildPathCandidates(unanswered), unanswered, null);
    expect(payload.situation.dependents).toBe('not on file');
    expect(buildOrderPayload(buildPathCandidates(firstBuyer()), firstBuyer(), null).situation.dependents)
      .toBe(0);
  });

  it('carries no balance at all, in any form, because their order is not asked for', () => {
    // Debt sits at the position its own APR band puts it in, and the model is
    // not consulted about it. Nothing in what leaves the boundary may suggest
    // otherwise: no key it could place, no label it could name, no size it
    // could weigh one balance against another with.
    const ctx = firstBuyer();
    const payload = buildOrderPayload(buildPathCandidates(ctx), ctx, null);
    const debts = buildPathCandidates(ctx).filter((c) => c.kind === 'debt');

    expect(debts.length).toBeGreaterThan(0);
    expect(payload.candidates.map((c) => c.key)).not.toContain(debts[0].key);
    expect(payload.candidates.some((c) => c.kind === 'debt')).toBe(false);
    expect(JSON.stringify(payload)).not.toContain('Credit card balance');
  });

  it('bands what the household holds, and never states the balance itself', () => {
    // The three facts an inclusion decision turns on that the payload could not
    // say before. Each one is banded or a flag, so the boundary carries no
    // figure it did not carry already.
    const ctx = firstBuyer();
    ctx.cashTotal = 21_450;
    ctx.trad401kBalance = 412_800;
    ctx.propertyValue = 640_000;
    const readiness = {
      successRate: 61,
      targetSuccess: 80,
      verdict: 'at_risk' as const,
      currentAge: 24,
      retirementAge: 65,
      currentMonthlySavings: 900,
      requiredMonthlySavings: 1_800,
      requiredSuccessRate: 84,
      medianByAge: Array.from({ length: 42 }, (_, i) => Math.round(412_800 * 1.06 ** i)),
      simRuns: 0,
    };
    const payload = JSON.stringify(buildOrderPayload(buildPathCandidates(ctx), ctx, readiness));

    expect(payload).toContain('"transferableAssets":"over $1m"');
    expect(payload).toContain('"ownsProperty":true');
    expect(payload).toContain('"retirementOutlook":"at_risk"');
    // Not one of the figures the band was computed from.
    for (const figure of ['21450', '412800', '640000', '1074250', '61', '1800']) {
      expect(payload).not.toContain(figure);
    }
  });

  it('says the outlook is not on file rather than guessing when no simulation ran', () => {
    const ctx = firstBuyer();
    const payload = JSON.stringify(buildOrderPayload(buildPathCandidates(ctx), ctx, null));
    expect(payload).toContain('"retirementOutlook":"not on file"');
    expect(payload).toContain('"transferableAssets":"under $25k"');
    expect(payload).toContain('"ownsProperty":false');
  });

  it('lists the steps in an order that suggests nothing, so the sequence comes from the model', () => {
    const ctx = firstBuyer();
    const keys = buildOrderPayload(buildPathCandidates(ctx), ctx, null).candidates.map((c) => c.key);

    // Ascending by key: arbitrary with respect to what any step is FOR. The
    // emitted order is the tier order, and it is a worked-out sequence, so
    // handing it over as the list itself is handing over an answer.
    expect(keys).toEqual([...keys].sort());
    expect(keys).not.toEqual(buildPathCandidates(ctx).map((c) => c.key));
    // The tell: whatever the last tier emits used to be last in every payload
    // ever built, and the independence step is that tier.
    expect(keys.indexOf('financial-independence')).toBeGreaterThan(-1);
    expect(keys.indexOf('financial-independence')).toBeLessThan(keys.length - 1);
  });

  it('is byte-identical across two builds of the same household', () => {
    // The fingerprint is a hash of this payload and is compared on every read.
    // An order that varied per call would move the hash every time and
    // regenerate the path forever, so neutral has to mean stable, not random.
    const ctx = firstBuyer();
    const first = JSON.stringify(buildOrderPayload(buildPathCandidates(ctx), ctx, null));
    const second = JSON.stringify(buildOrderPayload(buildPathCandidates(ctx), ctx, null));
    expect(first).toBe(second);
  });
});

// ── Validation ───────────────────────────────────────────────────────────────

describe('validation rejects what the model made up', () => {
  it('drops a fabricated key, a duplicate key, and a goal id since deleted', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    const { ordered, leftOut, source } = validateOrder(
      { steps: [
        { key: 'emergency-fund', reason: 'This is the buffer everything else rests on.' },
        { key: 'pay-off-the-yacht', reason: 'Invented.' },
        { key: 'emergency-fund', reason: 'Said twice.' },
        // A goal deleted since the candidate set was built has no candidate, so
        // its key is as unknown here as one that was never offered.
        { key: `goal:${DELETED_GOAL_ID}`, reason: 'A goal that is gone.' },
      ], leftOut: [] },
      candidates,
    );

    const placed = ordered.map((o) => o.candidate.key);
    expect(source).toBe('model');
    expect(placed).not.toContain('pay-off-the-yacht');
    expect(placed).not.toContain(`goal:${DELETED_GOAL_ID}`);
    expect(placed.filter((k) => k === 'emergency-fund')).toHaveLength(1);
    // The one step it placed, plus the balance whose position was never its to
    // choose. Every other candidate is off the path rather than gone.
    expect(placed).toEqual(['emergency-fund', `debt:${CARD_ID}`]);
    expect(new Set([...placed, ...leftOut.map((o) => o.candidate.key)])).toEqual(
      new Set(keysOf(candidates)),
    );
  });

  it('puts a step the person kept back at its own position, not on the end', () => {
    // A step somebody has answered for cannot be left out again. It has no
    // placement line, so there is no position of the model's choosing to
    // honour, and it used to be appended behind everything else, which is the
    // position least likely to be right for a step they explicitly asked to
    // keep. Its deterministic slot is a worked-out answer.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    const rail = keysOf(candidates);
    expect(rail.indexOf('stabilize')).toBe(0);

    const { ordered } = validateOrder(
      {
        steps: candidates
          .filter((c) => c.kind !== 'debt' && c.key !== 'stabilize')
          .map((c) => ({ key: c.key, reason: `Placed ${c.key}.` })),
        leftOut: [{ key: 'stabilize', reason: 'You already hold more than a first buffer.' }],
      },
      candidates,
      new Set(['stabilize']),
    );

    const placed = ordered.map((o) => o.candidate.key);
    expect(placed).toContain('stabilize');
    expect(placed[placed.length - 1]).not.toBe('stabilize');
    expect(placed.indexOf('stabilize')).toBe(0);
  });

  it('keeps every balance in the sequence, whatever the model returned', () => {
    // Payoff order is computed from each account's own APR band, so a balance
    // is not a candidate the model can decline. It cannot be left out by a
    // response that omits it, because it was never offered in the first place.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    for (const proposed of [
      null,
      { steps: [{ key: 'emergency-fund', reason: 'Placed.' }], leftOut: [] },
      {
        steps: [{ key: 'emergency-fund', reason: 'Placed.' }],
        leftOut: [{ key: `debt:${CARD_ID}`, reason: 'Not worth your attention.' }],
      },
    ]) {
      const { ordered, leftOut } = validateOrder(proposed, candidates);
      expect(ordered.map((o) => o.candidate.key)).toContain(`debt:${CARD_ID}`);
      expect(leftOut.map((o) => o.candidate.key)).not.toContain(`debt:${CARD_ID}`);
    }
  });

  it('threads the model order through the positions the balances hold', () => {
    // The deterministic rail puts a 22% card above the emergency fund and below
    // the starter buffer. The model reverses the two steps around it, and the
    // card keeps its slot between them.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    const rail = keysOf(candidates);
    expect(rail.slice(0, 3)).toEqual(['stabilize', `debt:${CARD_ID}`, 'emergency-fund']);

    const { ordered } = validateOrder(
      {
        steps: [
          { key: 'emergency-fund', reason: 'This comes first for you.' },
          { key: 'stabilize', reason: 'You can turn to this after the reserve.' },
        ],
        leftOut: candidates
          .filter((c) => c.kind !== 'debt' && c.key !== 'stabilize' && c.key !== 'emergency-fund')
          .map((c) => ({ key: c.key, reason: `Set aside because of ${c.key}.` })),
      },
      candidates,
    );

    expect(ordered.map((o) => o.candidate.key)).toEqual([
      'emergency-fund',
      `debt:${CARD_ID}`,
      'stabilize',
    ]);
  });

  it('leaves a candidate out when that is what the model said, and says why', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    // Even the first buffer, which every household is offered. Which steps a
    // person gets is the model's call, and the only guarantee is that nothing
    // disappears.
    expect(candidates.map((c) => c.key)).toContain('stabilize');

    const { ordered, leftOut } = validateOrder(
      {
        steps: candidates
          .filter((c) => c.key !== 'stabilize')
          .map((c) => ({ key: c.key, reason: 'Placed.' })),
        leftOut: [
          { key: 'stabilize', reason: 'You already keep more than a first buffer in cash.' },
        ],
      },
      candidates,
    );

    expect(ordered.map((o) => o.candidate.key)).not.toContain('stabilize');
    expect(leftOut).toEqual([
      {
        candidate: candidates.find((c) => c.key === 'stabilize'),
        reason: 'You already keep more than a first buffer in cash.',
      },
    ]);
  });

  it('lists a candidate the model mentioned in neither list, rather than losing it', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered, leftOut } = validateOrder(
      {
        steps: candidates
          .filter((c) => c.kind !== 'debt' && c.key !== 'financial-independence')
          .map((c) => ({ key: c.key, reason: `Placed ${c.key}.` })),
        leftOut: [],
      },
      candidates,
    );

    // A short answer is not a decision to drop a step. It is off the sequence
    // the model chose, so it is off the path, and it is on the page with
    // nothing said about it.
    expect(ordered.map((o) => o.candidate.key)).not.toContain('financial-independence');
    expect(leftOut.map((o) => o.candidate.key)).toEqual(['financial-independence']);
    expect(leftOut[0].reason).toBe('');
  });

  it('falls back to the deterministic order when nothing the model said is usable', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered, leftOut, source } = validateOrder(
      { steps: [{ key: 'nonsense', reason: 'x' }, { key: 'also-nonsense', reason: 'y' }], leftOut: [] },
      candidates,
    );

    expect(source).toBe('deterministic');
    expect(ordered.map((o) => o.candidate.key)).toEqual(keysOf(candidates));
    // A response nobody could read is not a judgement that a step should go.
    expect(leftOut).toEqual([]);
  });

  it('drops a reason stating a figure nobody sent, because that figure is the model\'s', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: 'Put $1,000 aside before anything else.' },
        { key: 'emergency-fund', reason: 'A deeper buffer comes next, once the first one is there.' },
      ], leftOut: [] },
      candidates,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get('stabilize')).toBe('');
    expect(byKey.get('emergency-fund')).toBe(
      'A deeper buffer comes next, once the first one is there.',
    );
  });

  it('drops a figure nobody sent even when it is spelled out', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    // Digits are not what makes a figure invented, and a guard that only read
    // them let these two through to the page verbatim.
    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: 'Put a thousand dollars aside before anything else.' },
        { key: 'emergency-fund', reason: 'This waits until you are putting over four thousand a month aside.' },
      ], leftOut: [] },
      candidates,
    );

    for (const placed of ordered) expect(placed.reason).toBe('');
  });

  it('drops a reason stating a band, because the band it was true of moves', () => {
    // This used to be allowed, on the ground that a band the payload had just
    // handed over is the household's own figure read back correctly. The band
    // was the one at GENERATION time and the line is stored and rendered on
    // every read after that, so a surplus that later falls leaves the sentence
    // asserting a figure that is no longer true of the person reading it, and
    // nothing revalidates a stored path on a read. A line that can go stale is
    // not stored at all.
    const ctx = firstBuyer();
    ctx.monthlySurplus = 4_600;
    const candidates = buildPathCandidates(ctx);
    const payload = JSON.stringify(buildOrderPayload(candidates, ctx, null));
    expect(payload).toContain('over $4k a month');

    const { leftOut } = validateOrder(
      {
        steps: candidates
          .filter((c) => c.key !== 'savings-rate')
          .map((c) => ({ key: c.key, reason: `Placed ${c.key}.` })),
        leftOut: [
          {
            key: 'savings-rate',
            reason:
              'You are already putting over $4k a month aside, so a step that asks you to find surplus does not apply.',
          },
        ],
      },
      candidates,
    );

    expect(new Map(leftOut.map((o) => [o.candidate.key, o.reason])).get('savings-rate')).toBe('');
  });

  it('drops a figure spelled out in words as readily as one in digits', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: 'You can turn to this once you have a few thousand spare.' },
        { key: 'emergency-fund', reason: 'This waits until the first reserve is behind you.' },
      ], leftOut: [] },
      candidates,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get('stabilize')).toBe('');
    expect(byKey.get('emergency-fund')).toBe('This waits until the first reserve is behind you.');
  });

  it('drops a line about what borrowing costs, on any step, whatever is on file', () => {
    // The guard used to fire on an account reporting no rate, which is a fact
    // about our data rather than about what the model was told. It is told no
    // rate for anything, ever, so a 2.5% mortgage could be called high interest
    // purely because that account happened to have a rate stored against it.
    // The invariant holds for every line, so the guard runs on every line.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: 'This comes before your high-interest balances.' },
        { key: 'emergency-fund', reason: 'You reach this once the expensive borrowing is gone.' },
        {
          key: 'tax-advantaged',
          reason: 'This waits because that debt typically carries terms that reward earlier attention.',
        },
        { key: 'will-trust', reason: 'This sits after the steps that build your reserve.' },
      ], leftOut: [] },
      candidates,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get('stabilize')).toBe('');
    expect(byKey.get('emergency-fund')).toBe('');
    expect(byKey.get('tax-advantaged')).toBe('');
    expect(byKey.get('will-trust')).toBe('This sits after the steps that build your reserve.');
  });

  it('keeps a line using "terms" in its ordinary sense', () => {
    // The guard is about claims on what BORROWING costs. Matching the bare word
    // dropped a line that made no claim about a rate at all.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: 'You can finish this one on your own terms, once it is funded.' },
        { key: 'emergency-fund', reason: 'That balance carries terms that reward earlier attention.' },
      ], leftOut: [] },
      candidates,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get('stabilize')).toBe('You can finish this one on your own terms, once it is funded.');
    expect(byKey.get('emergency-fund')).toBe('');
  });

  it('writes the same sentence once, and leaves the repeats blank', () => {
    // Three balances came back with a byte-identical line between them, and the
    // reader went down the list reading the same excuse three times.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    const repeated = 'You set this aside because the work above it comes first.';

    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: repeated },
        { key: 'emergency-fund', reason: repeated },
        { key: 'will-trust', reason: repeated },
      ], leftOut: [] },
      candidates,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get('stabilize')).toBe(repeated);
    expect(byKey.get('emergency-fund')).toBe('');
    expect(byKey.get('will-trust')).toBe('');
  });

  it('drops a reason written in punctuation the product does not use', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: 'This comes first \u2014 everything else rests on it.' },
        { key: 'emergency-fund', reason: 'A buffer first; the rest can wait.' },
        { key: 'will-trust', reason: 'Where what you own goes should be your decision, not a court\'s.' },
      ], leftOut: [] },
      candidates,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get('stabilize')).toBe('');
    expect(byKey.get('emergency-fund')).toBe('');
    expect(byKey.get('will-trust')).toBe('Where what you own goes should be your decision, not a court\'s.');
  });

  it('drops a reason claiming an absolute place, because balances are woven in around it', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    // Verbatim off a live path: step 10 of 14, with four debt steps under it.
    // The model orders the list it was given, balances are held out of that
    // list entirely, and they are woven back in at the positions their own
    // rates put them in. So nothing it was shown tells it where the path ends.
    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: 'This comes last because you open it once contribution limits are reached.' },
        { key: 'emergency-fund', reason: 'Once the protective steps are settled, this is first.' },
        { key: 'will-trust', reason: 'This waits until the buffer above it is built.' },
      ], leftOut: [] },
      candidates,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get('stabilize')).toBe('');
    expect(byKey.get('emergency-fund')).toBe('');
    // A RELATIVE claim survives, because whatever ends up above a step is
    // still above it however the balances land.
    expect(byKey.get('will-trust')).toBe('This waits until the buffer above it is built.');
  });

  it('keeps a balance that beats the market above the steps that only compound', () => {
    // A Roth balance so a brokerage step is emitted too, which makes this two
    // compounding steps rather than one.
    const ctx = { ...firstBuyer(), rothIraBalance: 40_000 };
    const candidates = buildPathCandidates(ctx);

    // The model never sees the card, so it can hand back an order that opens
    // on the compounding steps, and the weave holds each balance's INDEX
    // rather than its rank. A 22% card then landed below independence and the
    // brokerage step, next to its own copy saying money put there beats money
    // invested with none of the uncertainty.
    const compounding = ['financial-independence', 'taxable-brokerage'];
    const rest = candidates
      .filter((c) => c.kind !== 'debt' && !compounding.includes(c.key))
      .map((c) => c.key);
    const { ordered } = validateOrder(
      {
        steps: [...compounding, ...rest].map((key) => ({ key, reason: '' })),
        leftOut: [],
      },
      candidates,
    );

    const at = (key: string) => ordered.findIndex((o) => o.candidate.key === key);
    expect(at(`debt:${CARD_ID}`)).toBeGreaterThanOrEqual(0);
    expect(at('financial-independence')).toBeGreaterThan(at(`debt:${CARD_ID}`));
    expect(at('taxable-brokerage')).toBeGreaterThan(at(`debt:${CARD_ID}`));
    // Nothing else is disturbed: every candidate is still on the path once.
    expect(new Set(ordered.map((o) => o.candidate.key)).size).toBe(ordered.length);
  });

  it('holds the amount step above the retirement outcomes, whichever order came back', () => {
    // The rate is the LEVER and independence is the READING. Ordered the other
    // way the page tells somebody to put more away after telling them the
    // outcome that money acts through has already been reached, at which point
    // the instruction has nothing left to change.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    expect(keysOf(candidates)).toContain('savings-rate');
    expect(keysOf(candidates)).toContain('financial-independence');

    // Independence first, the amount step dead last: an order the model is free
    // to return, because nothing it was shown says these two are a pair.
    const middle = candidates
      .filter((c) => c.kind !== 'debt' && !['financial-independence', 'savings-rate'].includes(c.key))
      .map((c) => c.key);
    const { ordered } = validateOrder(
      {
        steps: ['financial-independence', ...middle, 'savings-rate'].map((key) => ({ key, reason: '' })),
        leftOut: [],
      },
      candidates,
    );

    const at = (key: string) => ordered.findIndex((o) => o.candidate.key === key);
    expect(at('savings-rate')).toBeLessThan(at('financial-independence'));
    // Everything either side keeps the order the model chose, and nothing is
    // lost or doubled moving one step.
    expect(new Set(ordered.map((o) => o.candidate.key)).size).toBe(ordered.length);
    expect(ordered.length).toBe(candidates.length);
    expect(at(middle[0])).toBeGreaterThan(at('financial-independence'));
  });
});

// ── The guard runs on the way out of storage too ─────────────────────────────

describe('a stored placement line is checked again every time it is read', () => {
  const storedWith = (steps: Array<{ key: string; reason: string }>): StoredPath => ({
    id: 'path-1',
    generatedAt: new Date('2026-08-01T00:00:00Z'),
    reason: 'no_active_path',
    inputsFingerprint: 'fp',
    pendingReason: null,
    orderSource: 'model',
    steps: steps.map((s) => ({ ...s, mark: 'pending' as const, note: '', markedAt: null })),
  });

  it('drops a line the guard has since learned to catch, without regenerating', () => {
    // A path is not regenerated on a read, and nothing else heals a stored row,
    // so a line that only became catchable when the guard was tightened would
    // otherwise sit on the page until something unrelated moved the
    // fingerprint. Every one of these passed the guard the day it was written.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    const { reasons } = storedPath(
      candidates,
      ctx,
      storedWith([
        { key: 'stabilize', reason: 'This one carries the highest interest of anything you hold.' },
        { key: 'emergency-fund', reason: 'This comes last once everything above it is settled.' },
        { key: 'savings-rate', reason: 'You keep $2,600 a month, which is what pays for the rest.' },
        { key: 'will-trust', reason: 'This waits until the buffer above it is built.' },
      ]),
    );

    expect(reasons.get('stabilize')).toBeUndefined();
    expect(reasons.get('emergency-fund')).toBeUndefined();
    expect(reasons.get('savings-rate')).toBeUndefined();
    // A line that is still true is still shown. The heal costs a good path
    // nothing.
    expect(reasons.get('will-trust')).toBe('This waits until the buffer above it is built.');
  });
});

// ── What gets stored ─────────────────────────────────────────────────────────

describe('generatePath', () => {
  it('stores only keys from the candidate set, and never one the model made up', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    modelReturns([
      { key: `goal:${GOAL_ID}`, reason: 'Your deposit has a date on it, so it sets the pace.' },
      { key: 'pay-off-the-yacht', reason: 'Invented.' },
      { key: `goal:${GOAL_ID}`, reason: 'Said twice.' },
      { key: 'stabilize', reason: 'A first buffer keeps a surprise bill off the card.' },
    ]);

    const { steps } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    expect(recorded.paths).toHaveLength(1);
    expect(recorded.paths[0]).toMatchObject({
      orderSource: 'model',
      model: 'anthropic/claude-sonnet-4.5',
      reason: 'no_active_path',
    });
    const storedKeys = recorded.steps.map((s) => s.candidateKey);
    expect(storedKeys).not.toContain('pay-off-the-yacht');
    expect(storedKeys.filter((k) => k === `goal:${GOAL_ID}`)).toHaveLength(1);
    expect(new Set(storedKeys)).toEqual(new Set(keysOf(candidates)));
    // The model's order leads, and sizing ran over that order. The balance
    // holds the slot its APR band gives it, second on the rail, and the two
    // steps the model placed fill the slots either side of it.
    expect(steps[0].key).toBe(`goal:${GOAL_ID}`);
    expect(storedKeys.slice(0, 3)).toEqual([`goal:${GOAL_ID}`, `debt:${CARD_ID}`, 'stabilize']);
  });

  it('stores the deterministic order when the model call fails', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    generateObject.mockRejectedValue(new Error('upstream 500'));

    const { steps } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    expect(recorded.paths[0]).toMatchObject({ orderSource: 'deterministic', model: null });
    expect(recorded.steps.map((s) => s.candidateKey)).toEqual(keysOf(candidates));
    expect(steps.map((s) => s.key)).toEqual(keysOf(candidates));
  });

  it('stores the deterministic order when the response is malformed', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    generateObject.mockResolvedValue({ object: {}, usage: {} });

    await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    expect(recorded.paths[0]).toMatchObject({ orderSource: 'deterministic', model: null });
    expect(recorded.steps.map((s) => s.candidateKey)).toEqual(keysOf(candidates));
  });

  it('stores the order and the reason, and no figure the read would recompute', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    // A line per key. One sentence repeated is kept once on purpose, so a
    // fixture that repeated one would be asserting the dedupe instead.
    modelReturns(
      candidates.map((c) => ({ key: c.key, reason: `It belongs about here, for the ${c.kind} of it.` })),
    );

    const { steps, reasons } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    const card = recorded.steps.find((s) => s.candidateKey === `debt:${CARD_ID}`)!;
    // A stored step is the position, the key, the line, and what the person
    // said about it. Anything a balance would move is computed on read instead,
    // so none of it is written here.
    expect(Object.keys(card).sort()).toEqual([
      'candidateKey',
      'note',
      'pathId',
      'position',
      'reason',
      'status',
      'statusAt',
      'tenantId',
    ]);
    expect(card.status).toBe('pending');
    expect(card.note).toBe('');
    // A balance takes a computed position, which nothing wrote a line about.
    expect(card.reason).toBe('');
    for (const step of recorded.steps) {
      expect(String(step.reason)).not.toMatch(/[\d$%]/);
    }
    // And the line comes back out with the step it belongs to.
    expect(reasons.get(steps[0].key)).toBe(`It belongs about here, for the ${steps[0].kind} of it.`);
  });

  it('takes the order already stored when a concurrent request won the race', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    modelPlacesAll(candidates);
    activePath = { id: 'path-0', orderSource: 'model' };
    activeSteps = [
      { candidateKey: 'emergency-fund', reason: 'The winner put it first.' },
      { candidateKey: 'stabilize', reason: '' },
    ];

    const { steps, reasons } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    // Nothing was ordered and nothing was written: the stored path is the answer.
    expect(generateObject).not.toHaveBeenCalled();
    expect(recorded.paths).toHaveLength(0);
    expect(steps.slice(0, 2).map((s) => s.key)).toEqual(['emergency-fund', 'stabilize']);
    expect(reasons.get('emergency-fund')).toBe('The winner put it first.');
    expect(reasons.has('stabilize')).toBe(false);
  });

  it('never descrubs the line it stores, so no account name is spliced into it', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    modelReturns(
      candidates.map((c) => ({ key: c.key, reason: `This comes after your auto loan, ${c.kind}.` })),
    );

    await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    // A debt's alias IS its subtype, so restoring one rewrites ordinary prose:
    // "your auto loan" comes back "your Auto Loan loan". The line names nothing,
    // so there is nothing to restore and the boundary is told not to try.
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(descrubObject).not.toHaveBeenCalled();
    expect(
      recorded.steps
        .filter((s) => String(s.reason) !== '')
        .every((s) => String(s.reason).startsWith('This comes after your auto loan,')),
    ).toBe(true);
  });

  it('stores a left-out step with its reason, off the sequence but not gone', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    modelReturns(
      candidates
        .filter((c) => c.key !== 'stabilize')
        .map((c) => ({ key: c.key, reason: 'It belongs about here for you.' })),
      [{ key: 'stabilize', reason: 'You already hold more than a first buffer in cash.' }],
    );

    const { steps, leftOut } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    // Off the sequence: no number, no funding, not sized.
    expect(steps.map((s) => s.key)).not.toContain('stabilize');
    expect(leftOut.map((o) => o.candidate.key)).toEqual(['stabilize']);
    expect(leftOut[0].reason).toBe('You already hold more than a first buffer in cash.');

    // On file all the same, with the line, behind everything on the path.
    const row = recorded.steps.find((s) => s.candidateKey === 'stabilize')!;
    expect(row.status).toBe('left_out');
    expect(row.reason).toBe('You already hold more than a first buffer in cash.');
    expect(row.position).toBe(candidates.length - 1);
    // The guarantee: every candidate that went in is stored, one way or another.
    expect(new Set(recorded.steps.map((s) => s.candidateKey))).toEqual(new Set(keysOf(candidates)));
  });

  it('brings a step back to pending when this generation puts it in the sequence', async () => {
    // `left_out` is the PREVIOUS generation's own omission, not a mark the
    // person made. Carried onto a step this generation placed, it stored a step
    // that IS on the path as off it, `storedPath` filtered it straight back
    // off, and nothing could rescue it: a left-out row stores no `statusAt`, so
    // it never reads as one the person spoke for. Two households had a student
    // loan and a car loan stuck off the path for three generations that way,
    // each listed under "not on your path" beneath a sentence saying when to
    // pay it.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    activePath = { id: 'path-0', orderSource: 'model' };
    activeSteps = candidates.map((c) => ({
      candidateKey: c.key,
      reason: c.key === 'emergency-fund' ? 'You set this aside last time.' : '',
      status: c.key === 'emergency-fund' ? 'left_out' : 'pending',
      note: '',
      statusAt: null,
    }));

    modelPlacesAll(
      candidates.filter((c) => c.kind !== 'debt'),
      'This is where it goes for you.',
    );

    const { steps } = await generatePath(
      'tenant-1', ctx, candidates, null, 'inputs_changed',
      { id: 'path-0' } as never,
    );

    const row = recorded.steps.find((r) => r.candidateKey === 'emergency-fund')!;
    expect(row.status).toBe('pending');
    // And it is genuinely back on the path this read, not merely stored so.
    expect(steps.map((st) => st.key)).toContain('emergency-fund');
  });

  it('never leaves out a goal that a built-in step was suppressed for', async () => {
    // An `emergency_fund` goal computes what the emergency-fund step computes,
    // so only the goal is emitted. Dropping the goal therefore takes the job
    // off the path in BOTH forms, and one household ended up with neither, the
    // goal listed under "not on your path" with an empty reason so the page
    // read "Your plan did not place this step."
    const ctx = firstBuyer();
    ctx.goals = [
      {
        id: GOAL_ID,
        name: 'Rainy day',
        category: 'emergency_fund',
        targetAmount: 24_000,
        currentAmount: 0,
        deadline: null,
        details: null,
      },
    ];
    const candidates = buildPathCandidates(ctx);
    expect(candidates.map((c) => c.key)).not.toContain('emergency-fund');

    modelReturns(
      [{ key: 'stabilize', reason: 'Everything else waits on this.' }],
      [{ key: `goal:${GOAL_ID}`, reason: 'You do not need this one.' }],
    );

    const { steps, leftOut } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    expect(leftOut.map((o) => o.candidate.key)).not.toContain(`goal:${GOAL_ID}`);
    expect(steps.map((st) => st.key)).toContain(`goal:${GOAL_ID}`);
    // The guarantee stated plainly: the job is on the path in one form or the
    // other, never in neither.
    const onPath = new Set(steps.map((st) => st.key));
    expect(onPath.has('emergency-fund') || onPath.has(`goal:${GOAL_ID}`)).toBe(true);
  });

  it('keeps every debt and every goal on the page when the model drops both', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    // The worst answer that is still readable: one step placed, everything else
    // dropped without a word about any of it.
    modelReturns([{ key: 'emergency-fund', reason: 'Everything else waits on this.' }]);

    const { steps, leftOut } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    // The one step it placed, and the balance it was never asked about.
    expect(steps.map((s) => s.key)).toEqual(['emergency-fund', `debt:${CARD_ID}`]);
    const onThePage = [...steps.map((s) => s.key), ...leftOut.map((o) => o.candidate.key)];
    // A real obligation and a goal they set themselves are both still there.
    expect(onThePage).toContain(`debt:${CARD_ID}`);
    expect(onThePage).toContain(`goal:${GOAL_ID}`);
    expect(new Set(onThePage)).toEqual(new Set(keysOf(candidates)));
    expect(new Set(recorded.steps.map((s) => s.candidateKey))).toEqual(new Set(keysOf(candidates)));
  });

  it('does not pay to order a set with no account and no goal in it', async () => {
    // Somebody who has just signed up: three unconditional steps, one order.
    const ctx = buildPathContextDefaults({});
    const candidates = buildPathCandidates(ctx);
    expect(candidates.every((c) => c.accountId === null && c.goalId === null)).toBe(true);

    const { steps } = await generatePath('new-tenant', ctx, candidates, null, 'no_active_path');

    expect(generateObject).not.toHaveBeenCalled();
    expect(recorded.paths[0]).toMatchObject({ orderSource: 'deterministic', model: null });
    expect(steps.map((s) => s.key)).toEqual(keysOf(candidates));
    expect(recorded.steps.every((s) => s.reason === '')).toBe(true);
  });
});

// ── Two first-reads at once ──────────────────────────────────────────────────

describe('simultaneous first-reads', () => {
  it('pays for one ordering call between them, not one each', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    modelReturns([
      { key: 'emergency-fund', reason: 'A deeper buffer is what the rest rests on.' },
      ...candidates
        .filter((c) => c.key !== 'emergency-fund')
        .map((c) => ({ key: c.key, reason: 'Placed for you.' })),
    ]);

    const results = await Promise.all([
      generatePath('tenant-1', ctx, candidates, null, 'no_active_path'),
      generatePath('tenant-1', ctx, candidates, null, 'no_active_path'),
      generatePath('tenant-1', ctx, candidates, null, 'no_active_path'),
    ]);

    // The whole point: the order is bought once, however many people ask.
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(recorded.paths).toHaveLength(1);
    expect(recorded.steps).toHaveLength(candidates.length);
    // All three queued on the same tenant-derived lock, before spending.
    expect(lockCalls).toHaveLength(3);
    expect(new Set(lockCalls).size).toBe(1);
    // And all three answered with the same path, in the same order.
    const orders = results.map((r) => r.steps.map((s) => s.key).join(','));
    expect(new Set(orders).size).toBe(1);
    expect(results[0].steps[0].key).toBe('emergency-fund');
    for (const result of results) {
      expect(result.reasons.get('emergency-fund')).toBe(
        'A deeper buffer is what the rest rests on.',
      );
    }
  });

  it('leaves nothing half-written, and nobody locked out, when the write fails', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    modelPlacesAll(candidates, 'Placed for you.');
    insertFails = true;

    await expect(generatePath('tenant-1', ctx, candidates, null, 'no_active_path')).rejects.toThrow(
      'insert failed',
    );

    // Nothing stored, and the tenant is free again: the next read generates.
    expect(recorded.paths).toHaveLength(0);
    expect(activePath).toBeNull();
    insertFails = false;
    const { steps } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');
    expect(steps).toHaveLength(candidates.length);
    expect(recorded.paths).toHaveLength(1);
  });
});

// ── Reading the stored order back ────────────────────────────────────────────

describe('applyStoredOrder', () => {
  it('reproduces the stored order, skips a key that is gone, and appends a new step', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    const stored = ['emergency-fund', 'goal:00000000-0000-4000-8000-000000000000', 'stabilize'];

    const applied = applyStoredOrder(candidates, stored).map((c) => c.key);

    expect(applied.slice(0, 2)).toEqual(['emergency-fund', 'stabilize']);
    expect(new Set(applied)).toEqual(new Set(keysOf(candidates)));
    expect(applied).toHaveLength(candidates.length);
  });
});
