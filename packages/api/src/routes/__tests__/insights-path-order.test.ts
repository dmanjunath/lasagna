import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

/**
 * The actions list, read in the order of the plan it serves.
 *
 * This drives the real route over real path rows. The two path tables are stood
 * up in memory rather than mocked call by call, because the property that
 * matters is state ACROSS a regeneration: a path is replaced by superseding its
 * steps and inserting a fresh set, and the question is whether an action written
 * against the old one still finds its place in the new one.
 *
 * That is the whole argument for storing the candidate key instead of a step
 * row id. A row id would be dangling the moment the order is chosen again, and
 * every action would come loose from the plan on every rebuild.
 */

const TENANT = "00000000-0000-4000-8000-000000000001";
const CARD = "11111111-1111-4111-8111-111111111111";

interface PathRow {
  id: string;
  tenantId: string;
  status: string;
  generatedAt: Date;
  reason: string;
  inputsFingerprint: string;
  model: string | null;
  orderSource: string;
  pendingReason: string | null;
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
interface InsightRow {
  id: string;
  tenantId: string;
  category: string;
  urgency: string;
  insightType: string | null;
  title: string;
  description: string;
  impact: string | null;
  impactColor: string | null;
  chatPrompt: string | null;
  generatedBy: string;
  createdAt: Date;
  pathStepKey: string | null;
}

const store = {
  paths: [] as PathRow[],
  steps: [] as StepRow[],
  insights: [] as InsightRow[],
  accounts: [] as Array<{ id: string; name: string }>,
  goals: [] as Array<{ id: string; name: string }>,
};

/** snake_case as the SQL names it → the camelCase the rows are held in. */
const COLUMN: Record<string, string> = {
  id: "id",
  tenant_id: "tenantId",
  path_id: "pathId",
  status: "status",
};

function matching<T extends Record<string, unknown>>(rows: T[], where: unknown): T[] {
  if (!where) return rows;
  const { sql: text, params } = new PgDialect().sqlToQuery(where as never);
  const pairs: Array<[string, unknown]> = [];
  for (const m of text.matchAll(/"[a-z_]+"\."([a-z_]+)" = \$(\d+)/g)) {
    const field = COLUMN[m[1]];
    if (!field) continue;
    pairs.push([field, params[Number(m[2]) - 1]]);
  }
  return rows.filter((row) => pairs.every(([field, value]) => row[field] === value));
}

/**
 * A select chain. Which table it reads is taken off `.from()`, and the tenant
 * filter is the only one modelled: everything here belongs to one tenant, and
 * the id lists the path reads with are built from the rows themselves.
 */
function selectChain() {
  let table: unknown = null;
  const self: Record<string, unknown> = {
    from: (t: unknown) => {
      table = t;
      return self;
    },
    where: () => self,
    orderBy: () => self,
    limit: () => self,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const rows =
        table === insights
          ? store.insights
          : table === accounts
            ? store.accounts
            : table === goals
              ? store.goals
              : [];
      return Promise.resolve(rows.map((r) => ({ ...r }))).then(res, rej);
    },
  };
  return self;
}

vi.mock("../../lib/db.js", () => ({
  db: {
    select: () => selectChain(),
    query: {
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
    },
  },
}));

// Generation is never reached: the profile below is freshly stamped, so the
// stale backstop does not fire. Stubbed so a regression there fails loudly
// rather than quietly paying for a model call.
const generateInsights = vi.fn(async () => 0);
vi.mock("../../lib/insights-engine.js", () => ({
  generateInsights: () => generateInsights(),
}));
vi.mock("../../lib/profile-resolver.js", () => ({
  readHouseholdProfile: async () => ({ lastActionsGeneratedAt: new Date() }),
}));

import { PgDialect, accounts, goals, insights } from "@lasagna/core";
import type { AuthEnv } from "../../middleware/auth.js";
import { insightsRoutes } from "../insights.js";

// Typed as the routes are, so the session this stands in for is the session
// they read rather than an untyped stub.
const app = new Hono<AuthEnv>();
app.use("*", async (c, next) => {
  c.set("session", { tenantId: TENANT, userId: "u1" } as AuthEnv["Variables"]["session"]);
  await next();
});
app.route("/insights", insightsRoutes);

let nextId = 0;
const newId = (prefix: string) => `${prefix}-${++nextId}`;

/**
 * Store a path for this tenant, superseding whatever it replaces exactly as
 * `generatePath` does: the old row stops being active, and a brand new set of
 * step ROWS is written under a brand new path id, carrying the same keys.
 */
function storePath(keys: string[]): string {
  for (const p of store.paths) if (p.tenantId === TENANT) p.status = "superseded";
  const id = newId("path");
  store.paths.push({
    id,
    tenantId: TENANT,
    status: "active",
    generatedAt: new Date(),
    reason: "no_active_path",
    inputsFingerprint: "f",
    model: null,
    orderSource: "model",
    pendingReason: null,
  });
  keys.forEach((candidateKey, position) => {
    store.steps.push({
      id: newId("step"),
      pathId: id,
      tenantId: TENANT,
      position,
      candidateKey,
      reason: "",
      status: "pending",
      note: "",
      statusAt: null,
    });
  });
  return id;
}

function storeInsight(title: string, urgency: string, pathStepKey: string | null) {
  store.insights.push({
    id: newId("insight"),
    tenantId: TENANT,
    category: "general",
    urgency,
    insightType: "general",
    title,
    description: "",
    impact: null,
    impactColor: null,
    chatPrompt: null,
    generatedBy: "ai",
    createdAt: new Date(),
    pathStepKey,
  });
}

/** The titles the route answers with, in the order it answers with them. */
async function listed(): Promise<string[]> {
  const res = await app.request("/insights");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { insights: Array<{ title: string }> };
  return body.insights.map((i) => i.title);
}

/** The step key the route answers with, per action, by title. */
async function keys(): Promise<Record<string, string | null>> {
  const res = await app.request("/insights");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { insights: Array<{ title: string; pathStepKey: string | null }> };
  return Object.fromEntries(body.insights.map((i) => [i.title, i.pathStepKey]));
}

/** A six step path. Only the first and the last carry anything here. */
const SIX_STEPS = [
  "stabilize",
  `debt:${CARD}`,
  "emergency-fund",
  "insurance-will",
  "tax-advantaged",
  "estate-legacy",
];

beforeEach(() => {
  store.paths = [];
  store.steps = [];
  store.insights = [];
  store.accounts = [{ id: CARD, name: "Rewards card" }];
  store.goals = [];
  nextId = 0;
  generateInsights.mockClear();
});

describe("the actions list reads in path order", () => {
  it("puts a low urgency action on step 1 above a critical one on step 6", async () => {
    storePath(SIX_STEPS);
    // The order the SQL hands them over in: urgency alone, which is what this
    // list used to be. Nothing about step 6 changes because it is critical.
    storeInsight("Write your will", "critical", "estate-legacy");
    storeInsight("Move $200 into your buffer", "low", "stabilize");

    expect(await listed()).toEqual(["Move $200 into your buffer", "Write your will"]);
    expect(generateInsights).not.toHaveBeenCalled();
  });

  it("keeps urgency deciding the order inside one step", async () => {
    storePath(SIX_STEPS);
    storeInsight("Cover the deductible first", "critical", "stabilize");
    storeInsight("Move $200 into your buffer", "low", "stabilize");

    expect(await listed()).toEqual(["Cover the deductible first", "Move $200 into your buffer"]);
  });

  it("shows an action with no step, after every action that has one", async () => {
    storePath(SIX_STEPS);
    storeInsight("Dispute the charge you did not make", "critical", null);
    storeInsight("Move $200 into your buffer", "low", "stabilize");
    storeInsight("Write your will", "medium", "estate-legacy");

    expect(await listed()).toEqual([
      "Move $200 into your buffer",
      "Write your will",
      "Dispute the charge you did not make",
    ]);
  });

  it("reads a key that names no step on the path as no step at all", async () => {
    // The step was taken off the path, so it is not one of its steps any more.
    // The action is not lost with it.
    storePath(["stabilize", "emergency-fund"]);
    storeInsight("Buy term life", "critical", "insurance-will");
    storeInsight("Move $200 into your buffer", "low", "stabilize");

    expect(await listed()).toEqual(["Move $200 into your buffer", "Buy term life"]);
  });

  it("leaves the list alone when the person has no path", async () => {
    storeInsight("Write your will", "critical", "estate-legacy");
    storeInsight("Move $200 into your buffer", "low", "stabilize");

    expect(await listed()).toEqual(["Write your will", "Move $200 into your buffer"]);
  });
});

describe("a regenerated path does not lose an action", () => {
  it("keeps the action attached when every step row is replaced", async () => {
    const first = storePath(SIX_STEPS);
    storeInsight("Write your will", "critical", "estate-legacy");
    storeInsight("Move $200 into your buffer", "low", "stabilize");
    expect(await listed()).toEqual(["Move $200 into your buffer", "Write your will"]);

    // Regenerate: the order is chosen again, the old path is superseded, and a
    // completely new set of step rows is written.
    const second = storePath([...SIX_STEPS].reverse());
    expect(second).not.toBe(first);
    const before = store.steps.filter((s) => s.pathId === first).map((s) => s.id);
    const after = store.steps.filter((s) => s.pathId === second).map((s) => s.id);
    expect(after.some((id) => before.includes(id))).toBe(false);

    // Both actions are still here, still attached, and now in the new order:
    // the estate step leads the reversed path, so its action does too.
    expect(await listed()).toEqual(["Write your will", "Move $200 into your buffer"]);
  });

  it("keeps an action whose step moved off the path, unattached rather than gone", async () => {
    storePath(SIX_STEPS);
    storeInsight("Pay down your card", "high", `debt:${CARD}`);
    storeInsight("Move $200 into your buffer", "low", "stabilize");

    // The card is cleared, so the next path has no step for it at all.
    storePath(SIX_STEPS.filter((k) => k !== `debt:${CARD}`));

    expect(await listed()).toEqual(["Move $200 into your buffer", "Pay down your card"]);
  });
});

/**
 * What the payload SAYS is what it means.
 *
 * The stored column is a candidate key, and a key outlives the path it was
 * written against: the order gets chosen again, a step is taken off, or nothing
 * has attached this action yet. Every one of those leaves a key naming no step
 * on the plan as it stands, and answering with it would invite a reader to file
 * the action under a step that is not there. So the route resolves it, and the
 * three surfaces that re-resolve it today stop being what keeps this honest.
 */
describe("the step key it answers with names a step on the path", () => {
  it("answers with the key when the step is on the path", async () => {
    storePath(SIX_STEPS);
    storeInsight("Top up the buffer", "medium", "emergency-fund");
    expect(await keys()).toEqual({ "Top up the buffer": "emergency-fund" });
  });

  it("answers null for a key that names no step on the path", async () => {
    storePath(SIX_STEPS);
    storeInsight("Check this statement", "medium", "a-step-that-is-not-on-the-path");
    expect(await keys()).toEqual({ "Check this statement": null });
  });

  it("answers null for a key whose step was taken off the path", async () => {
    storePath(SIX_STEPS);
    storeInsight("Clear the card", "high", `debt:${CARD}`);
    expect(await keys()).toEqual({ "Clear the card": `debt:${CARD}` });
    // Regenerated without that step, exactly as marking it not applicable does.
    storePath(SIX_STEPS.filter((k) => k !== `debt:${CARD}`));
    expect(await keys()).toEqual({ "Clear the card": null });
  });

  it("answers null for every key when the person has no path", async () => {
    storeInsight("Move idle cash", "medium", "emergency-fund");
    storeInsight("Check this statement", "low", null);
    expect(await keys()).toEqual({ "Move idle cash": null, "Check this statement": null });
  });
});
