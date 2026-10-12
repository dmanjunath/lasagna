import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Carrying an action forward from one run to the next.
 *
 * Each run used to delete every action and write a fresh set, so no action
 * could say when it was first found. Now the model is shown the open actions
 * with their ids, and an action that still holds names the id it continues:
 * that row is rewritten in place (same id, same created_at, a new 30 days),
 * and only what the run neither wrote nor carried forward is cleared, after
 * the writes. Asserted against the real engine with the model and the
 * database stood in for, so no test spends a model call.
 */

const llmGenerateObject = vi.fn();
vi.mock("../llm.js", () => ({
  llmGenerateObject: (...args: unknown[]) => llmGenerateObject(...args),
}));
vi.mock("../../agent/index.js", () => ({ getModel: () => ({}) as never }));
vi.mock("../activity.js", () => ({ logLlmUsage: vi.fn(), actualLlmCostUsd: () => undefined }));
vi.mock("../billing.js", () => ({ isTenantDisabled: async () => false }));
vi.mock("../pii-scrubber.js", () => ({
  buildAliasMap: async () => ({ forward: new Map(), reverse: new Map() }),
  scrub: (x: unknown) => x,
  descrub: (x: unknown) => x,
  descrubObject: (x: unknown) => x,
}));
vi.mock("../account-balances.js", () => ({
  excludedTxnAccountIds: async () => [] as string[],
  fetchAccountsWithBalances: async () => [] as unknown[],
}));
vi.mock("../goal-progress.js", () => ({
  buildGoalAccountMap: () => new Map(),
  resolveGoalAmount: () => ({ amount: 0 }),
}));
vi.mock("../profile-resolver.js", () => ({
  readHouseholdProfile: async () => null,
  readOwnerPersonalProfile: async () => null,
  resolveProfile: () => ({
    annualIncome: null,
    filingStatus: null,
    stateOfResidence: null,
    riskTolerance: null,
    retirementAge: null,
    employerMatchPercent: null,
    age: null,
  }),
}));
vi.mock("../path-generator.js", () => ({ readPathSteps: async () => [] }));

// ── A database that answers, without being one ──────────────────────────────

/** Every row written to financial_profiles, which is where the marker lives. */
const profileWrites: Record<string, unknown>[] = [];
/** Every write to the actions table, in order. */
const log: Array<{ op: "insert" | "update" | "delete"; row?: Record<string, unknown>; cond?: unknown }> = [];

/** The actions already on the list, as openEngineActions reads them. */
let currentRows: Array<{ id: string; title: string }> = [];

/** Extra accounts a test adds beside the checking account. */
let extraAccounts: Record<string, unknown>[] = [];

function rowsFor(table: unknown): unknown[] {
  if (table === insights) return currentRows;
  if (table === accounts && extraAccounts.length > 0) {
    return [...(rowsFor(null) as never[]), ...extraAccounts];
  }
  // The accounts read decides there is a household to analyse.
  return table === accounts || table === null
    ? [
        {
          name: "Everyday checking",
          type: "depository",
          subtype: "checking",
          metadata: null,
          accountId: "00000000-0000-4000-8000-000000000001",
          excludeFromNetWorth: false,
          invertBalance: false,
        },
      ]
    : [];
}

function selectChain() {
  let table: unknown = null;
  const self: Record<string, unknown> = {
    from: (t: unknown) => {
      table = t;
      return self;
    },
    innerJoin: () => self,
    leftJoin: () => self,
    where: () => self,
    orderBy: () => self,
    groupBy: () => self,
    limit: () => self,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(table)).then(res, rej),
  };
  return self;
}

function settled() {
  const self: Record<string, unknown> = {
    where: () => self,
    onConflictDoUpdate: () => self,
    returning: () => Promise.resolve([]),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve([]).then(res, rej),
  };
  return self;
}

vi.mock("../db.js", () => ({
  db: {
    select: () => selectChain(),
    query: { goalAccounts: { findMany: async () => [] } },
    delete: (table: unknown) => {
      if (table === insights) log.push({ op: "delete" });
      return settled();
    },
    update: (table: unknown) => ({
      set: (row: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (table === insights) log.push({ op: "update", row, cond });
          return settled();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (table === financialProfiles) profileWrites.push(row);
        if (table === insights) log.push({ op: "insert", row });
        return settled();
      },
    }),
  },
}));

import { accounts, financialProfiles, insights, PgDialect } from "@lasagna/core";
import { generateInsights } from "../insights-engine.js";

const TENANT = "00000000-0000-4000-8000-0000000000aa";
const DAY = 24 * 60 * 60 * 1000;

const action = (over: Record<string, unknown> = {}) => ({
  category: "debt",
  urgency: "high",
  type: "debt",
  title: "Pay down your $3,076 card to stop $736/yr in interest",
  description: "Because the numbers say so.",
  impact: "$736/yr interest",
  impactColor: "amber",
  chatPrompt: "Tell me more",
  ...over,
});

function respond(list: unknown[]) {
  llmGenerateObject.mockResolvedValueOnce({ object: { insights: list } });
}

const condSql = (cond: unknown) => new PgDialect().sqlToQuery(cond as never);

beforeEach(() => {
  llmGenerateObject.mockReset();
  log.length = 0;
  currentRows = [{ id: "old-card", title: "Pay down your card" }, { id: "old-hsa", title: "Open an HSA" }];
  extraAccounts = [];
});

describe("a card the person pays in full is never offered as debt", () => {
  it("goes to the model as paid in full, not in the debt trajectory", async () => {
    // The real case: two Plaid cards with no statement data, marked by hand as
    // paid in full each month. The engine's account read used to leave the
    // flag out, so both went to the model as debt and it advised clearing them.
    extraAccounts = [
      {
        name: "Everyday card",
        type: "credit",
        subtype: "credit card",
        metadata: null,
        accountId: "00000000-0000-4000-8000-000000000002",
        excludeFromNetWorth: false,
        invertBalance: false,
        paidInFullMonthly: true,
      },
    ];
    respond([]);
    await generateInsights(TENANT);
    const prompt = llmGenerateObject.mock.calls[0][1].prompt as string;
    const data = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.indexOf("\n\nHere are the current actions")));
    expect(data.paidInFullCards.map((c: { name: string }) => c.name)).toEqual(["Everyday card"]);
    expect(data.debtTrajectory.map((d: { name: string }) => d.name)).not.toContain("Everyday card");
  });
});

describe("an action that still holds is carried forward", () => {
  it("shows the model the open actions with their ids", async () => {
    respond([]);
    await generateInsights(TENANT);
    const prompt = llmGenerateObject.mock.calls[0][1].prompt as string;
    expect(prompt).toContain("current actions on their list");
    expect(prompt).toContain('"id":"old-card"');
  });

  it("rewrites the continued row in place with a new 30 days, instead of inserting", async () => {
    respond([action({ continuesId: "old-card" })]);
    const before = Date.now();
    await generateInsights(TENANT);

    const update = log.find((e) => e.op === "update")!;
    expect(update).toBeDefined();
    expect(condSql(update.cond).params).toContain("old-card");
    const expires = (update.row!.expiresAt as Date).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 30 * DAY - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 30 * DAY);
    // created_at is never written, so the row keeps saying when it was found.
    expect(update.row).not.toHaveProperty("createdAt");
    expect(log.filter((e) => e.op === "insert")).toHaveLength(0);
  });

  it("inserts a new action, and one naming an id that is not on the list", async () => {
    respond([action(), action({ title: "Raise your 401(k) to 4% to claim $3,400/yr", continuesId: "made-up" })]);
    await generateInsights(TENANT);
    expect(log.filter((e) => e.op === "insert")).toHaveLength(2);
    expect(log.filter((e) => e.op === "update")).toHaveLength(0);
  });

  it("carries an id forward once, never onto two actions", async () => {
    respond([action({ continuesId: "old-card" }), action({ title: "Move $5,000 to the card", continuesId: "old-card" })]);
    await generateInsights(TENANT);
    expect(log.filter((e) => e.op === "update")).toHaveLength(1);
    expect(log.filter((e) => e.op === "insert")).toHaveLength(1);
  });

  it("clears what was not carried forward AFTER writing, by its age", async () => {
    respond([action({ continuesId: "old-card" })]);
    await generateInsights(TENANT);
    const ops = log.map((e) => e.op);
    expect(ops[ops.length - 1]).toBe("delete");
    expect(ops.indexOf("delete")).toBeGreaterThan(ops.indexOf("update"));
  });

  it("marks an overspend action so the list can keep only one", async () => {
    respond([action({ type: "spending", title: "Cap dining near $119 after it jumped 34% to $159", overspend: true })]);
    await generateInsights(TENANT);
    expect(log.find((e) => e.op === "insert")!.row!.metadata).toEqual({ overspend: true });
  });
});
