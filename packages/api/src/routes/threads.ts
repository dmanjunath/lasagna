import { Hono } from "hono";
import { z } from "zod";
import { db } from "../lib/db.js";
import { chatThreads, messages, eq, and, desc, asc, inArray } from "@lasagna/core";
import { type AuthEnv } from "../middleware/auth.js";

export const threadsRouter = new Hono<AuthEnv>();

// Validation schemas
const uuidSchema = z.string().uuid();

const createThreadSchema = z.object({
  planId: z.string().uuid().optional(),
  title: z.string().max(255).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

// Safe JSON parse helper
function safeJsonParse<T>(str: string | null, fallback: T): T {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// List threads (optionally filter by planId)
threadsRouter.get("/", async (c) => {
  const { tenantId } = c.get("session");
  const planId = c.req.query("planId");

  // Validate planId if provided
  if (planId) {
    const uuidResult = uuidSchema.safeParse(planId);
    if (!uuidResult.success) {
      return c.json({ error: "Invalid planId format" }, 400);
    }
  }

  const baseQuery = {
    id: chatThreads.id,
    planId: chatThreads.planId,
    title: chatThreads.title,
    tags: chatThreads.tags,
    createdAt: chatThreads.createdAt,
    updatedAt: chatThreads.updatedAt,
  };

  let results;
  if (planId) {
    results = await db
      .select(baseQuery)
      .from(chatThreads)
      .where(
        and(eq(chatThreads.tenantId, tenantId), eq(chatThreads.planId, planId))
      )
      .orderBy(desc(chatThreads.updatedAt));
  } else {
    results = await db
      .select(baseQuery)
      .from(chatThreads)
      .where(eq(chatThreads.tenantId, tenantId))
      .orderBy(desc(chatThreads.updatedAt));
  }

  // Fetch first user + first assistant message per thread in one query
  const snippets: Record<string, { firstUser: string | null; firstAssistant: string | null }> = {};
  if (results.length > 0) {
    const threadIds = results.map(t => t.id);
    const rows = await db
      .select({ threadId: messages.threadId, role: messages.role, content: messages.content })
      .from(messages)
      .where(and(inArray(messages.threadId, threadIds), inArray(messages.role, ['user', 'assistant'])))
      .orderBy(asc(messages.createdAt));

    for (const row of rows) {
      if (!snippets[row.threadId]) snippets[row.threadId] = { firstUser: null, firstAssistant: null };
      const s = snippets[row.threadId];
      if (row.role === 'user' && s.firstUser === null) s.firstUser = row.content;
      if (row.role === 'assistant' && s.firstAssistant === null) s.firstAssistant = row.content;
    }
  }

  const threadsWithSnippets = results.map(t => ({
    ...t,
    firstMessage: snippets[t.id]?.firstUser ?? null,
    firstAssistantSnippet: snippets[t.id]?.firstAssistant ?? null,
  }));

  return c.json({ threads: threadsWithSnippets });
});

// Get thread with messages
threadsRouter.get("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const threadId = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(threadId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid thread ID format" }, 400);
  }

  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(
      and(eq(chatThreads.id, threadId), eq(chatThreads.tenantId, tenantId))
    );

  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  const threadMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(messages.createdAt);

  return c.json({
    thread,
    messages: threadMessages.map((m) => ({
      ...m,
      toolCalls: safeJsonParse(m.toolCalls, null),
      uiPayload: safeJsonParse(m.uiPayload, null),
    })),
  });
});

// Create thread
threadsRouter.post("/", async (c) => {
  const { tenantId } = c.get("session");
  const rawBody = await c.req.json();

  const parseResult = createThreadSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request body", details: parseResult.error.issues }, 400);
  }
  const body = parseResult.data;

  const [thread] = await db
    .insert(chatThreads)
    .values({
      tenantId,
      planId: body.planId ?? null,
      title: body.title ?? null,
      tags: body.tags ?? [],
    })
    .returning();

  return c.json({ thread }, 201);
});

// Delete thread
threadsRouter.delete("/:id", async (c) => {
  const { tenantId } = c.get("session");
  const threadId = c.req.param("id");

  const uuidResult = uuidSchema.safeParse(threadId);
  if (!uuidResult.success) {
    return c.json({ error: "Invalid thread ID format" }, 400);
  }

  const [thread] = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(
      and(eq(chatThreads.id, threadId), eq(chatThreads.tenantId, tenantId))
    );

  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  await db.delete(chatThreads).where(
    and(eq(chatThreads.id, threadId), eq(chatThreads.tenantId, tenantId))
  );

  return c.json({ success: true });
});
