/**
 * THE single sanctioned entry point for LLM calls.
 *
 * INVARIANT: no LLM ever sees raw user data. Every call through this module is
 * anonymized at the boundary — the full outbound payload (system, prompt,
 * messages, embedded tool results) is deep-scrubbed with the tenant's alias map
 * (real account/goal names → aliases), and the model's output is descrubbed on
 * the way back so only the USER ever sees real names.
 *
 * Enforced by `__tests__/llm-boundary.test.ts`, which fails the suite if any
 * other file imports the model-call functions from "ai" (or hits a provider URL
 * directly). Do NOT add direct calls elsewhere; if a feature genuinely must see
 * raw input (e.g. parsing a user-pasted document), add it to that test's
 * documented exception list so the decision is visible in review.
 *
 * Scrubbing is idempotent (aliases never match real names), so callers that
 * additionally pre-scrub (chat's tool-result loop) stay correct.
 */

import { generateText, generateObject } from "ai";
import type { z } from "zod";
import {
  buildAliasMap,
  scrub,
  descrub,
  descrubObject,
  type AliasMap,
} from "./pii-scrubber.js";
import { actualLlmCostUsd, logLlmUsage, type LlmSource } from "./activity.js";

/** Who the call is for; pass a prebuilt aliasMap to avoid a per-call DB read. */
export interface LlmAnonContext {
  tenantId: string;
  /**
   * What the call is for. Required, because this is also the metering boundary:
   * every call through here writes one activity_events row, so a call with no
   * source would be spend nobody can see. Hand-rolled logging at the call sites
   * left real holes — the strategy verifier billed two model calls per section
   * and logged neither, so "strategy" stopped appearing in activity_events
   * altogether while it was still running daily.
   */
  source: LlmSource;
  aliasMap?: AliasMap;
  /**
   * Default true. Two reasons to set it false:
   *
   *  - The caller JSON.parses the returned text. Descrubbing first would splice
   *    real names (which may contain quotes or backslashes) into the JSON and
   *    corrupt it. The caller must then descrub the parsed fields itself.
   *  - The model was told not to name anything, so the response should carry no
   *    alias at all. Descrubbing it can only do damage: a debt alias IS a common
   *    noun ("auto", "credit card"), so restoring one splices an account name
   *    into ordinary prose and doubles the noun ("your Auto Loan loan").
   */
  descrubOutput?: boolean;
}

type GenerateTextOpts = Parameters<typeof generateText>[0];

export interface LlmTextResult {
  /** Assistant text with real names restored (alias-form when descrubOutput is false). */
  text: string;
  toolCalls: Awaited<ReturnType<typeof generateText>>["toolCalls"];
  finishReason: Awaited<ReturnType<typeof generateText>>["finishReason"];
  usage: Awaited<ReturnType<typeof generateText>>["usage"];
  /** OpenRouter's actual USD cost for the call, when reported. */
  costUsd?: number;
}

async function resolveMap(anon: LlmAnonContext): Promise<AliasMap> {
  return anon.aliasMap ?? buildAliasMap(anon.tenantId);
}

/** Deep-scrub the outbound fields of a call's options. */
function scrubOpts<T extends { system?: unknown; prompt?: unknown; messages?: unknown }>(
  opts: T,
  map: AliasMap,
): T {
  const out = { ...opts };
  if (typeof out.system === "string") out.system = scrub(out.system, map);
  if (out.prompt !== undefined) out.prompt = scrub(out.prompt, map);
  if (out.messages !== undefined) out.messages = scrub(out.messages, map);
  return out;
}

/**
 * The provider slug actually used, for the usage row.
 *
 * Read off the model the caller built rather than re-derived from a tier name,
 * so an admin override is metered as the model it really ran.
 */
function modelSlug(model: GenerateTextOpts["model"]): string {
  if (typeof model === "string") return model;
  const id = (model as { modelId?: unknown } | null | undefined)?.modelId;
  return typeof id === "string" && id.length > 0 ? id : "unknown";
}

/** Anonymized generateText: scrubbed outbound, text descrubbed inbound. */
export async function llmGenerateText(
  anon: LlmAnonContext,
  opts: GenerateTextOpts,
): Promise<LlmTextResult> {
  // Outside the try: a failure here means no model was reached, so there is no
  // call to meter.
  const map = await resolveMap(anon);
  let usage: Awaited<ReturnType<typeof generateText>>["usage"] | undefined;
  let costUsd: number | undefined;
  try {
    const result = await generateText(scrubOpts(opts, map) as GenerateTextOpts);
    usage = result.usage;
    costUsd = actualLlmCostUsd(result.providerMetadata);
    return {
      text: anon.descrubOutput === false ? result.text : descrub(result.text, map),
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      usage: result.usage,
      costUsd,
    };
  } finally {
    // In a `finally` so a call that THREW is still recorded. A provider error
    // arrives after the tokens are billed, so the ones that throw are exactly
    // the spend an operator most needs to see; logging only on success is how
    // whole features went missing from the activity table.
    logLlmUsage({
      tenantId: anon.tenantId,
      source: anon.source,
      model: modelSlug(opts.model),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd,
    });
  }
}

/** The single tool the schema rides under in `viaToolCall` mode. */
const OBJECT_TOOL_NAME = "emit_result";

/** Anonymized generateObject: scrubbed outbound, object strings descrubbed inbound. */
export async function llmGenerateObject<T>(
  anon: LlmAnonContext,
  opts: {
    model: GenerateTextOpts["model"];
    schema: z.Schema<T>;
    system?: string;
    prompt?: string;
    messages?: GenerateTextOpts["messages"];
    temperature?: number;
    maxOutputTokens?: number;
    /**
     * Carry the schema as ONE forced tool call instead of a JSON response
     * format. Needed for models whose serving route does structured output
     * only through tool use — see the Opus note in strategy-section.ts. The
     * returned object is still parsed against `schema`, so callers cannot tell
     * the two modes apart.
     */
    viaToolCall?: boolean;
  },
): Promise<{ object: T; usage?: { inputTokens?: number; outputTokens?: number }; costUsd?: number }> {
  const map = await resolveMap(anon);
  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  let costUsd: number | undefined;
  try {
    const { viaToolCall, ...call } = scrubOpts(opts, map);
    let object: unknown;
    let providerMetadata: Awaited<ReturnType<typeof generateText>>["providerMetadata"];
    if (viaToolCall) {
      const result = await generateText({
        ...call,
        tools: {
          [OBJECT_TOOL_NAME]: {
            description: "Return the result. Call this exactly once.",
            inputSchema: opts.schema,
          },
        },
        toolChoice: { type: "tool", toolName: OBJECT_TOOL_NAME },
      } as never);
      const input = result.toolCalls[0]?.input;
      if (input === undefined) {
        throw new Error(
          `llmGenerateObject: model returned no ${OBJECT_TOOL_NAME} call (finish: ${result.finishReason})`,
        );
      }
      object = opts.schema.parse(input);
      usage = result.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      providerMetadata = result.providerMetadata;
    } else {
      const result = await generateObject(call as never);
      object = result.object;
      usage = result.usage as { inputTokens?: number; outputTokens?: number } | undefined;
      providerMetadata = result.providerMetadata;
    }
    costUsd = actualLlmCostUsd(providerMetadata);
    return {
      object: (anon.descrubOutput === false ? object : descrubObject(object, map)) as T,
      usage,
      costUsd,
    };
  } finally {
    // See llmGenerateText: recorded even when the call throws.
    logLlmUsage({
      tenantId: anon.tenantId,
      source: anon.source,
      model: modelSlug(opts.model),
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      costUsd,
    });
  }
}
