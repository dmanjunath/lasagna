import { Hono } from "hono";
import { z } from "zod";
import { generateText } from "ai";
import { db } from "../lib/db.js";
import { chatThreads, messages, plans, planEdits, eq, and } from "@lasagna/core";
import { getModel, createAgentTools, systemPrompt } from "../agent/index.js";
import { uiPayloadSchema } from "../agent/types.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const chatRouter = new Hono<AuthEnv>();
chatRouter.use("*", requireAuth);

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

  // Manual multi-step tool execution loop (OpenRouter doesn't support auto maxSteps)
  console.log("[Chat] Starting agentic loop with", Object.keys(tools).length, "tools");

  let conversationMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let finalText = "";
  let allToolCalls: any[] = [];
  const MAX_TOOL_ROUNDS = 5; // Limit tool-calling rounds to prevent infinite loops

  // Loop up to MAX_TOOL_ROUNDS iterations for tool calls
  for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
    console.log(`[Chat] Step ${step + 1}/${MAX_TOOL_ROUNDS}...`);

    const stepResult = await generateText({
      model: getModel(),
      system: systemPrompt + planContext,
      messages: conversationMessages,
      tools,
      maxSteps: 1, // Single step, we handle multi-step manually
    });

    const toolCallCount = stepResult.toolCalls?.length || 0;
    console.log(`[Chat] Step ${step + 1} result: text=${stepResult.text.length} chars, toolCalls=${toolCallCount}, finishReason=${stepResult.finishReason}`);

    // Accumulate text
    finalText = stepResult.text;

    // If no tool calls or finish reason is not tool-calls, we're done
    if (!stepResult.toolCalls?.length || stepResult.finishReason !== 'tool-calls') {
      console.log("[Chat] Agentic loop complete, no more tool calls");
      break;
    }

    // Execute tools and add results to conversation
    const toolResults: any[] = [];

    for (const toolCall of stepResult.toolCalls) {
      console.log(`[Chat] Calling tool: ${toolCall.toolName}`);
      const tool = tools[toolCall.toolName as keyof typeof tools];
      if (tool && 'execute' in tool) {
        try {
          const args = toolCall.args ?? {};
          const result = await (tool as any).execute(args);
          toolResults.push({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result: JSON.stringify(result),
          });
        } catch (e) {
          console.error(`[Chat] Tool ${toolCall.toolName} error:`, e instanceof Error ? e.message : e);
          toolResults.push({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
          });
        }
      } else {
        toolResults.push({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          result: JSON.stringify({ error: `Tool ${toolCall.toolName} not found` }),
        });
      }
    }

    allToolCalls.push(...stepResult.toolCalls);

    // Simpler approach: add assistant message and tool results as text for the next step
    // This avoids complex message format issues
    const toolResultsSummary = toolResults
      .map(tr => `[Tool: ${tr.toolName}]\n${tr.result}`)
      .join("\n\n");

    conversationMessages.push({
      role: "assistant" as const,
      content: stepResult.text,
    });

    // On the last round, tell the model to produce final output without more tool calls
    const isLastRound = step === MAX_TOOL_ROUNDS - 1;
    const nextPrompt = isLastRound
      ? `[System: Tool results]\n\n${toolResultsSummary}\n\nYou have all the data you need. NOW produce your FINAL response with the complete UIPayload JSON. Do NOT call any more tools.`
      : `[System: Tool results]\n\n${toolResultsSummary}\n\nPlease continue with your analysis using this data and output the final UIPayload JSON.`;

    conversationMessages.push({
      role: "user" as const,
      content: nextPrompt,
    });
  }

  // Check if we have a valid JSON response
  const hasJsonPayload = finalText && (
    finalText.includes('"layout"') && finalText.includes('"blocks"')
  );

  // If we don't have valid JSON, request a wrap-up response with explicit JSON request
  if (!hasJsonPayload) {
    console.log("[Chat] No UIPayload JSON found, requesting wrap-up response...");

    // Add a message requesting the final JSON
    conversationMessages.push({
      role: "user" as const,
      content: "IMPORTANT: You must now produce your FINAL response. Include the complete UIPayload JSON with layout and blocks arrays. Do not call any more tools. Output the JSON now.",
    });

    const wrapUpResult = await generateText({
      model: getModel(),
      system: systemPrompt + planContext,
      messages: conversationMessages,
      tools: {}, // No tools - force text response
      maxSteps: 1,
    });
    finalText = wrapUpResult.text;
    console.log(`[Chat] Wrap-up response: ${finalText.length} chars`);
  }

  const text = finalText;
  const toolCalls = allToolCalls;
  console.log(`[Chat] Finished: ${text.length} chars, ${toolCalls.length} tool calls`);

  // Try to extract UI payload from response
  let uiPayload = null;
  try {
    // Try markdown code block first
    let jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    let jsonStr = jsonMatch?.[1];

    // If no code block, look for raw JSON object with layout and blocks
    if (!jsonStr) {
      // Find the last { that starts a layout/blocks object
      const layoutIdx = text.lastIndexOf('"layout"');
      if (layoutIdx !== -1) {
        let braceIdx = text.lastIndexOf('{', layoutIdx);
        if (braceIdx !== -1) {
          jsonStr = text.slice(braceIdx);
        }
      }
    }

    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      const validated = uiPayloadSchema.safeParse(parsed);
      if (validated.success) {
        uiPayload = validated.data;
      } else {
        console.error("[Chat] UIPayload validation failed:", validated.error.issues.slice(0, 3));
      }
    } else {
      console.log("[Chat] No JSON found in response, text length:", text.length);
    }
  } catch (e) {
    console.error("[Chat] JSON parse error:", e instanceof Error ? e.message : e);
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

  // Extract a brief chat summary (first paragraph or sentence before JSON)
  let chatSummary = "Here's my analysis.";
  const jsonIdx = text.indexOf('{');
  if (jsonIdx > 0) {
    // Get text before JSON
    const proseText = text.slice(0, jsonIdx).trim();
    // Get first paragraph or first 200 chars
    const firstPara = proseText.split('\n\n')[0];
    if (firstPara && firstPara.length > 10) {
      chatSummary = firstPara.slice(0, 200);
      if (firstPara.length > 200) chatSummary += '...';
    }
  }

  // Return JSON response matching V2 format expected by frontend
  return c.json({
    response: {
      chat: chatSummary,
      metrics: [],
      content: uiPayload ? JSON.stringify(uiPayload) : null,
      actions: [],
    },
    toolResults: allToolCalls.map(tc => ({
      toolName: tc.toolName,
      args: tc.args,
      result: null, // Results already processed
    })),
    uiPayload, // Also include the parsed payload directly
  });
});
