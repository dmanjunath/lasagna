import { Hono } from "hono";
import { z } from "zod";
import { generateText } from "ai";
import { db } from "../lib/db.js";
import { chatThreads, messages, eq, and } from "@lasagna/core";
import { getModel, getModelSlug, createAgentTools, systemPrompt, MODEL_LEVELS } from "../agent/index.js";
import { type AuthEnv } from "../middleware/auth.js";
import { buildAliasMap, scrub, descrub, PII_DEBUG } from "../lib/pii-scrubber.js";

export const chatRouter = new Hono<AuthEnv>();

const chatRequestSchema = z.object({
  threadId: z.string().uuid(),
  message: z.string().min(1).max(10000),
  // Optional page context string prepended to the AI message (not stored in DB)
  context: z.string().max(20000).optional(),
  // Optional structured context metadata for the user message bubble (stored as ui_payload)
  uiPayload: z.unknown().optional(),
  // Optional model quality level
  modelLevel: z.enum(MODEL_LEVELS).optional(),
});

chatRouter.post("/", async (c) => {
  const { tenantId, isDemo } = c.get("session");
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

  // Save user message — store only the actual user text, not the context prefix
  if (!isDemo) {
    await db.insert(messages).values({
      threadId: body.threadId,
      tenantId,
      role: "user",
      content: body.message,
      uiPayload: body.uiPayload ? JSON.stringify(body.uiPayload) : null,
    });
  }

  // Get conversation history
  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.threadId, body.threadId))
    .orderBy(messages.createdAt);

  // Build conversation messages for AI
  let conversationMessages: any[] = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Prepend page context to the current (last) user message so the AI has it,
  // without persisting the raw context blob in the DB
  if (body.context && conversationMessages.length > 0) {
    const lastIdx = conversationMessages.length - 1;
    conversationMessages[lastIdx] = {
      ...conversationMessages[lastIdx],
      content: body.context + conversationMessages[lastIdx].content,
    };
  }

  const tools = createAgentTools(tenantId, { isDemo });
  const aliasMap = await buildAliasMap(tenantId);
  const threadId = body.threadId;

  // Resolve the agent-loop model once — the response echoes this back so the
  // client can show which model answered.
  const agentLevel = body.modelLevel ?? "fast-claude";
  const agentModelSlug = getModelSlug(agentLevel);

  console.log("[Chat] Starting agentic loop with", Object.keys(tools).length, "tools");

  let finalText = "";
  let allToolCalls: any[] = [];
  const MAX_TOOL_ROUNDS = 5;

  for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
    console.log(`[Chat] Step ${step + 1}/${MAX_TOOL_ROUNDS}...`);

    if (PII_DEBUG) {
      console.log(`[Chat][PII Debug] Step ${step + 1} — messages sent to LLM:`);
      for (const msg of conversationMessages) {
        const preview = typeof msg.content === "string" ? msg.content.slice(0, 500) : JSON.stringify(msg.content).slice(0, 500);
        console.log(`  [${msg.role}] ${preview}`);
      }
    }

    const stepResult = await generateText({
      model: getModel(agentLevel),
      system: systemPrompt,
      messages: conversationMessages,
      tools,
      // Force at least one tool call on step 1 so the model fetches real data
      // before answering. Subsequent steps use "auto" so it can respond freely.
      toolChoice: step === 0 ? "required" : "auto",
    });

    const toolCallCount = stepResult.toolCalls?.length || 0;
    console.log(`[Chat] Step ${step + 1}: text=${stepResult.text.length} chars, toolCalls=${toolCallCount}, finishReason=${stepResult.finishReason}`);

    finalText = stepResult.text;

    if (!stepResult.toolCalls?.length || stepResult.finishReason !== 'tool-calls') {
      console.log("[Chat] Agentic loop complete");
      break;
    }

    // Execute tool calls and collect results
    const toolResultParts: any[] = [];
    for (const toolCall of stepResult.toolCalls) {
      console.log(`[Chat] Calling tool: ${toolCall.toolName}`);
      const t = tools[toolCall.toolName as keyof typeof tools];
      if (t && 'execute' in t) {
        try {
          const toolInput = (toolCall as any).input ?? (toolCall as any).args ?? {};
          const result = await (t as any).execute(toolInput);
          const scrubbedResult = scrub(result, aliasMap, "chat");
          const jsonValue = JSON.stringify(scrubbedResult);
          toolResultParts.push({
            type: "tool-result" as const,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output: { type: "text" as const, value: jsonValue },
          });
        } catch (e) {
          console.error(`[Chat] Tool ${toolCall.toolName} ERROR:`, e instanceof Error ? e.message : String(e));
          toolResultParts.push({
            type: "tool-result" as const,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output: { type: "text" as const, value: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) },
          });
        }
      }
    }

    allToolCalls.push(...stepResult.toolCalls);

    // Build the assistant message with tool-call content parts
    const assistantContent: any[] = [];
    if (stepResult.text) {
      assistantContent.push({ type: "text" as const, text: stepResult.text });
    }
    for (const tc of stepResult.toolCalls) {
      assistantContent.push({
        type: "tool-call" as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: (tc as any).input ?? (tc as any).args,
      });
    }
    conversationMessages.push({ role: "assistant" as const, content: assistantContent });

    // Add tool results as a proper tool message
    conversationMessages.push({ role: "tool" as const, content: toolResultParts });
  }

  // Descrub LLM response — replace aliases back to real names
  finalText = descrub(finalText, aliasMap, "chat");

  console.log(`[Chat] Final response: ${finalText.length} chars, ${allToolCalls.length} tool calls`);

  // Save assistant message with full markdown response
  if (!isDemo) {
    await db.insert(messages).values({
      threadId,
      tenantId,
      role: "assistant",
      content: finalText || "I wasn't able to generate a response. Please try again.",
      toolCalls: allToolCalls.length > 0 ? JSON.stringify(allToolCalls) : null,
    });
  }

  // Auto-generate thread title on first message
  let generatedThreadTitle: string | null = null;
  if (!isDemo && !thread.title) {
    try {
      const titleResult = await generateText({
        model: getModel(),
        system: "Generate a short title (3-6 words) for this financial conversation. No quotes, no punctuation at the end. Just the title.",
        messages: [{ role: "user", content: `Title for: "${body.message.slice(0, 200)}"` }],
      });
      generatedThreadTitle = titleResult.text.trim().slice(0, 100);
      if (generatedThreadTitle && generatedThreadTitle.length > 2) {
        await db
          .update(chatThreads)
          .set({ title: generatedThreadTitle })
          .where(and(eq(chatThreads.id, threadId), eq(chatThreads.tenantId, tenantId)));
      } else {
        generatedThreadTitle = null;
      }
    } catch {
      // Non-fatal
    }
  }

  return c.json({
    threadTitle: generatedThreadTitle,
    response: {
      chat: finalText || "I wasn't able to generate a response. Please try again.",
    },
    toolResults: allToolCalls.map(tc => ({
      toolName: tc.toolName,
      args: tc.input ?? tc.args,
    })),
    model: { level: agentLevel, slug: agentModelSlug },
  });
});
