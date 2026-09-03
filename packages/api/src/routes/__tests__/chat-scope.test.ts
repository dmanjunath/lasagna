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

interface MessageRow {
  threadId: string;
  role: string;
  content: string;
}
let messageTable: MessageRow[] = [];

function matchMessages(where: unknown): MessageRow[] {
  const eqs = extractEqualities(where);
  return messageTable.filter(
    (row) => !("messages.threadId" in eqs) || row.threadId === eqs["messages.threadId"],
  );
}

// Writes land in messageTable so a read taken after the write really would see
// the new turn — that is what makes the "not duplicated" assertion mean
// something.
const insertValues = vi.fn(async (v?: Record<string, unknown>) => {
  if (v && typeof v.threadId === "string" && typeof v.role === "string") {
    messageTable.push({ threadId: v.threadId, role: v.role, content: String(v.content ?? "") });
  }
});

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
          if ((table as { _table?: string })?._table === "messages") {
            const rows = matchMessages(where).map((m) => ({ role: m.role, content: m.content }));
            const result = Promise.resolve(rows);
            (result as unknown as { orderBy: () => Promise<typeof rows> }).orderBy = () => Promise.resolve(rows);
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
  buildAliasMap: async () => ({ forward: new Map(), reverse: new Map() }),
  scrub: (x: unknown) => x,
  descrub: (x: unknown) => x,
  descrubObject: (x: unknown) => x,
  PII_DEBUG: false,
}));
vi.mock("../../lib/billing.js", () => ({ resolveTenantPlan: async () => "free" }));
vi.mock("../../lib/model-gate.js", () => ({ resolveModelLevel: () => "free" }));
vi.mock("../../lib/activity.js", () => ({ logLlmUsage: () => {}, actualLlmCostUsd: () => undefined }));
vi.mock("ai", () => ({ generateText: vi.fn(async () => ({ text: "", toolCalls: [], finishReason: "stop", usage: {} })) }));

import { generateText } from "ai";
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
const demoUser: SessionPayload = { userId: "user-demo", tenantId: "tenant-demo", role: "member", isDemo: true, isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  threadTable = [];
  messageTable = [];
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

describe("POST /api/chat prompts the model with the turn it is answering", () => {
  const THREAD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  function post(session: SessionPayload, message: string) {
    return appWithSession(session).request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: THREAD_ID, message }),
    });
  }

  /** The messages handed to the model on the first (and only) model call. */
  function promptSent(): Array<{ role: string; content: string }> {
    const [opts] = vi.mocked(generateText).mock.calls[0] as [{ messages: Array<{ role: string; content: string }> }];
    return opts.messages;
  }

  beforeEach(() => {
    // A non-empty answer means the route never falls through to the extra
    // synthesis call, so call 0 is the only prompt to inspect.
    vi.mocked(generateText).mockResolvedValue({
      text: "The sky is blue.",
      toolCalls: [],
      finishReason: "stop",
      usage: {},
    } as never);
  });

  it("sends a demo tenant's first message even though nothing is persisted", async () => {
    threadTable = [{ id: THREAD_ID, tenantId: "tenant-demo", userId: "user-demo", title: "Demo" }];

    const res = await post(demoUser, "what colour is the sky?");

    expect(res.status).toBe(200);
    // Demo persists nothing, so the prompt cannot come from the DB read alone.
    expect(insertValues).not.toHaveBeenCalled();
    expect(promptSent()).toEqual([{ role: "user", content: "what colour is the sky?" }]);
    expect(await res.json()).toMatchObject({ response: { chat: "The sky is blue." } });
  });

  it("answers a demo tenant's newest message, not the previous turn", async () => {
    threadTable = [{ id: THREAD_ID, tenantId: "tenant-demo", userId: "user-demo", title: "Demo" }];
    messageTable = [
      { threadId: THREAD_ID, role: "user", content: "how is my retirement plan?" },
      { threadId: THREAD_ID, role: "assistant", content: "It looks on track." },
    ];

    await post(demoUser, "ignore that, what colour is the sky?");

    const prompt = promptSent();
    expect(prompt).toHaveLength(3);
    expect(prompt[prompt.length - 1]).toEqual({ role: "user", content: "ignore that, what colour is the sky?" });
  });

  it("does not duplicate a non-demo turn in the prompt", async () => {
    threadTable = [{ id: THREAD_ID, tenantId: "tenant-1", userId: "user-a", title: "Existing" }];

    await post(userA, "how much did I spend last month?");

    // The turn really was written, so a read taken after the write would have
    // returned it — the prompt must still carry exactly one copy.
    expect(messageTable).toContainEqual({ threadId: THREAD_ID, role: "user", content: "how much did I spend last month?" });
    expect(promptSent()).toEqual([{ role: "user", content: "how much did I spend last month?" }]);
  });
});
