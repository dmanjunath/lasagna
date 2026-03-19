import { Hono } from "hono";
import { z } from "zod";
import { generateText } from "ai";
import { db } from "../lib/db.js";
import { chatThreads, messages, plans, planEdits, eq, and } from "@lasagna/core";
import { getModel, createAgentTools } from "../agent/index.js";
import { systemPromptV2 } from "../agent/prompt-v2.js";
import { responseSchemaV2 } from "../agent/types-v2.js";
import { type AuthEnv } from "../middleware/auth.js";
import { buildAliasMap, scrub, descrub, PII_DEBUG } from "../lib/pii-scrubber.js";

export const chatRouterV2 = new Hono<AuthEnv>();

// Validation schemas
const chatRequestSchema = z.object({
  threadId: z.string().uuid(),
  message: z.string().min(1).max(10000),
});

chatRouterV2.post("/", async (c) => {
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
  if (!isDemo) {
    await db.insert(messages).values({
      threadId: body.threadId,
      tenantId,
      role: "user",
      content: body.message,
    });
  }

  // Get conversation history
  const history = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.threadId, body.threadId))
    .orderBy(messages.createdAt);

  // Create tools with tenant context
  const tools = createAgentTools(tenantId, { isDemo });

  // Build PII alias map for scrubbing data sent to LLM
  const aliasMap = await buildAliasMap(tenantId);

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

    if (PII_DEBUG) {
      console.log(`[Chat V2][PII Debug] Step ${step + 1} — messages sent to LLM:`);
      for (const msg of conversationMessages) {
        console.log(`  [${msg.role}] ${msg.content.slice(0, 500)}${msg.content.length > 500 ? "..." : ""}`);
      }
    }

    const stepResult = await generateText({
      model: getModel(),
      system: systemPromptV2 + planContext,
      messages: conversationMessages,
      tools,
      // Note: We handle multi-step manually with the loop above
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
          const args = (toolCall as any).args ?? {};
          const result = await (tool as any).execute(args);
          const scrubbedResult = scrub(result, aliasMap, "chat-v2");
          toolResults.push({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            result: JSON.stringify(scrubbedResult),
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
      ? `[System: Tool results]\n\n${toolResultsSummary}\n\nYou have all the data you need. NOW produce your FINAL response as the JSON object with "chat", "content", and optionally "metrics" and "actions" fields. Do NOT call any more tools.`
      : `[System: Tool results]\n\n${toolResultsSummary}\n\nContinue your analysis. When you have enough data, output the final JSON response with "chat" and "content" fields.`;

    conversationMessages.push({
      role: "user" as const,
      content: nextPrompt,
    });
  }

  // Descrub LLM response — replace aliases back to real names
  finalText = descrub(finalText, aliasMap, "chat-v2");

  const text = finalText;
  const toolCalls = allToolCalls;
  console.log(`[Chat V2] Finished: ${text.length} chars, ${toolCalls.length} tool calls`);

  // Try to extract JSON response from text using multiple strategies
  let response = null;
  try {
    // Strategy 1: markdown code block
    let jsonStr: string | undefined;
    const codeBlockMatch = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    // Strategy 2: find outermost JSON object containing "chat" or "content"
    if (!jsonStr) {
      for (const key of ['"chat"', '"content"']) {
        const keyIdx = text.indexOf(key);
        if (keyIdx === -1) continue;
        // Walk backwards to find the opening brace
        let braceIdx = text.lastIndexOf('{', keyIdx);
        if (braceIdx === -1) continue;
        // Walk forwards to find the matching closing brace
        let depth = 0;
        for (let i = braceIdx; i < text.length; i++) {
          if (text[i] === '{') depth++;
          else if (text[i] === '}') depth--;
          if (depth === 0) {
            jsonStr = text.slice(braceIdx, i + 1);
            break;
          }
        }
        if (jsonStr) break;
      }
    }

    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      const validated = responseSchemaV2.safeParse(parsed);
      if (validated.success) {
        response = validated.data;
      } else {
        console.error("[Chat V2] Response validation failed:", validated.error.issues.slice(0, 3));
        // Partial recovery: if it has chat or content, use it anyway
        if (parsed && (parsed.chat || parsed.content)) {
          response = {
            chat: parsed.chat || parsed.content?.slice(0, 200),
            content: parsed.content || parsed.chat,
            ...(parsed.metrics && { metrics: parsed.metrics }),
            ...(parsed.actions && { actions: parsed.actions }),
          };
        }
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
      chat: finalText.slice(0, 200) + (finalText.length > 200 ? '...' : ''), // Truncate for chat
      content: finalText,
    };
  }

  // Ensure chat field exists (for backwards compatibility)
  if (response && !response.chat) {
    // Extract first sentence or first 150 chars as chat fallback
    const firstSentence = response.content?.match(/^[^.!?]+[.!?]/)?.[0];
    response.chat = firstSentence || response.content?.slice(0, 150) || 'Analysis complete.';
  }

  // Save assistant message
  if (!isDemo) {
    await db.insert(messages).values({
      threadId,
      tenantId,
      role: "assistant",
      content: text,
      toolCalls: toolCalls ? JSON.stringify(toolCalls) : null,
      uiPayload: response ? JSON.stringify(response) : null,
    });
  }

  // Update plan content if we have response and plan is attached
  if (!isDemo && response && planId) {
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
