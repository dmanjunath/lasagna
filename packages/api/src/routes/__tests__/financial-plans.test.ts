import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ── Core mock: identity-ish query builders + table markers ──
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  ne: (...args: unknown[]) => ["ne", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  financialPlans: {
    _table: "financialPlans",
    id: "financialPlans.id",
    tenantId: "financialPlans.tenantId",
    userId: "financialPlans.userId",
    title: "financialPlans.title",
    document: "financialPlans.document",
    status: "financialPlans.status",
    createdAt: "financialPlans.createdAt",
    updatedAt: "financialPlans.updatedAt",
  },
}));

// The snapshot builder is exercised by its own path; here we stub it so the
// router test stays a pure routing/scoping test that doesn't touch the DB math.
const buildFinancialSnapshot = vi.fn();
vi.mock("../../services/financial-snapshot.js", () => ({
  buildFinancialSnapshot: (...args: unknown[]) => buildFinancialSnapshot(...args),
}));

const buildPortfolioSection = vi.fn();
vi.mock("../../services/portfolio-section.js", () => ({
  buildPortfolioSection: (...args: unknown[]) => buildPortfolioSection(...args),
}));

const buildRetirementReadiness = vi.fn();
vi.mock("../../services/retirement-readiness.js", () => ({
  buildRetirementReadiness: (...args: unknown[]) => buildRetirementReadiness(...args),
}));

const buildWhatIfSection = vi.fn();
vi.mock("../../services/what-if-section.js", () => ({
  buildWhatIfSection: (...args: unknown[]) => buildWhatIfSection(...args),
}));

// The schedule builder is deterministic and the strategy builder wraps the LLM;
// stub both (and the grounding helper they're fed) so this stays a routing test
// with no DB math or model call. Mocking them also keeps their heavy transitive
// imports (portfolio.ts → security-classifier.ts) out of this suite.
// Default: no schedule, no strategy.
const buildRetirementSchedule = vi.fn();
vi.mock("../../services/retirement-schedule.js", () => ({
  buildRetirementSchedule: (...args: unknown[]) => buildRetirementSchedule(...args),
}));
const buildStrategySection = vi.fn();
vi.mock("../../services/strategy-section.js", () => ({
  buildStrategySection: (...args: unknown[]) => buildStrategySection(...args),
}));
// plan-assumptions (imported for the assumptions route) value-imports the
// narrative builder for legacy regens; stub it so its agent/LLM graph
// (security classifier etc.) stays out of this routing test.
const buildNarrativeSection = vi.fn();
vi.mock("../../services/narrative-section.js", () => ({
  buildNarrativeSection: (...args: unknown[]) => buildNarrativeSection(...args),
}));
// Regeneration itself has its own unit test (services/plan-assumptions.test.ts).
// Stubbed here so the assumptions route stays a routing/guard test.
const regeneratePlan = vi.fn();
vi.mock("../../services/plan-assumptions.js", () => ({
  regeneratePlan: (...args: unknown[]) => regeneratePlan(...args),
}));
// The freeform create guard checks for investable balances; default: one
// funded investment account so structured/freeform creates proceed.
const fetchAccountsWithBalances = vi.fn();
vi.mock("../../lib/account-balances.js", () => ({
  fetchAccountsWithBalances: (...args: unknown[]) => fetchAccountsWithBalances(...args),
}));
// The regeneration budget + the in-flight claim are DB-backed and exercised in
// lib/__tests__/plan-regen-guard.test.ts. Here they are controllable doubles so
// the routing tests can drive an allowed run, a refused one, and a plan that is
// already busy. Default (set in beforeEach): allowed, and free.
const claimPlanRegeneration = vi.fn();
const beginStructuredRun = vi.fn();
const endStructuredRun = vi.fn();
vi.mock("../../lib/plan-regen-guard.js", () => ({
  claimPlanRegeneration: (...a: unknown[]) => claimPlanRegeneration(...a),
  beginStructuredRun: (...a: unknown[]) => beginStructuredRun(...a),
  endStructuredRun: (...a: unknown[]) => endStructuredRun(...a),
}));

vi.mock("../../services/plan-grounding.js", () => ({
  parseAssumptions: (raw: unknown) => (typeof raw === "string" ? JSON.parse(raw) : null),
  toCompactGrounding: (
    planId: string,
    title: string,
    sections: unknown,
    person: unknown,
    assumptions: unknown,
    schedule: unknown,
  ) => ({ planId, title, sections, person, assumptions, schedule }),
  resolvePersonContext: vi.fn(async () => ({ realEstate: null })),
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
const insertValues = vi.fn();
const updateSet = vi.fn();

function extractEqualities(where: unknown): {
  eqs: Record<string, unknown>;
  nes: Record<string, unknown>;
} {
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
  const { eqs, nes } = extractEqualities(where);
  return planTable.filter((row) => {
    if ("financialPlans.id" in eqs && row.id !== eqs["financialPlans.id"]) return false;
    if ("financialPlans.tenantId" in eqs && row.tenantId !== eqs["financialPlans.tenantId"]) return false;
    if ("financialPlans.userId" in eqs && row.userId !== eqs["financialPlans.userId"]) return false;
    if (nes["financialPlans.status"] != null && row.status === nes["financialPlans.status"]) return false;
    return true;
  });
}

vi.mock("../../lib/db.js", () => ({
  db: {
    select: (_proj?: unknown) => ({
      from: (_table: unknown) => ({
        where: (where: unknown) => {
          const rows = matchPlans(where);
          const result = Promise.resolve(rows) as Promise<PlanRow[]> & {
            orderBy: (o?: unknown) => Promise<PlanRow[]>;
          };
          result.orderBy = () => Promise.resolve(rows);
          return result;
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValues(vals);
        const row = { id: "plan-new", ...vals } as unknown as PlanRow;
        planTable.push(row);
        return { returning: async () => [row] };
      },
    }),
    update: (_table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        updateSet(vals);
        return {
          where: (where: unknown) => {
            for (const row of matchPlans(where)) Object.assign(row, vals);
            return Promise.resolve();
          },
        };
      },
    }),
  },
}));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { financialPlansRouter } from "../financial-plans.js";

function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/api/financial-plans", financialPlansRouter);
  return app;
}

const userA: SessionPayload = {
  userId: "user-a",
  tenantId: "tenant-1",
  role: "member",
  isDemo: false,
  isAdmin: false,
};
const otherTenant: SessionPayload = { ...userA, tenantId: "tenant-2" };
const otherUser: SessionPayload = { ...userA, userId: "user-b" };

const SNAPSHOT = {
  section: "snapshot" as const,
  totalAssets: 100,
  totalDebt: 40,
  netWorth: 60,
  monthlySpend: 25,
  age: 40,
  annualIncome: 120000,
  breakdown: [{ kind: "asset" as const, type: "depository", value: 100 }],
  generatedAt: "2026-01-01T00:00:00.000Z",
};

const PORTFOLIO = {
  section: "portfolio" as const,
  totalValue: 100,
  classes: [
    { name: "US Stocks", value: 100, weight: 100, categories: [{ name: "S&P 500", value: 100, weight: 100 }] },
  ],
  generatedAt: "2026-01-01T00:00:00.000Z",
};

const RETIREMENT = {
  section: "retirement" as const,
  computed: true,
  currentAge: 40,
  retirementAge: 65,
  planThroughAge: 90,
  successRate: 88,
  targetSuccess: 85,
  verdict: "on_track" as const,
  medianLastsToAge: null,
  blendedExpectedReturn: 0.062,
  growth: [{ age: 40, median: 100, p25: 90, p75: 110, phase: "accumulation" as const }],
  methods: [
    { strategy: "guardrails" as const, label: "Guardrails", successRate: 88, medianLastsToAge: null, recommended: true },
  ],
  recommendedStrategy: "guardrails" as const,
  drawdownOrder: [{ bucket: "taxable" as const, label: "Taxable", balance: 100 }],
  generatedAt: "2026-01-01T00:00:00.000Z",
};

const WHAT_IFS = {
  section: "what_ifs" as const,
  baseSuccessRate: 88,
  scenarios: [
    { label: "Retire 3 years earlier", overrides: { retirementAge: 62 }, successRate: 76, medianLastsToAge: null, deltaVsBase: -12 },
  ],
  generatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  planTable = [];
  buildFinancialSnapshot.mockResolvedValue(SNAPSHOT);
  buildPortfolioSection.mockResolvedValue(PORTFOLIO);
  buildRetirementReadiness.mockResolvedValue(RETIREMENT);
  buildWhatIfSection.mockResolvedValue(WHAT_IFS);
  // Default: schedule computes, no strategy.
  buildRetirementSchedule.mockResolvedValue(SCHEDULE);
  buildStrategySection.mockResolvedValue(null);
  fetchAccountsWithBalances.mockResolvedValue([
    { id: "acct-1", type: "investment", rawBalance: 100 },
  ]);
  claimPlanRegeneration.mockResolvedValue(null); // budget available
  beginStructuredRun.mockResolvedValue(true); // no run in flight
  endStructuredRun.mockResolvedValue(undefined);
  regeneratePlan.mockResolvedValue({ sections: { snapshot: SNAPSHOT, retirement: RETIREMENT } });
});

const SCHEDULE = {
  section: "schedule" as const,
  computed: true,
  rows: [],
  flags: {},
  assumptions: {},
  generatedAt: "2026-01-01T00:00:00.000Z",
};

const STRATEGY = {
  section: "strategy" as const,
  situationHeadline: "You are on track for an early retirement.",
  watchouts: [],
  strategies: [],
  explore: [],
  generatedAt: "2026-01-01T00:00:00.000Z",
};

describe("POST /api/financial-plans", () => {
  it("builds a snapshot, stores the document, and returns the parsed document", async () => {
    const app = appWithSession(userA);
    const res = await app.request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { plan: { document: { sections: { snapshot: unknown; portfolio: unknown; retirement: unknown; whatIfs: unknown } }; tenantId: string; userId: string } };
    expect(buildFinancialSnapshot).toHaveBeenCalledWith("tenant-1", "user-a");
    expect(buildPortfolioSection).toHaveBeenCalledWith("tenant-1");
    expect(buildRetirementReadiness).toHaveBeenCalledWith("tenant-1", "user-a");
    // What-ifs re-run the engine against the retirement section's base rate.
    expect(buildWhatIfSection).toHaveBeenCalledWith("tenant-1", "user-a", RETIREMENT.successRate);
    // Stored as a JSON string on the row, returned parsed. The deterministic
    // schedule computes by default and is attached; no strategy on this path.
    const stored = insertValues.mock.calls[0][0] as { document: string; tenantId: string; userId: string };
    expect(JSON.parse(stored.document)).toEqual({ sections: { snapshot: SNAPSHOT, portfolio: PORTFOLIO, retirement: RETIREMENT, whatIfs: WHAT_IFS, schedule: SCHEDULE } });
    expect(stored.tenantId).toBe("tenant-1");
    expect(stored.userId).toBe("user-a");
    expect(body.plan.document.sections.snapshot).toEqual(SNAPSHOT);
    expect(body.plan.document.sections.portfolio).toEqual(PORTFOLIO);
    expect(body.plan.document.sections.retirement).toEqual(RETIREMENT);
    expect(body.plan.document.sections.whatIfs).toEqual(WHAT_IFS);
  });

  it("skips the what-if section when the retirement projection wasn't computable", async () => {
    buildRetirementReadiness.mockResolvedValue({ ...RETIREMENT, computed: false, successRate: 0 });
    const res = await appWithSession(userA).request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    // No base to compare against → the builder isn't even called.
    expect(buildWhatIfSection).not.toHaveBeenCalled();
    const stored = insertValues.mock.calls[0][0] as { document: string };
    expect(JSON.parse(stored.document).sections).not.toHaveProperty("whatIfs");
  });

  it("still creates the plan (no what-ifs) when the what-if builder throws", async () => {
    buildWhatIfSection.mockRejectedValue(new Error("sim exploded"));
    const res = await appWithSession(userA).request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // A scenario failure must never 500 the create — the plan ships without what-ifs.
    expect(res.status).toBe(201);
    const stored = insertValues.mock.calls[0][0] as { document: string };
    expect(JSON.parse(stored.document).sections).not.toHaveProperty("whatIfs");
  });

  it("omits the schedule section when the schedule isn't computed", async () => {
    buildRetirementSchedule.mockResolvedValue({ ...SCHEDULE, computed: false, rows: [] });
    const res = await appWithSession(userA).request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    // An un-computed schedule (no balances on file) is not attached.
    const stored = insertValues.mock.calls[0][0] as { document: string };
    expect(JSON.parse(stored.document).sections).not.toHaveProperty("schedule");
  });

  it("includes the strategy section when the builder returns one, grounded on the schedule", async () => {
    buildStrategySection.mockResolvedValue(STRATEGY);
    const res = await appWithSession(userA).request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    // Strategy is grounded on the SAME compact figures WITH the schedule attached
    // (the 6th arg to toCompactGrounding, surfaced by the test's grounding stub).
    const grounding = buildStrategySection.mock.calls[0][2] as { sections: unknown; schedule: unknown };
    expect(grounding.sections).toEqual({ snapshot: SNAPSHOT, portfolio: PORTFOLIO, retirement: RETIREMENT });
    expect(grounding.schedule).toEqual(SCHEDULE);
    const stored = insertValues.mock.calls[0][0] as { document: string };
    expect(JSON.parse(stored.document).sections.strategy).toEqual(STRATEGY);
  });

  it("still creates the plan (no strategy) when the strategy builder throws", async () => {
    buildStrategySection.mockRejectedValue(new Error("model exploded"));
    const res = await appWithSession(userA).request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // An LLM hiccup must never 500 the create — the plan ships without a strategy.
    expect(res.status).toBe(201);
    const stored = insertValues.mock.calls[0][0] as { document: string };
    const parsed = JSON.parse(stored.document) as { sections: Record<string, unknown> };
    expect(parsed.sections.snapshot).toEqual(SNAPSHOT);
    expect(parsed.sections).not.toHaveProperty("strategy");
  });

  it("still creates the plan (no schedule, no strategy) when the schedule builder throws", async () => {
    buildRetirementSchedule.mockRejectedValue(new Error("schedule exploded"));
    const res = await appWithSession(userA).request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // The schedule throw is caught before strategy runs — plan ships with neither.
    expect(res.status).toBe(201);
    const stored = insertValues.mock.calls[0][0] as { document: string };
    const parsed = JSON.parse(stored.document) as { sections: Record<string, unknown> };
    expect(parsed.sections).not.toHaveProperty("schedule");
    expect(parsed.sections).not.toHaveProperty("strategy");
  });
});

describe("GET /api/financial-plans", () => {
  it("lists only the caller's non-archived plans", async () => {
    planTable = [
      { id: "p1", tenantId: "tenant-1", userId: "user-a", title: "A", document: "{}", status: "draft" },
      { id: "p2", tenantId: "tenant-1", userId: "user-a", title: "Archived", document: "{}", status: "archived" },
      { id: "p3", tenantId: "tenant-2", userId: "user-a", title: "Other tenant", document: "{}", status: "draft" },
      { id: "p4", tenantId: "tenant-1", userId: "user-b", title: "Other user", document: "{}", status: "draft" },
    ];
    const app = appWithSession(userA);
    const res = await app.request("/api/financial-plans");
    const body = (await res.json()) as { plans: Array<{ id: string }> };
    expect(body.plans.map((p) => p.id)).toEqual(["p1"]);
  });

  // The list derives freshness scalars from the document blob but must never
  // ship the blob itself.
  type SummaryRow = {
    id: string;
    generatedAt: string | null;
    reportStatus: string | null;
    document?: unknown;
  };
  const listRows = async (): Promise<SummaryRow[]> => {
    const res = await appWithSession(userA).request("/api/financial-plans");
    return ((await res.json()) as { plans: SummaryRow[] }).plans;
  };

  it("derives generatedAt and a ready status from a freeform document", async () => {
    planTable = [
      {
        id: "p1",
        tenantId: "tenant-1",
        userId: "user-a",
        title: "A",
        document: JSON.stringify({
          freeform: { html: "<h1>x</h1>", generatedAt: "2026-03-01T00:00:00.000Z" },
        }),
        status: "draft",
      },
    ];
    const [row] = await listRows();
    expect(row.generatedAt).toBe("2026-03-01T00:00:00.000Z");
    // Pre-async freeform documents carry no status — they are already written.
    expect(row.reportStatus).toBe("ready");
    expect(row).not.toHaveProperty("document");
  });

  it("reports an in-flight freeform run as generating", async () => {
    planTable = [
      {
        id: "p1",
        tenantId: "tenant-1",
        userId: "user-a",
        title: "A",
        document: JSON.stringify({
          freeform: { status: "generating", html: "", generatedAt: "2026-03-01T00:00:00.000Z" },
        }),
        status: "draft",
      },
    ];
    const [row] = await listRows();
    expect(row.reportStatus).toBe("generating");
  });

  it("falls back to the snapshot's generatedAt for a legacy structured plan", async () => {
    planTable = [
      {
        id: "p1",
        tenantId: "tenant-1",
        userId: "user-a",
        title: "A",
        document: JSON.stringify({ sections: { snapshot: SNAPSHOT } }),
        status: "draft",
      },
    ];
    const [row] = await listRows();
    expect(row.generatedAt).toBe(SNAPSHOT.generatedAt);
    // No freeform run has ever happened on a structured plan.
    expect(row.reportStatus).toBeNull();
  });

  it("nulls both scalars for a missing or malformed document, without throwing", async () => {
    planTable = [
      { id: "p1", tenantId: "tenant-1", userId: "user-a", title: "A", document: null, status: "draft" },
      { id: "p2", tenantId: "tenant-1", userId: "user-a", title: "B", document: "{not json", status: "draft" },
    ];
    const rows = await listRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.generatedAt).toBeNull();
      expect(row.reportStatus).toBeNull();
    }
  });
});

describe("GET /api/financial-plans/:id", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    planTable = [
      { id: uuid, tenantId: "tenant-1", userId: "user-a", title: "A", document: JSON.stringify({ sections: { snapshot: SNAPSHOT } }), status: "draft" },
    ];
  });

  it("returns the plan with a parsed document for the owner", async () => {
    const res = await appWithSession(userA).request(`/api/financial-plans/${uuid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: { sections: { snapshot: unknown } } };
    expect(body.document.sections.snapshot).toEqual(SNAPSHOT);
  });

  it("404s for another tenant", async () => {
    const res = await appWithSession(otherTenant).request(`/api/financial-plans/${uuid}`);
    expect(res.status).toBe(404);
  });

  it("404s for another user in the same tenant", async () => {
    const res = await appWithSession(otherUser).request(`/api/financial-plans/${uuid}`);
    expect(res.status).toBe(404);
  });

  it("404s after the plan is archived via DELETE", async () => {
    const app = appWithSession(userA);
    const del = await app.request(`/api/financial-plans/${uuid}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const res = await app.request(`/api/financial-plans/${uuid}`);
    expect(res.status).toBe(404);
  });

  it("400s on a malformed id", async () => {
    const res = await appWithSession(userA).request("/api/financial-plans/not-a-uuid");
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/financial-plans/:id", () => {
  const uuid = "22222222-2222-4222-8222-222222222222";

  it("soft-archives the caller's plan", async () => {
    planTable = [
      { id: uuid, tenantId: "tenant-1", userId: "user-a", title: "A", document: "{}", status: "draft" },
    ];
    const res = await appWithSession(userA).request(`/api/financial-plans/${uuid}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith({ status: "archived" });
    expect(planTable[0].status).toBe("archived");
  });

  it("404s (no update) for another tenant", async () => {
    planTable = [
      { id: uuid, tenantId: "tenant-1", userId: "user-a", title: "A", document: "{}", status: "draft" },
    ];
    const res = await appWithSession(otherTenant).request(`/api/financial-plans/${uuid}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(updateSet).not.toHaveBeenCalled();
  });
});

// ── The regeneration budget and the in-flight claim ──────────────────────────
// Every path that reaches the expensive generation work has to answer for an
// exhausted budget, including the ones that do the work in the background: the
// money is spent whether or not the caller waits for it.
describe("plan regeneration guards", () => {
  const uuid = "33333333-3333-4333-8333-333333333333";
  const DENIAL = {
    error: "Your household can build or update a plan twice every 24 hours, and both attempts have been used.",
    code: "rate_limited" as const,
    retryAfter: "2026-09-18T09:05:00.000Z",
  };

  function seedPlan(document: string) {
    planTable = [
      { id: uuid, tenantId: "tenant-1", userId: "user-a", title: "A", document, status: "draft" },
    ];
  }

  it("429s a structured create and runs none of the builders", async () => {
    claimPlanRegeneration.mockResolvedValue(DENIAL);
    const res = await appWithSession(userA).request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual(DENIAL);
    expect(claimPlanRegeneration).toHaveBeenCalledWith("tenant-1", "plan-create");
    expect(buildFinancialSnapshot).not.toHaveBeenCalled();
    expect(buildStrategySection).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("429s a freeform create and never inserts the plan row", async () => {
    claimPlanRegeneration.mockResolvedValue(DENIAL);
    const res = await appWithSession(userA).request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "freeform" }),
    });
    expect(res.status).toBe(429);
    expect(claimPlanRegeneration).toHaveBeenCalledWith("tenant-1", "freeform-create");
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("429s freeform feedback without marking the report revising", async () => {
    seedPlan(JSON.stringify({ freeform: { status: "ready", html: "<p>hi</p>" } }));
    claimPlanRegeneration.mockResolvedValue(DENIAL);
    const res = await appWithSession(userA).request(`/api/financial-plans/${uuid}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback: "make it shorter" }),
    });
    expect(res.status).toBe(429);
    expect(claimPlanRegeneration).toHaveBeenCalledWith("tenant-1", "freeform-feedback");
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("429s a freeform refresh without touching the stored report", async () => {
    seedPlan(JSON.stringify({ freeform: { status: "ready", html: "<p>hi</p>" } }));
    claimPlanRegeneration.mockResolvedValue(DENIAL);
    const res = await appWithSession(userA).request(`/api/financial-plans/${uuid}/regenerate`, {
      method: "POST",
    });
    expect(res.status).toBe(429);
    expect(claimPlanRegeneration).toHaveBeenCalledWith("tenant-1", "freeform-regenerate");
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("429s an assumptions change, persists nothing, and hands the plan back", async () => {
    seedPlan(JSON.stringify({ sections: { snapshot: SNAPSHOT } }));
    claimPlanRegeneration.mockResolvedValue(DENIAL);
    const res = await appWithSession(userA).request(`/api/financial-plans/${uuid}/assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retirementAge: 62 }),
    });
    expect(res.status).toBe(429);
    expect(claimPlanRegeneration).toHaveBeenCalledWith("tenant-1", "plan-assumptions");
    expect(regeneratePlan).not.toHaveBeenCalled();
    // The user's change was refused, so it must not be recorded either.
    expect(updateSet).not.toHaveBeenCalled();
    // A refused claim releases the in-flight claim it took first.
    expect(endStructuredRun).toHaveBeenCalledWith("tenant-1", "user-a", uuid);
  });

  it("409s an assumptions change while a run is already in progress", async () => {
    seedPlan(JSON.stringify({ sections: { snapshot: SNAPSHOT } }));
    beginStructuredRun.mockResolvedValue(false);
    const res = await appWithSession(userA).request(`/api/financial-plans/${uuid}/assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retirementAge: 62 }),
    });
    // Same status and same shape the freeform refresh already returns.
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "An update is already in progress" });
    // The duplicate request is turned away WITHOUT spending an attempt.
    expect(claimPlanRegeneration).not.toHaveBeenCalled();
    expect(regeneratePlan).not.toHaveBeenCalled();
  });

  it("claims and releases around a successful assumptions change", async () => {
    seedPlan(JSON.stringify({ sections: { snapshot: SNAPSHOT } }));
    const res = await appWithSession(userA).request(`/api/financial-plans/${uuid}/assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retirementAge: 62 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).regenerated).toBe(true);
    expect(beginStructuredRun).toHaveBeenCalledWith("tenant-1", "user-a", uuid);
    expect(endStructuredRun).toHaveBeenCalledWith("tenant-1", "user-a", uuid);
  });

  it("releases the plan when the regeneration throws", async () => {
    seedPlan(JSON.stringify({ sections: { snapshot: SNAPSHOT } }));
    regeneratePlan.mockRejectedValue(new Error("regen boom"));
    const res = await appWithSession(userA).request(`/api/financial-plans/${uuid}/assumptions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retirementAge: 62 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).regenerated).toBe(false);
    // A failed run still hands the plan back, or the next request waits out
    // the staleness window for nothing.
    expect(endStructuredRun).toHaveBeenCalledWith("tenant-1", "user-a", uuid);
  });

  it("guards the second concurrent request for the same plan, not the first", async () => {
    seedPlan(JSON.stringify({ sections: { snapshot: SNAPSHOT } }));
    // What Postgres does with the conditional UPDATE: the first caller takes
    // the claim, the second finds it held.
    let taken = false;
    beginStructuredRun.mockImplementation(async () => {
      if (taken) return false;
      taken = true;
      return true;
    });
    const fire = () =>
      appWithSession(userA).request(`/api/financial-plans/${uuid}/assumptions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retirementAge: 62 }),
      });
    const [a, b] = await Promise.all([fire(), fire()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    // One run, not two.
    expect(regeneratePlan).toHaveBeenCalledTimes(1);
    expect(claimPlanRegeneration).toHaveBeenCalledTimes(1);
  });
});
