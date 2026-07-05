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
  "anthropic/claude-haiku-4.5": { in: 1.0, out: 5.0 },
  "google/gemini-3.5-flash": { in: 0.3, out: 2.5 },
  "anthropic/claude-sonnet-4.5": { in: 3.0, out: 15.0 },
  "moonshotai/kimi-k2.6": { in: 0.55, out: 2.2 },
  "anthropic/claude-opus-4.7": { in: 5.0, out: 25.0 },
  "google/gemma-4-26b-a4b-it": { in: 0.1, out: 0.3 },
};
const DEFAULT_LLM_PRICE = { in: 1.0, out: 3.0 };

// ── Plaid pricing ────────────────────────────────────────────────────────────
// Per-event USD estimates. Plaid really bills per item-month (~$0.30 for
// transactions); a daily sync cadence amortizes to ~$0.01/sync. Link events
// approximate the one-time connection cost. EDITABLE ESTIMATES.
const PLAID_EVENT_COST: Record<string, number> = {
  sync: 0.01,
  link: 1.5,
};

export type LlmSource = "chat" | "chat-title" | "insights" | "recurring" | "tax-vision";
export type PlaidSource = keyof typeof PLAID_EVENT_COST;

/** Pure + unit-testable: estimated USD for a call. */
export function estimateLlmCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = LLM_PRICE_PER_MTOK[model] ?? DEFAULT_LLM_PRICE;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

/** Log an LLM call. Fire-and-forget: errors are logged, never thrown. */
export function logLlmUsage(input: {
  tenantId: string | null;
  source: LlmSource;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}): void {
  const inputTokens = input.inputTokens ?? 0;
  const outputTokens = input.outputTokens ?? 0;
  db.insert(activityEvents)
    .values({
      tenantId: input.tenantId,
      kind: "llm",
      source: input.source,
      model: input.model,
      inputTokens,
      outputTokens,
      costUsd: estimateLlmCostUsd(input.model, inputTokens, outputTokens).toFixed(6),
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
      costUsd: (PLAID_EVENT_COST[input.source] ?? 0).toFixed(6),
    })
    .catch((e: unknown) => console.error("[activity] plaid log failed:", e));
}
