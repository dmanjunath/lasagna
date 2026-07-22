import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// The chat route verifies the thread by (tenantId AND userId) *before* touching
// the LLM, so another member's thread 404s without any generateText call. We
// mock the whole agent/billing graph so importing chat.ts stays cheap and the
// test never reaches a real model.

vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  chatThreads: {
    _table: "chatThreads",
    id: "chatThreads.id",
    tenantId: "chatThreads.tenantId",
    userId: "chatThreads.userId",
    title: "chatThreads.title",
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

interface ThreadRow {
  id: string;
  tenantId: string;
  userId: string;
  title: string | null;
}
let threadTable: ThreadRow[] = [];

function extractEqualities(where: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    const [op, ...rest] = node;
    if (op === "eq") out[String(rest[0])] = rest[1];
    else if (op === "and") for (const child of rest) visit(child);
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
    return true;
  });
}

const insertValues = vi.fn(async (_v?: Record<string, unknown>) => undefined);

vi.mock("../../lib/db.js", () => ({
  db: {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => ({
        where: (where: unknown) => {
          if ((table as { _table?: string })?._table === "chatThreads") {
            const rows = matchThreads(where);
            const result = Promise.resolve(rows);
            (result as unknown as { orderBy: () => Promise<ThreadRow[]> }).orderBy = () => Promise.resolve(rows);
            return result;
          }
          const result = Promise.resolve([] as unknown[]);
          (result as unknown as { orderBy: () => Promise<unknown[]> }).orderBy = () => Promise.resolve([]);
          return result;
        },
      }),
    }),
    insert: () => ({ values: (v: Record<string, unknown>) => insertValues(v) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

// Stub the agent + billing graph so importing chat.ts is cheap and no model runs.
vi.mock("../../agent/index.js", () => ({
  getModel: () => ({}),
  getModelSlug: () => "stub-model",
  createAgentTools: () => ({}),
  systemPrompt: "stub",
  MODEL_LEVELS: ["free", "fast", "medium", "quality", "frontier"],
}));
vi.mock("../../lib/pii-scrubber.js", () => ({
  buildAliasMap: async () => ({}),
  scrub: (x: unknown) => x,
  descrub: (x: unknown) => x,
  PII_DEBUG: false,
}));
vi.mock("../../lib/billing.js", () => ({ resolveTenantPlan: async () => "free" }));
vi.mock("../../lib/model-gate.js", () => ({ resolveModelLevel: () => "free" }));
vi.mock("../../lib/activity.js", () => ({ logLlmUsage: () => {} }));
vi.mock("ai", () => ({ generateText: vi.fn(async () => ({ text: "", toolCalls: [], finishReason: "stop", usage: {} })) }));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { chatRouter } from "../chat.js";

function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/api/chat", chatRouter);
  return app;
}

const userA: SessionPayload = { userId: "user-a", tenantId: "tenant-1", role: "member", isDemo: false, isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  threadTable = [];
});

describe("POST /api/chat verifies the thread by (tenantId AND userId)", () => {
  it("returns 404 for another member's thread in the same tenant", async () => {
    // Thread belongs to user-b; user-a must not be able to post to it.
    threadTable = [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tenantId: "tenant-1", userId: "user-b", title: null }];
    const app = appWithSession(userA);
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", message: "hi" }),
    });
    expect(res.status).toBe(404);
    // No message was persisted for the foreign thread.
    expect(insertValues).not.toHaveBeenCalled();
  });
});
