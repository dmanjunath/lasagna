/**
 * Per-process model spend: a meter that makes cost visible while you work, and
 * a development cap that stops a runaway loop before it empties the account.
 *
 * Both hang off lib/llm.ts, the one boundary every model call already passes
 * through, next to the activity_events write. activity_events is the durable
 * record an operator reads later; this is the number you need NOW, in the
 * terminal, while the loop you just started is still running.
 *
 * THE CAP NEVER APPLIES IN PRODUCTION. A spend ceiling that throws mid-request
 * would take down plan generation for a real person, which is worse than the
 * spend it saves. Production's cost control is the frontier-escalation ceiling
 * in services/strategy-section.ts, which degrades to a cheaper model instead of
 * failing.
 */

import { env } from "./env.js";

interface SourceSpend {
  calls: number;
  usd: number;
}

let totalUsd = 0;
let totalCalls = 0;
const bySource = new Map<string, SourceSpend>();

/**
 * The deployed image sets NODE_ENV=production (see Dockerfile), and APP_ENV
 * falls back to it, so a real deployment answers true here on either signal.
 */
function isProduction(): boolean {
  return env.APP_ENV === "production" || process.env.NODE_ENV === "production";
}

/**
 * Add one completed call to the meter and, outside production, print it.
 *
 * Called from lib/llm.ts's `finally`, so it runs for calls that THREW too — a
 * provider error still bills the tokens, and a failing retry loop is exactly
 * the runaway the cap exists to stop.
 */
export function recordLlmSpend(input: {
  source: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}): void {
  // A meter must never poison its own total: one non-finite value would make
  // every later comparison false and the cap would stop working (or fire on
  // every call). Anything that isn't a real number counts as zero.
  const usd = Number.isFinite(input.costUsd) && input.costUsd > 0 ? input.costUsd : 0;

  totalUsd += usd;
  totalCalls += 1;
  const entry = bySource.get(input.source) ?? { calls: 0, usd: 0 };
  entry.calls += 1;
  entry.usd += usd;
  bySource.set(input.source, entry);

  if (isProduction()) return;
  console.log(
    `[llm] ${input.source} ${input.model} ${input.inputTokens}in/${input.outputTokens}out ` +
      `$${usd.toFixed(4)} (run total $${totalUsd.toFixed(2)})`,
  );
}

/**
 * Throws once this process has ALREADY spent past the cap.
 *
 * Called before each model call, so the call that crosses the line is allowed
 * to finish and the NEXT one stops. You cannot know a call's cost before making
 * it, so the alternative is either refusing calls that would have been fine or
 * letting the loop run — one call of overshoot is the cheap answer.
 *
 * No-op in production, always.
 */
export function assertLlmSpendUnderCap(): void {
  if (isProduction()) return;
  const cap = env.LLM_DEV_SPEND_CAP_USD;
  if (!Number.isFinite(cap) || cap <= 0) return;
  if (totalUsd <= cap) return;

  const plural = (n: number) => `${n} call${n === 1 ? "" : "s"}`;
  const biggest = [...bySource.entries()].sort((a, b) => b[1].usd - a[1].usd)[0];
  const blame = biggest
    ? `${biggest[0]} ($${biggest[1].usd.toFixed(2)} over ${plural(biggest[1].calls)})`
    : "none recorded";
  throw new Error(
    `[llm] development spend cap reached. This process has spent $${totalUsd.toFixed(2)} ` +
      `across ${totalCalls} model call${totalCalls === 1 ? "" : "s"}, against a cap of $${cap.toFixed(2)}. ` +
      `Biggest source: ${blame}. ` +
      `Raise LLM_DEV_SPEND_CAP_USD to keep going. This cap is never enforced in production.`,
  );
}

/** What the process has spent so far, in USD. */
export function llmSpendTotalUsd(): number {
  return totalUsd;
}

/** Test seam: clears the meter so cases do not inherit each other's spend. */
export function resetLlmSpend(): void {
  totalUsd = 0;
  totalCalls = 0;
  bySource.clear();
}
