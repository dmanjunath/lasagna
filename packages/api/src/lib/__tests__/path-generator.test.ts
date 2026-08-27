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
let activeSteps: Array<{ candidateKey: string; reason: string }> = [];

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
import { buildPathCandidates, type PathCandidate } from '../path-candidates.js';
import type { DebtAccount } from '../debt-accounts.js';
import {
  applyStoredOrder,
  buildOrderPayload,
  generatePath,
  stepLabelForKey,
  validateOrder,
  type ProposedStep,
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
    expect(payload).toContain('Credit card balance');
    expect(payload).toContain('"size":"medium"');
    expect(payload).toContain('"targetDate":"2030-06"');
    expect(payload).toContain('"incomeBand":"$50k to $75k"');
    expect(payload).toContain('"surplusBand":"$1.5k to $4k a month"');
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
      ctx,
    );

    const placed = ordered.map((o) => o.candidate.key);
    expect(source).toBe('model');
    expect(placed).not.toContain('pay-off-the-yacht');
    expect(placed).not.toContain(`goal:${DELETED_GOAL_ID}`);
    expect(placed.filter((k) => k === 'emergency-fund')).toHaveLength(1);
    // The step it did place is the only one in the sequence, and every other
    // candidate is off the path rather than gone.
    expect(placed).toEqual(['emergency-fund']);
    expect(new Set([...placed, ...leftOut.map((o) => o.candidate.key)])).toEqual(
      new Set(keysOf(candidates)),
    );
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
      ctx,
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
          .filter((c) => c.key !== `debt:${CARD_ID}`)
          .map((c) => ({ key: c.key, reason: 'Placed.' })),
        leftOut: [],
      },
      candidates,
      ctx,
    );

    // A short answer is not a decision to drop a balance somebody owes. It is
    // off the sequence the model chose, so it is off the path, and it is on the
    // page with nothing said about it.
    expect(ordered.map((o) => o.candidate.key)).not.toContain(`debt:${CARD_ID}`);
    expect(leftOut.map((o) => o.candidate.key)).toEqual([`debt:${CARD_ID}`]);
    expect(leftOut[0].reason).toBe('');
  });

  it('falls back to the deterministic order when nothing the model said is usable', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered, leftOut, source } = validateOrder(
      { steps: [{ key: 'nonsense', reason: 'x' }, { key: 'also-nonsense', reason: 'y' }], leftOut: [] },
      candidates,
      ctx,
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
      ctx,
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
      ctx,
    );

    for (const placed of ordered) expect(placed.reason).toBe('');
  });

  it('keeps a reason that reads back a band the payload sent', () => {
    const ctx = firstBuyer();
    // Enough room each month to put this household in the payload's top surplus
    // band, so "over $4k a month" is a phrase the model was handed.
    ctx.monthlySurplus = 4_600;
    const candidates = buildPathCandidates(ctx);

    // The line the digit test used to destroy. It is correct, it is useful, and
    // the reader saw "Your plan did not place this step." in its place.
    const restatement =
      'You are already putting over $4k a month aside, so a step that asks you to find surplus does not apply.';

    const { leftOut } = validateOrder(
      {
        steps: candidates
          .filter((c) => c.key !== 'savings-rate')
          .map((c) => ({ key: c.key, reason: 'Placed.' })),
        leftOut: [{ key: 'savings-rate', reason: restatement }],
      },
      candidates,
      ctx,
    );

    expect(new Map(leftOut.map((o) => [o.candidate.key, o.reason])).get('savings-rate')).toBe(
      restatement,
    );
  });

  it('reads a band back only for the household it was sent to', () => {
    // Same sentence, a household whose surplus band is not that one. The figure
    // is then one the model decided, and it goes exactly as any other would.
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { leftOut } = validateOrder(
      {
        steps: candidates
          .filter((c) => c.key !== 'savings-rate')
          .map((c) => ({ key: c.key, reason: 'Placed.' })),
        leftOut: [
          {
            key: 'savings-rate',
            reason:
              'You are already putting over $4k a month aside, so a step that asks you to find surplus does not apply.',
          },
        ],
      },
      candidates,
      ctx,
    );

    expect(new Map(leftOut.map((o) => [o.candidate.key, o.reason])).get('savings-rate')).toBe('');
  });

  it('lets through only phrases the payload put in front of the model', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    const payload = JSON.stringify(buildOrderPayload(candidates, ctx, null));

    // Each of these reads back one of this household's three bands verbatim, and
    // each of those bands is in the payload the model was handed. A fourth field
    // stating a figure would have to be allowed deliberately rather than
    // widening the guard by being written.
    const readBack = [
      'This waits until your income clears $50k to $75k.',
      'You can turn to this once you have $1.5k to $4k a month spare.',
      'Nothing here moves while what you have built is under $25k.',
    ];
    for (const band of ['$50k to $75k', '$1.5k to $4k a month', 'under $25k']) {
      expect(payload).toContain(band);
    }

    const { ordered } = validateOrder(
      { steps: readBack.map((reason, i) => ({ key: candidates[i].key, reason })), leftOut: [] },
      candidates,
      ctx,
    );
    expect(ordered.slice(0, readBack.length).map((o) => o.reason)).toEqual(readBack);
  });

  it('drops a line about what a balance costs when the account reports no rate', () => {
    const ctx = firstBuyer();
    // Same card, no rate on file. The card then says twice that the rate is
    // unknown, so a line calling the balance expensive contradicts it.
    ctx.debtAccounts = [debt({ id: CARD_ID, name: 'Rewards card', apr: null })];
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [
        { key: `debt:${CARD_ID}`, reason: 'You should clear this high-interest debt before it grows.' },
        { key: 'emergency-fund', reason: 'A buffer comes first so a surprise does not land on the card.' },
      ], leftOut: [] },
      candidates,
      ctx,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get(`debt:${CARD_ID}`)).toBe('');
    expect(byKey.get('emergency-fund')).toBe(
      'A buffer comes first so a surprise does not land on the card.',
    );
  });

  it('drops a line claiming what terms a balance carries when no rate is on file', () => {
    const ctx = firstBuyer();
    ctx.debtAccounts = [debt({ id: CARD_ID, name: 'Rewards card', apr: null })];
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [
        {
          key: `debt:${CARD_ID}`,
          reason: 'This comes first because this debt typically carries terms that reward earlier attention.',
        },
      ], leftOut: [] },
      candidates,
      ctx,
    );

    expect(new Map(ordered.map((o) => [o.candidate.key, o.reason])).get(`debt:${CARD_ID}`)).toBe('');
  });

  it('keeps a placement line on the same account once a rate is on file', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [{ key: `debt:${CARD_ID}`, reason: 'Clearing this high-interest balance comes before your goals.' }], leftOut: [] },
      candidates,
      ctx,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get(`debt:${CARD_ID}`)).toBe(
      'Clearing this high-interest balance comes before your goals.',
    );
  });

  it('drops a reason written in punctuation the product does not use', () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);

    const { ordered } = validateOrder(
      { steps: [
        { key: 'stabilize', reason: 'This comes first \u2014 everything else rests on it.' },
        { key: 'emergency-fund', reason: 'A buffer first; the rest can wait.' },
        { key: 'insurance-will', reason: 'One bad event should not undo what is behind it.' },
      ], leftOut: [] },
      candidates,
      ctx,
    );

    const byKey = new Map(ordered.map((o) => [o.candidate.key, o.reason]));
    expect(byKey.get('stabilize')).toBe('');
    expect(byKey.get('emergency-fund')).toBe('');
    expect(byKey.get('insurance-will')).toBe('One bad event should not undo what is behind it.');
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
    // The model's order leads, and sizing ran over that order.
    expect(steps[0].key).toBe(`goal:${GOAL_ID}`);
    expect(storedKeys.slice(0, 2)).toEqual([`goal:${GOAL_ID}`, 'stabilize']);
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
    modelReturns(
      candidates.map((c) => ({ key: c.key, reason: 'It belongs about here for you.' })),
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
    expect(card.reason).toBe('It belongs about here for you.');
    for (const step of recorded.steps) {
      expect(String(step.reason)).not.toMatch(/[\d$%]/);
    }
    // And the line comes back out with the step it belongs to.
    expect(reasons.get(steps[0].key)).toBe('It belongs about here for you.');
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
    modelReturns(candidates.map((c) => ({ key: c.key, reason: 'This comes after your auto loan.' })));

    await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    // A debt's alias IS its subtype, so restoring one rewrites ordinary prose:
    // "your auto loan" comes back "your Auto Loan loan". The line names nothing,
    // so there is nothing to restore and the boundary is told not to try.
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(descrubObject).not.toHaveBeenCalled();
    expect(recorded.steps.every((s) => s.reason === 'This comes after your auto loan.')).toBe(true);
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

  it('keeps every debt and every goal on the page when the model drops both', async () => {
    const ctx = firstBuyer();
    const candidates = buildPathCandidates(ctx);
    // The worst answer that is still readable: one step placed, everything else
    // dropped without a word about any of it.
    modelReturns([{ key: 'emergency-fund', reason: 'Everything else waits on this.' }]);

    const { steps, leftOut } = await generatePath('tenant-1', ctx, candidates, null, 'no_active_path');

    expect(steps.map((s) => s.key)).toEqual(['emergency-fund']);
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
