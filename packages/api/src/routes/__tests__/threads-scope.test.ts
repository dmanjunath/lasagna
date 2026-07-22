import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ── Core mock: identity-ish query builders so `where` args are inspectable ──
// `eq`/`and` return plain arrays so a handler's WHERE clause can be asserted on.
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  asc: (...args: unknown[]) => ["asc", ...args],
  inArray: (...args: unknown[]) => ["inArray", ...args],
  chatThreads: {
    _table: "chatThreads",
    id: "chatThreads.id",
    tenantId: "chatThreads.tenantId",
    userId: "chatThreads.userId",
    planId: "chatThreads.planId",
    title: "chatThreads.title",
    tags: "chatThreads.tags",
    createdAt: "chatThreads.createdAt",
    updatedAt: "chatThreads.updatedAt",
  },
  messages: {
    _table: "messages",
    threadId: "messages.threadId",
    tenantId: "messages.tenantId",
    role: "messages.role",
    content: "messages.content",
    createdAt: "messages.createdAt",
  },
  FREE_MODEL_LEVEL: "free",
}));

// A tiny in-memory thread table. Each row is scoped to (tenantId, userId).
// The select mock resolves against this so a WHERE clause that omits userId
// would (correctly) leak another member's row and fail the isolation asserts.
interface ThreadRow {
  id: string;
  tenantId: string;
  userId: string;
  planId: string | null;
  title: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}
let threadTable: ThreadRow[] = [];

// Capture the values passed to insert(chatThreads).values(...) so we can assert
// the creating user's id is stamped onto new threads.
const threadInsertValues = vi.fn();

// Walks the array-encoded WHERE clause produced by the eq/and mocks and pulls
// out the {column: value} equalities so the fake table can be filtered exactly
// the way the real SQL would be.
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

function matchThreads(where: unknown): ThreadRow[] {
  const eqs = extractEqualities(where);
  return threadTable.filter((row) => {
    if ("chatThreads.id" in eqs && row.id !== eqs["chatThreads.id"]) return false;
    if ("chatThreads.tenantId" in eqs && row.tenantId !== eqs["chatThreads.tenantId"]) return false;
    if ("chatThreads.userId" in eqs && row.userId !== eqs["chatThreads.userId"]) return false;
    if ("chatThreads.planId" in eqs && row.planId !== eqs["chatThreads.planId"]) return false;
    return true;
  });
}

vi.mock("../../lib/db.js", () => ({
  db: {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => ({
        where: (where: unknown) => {
          if ((table as { _table?: string })?._table === "chatThreads") {
            const rows = matchThreads(where);
            // threads list adds .orderBy(); get/delete/chat destructure [row].
            const result = Promise.resolve(rows);
            (result as unknown as { orderBy: (o?: unknown) => Promise<ThreadRow[]> }).orderBy = () =>
              Promise.resolve(rows);
            return result;
          }
          // messages selects → return empty (no snippets / no history needed).
          const result = Promise.resolve([] as unknown[]);
          (result as unknown as { orderBy: (o?: unknown) => Promise<unknown[]> }).orderBy = () =>
            Promise.resolve([]);
          return result;
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        threadInsertValues(vals);
        const row = { id: "thread-new", ...vals } as ThreadRow;
        return { returning: async () => [row] };
      },
    }),
    delete: (_table: unknown) => ({
      where: async (_where: unknown) => undefined,
    }),
  },
}));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { threadsRouter } from "../threads.js";

function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/api/threads", threadsRouter);
  return app;
}

const userA: SessionPayload = { userId: "user-a", tenantId: "tenant-1", role: "member", isDemo: false, isAdmin: false };
const userB: SessionPayload = { userId: "user-b", tenantId: "tenant-1", role: "member", isDemo: false, isAdmin: false };

const now = new Date();
function seedThread(id: string, tenantId: string, userId: string): ThreadRow {
  return { id, tenantId, userId, planId: null, title: null, tags: [], createdAt: now, updatedAt: now };
}

beforeEach(() => {
  vi.clearAllMocks();
  threadTable = [];
});

describe("POST /api/threads", () => {
  it("stamps the creating user's id onto the new thread", async () => {
    const app = appWithSession(userA);
    const res = await app.request("/api/threads", {
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

describe("GET /api/threads (list) is scoped per user within a household", () => {
  it("member A sees only A's threads, not member B's", async () => {
    threadTable = [
      seedThread("t-a1", "tenant-1", "user-a"),
      seedThread("t-a2", "tenant-1", "user-a"),
      seedThread("t-b1", "tenant-1", "user-b"),
    ];
    const app = appWithSession(userA);
    const res = await app.request("/api/threads");
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.threads as { id: string }[]).map((t) => t.id).sort();
    expect(ids).toEqual(["t-a1", "t-a2"]);
    expect(ids).not.toContain("t-b1");
  });

  it("member B (same tenant) sees only B's threads", async () => {
    threadTable = [
      seedThread("t-a1", "tenant-1", "user-a"),
      seedThread("t-b1", "tenant-1", "user-b"),
    ];
    const app = appWithSession(userB);
    const res = await app.request("/api/threads");
    const body = await res.json();
    const ids = (body.threads as { id: string }[]).map((t) => t.id);
    expect(ids).toEqual(["t-b1"]);
  });
});

describe("GET /api/threads/:id rejects another member's thread", () => {
  it("member A gets 404 for member B's thread in the same tenant", async () => {
    threadTable = [seedThread("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "tenant-1", "user-b")];
    const app = appWithSession(userA);
    const res = await app.request("/api/threads/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(res.status).toBe(404);
  });

  it("member A can read their own thread", async () => {
    threadTable = [seedThread("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "tenant-1", "user-a")];
    const app = appWithSession(userA);
    const res = await app.request("/api/threads/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/threads/:id rejects another member's thread", () => {
  it("member A gets 404 deleting member B's thread", async () => {
    threadTable = [seedThread("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "tenant-1", "user-b")];
    const app = appWithSession(userA);
    const res = await app.request("/api/threads/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
