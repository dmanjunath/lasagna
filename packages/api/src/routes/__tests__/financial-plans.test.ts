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

beforeEach(() => {
  vi.clearAllMocks();
  planTable = [];
  buildFinancialSnapshot.mockResolvedValue(SNAPSHOT);
  buildPortfolioSection.mockResolvedValue(PORTFOLIO);
});

describe("POST /api/financial-plans", () => {
  it("builds a snapshot, stores the document, and returns the parsed document", async () => {
    const app = appWithSession(userA);
    const res = await app.request("/api/financial-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { plan: { document: { sections: { snapshot: unknown; portfolio: unknown } }; tenantId: string; userId: string } };
    expect(buildFinancialSnapshot).toHaveBeenCalledWith("tenant-1", "user-a");
    expect(buildPortfolioSection).toHaveBeenCalledWith("tenant-1");
    // Stored as a JSON string on the row, returned parsed.
    const stored = insertValues.mock.calls[0][0] as { document: string; tenantId: string; userId: string };
    expect(JSON.parse(stored.document)).toEqual({ sections: { snapshot: SNAPSHOT, portfolio: PORTFOLIO } });
    expect(stored.tenantId).toBe("tenant-1");
    expect(stored.userId).toBe("user-a");
    expect(body.plan.document.sections.snapshot).toEqual(SNAPSHOT);
    expect(body.plan.document.sections.portfolio).toEqual(PORTFOLIO);
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
