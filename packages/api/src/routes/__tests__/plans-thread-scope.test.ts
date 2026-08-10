import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ── Core mock: identity-ish query builders + table markers ──
// `eq`/`and` return plain arrays; tables carry a `_table` marker so the db mock
// can route inserts/selects and so a captured insert's values can be asserted.
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  ne: (...args: unknown[]) => ["ne", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  plans: {
    _table: "plans",
    id: "plans.id",
    tenantId: "plans.tenantId",
    type: "plans.type",
    title: "plans.title",
    status: "plans.status",
    content: "plans.content",
    inputs: "plans.inputs",
    createdAt: "plans.createdAt",
    updatedAt: "plans.updatedAt",
  },
  planEdits: { _table: "planEdits" },
  chatThreads: {
    _table: "chatThreads",
    id: "chatThreads.id",
    tenantId: "chatThreads.tenantId",
    userId: "chatThreads.userId",
    planId: "chatThreads.planId",
    title: "chatThreads.title",
  },
}));

interface PlanRow {
  id: string;
  tenantId: string;
  type: string;
  title: string;
  status: string;
  content: string | null;
  inputs: string | null;
}
let planTable: PlanRow[] = [];

// Capture the values passed to insert(chatThreads).values(...) so we can assert
// the creating user's id is stamped onto plan-created threads.
const threadInsertValues = vi.fn();

function extractEqualities(where: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    const [op, ...rest] = node;
    if (op === "eq") {
      out[String(rest[0])] = rest[1];
    } else if (op === "and") {
      for (const child of rest) visit(child);
    }
  };
  visit(where);
  return out;
}

function matchPlans(where: unknown): PlanRow[] {
  const eqs = extractEqualities(where);
  return planTable.filter((row) => {
    if ("plans.id" in eqs && row.id !== eqs["plans.id"]) return false;
    if ("plans.tenantId" in eqs && row.tenantId !== eqs["plans.tenantId"]) return false;
    return true;
  });
}

vi.mock("../../lib/db.js", () => ({
  db: {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => ({
        where: (where: unknown) => {
          if ((table as { _table?: string })?._table === "plans") {
            const rows = matchPlans(where);
            const result = Promise.resolve(rows);
            (result as unknown as { orderBy: (o?: unknown) => Promise<PlanRow[]> }).orderBy = () =>
              Promise.resolve(rows);
            return result;
          }
          const result = Promise.resolve([] as unknown[]);
          (result as unknown as { orderBy: (o?: unknown) => Promise<unknown[]> }).orderBy = () =>
            Promise.resolve([]);
          return result;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const marker = (table as { _table?: string })?._table;
        if (marker === "chatThreads") {
          threadInsertValues(vals);
          return { returning: async () => [{ id: "thread-new", ...vals }] };
        }
        // plans insert → return a stable id so the thread insert can reference it.
        const row = { id: "plan-new", ...vals } as unknown as PlanRow;
        return { returning: async () => [row] };
      },
    }),
  },
}));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { plansRouter } from "../plans.js";

function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/api/plans", plansRouter);
  return app;
}

const userA: SessionPayload = {
  userId: "user-a",
  tenantId: "tenant-1",
  role: "member",
  isDemo: false,
  isAdmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  planTable = [];
});

describe("POST /api/plans stamps the creator on the plan's chat thread", () => {
  it("sets userId from the session on the create-plan chatThreads insert", async () => {
    const app = appWithSession(userA);
    const res = await app.request("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "net_worth" }),
    });
    expect(res.status).toBe(201);
    expect(threadInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", userId: "user-a" }),
    );
  });
});

describe("POST /api/plans/:id/clone stamps the creator on the cloned chat thread", () => {
  it("sets userId from the session on the clone-plan chatThreads insert", async () => {
    planTable = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tenantId: "tenant-1",
        type: "net_worth",
        title: "Original",
        status: "draft",
        content: null,
        inputs: null,
      },
    ];
    const app = appWithSession(userA);
    const res = await app.request("/api/plans/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    expect(threadInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", userId: "user-a" }),
    );
  });
});
