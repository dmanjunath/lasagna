import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What the assistant is allowed to know about somebody's path, and what it must
 * never do to it.
 *
 * Chat used to answer "what should I do next" from whatever the handoff pasted
 * into the message, which is a second opinion about an order the user is
 * already looking at. `get_financial_path` closes that: it reads the path they
 * have. So the two properties here are the two ways that can go wrong.
 *
 * ONE: the figures. A tool that answered with a rounded, restated or resized
 * version of the path would put a number in the assistant's mouth that appears
 * nowhere on the page, which is worse than no number. So the tool's answer is
 * asserted against the PAGE's own read, field for field.
 *
 * TWO: the writing. `readFinancialPath` generates — no stored path, or a stored
 * path the household has outgrown, and it calls a model and stores the result.
 * A chat turn must never do that: it would bill for a question, and it would
 * reshuffle the plan behind the page the question came from. So the model is
 * stubbed and its call count is asserted at zero across every read here, and
 * the stored rows are compared before and after.
 *
 * The path tables are stood up in memory rather than mocked call by call,
 * because what is being tested is state across reads: which row is active, and
 * whether a read of it ever writes one.
 */

const generateObject = vi.fn();
const generateText = vi.fn();
vi.mock('ai', () => ({
  generateObject: (...args: unknown[]) => generateObject(...args),
  generateText: (...args: unknown[]) => generateText(...args),
  // The real `tool()` is an identity function that exists for type inference.
  tool: (definition: unknown) => definition,
}));
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

/** The household behind the read. Set per test. */
let world: PathContext;
vi.mock('../../lib/path-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/path-context.js')>()),
  buildPathContext: async () => world,
}));
// A Monte Carlo has nothing to say about what the tool answers with, and it is
// thousands of times the cost of the rest of the read.
vi.mock('../../services/retirement-readiness.js', () => ({
  buildPathReadiness: async () => null,
}));

// ── The two path tables, in memory ───────────────────────────────────────────

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

const store: { paths: PathRow[]; steps: StepRow[] } = { paths: [], steps: [] };
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

function matching<T extends Record<string, unknown>>(rows: T[], where: unknown): T[] {
  if (!where) return rows;
  const { sql: text, params } = new PgDialect().sqlToQuery(where as never);
  const pairs: Array<[string, unknown]> = [];
  for (const m of text.matchAll(/"[a-z_]+"\."([a-z_]+)" = \$(\d+)/g)) {
    const field = COLUMN[m[1]];
    if (!field) throw new Error(`the fake store does not model column ${m[1]}`);
    pairs.push([field, params[Number(m[2]) - 1]]);
  }
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
          const path = {
            id: newId('path'),
            generatedAt: new Date(),
            model: null,
            status: 'active',
            pendingReason: null,
            createdAt: new Date(),
            ...(row as object),
          } as PathRow;
          store.paths.push(path);
          return path;
        }
        const step = {
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
    financialProfiles: { findFirst: async () => undefined },
  };
}

async function transaction(fn: (tx: unknown) => unknown) {
  return fn({ query: makeQuery(), insert: insertInto, update: updateIn, execute: async () => {} });
}

vi.mock('../../lib/db.js', () => ({
  db: { query: makeQuery(), insert: insertInto, update: updateIn, transaction },
}));

import { PgDialect, financialPaths, financialPathSteps } from '@lasagna/core';
import { buildPathContextDefaults, type PathContext } from '../../lib/path-context.js';
import {
  currentStepKey,
  readFinancialPath,
  serializeStep,
  type PathStepView,
} from '../../routes/financial-path.js';
import { createFinancialTools } from '../tools/financial.js';

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
        minimumPaymentAssumedApr: null,
        termMonths: null,
        originationDate: null,
        payoffDate: null,
        propertyAccountId: null,
        liabilitySource: null,
        liabilityLastSyncedAt: null,
        lastUpdated: null,
        lastStatementBalance: null,
        lastPaymentAmount: null,
        paidInFullMonthly: false,
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

/** The model returns the order it was given, so nothing turns on its taste. */
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

type PathToolResult = {
  steps: PathStepView[];
  notApplicable: { title: string }[];
  currentStep: number | null;
  rebuildPending: boolean;
  note?: string;
};

/** The tool, called exactly as the chat loop calls it. */
async function askTheAgent(): Promise<PathToolResult> {
  const tools = createFinancialTools(TENANT, USER);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return (await tools.get_financial_path.execute!({}, {
    messages: [],
    toolCallId: 'test',
  })) as PathToolResult;
}

/** The path as the PAGE renders it, which is the thing the answer must match. */
async function asThePageShowsIt() {
  const path = await readFinancialPath(TENANT, USER);
  const steps = path.steps.map((step, i) => serializeStep(step, i, path.reasons.get(step.key)));
  const current = currentStepKey(path.steps);
  return {
    steps,
    currentStep: steps.length > 0 ? steps.findIndex((s) => s.id === current) + 1 : null,
  };
}

/** A snapshot of every stored row, to compare a read against itself. */
const snapshot = () => JSON.stringify({ paths: store.paths, steps: store.steps });

beforeEach(() => {
  generateObject.mockReset();
  modelEchoesTheOrder();
  store.paths = [];
  store.steps = [];
  nextId = 0;
  world = household();
});

// ── The figures ──────────────────────────────────────────────────────────────

describe('the answer carries the path that is stored, and nothing else', () => {
  it('gives back the page\'s own steps, in order, figure for figure', async () => {
    // The path is generated ONCE, by the page, as it is in life.
    const page = await asThePageShowsIt();
    expect(page.steps.length).toBeGreaterThan(3);

    const answer = await askTheAgent();

    expect(answer.steps.map((s) => [s.step, s.title])).toEqual(
      page.steps.map((s) => [s.order, s.title]),
    );
    // Every figure the tool states, against the figure the page states for it.
    for (const [i, step] of answer.steps.entries()) {
      const shown = page.steps[i];
      expect({ ...step, step: shown.order }).toEqual({
        step: shown.order,
        title: shown.title,
        why: shown.why,
        reason: shown.reason,
        status: shown.status,
        rateShaped: shown.rateShaped,
        current: shown.current,
        target: shown.target,
        monthlyFunding: shown.monthlyFunding,
        projectedDate: shown.projectedDate,
        action: shown.action,
        fact: shown.fact,
      });
    }
    expect(answer.currentStep).toBe(page.currentStep);
  });

  it('states the figures the sizer computed, not a restatement of them', async () => {
    const page = await asThePageShowsIt();
    const answer = await askTheAgent();

    // The card the household is carrying, sized off its own balance: what is
    // on it today, and the zero it is being carried down to. Found by the
    // position the page gives it, because the answer carries no key to find.
    const shown = page.steps.find((s) => s.id === `debt:${CARD}`)!;
    const card = answer.steps[shown.order - 1];
    expect(card.title).toBe(shown.title);
    expect(card.current).toBe(6_400);
    expect(card.target).toBe(0);
    // And the same step on the page, so this is one figure with one source.
    expect([card.current, card.target, card.monthlyFunding]).toEqual([
      shown.current,
      shown.target,
      shown.monthlyFunding,
    ]);
    expect(card.monthlyFunding).toBeGreaterThan(0);
  });

  it('leaves a step the person took off their path off the numbered list', async () => {
    const page = await asThePageShowsIt();
    const cardTitle = page.steps.find((s) => s.id === `debt:${CARD}`)!.title;
    const { markPathStep } = await import('../../lib/path-generator.js');
    expect(await markPathStep(TENANT, `debt:${CARD}`, 'not_applicable')).toBe(true);

    const answer = await askTheAgent();
    expect(answer.steps.map((s) => s.title)).not.toContain(cardTitle);
    expect(answer.notApplicable).toEqual([
      { title: expect.stringContaining('Rewards card') },
    ]);
    // The numbers close up behind it, exactly as the path page counts.
    expect(answer.steps.map((s) => s.step)).toEqual(
      answer.steps.map((_, i) => i + 1),
    );
  });
});

// ── The ids ──────────────────────────────────────────────────────────────────
//
// A candidate key is `debt:<accountId>` or `goal:<goalId>`, which is to say a
// raw uuid with a word in front of it. Handed one, the model read it as a
// citation key and printed `[a3f7…]` a dozen times into an answer somebody had
// to read. The step number and the title are the whole of what a reader that
// can only explain needs, so the key does not travel.

describe('the answer carries nothing a reader could print as a citation', () => {
  it('has no candidate key and no uuid anywhere in it', async () => {
    await asThePageShowsIt();
    world = household({ goals: [houseDeposit] });

    const answer = await askTheAgent();
    expect(answer.steps.length).toBeGreaterThan(3);

    const wire = JSON.stringify(answer);
    expect(wire).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // The key shape itself, not the words: "Your own goal: $40,000" is copy.
    expect(wire).not.toMatch(/(debt|goal):[0-9a-f]{8}/i);
    expect(wire).not.toContain(CARD);
    expect(wire).not.toContain(GOAL);

    // And not under any name: no field of any step is an id at all.
    for (const step of answer.steps) {
      expect(Object.keys(step).sort()).toEqual([
        'action', 'current', 'fact', 'monthlyFunding', 'projectedDate',
        'rateShaped', 'reason', 'status', 'step', 'target', 'title', 'why',
      ]);
    }
    for (const off of answer.notApplicable) {
      expect(Object.keys(off)).toEqual(['title']);
    }
  });

  it('points at the step they are on by its number, not by its key', async () => {
    const page = await asThePageShowsIt();
    const answer = await askTheAgent();

    expect(answer.currentStep).toBe(page.currentStep);
    expect(answer.steps[answer.currentStep! - 1].title).toBe(
      page.steps[page.currentStep! - 1].title,
    );
  });
});

// ── The order that is about to move ──────────────────────────────────────────
//
// The read cannot rebuild, so between a household changing and the next read of
// the path page it answers with positions that are about to change. Saying so
// is the only thing it can do about that, and the only thing it must not do is
// state one of those positions as settled.

describe('a path that is due to be rebuilt says so', () => {
  it('is not pending while the stored order still describes the household', async () => {
    await asThePageShowsIt();

    expect((await askTheAgent()).rebuildPending).toBe(false);
  });

  it('is pending the moment a goal appears, before the page has placed it', async () => {
    await asThePageShowsIt();
    world = household({ goals: [houseDeposit] });

    const answer = await askTheAgent();
    expect(answer.rebuildPending).toBe(true);
    // The unplaced step is in the answer, at the end, with a number it is about
    // to lose. The flag is what stops that number being read as final.
    expect(answer.steps[answer.steps.length - 1].title).toBe(houseDeposit.name);
  });

  it('stops being pending once the page has rebuilt the order', async () => {
    await asThePageShowsIt();
    world = household({ goals: [houseDeposit] });
    expect((await askTheAgent()).rebuildPending).toBe(true);

    await asThePageShowsIt();

    expect((await askTheAgent()).rebuildPending).toBe(false);
  });

  it('is pending on a reason parked by an act no fingerprint could see', async () => {
    await asThePageShowsIt();
    expect((await askTheAgent()).rebuildPending).toBe(false);

    // A goal edited without crossing a band leaves the ordering inputs
    // identical, so whatever performed it parks the reason instead.
    const { invalidatePath } = await import('../../lib/path-generator.js');
    await invalidatePath(TENANT, 'goal_updated');

    expect((await askTheAgent()).rebuildPending).toBe(true);
  });
});

// ── The writing ──────────────────────────────────────────────────────────────

describe('a chat turn costs no generation and moves no row', () => {
  it('reads a stored path without asking a model anything', async () => {
    await asThePageShowsIt();
    const generationsForThePage = generateObject.mock.calls.length;
    expect(generationsForThePage).toBe(1);
    const before = snapshot();

    await askTheAgent();
    await askTheAgent();
    await askTheAgent();

    expect(generateObject.mock.calls.length).toBe(generationsForThePage);
    expect(snapshot()).toBe(before);
  });

  it('does not regenerate a path the household has outgrown', async () => {
    await asThePageShowsIt();
    const generationsForThePage = generateObject.mock.calls.length;
    const before = snapshot();

    // A goal appears. The page WOULD rebuild the order on this: the set it was
    // ordered over no longer describes the household.
    world = household({ goals: [houseDeposit] });

    const answer = await askTheAgent();

    expect(generateObject.mock.calls.length).toBe(generationsForThePage);
    expect(snapshot()).toBe(before);
    // The step nobody has ordered yet is still shown, at the end, exactly where
    // an unplaced step goes. Not ranking it is not the same as hiding it.
    expect(answer.steps[answer.steps.length - 1].title).toBe(houseDeposit.name);
  });

  it('leaves the page free to rebuild afterwards', async () => {
    await asThePageShowsIt();
    world = household({ goals: [houseDeposit] });
    await askTheAgent();

    // The one place a path changes is still the one place a user can see it.
    const rebuilt = await asThePageShowsIt();
    expect(generateObject.mock.calls.length).toBe(2);
    expect(rebuilt.steps.map((s) => s.id)).toContain(`goal:${GOAL}`);

    // And from then on the answer is the rebuilt path, still without spending.
    const answer = await askTheAgent();
    expect(generateObject.mock.calls.length).toBe(2);
    expect(answer.steps.map((s) => s.title)).toEqual(rebuilt.steps.map((s) => s.title));
  });
});

// ── Nobody's path ────────────────────────────────────────────────────────────

describe('a person with no path', () => {
  it('is answered with nothing, rather than a path invented for them', async () => {
    const answer = await askTheAgent();

    expect(answer.steps).toEqual([]);
    expect(answer.notApplicable).toEqual([]);
    expect(answer.currentStep).toBeNull();
    expect(answer.rebuildPending).toBe(false);
    expect(answer.note).toContain('no financial path yet');
  });

  it('is not given one as a side effect of asking', async () => {
    await askTheAgent();

    expect(generateObject).not.toHaveBeenCalled();
    expect(store.paths).toEqual([]);
    expect(store.steps).toEqual([]);
  });
});
