import { FREE_MODEL_LEVEL, type Plan } from "@lasagna/core";
import { type ModelLevel } from "../agent/index.js";

/**
 * Resolve the model level a chat request runs at.
 * - Free tenants ALWAYS get the free model. They have no model picker (the
 *   selector component isn't mounted), so the client may send a stale/default
 *   premium level — we silently serve the free model rather than reject it.
 *   Upgrade prompts live on the Settings/Accounts surfaces, not here.
 * - Pro honors the requested level, defaulting to "fast-claude".
 *
 * No cast on FREE_MODEL_LEVEL: if it ever drifts to a value not in
 * MODEL_LEVELS, this must fail to compile (the core/api level-sync invariant).
 */
export function resolveModelLevel(plan: Plan, requested: ModelLevel | undefined): ModelLevel {
  if (plan === "free") return FREE_MODEL_LEVEL;
  return requested ?? "fast-claude";
}
