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
import { actualLlmCostUsd } from "./activity.js";

/** Who the call is for; pass a prebuilt aliasMap to avoid a per-call DB read. */
export interface LlmAnonContext {
  tenantId: string;
  aliasMap?: AliasMap;
  /**
   * Default true. Set false when the caller JSON.parses the returned text —
   * descrubbing first would splice real names (which may contain quotes or
   * backslashes) into the JSON and corrupt it. The caller must then descrub
   * the parsed fields itself.
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

/** Anonymized generateText: scrubbed outbound, text descrubbed inbound. */
export async function llmGenerateText(
  anon: LlmAnonContext,
  opts: GenerateTextOpts,
): Promise<LlmTextResult> {
  const map = await resolveMap(anon);
  const result = await generateText(scrubOpts(opts, map) as GenerateTextOpts);
  return {
    text: anon.descrubOutput === false ? result.text : descrub(result.text, map),
    toolCalls: result.toolCalls,
    finishReason: result.finishReason,
    usage: result.usage,
    costUsd: actualLlmCostUsd(result.providerMetadata),
  };
}

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
  },
): Promise<{ object: T; usage?: { inputTokens?: number; outputTokens?: number }; costUsd?: number }> {
  const map = await resolveMap(anon);
  const result = await generateObject(scrubOpts(opts, map) as never);
  return {
    object: descrubObject(result.object, map) as T,
    usage: result.usage as { inputTokens?: number; outputTokens?: number } | undefined,
    costUsd: actualLlmCostUsd(result.providerMetadata),
  };
}
