import { Hono } from "hono";
import { z } from "zod";
import { streamText } from "ai";
import { db } from "../lib/db.js";
import { chatThreads, messages, plans, planEdits, eq, and } from "@lasagna/core";
import { model, createAgentTools, systemPrompt } from "../agent/index.js";
import { uiPayloadSchema } from "../agent/types.js";
import type { AuthEnv } from "../middleware/auth.js";

export const chatRouter = new Hono<AuthEnv>();

// Validation schemas
const chatRequestSchema = z.object({
  threadId: z.string().uuid(),
  message: z.string().min(1).max(10000),
});

chatRouter.post("/", async (c) => {
  const { tenantId } = c.get("session");
  const rawBody = await c.req.json();

  const parseResult = chatRequestSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return c.json({ error: "Invalid request body", details: parseResult.error.issues }, 400);
  }
  const body = parseResult.data;

  // Verify thread belongs to tenant
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(
      and(eq(chatThreads.id, body.threadId), eq(chatThreads.tenantId, tenantId))
    );

  if (!thread) {
    return c.json({ error: "Thread not found" }, 404);
  }

  // Get plan context if thread is attached to a plan
  let planContext = "";
  if (thread.planId) {
    const [plan] = await db
      .select({ type: plans.type, title: plans.title, content: plans.content })
      .from(plans)
      .where(and(eq(plans.id, thread.planId), eq(plans.tenantId, tenantId)));

    if (plan) {
      planContext = `\n\nCurrent plan: "${plan.title}" (${plan.type})`;
      if (plan.content) {
        planContext += `\nCurrent content: ${plan.content}`;
      }
    }
  }

  // Save user message
  await db.insert(messages).values({
    threadId: body.threadId,
    tenantId,
    role: "user",
    content: body.message,
  });

  // Get conversation history
  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.threadId, body.threadId))
    .orderBy(messages.createdAt);

  // Create tools with tenant context
  const tools = createAgentTools(tenantId);

  // Capture for onFinish closure
  const threadId = body.threadId;
  const planId = thread.planId;

  // Stream response
  const result = streamText({
    model,
    system: systemPrompt + planContext,
    messages: history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    tools,
    maxRetries: 3,
    onFinish: async ({ text, toolCalls }) => {
      // Try to extract UI payload from response
      let uiPayload = null;
      try {
        // Look for JSON in the response
        const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          const validated = uiPayloadSchema.safeParse(parsed);
          if (validated.success) {
            uiPayload = validated.data;
          }
        }
      } catch {
        // Not valid JSON, that's ok
      }

      // Save assistant message
      await db.insert(messages).values({
        threadId,
        tenantId,
        role: "assistant",
        content: text,
        toolCalls: toolCalls ? JSON.stringify(toolCalls) : null,
        uiPayload: uiPayload ? JSON.stringify(uiPayload) : null,
      });

      // Update plan content if we have UI payload and plan is attached
      if (uiPayload && planId) {
        const [plan] = await db
          .select({ content: plans.content })
          .from(plans)
          .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));

        // Save edit history
        if (plan?.content) {
          await db.insert(planEdits).values({
            planId,
            tenantId,
            editedBy: "agent",
            previousContent: plan.content,
            changeDescription: "Updated via chat",
          });
        }

        // Update plan (with tenant isolation)
        await db
          .update(plans)
          .set({ content: JSON.stringify(uiPayload) })
          .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));
      }
    },
  });

  // Return as SSE stream
  return result.toTextStreamResponse();
});
