import { describe, it, expect, vi, beforeEach } from 'vitest';

// When a path may change, and what survives when it does.
//
// The two properties pulling against each other here are the whole point of the
// slice: a plan that reshuffles under the person walking it is useless, and a
// plan that never answers to the household behind it is worse. So this drives
// the real read path and asserts BOTH directions — five reads of an unchanged
// household must not regenerate and must not spend, and the events that should
// regenerate must.
//
// The model, the telemetry and the alias map are stubbed. The two path tables
// are stood up in memory rather than mocked call-by-call, because what is being
// tested is state across reads: which row is active, what is stored on its
// steps, and what carries onto the next one.

const generateObject = vi.fn();
vi.mock('ai', () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
vi.mock('../../lib/activity.js', () => ({ logLlmUsage: vi.fn(), actualLlmCostUsd: () => undefined }));
vi.mock('../../agent/index.js', () => ({
  getModel: () => ({}) as never,
  getModelSlug: () => 'anthropic/claude-sonnet-4.5',
}));
vi.mock('../../lib/pii-scrubber.js', () => ({
  buildAliasMap: async () => ({ forward: new Map(), reverse: new Map() }),
  scrub: (x: unknown) => x,
  descrub: (x: unknown) => x,
  descrubObject: (x: unknown) => x,
}));

// The household this read sees. Set per test, so "nothing changed" and "a goal
// appeared" are the same code path with a different world behind it.
let world: PathContext;
vi.mock('../../lib/path-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/path-context.js')>()),
  buildPathContext: async () => world,
}));
// A Monte Carlo has nothing to say about when a path may change, and it is
// thousands of times the cost of the rest of the read.
vi.mock('../../services/retirement-readiness.js', () => ({
  buildPathReadiness: async () => null,
}));

// ── The two path tables, in memory ───────────────────────────────────────────
//
// Rows are filtered by decoding the real drizzle `where` into the column/value
// pairs it compares, so a query that names the wrong column matches nothing
// here exactly as it would match nothing in Postgres.

interface PathRow {
  id: string;
  tenantId: string;
  generatedAt: Date;
  reason: string;
  inputsFingerprint: string;
  model: string | null;
  orderSource: string;
  status: string;
  pendingReason: string | null;
  createdAt: Date;
}
interface StepRow {
  id: string;
  pathId: string;
  tenantId: string;
  position: number;
  candidateKey: string;
  reason: string;
  status: string;
  note: string;
  statusAt: Date | null;
}

/** The profile row, for the two columns the older bookkeeping lived in. */
interface ProfileRow {
  tenantId: string;
  skippedPrioritySteps: string[] | null;
  completedPrioritySteps: Array<{ id: string; note?: string; completedAt?: string }> | null;
}

const store: { paths: PathRow[]; steps: StepRow[]; profiles: ProfileRow[] } = {
  paths: [],
  steps: [],
  profiles: [],
};
let nextId = 0;
const newId = (prefix: string) => `${prefix}-${++nextId}`;

/** snake_case as the SQL names it → the camelCase the rows are held in. */
const COLUMN: Record<string, string> = {
  id: 'id',
  tenant_id: 'tenantId',
  path_id: 'pathId',
  candidate_key: 'candidateKey',
  status: 'status',
  position: 'position',
};

/** The equality pairs a drizzle `where` compares, in the order it compares them. */
function conditions(where: unknown): Array<[string, unknown]> {
  if (!where) return [];
  const { sql: text, params } = new PgDialect().sqlToQuery(where as never);
  const pairs: Array<[string, unknown]> = [];
  for (const m of text.matchAll(/"[a-z_]+"\."([a-z_]+)" = \$(\d+)/g)) {
    const field = COLUMN[m[1]];
    if (!field) throw new Error(`the fake store does not model column ${m[1]}`);
    pairs.push([field, params[Number(m[2]) - 1]]);
  }
  return pairs;
}

function matching<T extends Record<string, unknown>>(rows: T[], where: unknown): T[] {
  const pairs = conditions(where);
  return rows.filter((row) => pairs.every(([field, value]) => row[field] === value));
}

function tableOf(table: unknown): 'paths' | 'steps' {
  if (table === financialPaths) return 'paths';
  if (table === financialPathSteps) return 'steps';
  throw new Error('the fake store does not model that table');
}

function insertInto(table: unknown) {
  const which = tableOf(table);
  return {
    values(rows: Record<string, unknown> | Record<string, unknown>[]) {
      const list = Array.isArray(rows) ? rows : [rows];
      const written = list.map((row) => {
        if (which === 'paths') {
          const path: PathRow = {
            id: newId('path'),
            generatedAt: new Date(),
            model: null,
            status: 'active',
            pendingReason: null,
            createdAt: new Date(),
            ...(row as object),
          } as PathRow;
          // The partial unique index. Two active rows for one tenant is the
          // exact failure the supersede-then-insert ordering exists to avoid,
          // so the fake refuses it rather than quietly allowing it.
          if (
            path.status === 'active' &&
            store.paths.some((p) => p.tenantId === path.tenantId && p.status === 'active')
          ) {
            throw new Error('financial_paths_one_active_per_tenant');
          }
          store.paths.push(path);
          return path;
        }
        const step: StepRow = {
          id: newId('step'),
          reason: '',
          status: 'pending',
          note: '',
          statusAt: null,
          ...(row as object),
        } as StepRow;
        store.steps.push(step);
        return step;
      });
      const result = written.map((r) => ({ ...r }));
      return {
        returning: () => Promise.resolve(result),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(result).then(res, rej),
      };
    },
  };
}

function updateIn(table: unknown) {
  const rows = store[tableOf(table)] as unknown as Array<Record<string, unknown>>;
  return {
    set(values: Record<string, unknown>) {
      return {
        where(clause: unknown) {
          const hit = matching(rows, clause);
          for (const row of hit) Object.assign(row, values);
          const result = hit.map((r) => ({ ...r }));
          return {
            returning: () => Promise.resolve(result),
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(result).then(res, rej),
          };
        },
      };
    },
  };
}

/** A declaration, not a const: `vi.mock`'s factory is hoisted above both. */
function makeQuery() {
  return {
    financialPaths: {
      findFirst: async ({ where }: { where?: unknown } = {}) =>
        matching(store.paths as unknown as Array<Record<string, unknown>>, where)[0],
    },
    financialPathSteps: {
      findMany: async ({ where }: { where?: unknown } = {}) =>
        matching(store.steps as unknown as Array<Record<string, unknown>>, where).sort(
          (a, b) => Number(a.position) - Number(b.position),
        ),
    },
    financialProfiles: {
      findFirst: async ({ where }: { where?: unknown } = {}) =>
        matching(store.profiles as unknown as Array<Record<string, unknown>>, where)[0],
    },
  };
}

/**
 * The advisory lock, as Postgres holds it: FIFO on one key, released at commit
 * or at rollback and never before.
 *
 * Modelled rather than stubbed away, because the whole reason generation takes
 * a lock is that the model call inside it costs money. A regeneration that let
 * two requests through would bill the tenant twice.
 */
const held = new Map<string, Promise<void>>();
async function takeLock(key: string): Promise<() => void> {
  const ahead = held.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  held.set(key, ahead.then(() => mine));
  await ahead;
  return release;
}

async function transaction(fn: (tx: unknown) => unknown) {
  const lock: { release: (() => void) | null } = { release: null };
  const tx = {
    query: makeQuery(),
    insert: insertInto,
    update: updateIn,
    execute: async (statement: unknown) => {
      const { params } = new PgDialect().sqlToQuery(statement as never);
      lock.release = await takeLock(params.join(':'));
    },
  };
  try {
    return await fn(tx);
  } finally {
    lock.release?.();
  }
}

vi.mock('../../lib/db.js', () => ({
  db: { query: makeQuery(), insert: insertInto, update: updateIn, transaction },
}));

import { PgDialect, financialPaths, financialPathSteps } from '@lasagna/core';
import { buildPathContextDefaults, type PathContext } from '../../lib/path-context.js';
import { buildPathCandidates } from '../../lib/path-candidates.js';
import { invalidatePath, markPathStep, readActivePath } from '../../lib/path-generator.js';
import { currentStepKey, markAndReadPath, readFinancialPath } from '../financial-path.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const CARD = '11111111-1111-4111-8111-111111111111';
const GOAL = '22222222-2222-4222-8222-222222222222';

/** Someone with a card and money left over, so the set is worth ordering. */
function household(overrides: Partial<PathContext> = {}): PathContext {
  return buildPathContextDefaults({
    age: 31,
    annualIncome: 96_000,
    monthlyIncome: 8_000,
    monthlyExpenses: 5_000,
    stableMonthlyExpenses: 5_000,
    monthlySurplus: 3_000,
    savingsRate: 37,
    employmentType: 'w2',
    cashTotal: 4_000,
    debtAccounts: [
      {
        id: CARD,
        name: 'Rewards card',
        mask: null,
        type: 'credit',
        subtype: null,
        balance: 6_400,
        apr: 21,
        minimumPayment: 160,
        minimumPaymentEstimated: false,
        termMonths: null,
        originationDate: null,
        payoffDate: null,
        propertyAccountId: null,
        liabilitySource: null,
        liabilityLastSyncedAt: null,
        lastUpdated: null,
      },
    ],
    ...overrides,
  });
}

const houseDeposit = {
  id: GOAL,
  name: 'House deposit',
  category: 'home_purchase',
  targetAmount: 40_000,
  currentAmount: 2_000,
  deadline: new Date('2031-04-01T00:00:00Z'),
  details: null,
};

/** The model returns the order it was given, so nothing here turns on its taste. */
function modelEchoesTheOrder() {
  generateObject.mockImplementation(async ({ prompt }: { prompt: string }) => ({
    object: {
      steps: (JSON.parse(prompt).candidates as Array<{ key: string }>).map((c) => ({
        key: c.key,
        reason: 'It belongs about here for you.',
      })),
    },
    usage: { inputTokens: 400, outputTokens: 200 },
  }));
}

const read = () => readFinancialPath(TENANT, USER);
const activeRows = () => store.paths.filter((p) => p.status === 'active');

beforeEach(() => {
  generateObject.mockReset();
  modelEchoesTheOrder();
  store.paths = [];
  store.steps = [];
  store.profiles = [];
  held.clear();
  nextId = 0;
  world = household();
});

// ── Nothing happened ─────────────────────────────────────────────────────────

describe('a household that did not change', () => {
  it('is not regenerated and is not paid for again, five reads running', async () => {
    const first = await read();
    expect(generateObject).toHaveBeenCalledTimes(1);

    const serialise = (p: Awaited<ReturnType<typeof read>>) =>
      JSON.stringify({
        keys: p.steps.map((s) => s.key),
        current: currentStepKey(p.steps),
        count: p.steps.length,
        at: p.generatedAt.toISOString(),
        reason: p.reason,
      });
    const before = serialise(first);

    for (let i = 0; i < 5; i++) {
      expect(serialise(await read())).toBe(before);
    }

    // One order chosen, one call made, one row. Not five of anything.
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(store.paths).toHaveLength(1);
  });

  it('is not regenerated by a balance drifting, which is what a day does', async () => {
    await read();
    const at = (await readActivePath(TENANT))!.generatedAt;

    // A payment lands, a little spending, the goal gains a contribution. Every
    // figure on the page moves. None of it is a reason to reorder the path.
    world = household({
      cashTotal: 4_137,
      stableMonthlyExpenses: 5_064,
      monthlySurplus: 2_936,
      debtAccounts: [{ ...household().debtAccounts[0], balance: 6_218.44 }],
    });

    const after = await read();
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(after.generatedAt).toEqual(at);
    expect(store.paths).toHaveLength(1);
  });
});

// ── The events that DO change it ─────────────────────────────────────────────

describe('a goal', () => {
  it('regenerates the path on the next read once it is added', async () => {
    const before = await read();
    expect(before.steps.map((s) => s.key)).not.toContain(`goal:${GOAL}`);

    // What POST /goals leaves behind: the goal itself, and the reason parked on
    // the path so the next read can say what changed it.
    world = household({ goals: [houseDeposit] });
    await invalidatePath(TENANT, 'goal_added');

    const after = await read();
    expect(after.steps.map((s) => s.key)).toContain(`goal:${GOAL}`);
    expect(after.reason).toBe('goal_added');
    expect(generateObject).toHaveBeenCalledTimes(2);

    // Superseded, not edited. The order somebody was reading is still on file.
    expect(activeRows()).toHaveLength(1);
    expect(store.paths).toHaveLength(2);
    expect(store.paths[0].status).toBe('superseded');
  });

  it('regenerates on an edit the ordering inputs cannot see', async () => {
    world = household({ goals: [houseDeposit] });
    await read();

    // A target nudged inside its own t-shirt size. The fingerprint is identical
    // by design, which is exactly why the goal route has to say so itself.
    world = household({ goals: [{ ...houseDeposit, targetAmount: 41_500 }] });
    expect((await read()).reason).toBe('no_active_path');
    expect(generateObject).toHaveBeenCalledTimes(1);

    await invalidatePath(TENANT, 'goal_updated');
    expect((await read()).reason).toBe('goal_updated');
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('names its own removal when the goal is simply gone', async () => {
    world = household({ goals: [houseDeposit] });
    await read();

    world = household();
    const after = await read();
    expect(after.reason).toBe('goal_removed');
    expect(after.steps.map((s) => s.key)).not.toContain(`goal:${GOAL}`);
  });
});

describe('the household behind the steps', () => {
  it('regenerates when a new balance appears, and says that is what happened', async () => {
    await read();
    const second = '33333333-3333-4333-8333-333333333333';
    world = household({
      debtAccounts: [
        household().debtAccounts[0],
        { ...household().debtAccounts[0], id: second, name: 'Auto loan', type: 'loan', balance: 14_000, apr: 6 },
      ],
    });

    const after = await read();
    expect(after.reason).toBe('debt_added');
    expect(after.steps.map((s) => s.key)).toContain(`debt:${second}`);
  });

  it('regenerates when a balance is cleared', async () => {
    await read();
    world = household({ debtAccounts: [{ ...household().debtAccounts[0], balance: 0 }] });

    const after = await read();
    expect(after.reason).toBe('debt_cleared');
    expect(after.steps.map((s) => s.key)).not.toContain(`debt:${CARD}`);
  });

  it('regenerates on an income change large enough to cross a band', async () => {
    await read();
    // $96k to $104k. The band the model was shown moves, so the order it would
    // choose can too. A raise of a few hundred dollars would not have.
    world = household({ annualIncome: 104_000, monthlyIncome: 8_666, monthlySurplus: 3_666 });

    expect((await read()).reason).toBe('inputs_changed');
    expect(generateObject).toHaveBeenCalledTimes(2);
  });
});

// ── What survives a regeneration ─────────────────────────────────────────────

describe('a step the person marked', () => {
  it('is still complete after the path is regenerated around it', async () => {
    await read();

    // Insurance is a step nothing measures, so a tick decides it and the order
    // it sits in is reopened for it.
    const after = (await markAndReadPath(TENANT, USER, 'insurance-will', 'done', 'Term life bound'))!;
    expect(after.reason).toBe('step_completed');
    expect(store.paths).toHaveLength(2);

    const step = after.steps.find((s) => s.key === 'insurance-will')!;
    expect(step.status).toBe('complete');
    expect(step.note).toBe('Term life bound');

    // And it is on the NEW row, not read off the old one.
    const active = (await readActivePath(TENANT))!;
    expect(active.id).toBe(store.paths[1].id);
    expect(active.steps.find((s) => s.key === 'insurance-will')).toMatchObject({
      mark: 'done',
      note: 'Term life bound',
    });
  });

  it('moves "you are here" past it', async () => {
    // No debt and a funded emergency fund, so the step they are standing on is
    // one nothing measures, which is the only case a tick decides.
    world = household({ debtAccounts: [], cashTotal: 40_000 });
    const before = await read();
    const standing = currentStepKey(before.steps);
    expect(standing).toBe('insurance-will');

    await markPathStep(TENANT, standing, 'done', '');
    const after = await read();
    expect(after.steps.find((s) => s.key === standing)!.status).toBe('complete');
    expect(currentStepKey(after.steps)).not.toBe(standing);
  });

  it('is taken off the path entirely when it does not apply, and can come back', async () => {
    const before = await read();
    const length = before.steps.length;

    await markPathStep(TENANT, 'insurance-will', 'not_applicable', '');
    const off = await read();
    expect(off.steps).toHaveLength(length - 1);
    expect(off.steps.map((s) => s.key)).not.toContain('insurance-will');
    expect(off.notApplicable.map((c) => c.key)).toEqual(['insurance-will']);
    // Numbering closes over it rather than leaving a gap, and nothing was paid
    // to take a step off a path.
    expect(off.steps.map((s) => s.key)).toEqual(
      before.steps.map((s) => s.key).filter((k) => k !== 'insurance-will'),
    );
    expect(generateObject).toHaveBeenCalledTimes(1);

    await markPathStep(TENANT, 'insurance-will', 'pending', '');
    const back = await read();
    expect(back.steps).toHaveLength(length);
    expect(back.notApplicable).toHaveLength(0);
  });

  it('cannot be pinned complete by hand when the figures measure it', async () => {
    await read();
    // The emergency fund is $4,000 of a $30,000 target. A tick does not decide
    // a step a balance decides, in either direction.
    await markPathStep(TENANT, 'emergency-fund', 'done', 'I think this is fine');
    const after = await read();
    const step = after.steps.find((s) => s.key === 'emergency-fund')!;
    expect(step.status).toBe('in_progress');
    // Their sentence is still theirs, which is the whole reason it is stored.
    expect(step.note).toBe('I think this is fine');
  });

  it('is refused for a key that is not on this path', async () => {
    await read();
    expect(await markPathStep(TENANT, 'goal:not-a-goal', 'done', '')).toBe(false);
  });

  it('keeps the note when a later mark says nothing about it', async () => {
    await read();
    await markAndReadPath(TENANT, USER, 'insurance-will', 'done', 'Term life bound');

    // "Undo" says where they stand. It says nothing about what they wrote, so
    // the sentence they typed survives the round trip.
    const undone = (await markAndReadPath(TENANT, USER, 'insurance-will', 'pending'))!;
    expect(undone.steps.find((s) => s.key === 'insurance-will')!.note).toBe('Term life bound');

    const off = (await markAndReadPath(TENANT, USER, 'insurance-will', 'not_applicable'))!;
    expect(off.notApplicable.map((c) => c.key)).toContain('insurance-will');
    const back = (await markAndReadPath(TENANT, USER, 'insurance-will', 'pending'))!;
    expect(back.steps.find((s) => s.key === 'insurance-will')!.note).toBe('Term life bound');

    // An empty string is a sentence they deleted, and that still clears it.
    const cleared = (await markAndReadPath(TENANT, USER, 'insurance-will', 'done', ''))!;
    expect(cleared.steps.find((s) => s.key === 'insurance-will')!.note).toBe('');
  });
});

// ── What a tick is worth reordering for ──────────────────────────────────────

describe('a tick on a step the figures already decide', () => {
  it('reorders nothing and is not paid for', async () => {
    await read();
    expect(generateObject).toHaveBeenCalledTimes(1);

    // The emergency fund is $4,000 of a $30,000 target, and it stays that way
    // whatever is ticked. Reordering for it would buy the same sequence back
    // for the length and the price of a model call.
    const after = (await markAndReadPath(TENANT, USER, 'emergency-fund', 'done', 'Feels fine'))!;
    expect(after.steps.find((s) => s.key === 'emergency-fund')!.status).toBe('in_progress');
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(store.paths).toHaveLength(1);

    // And nothing is left parked for a later read to spend either.
    await read();
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(store.paths).toHaveLength(1);
  });

  it('still reorders when the tick is the only thing that decides the step', async () => {
    await read();
    const after = (await markAndReadPath(TENANT, USER, 'insurance-will', 'done'))!;
    expect(after.steps.find((s) => s.key === 'insurance-will')!.status).toBe('complete');
    expect(after.reason).toBe('step_completed');
    expect(generateObject).toHaveBeenCalledTimes(2);
  });
});

// ── What was recorded before there were paths ────────────────────────────────
//
// Until the path was stored, a tick and a note lived on the profile row against
// a step id, and a step somebody had put aside lived beside it. Those rows are
// still the only record a returning person ever made of these steps, so the
// first path generated for them carries what matches, and nothing else.

/** The profile row a returning person still has, as they left it. */
function recordedBefore(row: Partial<ProfileRow> = {}) {
  store.profiles.push({
    tenantId: TENANT,
    skippedPrioritySteps: [],
    completedPrioritySteps: [],
    ...row,
  });
}

describe('a tick made before there were paths', () => {
  it('still stands on the path they already have, which carries nobody a mark', async () => {
    // The shape of a release: a stored path whose every step row is the column
    // default, and a profile row that is the only record of what they did.
    await read();
    expect(store.steps.every((s) => s.status === 'pending' && s.note === '')).toBe(true);
    recordedBefore({
      completedPrioritySteps: [
        { id: 'insurance-will', note: 'legacy note the user typed' },
        { id: 'tax-advantaged' },
      ],
    });

    const path = await read();
    const insurance = path.steps.find((s) => s.key === 'insurance-will')!;
    expect(insurance.status).toBe('complete');
    expect(insurance.note).toBe('legacy note the user typed');
    expect(path.steps.find((s) => s.key === 'tax-advantaged')!.status).toBe('complete');
    // Reading what they already told us is not an event, and is not paid for.
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it('carries onto the first path a returning person is given', async () => {
    recordedBefore({
      completedPrioritySteps: [{ id: 'insurance-will', note: 'legacy note the user typed' }],
    });

    const path = await read();
    expect(path.steps.find((s) => s.key === 'insurance-will')).toMatchObject({
      status: 'complete',
      note: 'legacy note the user typed',
    });
    // And onto the row, so the stored mark answers for it from here.
    const active = (await readActivePath(TENANT))!;
    expect(active.steps.find((s) => s.key === 'insurance-will')).toMatchObject({
      mark: 'done',
      note: 'legacy note the user typed',
    });
  });

  it('is dropped when its id named a rate band rather than a step', async () => {
    recordedBefore({
      skippedPrioritySteps: ['low-interest-debt'],
      completedPrioritySteps: [{ id: 'high-rate-debt', note: 'paid the card off' }],
    });

    const path = await read();
    // A band stood for a group of accounts, so there is no one step it means.
    // The card is still on the path, still owed, and carries none of it.
    const card = path.steps.find((s) => s.key === `debt:${CARD}`);
    expect(card).toBeDefined();
    expect(card!.status).not.toBe('complete');
    expect(path.notApplicable).toHaveLength(0);
    expect(path.steps.every((s) => s.note === '')).toBe(true);
  });

  it('takes a step off the path when that is what they said', async () => {
    recordedBefore({ skippedPrioritySteps: ['insurance-will'] });

    const path = await read();
    expect(path.notApplicable.map((c) => c.key)).toEqual(['insurance-will']);
    expect(path.steps.map((s) => s.key)).not.toContain('insurance-will');
  });

  it('does not come back once they have put the step back', async () => {
    recordedBefore({
      completedPrioritySteps: [{ id: 'insurance-will', note: 'legacy note the user typed' }],
    });
    await read();

    const undone = (await markAndReadPath(TENANT, USER, 'insurance-will', 'pending'))!;
    expect(undone.steps.find((s) => s.key === 'insurance-will')!.status).toBe('not_started');
    expect((await read()).steps.find((s) => s.key === 'insurance-will')!.status).toBe('not_started');

    // And it stays put through a reshuffle. A goal appears, so the whole path
    // is chosen again around it, and the profile row still says done.
    world = household({ goals: [houseDeposit] });
    const later = await read();
    expect(later.steps.find((s) => s.key === 'insurance-will')!.status).toBe('not_started');
  });
});

// ── Two requests, one bill ───────────────────────────────────────────────────

describe('two reads that both find the path stale', () => {
  it('pay for one reorder between them, and end on one active path', async () => {
    await read();
    expect(generateObject).toHaveBeenCalledTimes(1);

    // The goal lands, then home and the path page both load. Both see a stale
    // path. Only one of them may pay to reorder it.
    world = household({ goals: [houseDeposit] });
    await invalidatePath(TENANT, 'goal_added');

    const both = await Promise.all([read(), read()]);

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(activeRows()).toHaveLength(1);
    expect(store.paths).toHaveLength(2);
    // And they answered with the same path, which is the point of paying once.
    const orders = both.map((p) => p.steps.map((s) => s.key).join(','));
    expect(new Set(orders).size).toBe(1);
    expect(new Set(both.map((p) => p.generatedAt.getTime())).size).toBe(1);
  });
});

// ── The definition of "material" ─────────────────────────────────────────────

describe('the fingerprint', () => {
  it('is the digest of exactly what the ordering model was shown', async () => {
    // Stated as a property rather than a hash, so it stays true when the payload
    // changes: two households the model cannot tell apart get one fingerprint.
    const { buildOrderPayload, pathFingerprint } = await import('../../lib/path-generator.js');
    const drifted = household({ cashTotal: 4_137, brokerageBalance: 900 });
    const same =
      JSON.stringify(buildOrderPayload(buildPathCandidates(household()), household())) ===
      JSON.stringify(buildOrderPayload(buildPathCandidates(drifted), drifted));
    expect(same).toBe(true);
    expect(pathFingerprint(household(), buildPathCandidates(household()))).toBe(
      pathFingerprint(drifted, buildPathCandidates(drifted)),
    );
  });
});
