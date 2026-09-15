import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The brake on the read-triggered regeneration loop.
 *
 * generateInsights writes lastActionsGeneratedAt, and routes/insights reads it
 * to decide whether a page view should regenerate. The marker used to be
 * written only after everything succeeded, roughly 140 lines past the parse
 * that could throw, so a household whose generation kept failing was stale on
 * every read and every read bought another full model call. useInsights is
 * mounted on the home screen as well as /insights, so nearly every navigation
 * re-entered it: one household ran 303 calls for $23.78 over 15 continuous
 * hours, each one 45 to 60 seconds, the next starting within 90 seconds of the
 * last finishing.
 *
 * Two halves hold it shut, and both are asserted here against the real code:
 *
 *  1. A generation that FAILS still records the attempt.
 *  2. A read whose recorded attempt is inside the window does not regenerate.
 */

// ── The model, and everything the engine reaches for around it ───────────────

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

function rowsFor(table: unknown): unknown[] {
  // Only the accounts read matters: it decides there is a household to analyse.
  return table === accounts
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
    delete: () => settled(),
    insert: (table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        if (table === financialProfiles) profileWrites.push(row);
        return settled();
      },
    }),
  },
}));

import { accounts, financialProfiles } from "@lasagna/core";
import { generateInsights } from "../insights-engine.js";

const TENANT = "00000000-0000-4000-8000-0000000000aa";

const oneAction = {
  category: "debt",
  urgency: "high",
  type: "debt",
  title: "Pay down your card",
  description: "Because the numbers say so.",
  impact: "Save $340/yr",
  impactColor: "green",
  chatPrompt: "Tell me more",
};

beforeEach(() => {
  profileWrites.length = 0;
  llmGenerateObject.mockReset();
});

describe("a generation that fails still records the attempt", () => {
  it("marks the attempt when the model call throws", async () => {
    llmGenerateObject.mockRejectedValue(new Error("provider 502"));

    await expect(generateInsights(TENANT)).rejects.toThrow("provider 502");

    // THE assertion. Without this write the household stays stale, and the very
    // next read pays for the whole call again.
    expect(profileWrites).toHaveLength(1);
    expect(profileWrites[0].tenantId).toBe(TENANT);
    expect(profileWrites[0].lastActionsGeneratedAt).toBeInstanceOf(Date);
  });

  it("marks the attempt when the response does not match the schema", async () => {
    llmGenerateObject.mockRejectedValue(new Error("No object generated"));

    await expect(generateInsights(TENANT)).rejects.toThrow("No object generated");

    expect(profileWrites).toHaveLength(1);
    expect(profileWrites[0].lastActionsGeneratedAt).toBeInstanceOf(Date);
  });

  it("still marks the attempt on the success path, exactly once", async () => {
    llmGenerateObject.mockResolvedValue({ object: { insights: [oneAction] } });

    expect(await generateInsights(TENANT)).toBe(1);

    expect(profileWrites).toHaveLength(1);
    expect(profileWrites[0].lastActionsGeneratedAt).toBeInstanceOf(Date);
  });
});
