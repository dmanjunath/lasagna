import { db } from "./db.js";
import { accounts, goals, eq, and } from "@lasagna/core";

/** Set PII_DEBUG=true in env to log alias mappings and scrub/descrub operations */
export const PII_DEBUG = process.env.PII_DEBUG === "true";

export interface AliasMap {
  /** real name → alias */
  forward: Map<string, string>;
  /** alias → real name */
  reverse: Map<string, string>;
}

/**
 * Build a deterministic alias map for a tenant's PII fields.
 * - Account names → "Account 1", "Account 2", ...
 * - Debt account names (credit/loan) → subtype label, numbered if duplicates
 * - Goal names → "Goal 1", "Goal 2", ...
 * - Account masks → tracked for stripping
 */
export async function buildAliasMap(tenantId: string): Promise<AliasMap> {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();

  const [accts, goalsRows] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        subtype: accounts.subtype,
        mask: accounts.mask,
      })
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId))
      .orderBy(accounts.id),
    db
      .select({ id: goals.id, name: goals.name })
      .from(goals)
      .where(eq(goals.tenantId, tenantId))
      .orderBy(goals.id),
  ]);

  // Alias accounts
  let accountCounter = 1;
  const debtSubtypeCounts = new Map<string, number>();

  // First pass: count debt subtypes to know if we need numbering
  for (const acct of accts) {
    if (acct.type === "credit" || acct.type === "loan") {
      const label = acct.subtype || acct.type;
      debtSubtypeCounts.set(label, (debtSubtypeCounts.get(label) || 0) + 1);
    }
  }

  const debtSubtypeUsed = new Map<string, number>();

  for (const acct of accts) {
    if (!acct.name) continue;

    let alias: string;
    if (acct.type === "credit" || acct.type === "loan") {
      const label = acct.subtype || acct.type;
      const total = debtSubtypeCounts.get(label) || 1;
      if (total > 1) {
        const idx = (debtSubtypeUsed.get(label) || 0) + 1;
        debtSubtypeUsed.set(label, idx);
        alias = `${label} ${idx}`;
      } else {
        alias = label;
      }
    } else {
      alias = `Account ${accountCounter++}`;
    }

    forward.set(acct.name, alias);
    reverse.set(alias, acct.name);

    // Track masks for stripping
    if (acct.mask) {
      forward.set(acct.mask, "");
    }
  }

  // Alias goals
  let goalCounter = 1;
  for (const goal of goalsRows) {
    if (!goal.name) continue;
    const alias = `Goal ${goalCounter++}`;
    forward.set(goal.name, alias);
    reverse.set(alias, goal.name);
  }

  if (PII_DEBUG) {
    console.log(`[PII Scrubber] Built alias map: ${forward.size} entries (${accts.length} accounts, ${goalsRows.length} goals)`);
  }

  return { forward, reverse };
}

/**
 * Deep-walk any value and replace PII strings with aliases.
 * - String values: all occurrences of real names replaced with aliases
 * - Fields named "mask": set to null
 * - Objects/arrays: recursed
 * - Primitives: returned as-is
 */
export function scrub(data: unknown, map: AliasMap, caller?: string): unknown {
  if (PII_DEBUG && caller) {
    console.log(`[PII Scrubber] Scrubbing PII for ${caller}, replacing ${map.forward.size} known names with aliases`);
  }
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    return scrubString(data, map);
  }

  if (Array.isArray(data)) {
    return data.map((item) => scrub(item, map));
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (key === "mask") {
        result[key] = null;
        continue;
      }
      result[key] = scrub(value, map);
    }
    return result;
  }

  return data;
}

/**
 * Replace all PII occurrences in a string with their aliases.
 * Replaces longer names first to avoid partial matches.
 */
function scrubString(text: string, map: AliasMap): string {
  if (map.forward.size === 0) return text;

  // Sort by length descending to replace longer matches first
  const sorted = [...map.forward.entries()].sort(
    (a, b) => b[0].length - a[0].length
  );

  let result = text;
  for (const [real, alias] of sorted) {
    if (real && result.includes(real)) {
      result = result.split(real).join(alias);
    }
  }
  return result;
}

/**
 * Replace aliases in LLM response text back to real names.
 * Used before returning responses to the user.
 */
export function descrub(text: string, map: AliasMap, caller?: string): string {
  if (PII_DEBUG && caller) {
    console.log(`[PII Scrubber] Restoring real names for ${caller}, replacing ${map.reverse.size} aliases back to original values`);
  }
  if (map.reverse.size === 0) return text;

  // Sort by length descending to replace longer aliases first
  // (e.g., "Account 10" before "Account 1")
  const sorted = [...map.reverse.entries()].sort(
    (a, b) => b[0].length - a[0].length
  );

  let result = text;
  for (const [alias, real] of sorted) {
    if (result.includes(alias)) {
      result = result.split(alias).join(real);
    }
  }
  return result;
}

/**
 * Deep-walk and descrub all string values in a structured object.
 * Used for descrubbing structured LLM responses (e.g., JSON payloads).
 */
export function descrubObject(data: unknown, map: AliasMap): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    return descrub(data, map);
  }

  if (Array.isArray(data)) {
    return data.map((item) => descrubObject(item, map));
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      result[key] = descrubObject(value, map);
    }
    return result;
  }

  return data;
}
