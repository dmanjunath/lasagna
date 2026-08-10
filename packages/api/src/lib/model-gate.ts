import { FREE_MODEL_LEVEL, type Plan } from "@lasagna/core";
import { MODEL_LEVELS, type ModelLevel } from "../agent/index.js";

// The floor a paid (pro/premium) plan runs at: "medium" = Claude Sonnet. Paid
// users never get a below-Sonnet chat, even if they pick a cheaper tier or send
// no selection at all. Higher requests (quality/frontier) are still honored.
const PRO_MIN_LEVEL: ModelLevel = "medium";

/**
 * Resolve the model level a chat request runs at.
 * - Free tenants ALWAYS get the free model. They have no model picker (the
 *   selector component isn't mounted), so the client may send a stale/default
 *   premium level — we silently serve the free model rather than reject it.
 *   Upgrade prompts live on the Settings/Accounts surfaces, not here.
 * - Pro is floored to "medium" (Sonnet): a paid plan should never run a
 *   below-Sonnet model, whether it defaulted or explicitly asked for a cheaper
 *   tier. Higher requests (quality / frontier) are honored as-is.
 *
 * No cast on FREE_MODEL_LEVEL: if it ever drifts to a value not in
 * MODEL_LEVELS, this must fail to compile (the core/api level-sync invariant).
 */
export function resolveModelLevel(plan: Plan, requested: ModelLevel | undefined): ModelLevel {
  if (plan === "free") return FREE_MODEL_LEVEL;
  const level = requested ?? PRO_MIN_LEVEL;
  const floor = MODEL_LEVELS.indexOf(PRO_MIN_LEVEL);
  return MODEL_LEVELS.indexOf(level) < floor ? PRO_MIN_LEVEL : level;
}
