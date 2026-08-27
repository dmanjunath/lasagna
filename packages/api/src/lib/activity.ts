import { activityEvents } from "@lasagna/core";
import { db } from "./db.js";

/**
 * Operator metering: one activity_events row per billable action. Writes are
 * fire-and-forget — metering must never break (or slow) the feature it meters.
 */

// ── LLM pricing ──────────────────────────────────────────────────────────────
// USD per 1M tokens by OpenRouter slug. EDITABLE ESTIMATES — update when
// provider pricing changes. Unknown models fall back to DEFAULT_LLM_PRICE.
const LLM_PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "google/gemini-3.1-flash-lite-preview": { in: 0.1, out: 0.4 },
  "google/gemini-3.1-flash-lite": { in: 0.1, out: 0.4 },
  "anthropic/claude-haiku-4.5": { in: 1.0, out: 5.0 },
  "google/gemini-3.5-flash": { in: 0.3, out: 2.5 },
  "anthropic/claude-sonnet-4.5": { in: 3.0, out: 15.0 },
  "moonshotai/kimi-k2.6": { in: 0.55, out: 2.2 },
  "anthropic/claude-opus-4.7": { in: 5.0, out: 25.0 },
  "google/gemma-4-26b-a4b-it": { in: 0.1, out: 0.3 },
  "google/gemma-4-31B-it": { in: 0.1, out: 0.3 },
};
const DEFAULT_LLM_PRICE = { in: 1.0, out: 3.0 };

// ── Plaid pricing ────────────────────────────────────────────────────────────
// Plaid cost is NOT per event. Plaid bills per Item (connection) per month by
// product; that cost is now computed from the active items/products in
// lib/plaid-pricing.ts (surfaced by the admin spend routes), not attributed to
// individual events. logPlaidEvent still records events as an audit trail and
// for the dashboard's event counts, but writes costUsd = 0.

export type LlmSource = "chat" | "chat-title" | "insights" | "recurring" | "tax-vision" | "security-classify" | "suggestions" | "narrative" | "strategy" | "freeform" | "quick-import" | "financial-path";
export type PlaidSource = "sync" | "link";

/** Pure + unit-testable: estimated USD for a call. */
export function estimateLlmCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = LLM_PRICE_PER_MTOK[model] ?? DEFAULT_LLM_PRICE;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

/**
 * OpenRouter's actual per-generation USD cost, read from the AI SDK result's
 * providerMetadata.openrouter.usage.cost. Returns the value only when it is a
 * finite number >= 0; otherwise undefined so callers fall back to the estimate.
 */
export function actualLlmCostUsd(providerMetadata: unknown): number | undefined {
  if (typeof providerMetadata !== "object" || providerMetadata === null) return undefined;
  const openrouter = (providerMetadata as Record<string, unknown>).openrouter;
  if (typeof openrouter !== "object" || openrouter === null) return undefined;
  const usage = (openrouter as Record<string, unknown>).usage;
  if (typeof usage !== "object" || usage === null) return undefined;
  const cost = (usage as Record<string, unknown>).cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}

/** Log an LLM call. Fire-and-forget: errors are logged, never thrown. */
export function logLlmUsage(input: {
  tenantId: string | null;
  source: LlmSource;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** OpenRouter's actual USD cost; falls back to the token estimate when absent. */
  costUsd?: number;
}): void {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  const costUsd =
    typeof input.costUsd === "number" && Number.isFinite(input.costUsd) && input.costUsd >= 0
      ? input.costUsd
      : estimateLlmCostUsd(input.model, inputTokens, outputTokens);
  db.insert(activityEvents)
    .values({
      tenantId: input.tenantId,
      kind: "llm",
      source: input.source,
      model: input.model,
      inputTokens,
      outputTokens,
      costUsd: costUsd.toFixed(6),
    })
    .catch((e: unknown) => console.error("[activity] llm log failed:", e));
}

/** Log a Plaid event. Fire-and-forget: errors are logged, never thrown. */
export function logPlaidEvent(input: { tenantId: string | null; source: PlaidSource }): void {
  db.insert(activityEvents)
    .values({
      tenantId: input.tenantId,
      kind: "plaid",
      source: input.source,
      costUsd: "0",
    })
    .catch((e: unknown) => console.error("[activity] plaid log failed:", e));
}
