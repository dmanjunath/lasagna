import { Hono } from "hono";
import { z } from "zod";
import { generateText } from "ai";
import { db } from "../lib/db.js";
import { chatThreads, messages, plans, planEdits, eq, and } from "@lasagna/core";
import { getModel, createAgentTools } from "../agent/index.js";
import { systemPromptV2 } from "../agent/prompt-v2.js";
import { responseSchemaV2 } from "../agent/types-v2.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const chatRouterV2 = new Hono<AuthEnv>();
chatRouterV2.use("*", requireAuth);

// Validation schemas
const chatRequestSchema = z.object({
  threadId: z.string().uuid(),
  message: z.string().min(1).max(10000),
});

chatRouterV2.post("/", async (c) => {
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
  console.log("[Chat V2] Starting agentic loop with", Object.keys(tools).length, "tools");

  let conversationMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  let finalText = "";
  let allToolCalls: any[] = [];
  let allToolResults: any[] = [];
  const MAX_TOOL_ROUNDS = 5; // Limit tool-calling rounds to prevent infinite loops

  // Loop up to MAX_TOOL_ROUNDS iterations for tool calls
  for (let step = 0; step < MAX_TOOL_ROUNDS; step++) {
    console.log(`[Chat V2] Step ${step + 1}/${MAX_TOOL_ROUNDS}...`);

    const stepResult = await generateText({
      model: getModel(),
      system: systemPromptV2 + planContext,
      messages: conversationMessages,
      tools,
      maxSteps: 1, // Single step, we handle multi-step manually
    });

    const toolCallCount = stepResult.toolCalls?.length || 0;
    console.log(`[Chat V2] Step ${step + 1} result: text=${stepResult.text.length} chars, toolCalls=${toolCallCount}, finishReason=${stepResult.finishReason}`);

    // Accumulate text
    finalText = stepResult.text;

    // If no tool calls or finish reason is not tool-calls, we're done
    if (!stepResult.toolCalls?.length || stepResult.finishReason !== 'tool-calls') {
      console.log("[Chat V2] Agentic loop complete, no more tool calls");
      break;
    }

    // Execute tools and add results to conversation
    const toolResults: any[] = [];

    for (const toolCall of stepResult.toolCalls) {
      console.log(`[Chat V2] Calling tool: ${toolCall.toolName}`);
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
          console.error(`[Chat V2] Tool ${toolCall.toolName} error:`, e instanceof Error ? e.message : e);
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
    allToolResults.push(...toolResults);

    // Add assistant message and tool results for the next step
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
      ? `[System: Tool results]\n\n${toolResultsSummary}\n\nYou have all the data you need. NOW produce your FINAL response with the complete JSON. Do NOT call any more tools.`
      : `[System: Tool results]\n\n${toolResultsSummary}\n\nPlease continue with your analysis using this data and output the final JSON response.`;

    conversationMessages.push({
      role: "user" as const,
      content: nextPrompt,
    });
  }

  // Check if we have a valid JSON response
  const hasJsonPayload = finalText && (
    finalText.includes('"content"') || finalText.includes('"metrics"') || finalText.includes('"actions"')
  );

  // If we don't have valid JSON, request a wrap-up response with explicit JSON request
  if (!hasJsonPayload) {
    console.log("[Chat V2] No JSON found, requesting wrap-up response...");

    // Add a message requesting the final JSON
    conversationMessages.push({
      role: "user" as const,
      content: "IMPORTANT: You must now produce your FINAL response. Include the complete JSON with metrics, content, and actions fields. Do not call any more tools. Output the JSON now.",
    });

    const wrapUpResult = await generateText({
      model: getModel(),
      system: systemPromptV2 + planContext,
      messages: conversationMessages,
      tools: {}, // No tools - force text response
      maxSteps: 1,
    });
    finalText = wrapUpResult.text;
    console.log(`[Chat V2] Wrap-up response: ${finalText.length} chars`);
  }

  const text = finalText;
  const toolCalls = allToolCalls;
  console.log(`[Chat V2] Finished: ${text.length} chars, ${toolCalls.length} tool calls`);

  // Try to extract response from text
  let response = null;
  try {
    // Try markdown code block first
    let jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    let jsonStr = jsonMatch?.[1];

    // If no code block, look for raw JSON object with content field
    if (!jsonStr) {
      // Find the last { that starts a content object
      const contentIdx = text.lastIndexOf('"content"');
      if (contentIdx !== -1) {
        let braceIdx = text.lastIndexOf('{', contentIdx);
        if (braceIdx !== -1) {
          jsonStr = text.slice(braceIdx);
        }
      }
    }

    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      const validated = responseSchemaV2.safeParse(parsed);
      if (validated.success) {
        response = validated.data;
      } else {
        console.error("[Chat V2] Response validation failed:", validated.error.issues.slice(0, 3));
      }
    } else {
      console.log("[Chat V2] No JSON found in response, text length:", text.length);
    }
  } catch (e) {
    console.error("[Chat V2] JSON parse error:", e instanceof Error ? e.message : e);
  }

  // Fallback: if no valid JSON found, wrap raw text as content
  if (!response && finalText.trim()) {
    console.log("[Chat V2] Using fallback: wrapping raw text as content");
    response = {
      content: finalText,
    };
  }

  // Save assistant message
  await db.insert(messages).values({
    threadId,
    tenantId,
    role: "assistant",
    content: text,
    toolCalls: toolCalls ? JSON.stringify(toolCalls) : null,
    uiPayload: response ? JSON.stringify(response) : null,
  });

  // Update plan content if we have response and plan is attached
  if (response && planId) {
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
        changeDescription: "Updated via chat v2",
      });
    }

    // Update plan (with tenant isolation)
    await db
      .update(plans)
      .set({ content: JSON.stringify(response) })
      .where(and(eq(plans.id, planId), eq(plans.tenantId, tenantId)));
  }

  // Return JSON with response and tool results
  return c.json({
    response,
    toolResults: allToolResults
  });
});
