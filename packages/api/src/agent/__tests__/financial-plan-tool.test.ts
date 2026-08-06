import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Core mock: identity-ish query builders + a financialPlans table marker ──
// eq/ne/and return array nodes so the fake db can reconstruct the WHERE clause.
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  ne: (...args: unknown[]) => ["ne", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  parsePropertyMetadata: () => null,
  financialPlans: {
    _table: "financialPlans",
    id: "financialPlans.id",
    title: "financialPlans.title",
    document: "financialPlans.document",
    tenantId: "financialPlans.tenantId",
    userId: "financialPlans.userId",
    status: "financialPlans.status",
  },
  // Table markers the enriched grounding (resolvePersonContext) references.
  accounts: { tenantId: "accounts.tenantId" },
  goals: { tenantId: "goals.tenantId", createdAt: "goals.createdAt" },
  taxDocuments: { tenantId: "taxDocuments.tenantId", createdAt: "taxDocuments.createdAt" },
}));

interface PlanRow {
  id: string;
  tenantId: string;
  userId: string;
  title: string;
  document: string | null;
  status: string;
}
let planTable: PlanRow[] = [];

function extractClauses(where: unknown): { eqs: Record<string, unknown>; nes: Record<string, unknown> } {
  const eqs: Record<string, unknown> = {};
  const nes: Record<string, unknown> = {};
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    const [op, ...rest] = node;
    if (op === "eq") eqs[String(rest[0])] = rest[1];
    else if (op === "ne") nes[String(rest[0])] = rest[1];
    else if (op === "and") for (const child of rest) visit(child);
  };
  visit(where);
  return { eqs, nes };
}

function matchPlans(where: unknown): PlanRow[] {
  const { eqs, nes } = extractClauses(where);
  return planTable.filter((row) => {
    if ("financialPlans.id" in eqs && row.id !== eqs["financialPlans.id"]) return false;
    if ("financialPlans.tenantId" in eqs && row.tenantId !== eqs["financialPlans.tenantId"]) return false;
    if ("financialPlans.userId" in eqs && row.userId !== eqs["financialPlans.userId"]) return false;
    if (nes["financialPlans.status"] != null && row.status === nes["financialPlans.status"]) return false;
    return true;
  });
}

// Captures the last update()'s SET payload so a test can assert what was written.
let lastUpdate: { set: Record<string, unknown>; where: unknown } | null = null;

// The enriched grounding (resolvePersonContext) reads accounts/profiles/goals/
// tax-docs via db.query.*. This tool test only cares about plan scoping + the
// compact shape, so every enrichment read returns empty — person comes back
// with null/empty blocks and the assertions below (which don't inspect person)
// stay valid.
const emptyQuery = { findMany: async () => [], findFirst: async () => undefined };

vi.mock("../../lib/db.js", () => ({
  db: {
    query: new Proxy({}, { get: () => emptyQuery }),
    select: (_proj?: unknown) => ({
      from: (_table: unknown) => ({
        where: (where: unknown) => Promise.resolve(matchPlans(where)),
      }),
    }),
    update: (_table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          lastUpdate = { set, where };
          // Apply the write to the fake table so a follow-up read sees it.
          for (const row of matchPlans(where)) {
            if (typeof set.document === "string") row.document = set.document;
          }
          return Promise.resolve(undefined);
        },
      }),
    }),
  },
}));

import { createFinancialPlanTools } from "../tools/plans.js";

// A representative stored document with all three sections plus the large arrays
// the compact grounding is supposed to DROP.
const DOCUMENT = {
  sections: {
    snapshot: {
      section: "snapshot",
      totalAssets: 500000,
      totalDebt: 120000,
      netWorth: 380000,
      monthlySpend: 4200,
      age: 41,
      annualIncome: 150000,
      breakdown: [{ kind: "asset", type: "investment", value: 500000 }],
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    portfolio: {
      section: "portfolio",
      totalValue: 500000,
      classes: [
        {
          name: "US Stocks",
          value: 400000,
          weight: 80,
          categories: [{ name: "S&P 500", value: 400000, weight: 80 }],
        },
        { name: "Bonds", value: 100000, weight: 20, categories: [{ name: "Agg", value: 100000, weight: 20 }] },
      ],
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    retirement: {
      section: "retirement",
      computed: true,
      currentAge: 41,
      retirementAge: 65,
      planThroughAge: 95,
      successRate: 88,
      targetSuccess: 85,
      verdict: "on_track",
      medianLastsToAge: null,
      blendedExpectedReturn: 0.061,
      // Large arrays that must be dropped from the compact shape.
      growth: Array.from({ length: 55 }, (_, i) => ({ age: 41 + i, median: 1000 * i, p25: 900 * i, p75: 1100 * i, phase: "accumulation" })),
      methods: [
        { strategy: "constant_dollar", label: "4% rule (constant dollar)", successRate: 82, medianLastsToAge: 92, recommended: false },
        { strategy: "guardrails", label: "Guardrails", successRate: 88, medianLastsToAge: null, recommended: true },
      ],
      recommendedStrategy: "guardrails",
      drawdownOrder: [
        { bucket: "taxable", label: "Taxable", balance: 200000 },
        { bucket: "deferred", label: "Tax-deferred", balance: 250000 },
      ],
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
  },
};

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  planTable = [
    { id: PLAN_ID, tenantId: "tenant-1", userId: "user-a", title: "My Plan", document: JSON.stringify(DOCUMENT), status: "draft" },
  ];
  lastUpdate = null;
});

describe("get_financial_plan tool", () => {
  it("returns the stored section numbers for a plan the caller owns", async () => {
    const tools = createFinancialPlanTools("tenant-1", "user-a", PLAN_ID);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = (await tools.get_financial_plan.execute!({}, { messages: [], toolCallId: "t" })) as {
      title: string;
      snapshot: { netWorth: number; annualIncome: number | null };
      portfolio: { totalValue: number; allocation: { name: string; weight: number }[] };
      retirement: {
        verdict: string;
        successRate: number;
        targetSuccess: number;
        retirementAge: number;
        blendedExpectedReturn: number;
        recommendedStrategy: string;
        methods: unknown[];
        drawdownOrder: { bucket: string }[];
      } & Record<string, unknown>;
    };

    // Snapshot totals come straight from the stored section.
    expect(result.title).toBe("My Plan");
    expect(result.snapshot.netWorth).toBe(380000);
    expect(result.snapshot.annualIncome).toBe(150000);

    // Portfolio allocation (the class-level weights) is surfaced.
    expect(result.portfolio.totalValue).toBe(500000);
    expect(result.portfolio.allocation).toEqual([
      { name: "US Stocks", weight: 80, value: 400000 },
      { name: "Bonds", weight: 20, value: 100000 },
    ]);

    // Retirement: the "am I on track?" reconciling numbers.
    expect(result.retirement.verdict).toBe("on_track");
    expect(result.retirement.successRate).toBe(88);
    expect(result.retirement.targetSuccess).toBe(85);
    expect(result.retirement.retirementAge).toBe(65);
    expect(result.retirement.blendedExpectedReturn).toBeCloseTo(0.061);
    expect(result.retirement.recommendedStrategy).toBe("guardrails");
    expect(result.retirement.methods).toHaveLength(2);
    expect(result.retirement.drawdownOrder.map((d) => d.bucket)).toEqual(["taxable", "deferred"]);

    // The big growth/percentile arrays are DROPPED from the compact shape.
    expect(result.retirement).not.toHaveProperty("growth");
  });

  it("errors for a plan owned by another user in the same tenant", async () => {
    planTable = [
      { id: PLAN_ID, tenantId: "tenant-1", userId: "user-b", title: "Someone else's", document: JSON.stringify(DOCUMENT), status: "draft" },
    ];
    const tools = createFinancialPlanTools("tenant-1", "user-a", PLAN_ID);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = (await tools.get_financial_plan.execute!({}, { messages: [], toolCallId: "t" })) as {
      error?: string;
    };
    expect(result.error).toBe("Plan not found");
  });

  it("errors for a plan in another tenant", async () => {
    const tools = createFinancialPlanTools("tenant-2", "user-a", PLAN_ID);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = (await tools.get_financial_plan.execute!({}, { messages: [], toolCallId: "t" })) as {
      error?: string;
    };
    expect(result.error).toBe("Plan not found");
  });
});

// Reads the goals section back off the (mutated) fake row.
function storedGoals(): Record<string, unknown> | undefined {
  const row = planTable.find((r) => r.id === PLAN_ID);
  if (!row?.document) return undefined;
  return (JSON.parse(row.document) as { sections?: { goals?: Record<string, unknown> } }).sections
    ?.goals;
}

describe("update_financial_plan_goals tool", () => {
  it("merges supplied goal fields into the bound plan without clobbering the rest", async () => {
    const tools = createFinancialPlanTools("tenant-1", "user-a", PLAN_ID);

    // First write: two core numbers.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const first = (await tools.update_financial_plan_goals.execute!(
      { retirementAge: 62, retirementIncome: 90000 },
      { messages: [], toolCallId: "t" },
    )) as { success?: boolean; goals?: Record<string, unknown> };
    expect(first.success).toBe(true);
    expect(first.goals).toMatchObject({ retirementAge: 62, retirementIncome: 90000 });

    // Second write: a different field + named goals. The first write's fields
    // must survive (a merge, not a replace).
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await tools.update_financial_plan_goals.execute!(
      {
        planEndAge: 95,
        namedGoals: [{ label: "Kids' college", targetAmount: 200000, targetYear: 2038 }],
      },
      { messages: [], toolCallId: "t" },
    );

    const goals = storedGoals();
    expect(goals).toMatchObject({
      section: "goals",
      retirementAge: 62,
      retirementIncome: 90000,
      planEndAge: 95,
      namedGoals: [{ label: "Kids' college", targetAmount: 200000, targetYear: 2038 }],
    });

    // Untouched sections are preserved in the document.
    const row = planTable.find((r) => r.id === PLAN_ID);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const doc = JSON.parse(row!.document!) as { sections: Record<string, unknown> };
    expect(doc.sections.snapshot).toBeDefined();
    expect(doc.sections.retirement).toBeDefined();
  });

  it("errors for a plan owned by another user in the same tenant and writes nothing", async () => {
    planTable = [
      { id: PLAN_ID, tenantId: "tenant-1", userId: "user-b", title: "Someone else's", document: JSON.stringify(DOCUMENT), status: "draft" },
    ];
    const tools = createFinancialPlanTools("tenant-1", "user-a", PLAN_ID);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const result = (await tools.update_financial_plan_goals.execute!(
      { retirementAge: 62 },
      { messages: [], toolCallId: "t" },
    )) as { error?: string };
    expect(result.error).toBe("Plan not found");
    expect(lastUpdate).toBeNull();
  });

  // The demo gate in agent.ts strips tools BY NAME
  // (`const { update_financial_plan_goals, ... } = allTools`). This asserts the
  // real tool keys the gate targets, so a rename here can't silently un-gate the
  // write tool while leaving the read-only tool intact.
  it("exposes the exact tool keys the demo gate targets: write mutates, read stays", () => {
    const tools = createFinancialPlanTools("tenant-1", "user-a", PLAN_ID);
    expect(Object.keys(tools).sort()).toEqual([
      "get_financial_plan",
      "update_financial_plan_goals",
    ]);
  });
});
