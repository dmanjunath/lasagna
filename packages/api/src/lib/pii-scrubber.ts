import { db } from "./db.js";
import { accounts, goals, users, eq, and, parsePropertyMetadata } from "@lasagna/core";

/** Set PII_DEBUG=true in env to log alias mappings and scrub/descrub operations */
export const PII_DEBUG = process.env.PII_DEBUG === "true";

export interface AliasMap {
  /** real name → alias */
  forward: Map<string, string>;
  /** alias → real name */
  reverse: Map<string, string>;
}

/**
 * Add one person's identity to the map: the full name round-trips (alias →
 * real for display), while standalone name PARTS and the email are forward-only
 * strips — they must never reach a model, and a model echoing "Person A"
 * descrubs to the full name anyway. Name parts of ≤ 2 chars (middle initials)
 * are skipped as too collision-prone.
 *
 * Pure and exported for tests.
 */
export function addPersonToMap(map: AliasMap, alias: string, name: string | null, email: string | null): void {
  if (name && name.trim()) {
    const full = name.trim();
    map.forward.set(full, alias);
    map.reverse.set(alias, full);
    for (const part of full.split(/\s+/)) {
      if (part.length <= 2) continue;
      // Common financial vocabulary must never become a standalone strip —
      // a person named "John Bank" would otherwise mangle "Chase Bank" prose.
      if (NOT_A_PERSON.has(part)) continue;
      if (!map.forward.has(part)) map.forward.set(part, alias);
    }
  }
  if (email) map.forward.set(email, "");
}

/**
 * Strip a property's address: the full string and its street segment (before
 * the first comma) are forward-only — an address is never restored into model
 * output. Pure and exported for tests.
 */
export function addPropertyAddressToMap(map: AliasMap, address: string, n: number): void {
  const full = address.trim();
  if (!full) return;
  const alias = `the property ${n} address`;
  map.forward.set(full, alias);
  const street = full.split(",")[0]?.trim();
  if (street && street.length > 3 && street !== full) map.forward.set(street, alias);
}

// "Firstname [M.] Lastname"-shaped candidate (2-4 words, optional initial).
const PERSONISH_RE = /^[A-Z][a-z]+(?: [A-Z]\.?)?(?: [A-Z][a-z]+){1,2}$/;

// Financial vocabulary that disqualifies a shape-matched candidate ("Emergency
// Fund" is title-shaped but not a person). A candidate containing ANY of these
// words is rejected — mis-classifying one would strip common words from prose.
const NOT_A_PERSON = new Set([
  "Fund", "Funds", "Checking", "Savings", "Brokerage", "Account", "Accounts",
  "Emergency", "Money", "Market", "Cash", "Taxes", "Tax", "Rental", "Primary",
  "Residence", "College", "Retirement", "Investment", "Credit", "Card", "Loan",
  "Mortgage", "Roth", "Traditional", "Rollover", "Bank", "Trust", "Estate",
  "Kids", "Individual", "Custodial", "Portfolio", "Income", "Growth", "Value",
  "Index", "Target", "Capital", "Property", "Home", "House",
]);

/**
 * Person-name candidates embedded in an account name: the segment before the
 * first " - " separator (or a "-Individual"-style suffix), split on commas —
 * matching how aggregators title accounts ("Owner Name - Product - ****1234").
 * Pure and exported for tests.
 */
export function harvestPersonNames(accountName: string): string[] {
  const prefix = accountName.split(/\s+[-–—]\s+|-Individual|-\d/)[0] ?? "";
  return prefix
    .split(",")
    .map((s) => s.replace(/\b(?:Cust|Custodian|UTMA|UGMA)\b\.?/g, "").trim())
    .filter(
      (s) => PERSONISH_RE.test(s) && !s.split(/\s+/).some((w) => NOT_A_PERSON.has(w)),
    );
}

/**
 * Street-address segments inside an account name ("Maplewood Ct", "Sunny Brook
 * Ct") by street-suffix keyword. Pure and exported for tests.
 */
export function harvestStreetSegments(accountName: string): string[] {
  const out: string[] = [];
  for (const m of accountName.matchAll(
    /\b([A-Z][\w']*(?:\s[A-Z][\w']*)*\s(?:Ct|St|Rd|Dr|Ln|Ave|Way|Blvd|Pl|Cir|Ter))\b/g,
  )) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Build a deterministic alias map for a tenant's PII fields.
 * - Account names → "Account 1", "Account 2", ...
 * - Debt account names (credit/loan) → subtype label, numbered if duplicates
 * - Goal names → "Goal 1", "Goal 2", ...
 * - User names → "Person A", "Person B", ... (name parts + emails stripped)
 * - Property addresses (real-estate metadata) → stripped, never restored
 * - Account masks → tracked for stripping
 */
export async function buildAliasMap(tenantId: string): Promise<AliasMap> {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();

  const [accts, goalsRows, userRows] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        subtype: accounts.subtype,
        mask: accounts.mask,
        metadata: accounts.metadata,
      })
      .from(accounts)
      .where(eq(accounts.tenantId, tenantId))
      .orderBy(accounts.id),
    db
      .select({ id: goals.id, name: goals.name })
      .from(goals)
      .where(eq(goals.tenantId, tenantId))
      .orderBy(goals.id),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .orderBy(users.id),
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

  // Alias every tenant user's identity — the OWNER'S NAME MUST NEVER REACH A
  // MODEL. Runs after account aliasing so longest-string-first replacement
  // still favors full account names, then catches standalone name occurrences.
  const map: AliasMap = { forward, reverse };
  let personCounter = 0;
  for (const u of userRows) {
    const alias = `Person ${String.fromCharCode(65 + (personCounter++ % 26))}`;
    addPersonToMap(map, alias, u.name, u.email);
  }

  // Strip property ADDRESSES (and their street segments) from real-estate
  // metadata — forward-only, never restored into model output.
  let propCounter = 0;
  for (const acct of accts) {
    if (acct.type !== "real_estate") continue;
    const meta = parsePropertyMetadata(acct.metadata ?? null);
    if (meta?.address) addPropertyAddressToMap(map, meta.address, ++propCounter);
  }

  // Names and streets also live INSIDE account names ("Alex Q Rivera,
  // Jordan Rivera Cust - UTMA…", "Rental — Maplewood Ct, Springfield").
  // Full account-name strings are aliased above, but STANDALONE mentions of a
  // person or street would leak — harvest them from every account name.
  for (const acct of accts) {
    if (!acct.name) continue;
    for (const person of harvestPersonNames(acct.name)) {
      if (forward.has(person)) continue;
      const alias = `Person ${String.fromCharCode(65 + (personCounter++ % 26))}`;
      addPersonToMap(map, alias, person, null);
    }
    for (const street of harvestStreetSegments(acct.name)) {
      if (!forward.has(street)) forward.set(street, "the property address");
    }
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
      // mask: account number fragment. placeId/lat/lng: geocode identity — a
      // coordinate pins the home as precisely as the address string.
      if (key === "mask" || key === "placeId" || key === "lat" || key === "lng") {
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
 * Whole-word global replacement: the needle only matches at word boundaries,
 * so "Sam" never mangles "Samsung" and a bare alias like "auto" never expands
 * inside "automatic". A \b anchor is only applied on a side whose edge is a
 * word character — needles that start/end with a non-word char (masks like
 * "****1234") fall back to plain matching on that side, since \b would never
 * match there.
 */
function replaceWholeWord(text: string, needle: string, replacement: string): string {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lead = /^\w/.test(needle) ? "\\b" : "";
  const trail = /\w$/.test(needle) ? "\\b" : "";
  // Escape "$" so a replacement containing it isn't treated as a group ref.
  return text.replace(
    new RegExp(lead + escaped + trail, "g"),
    replacement.replace(/\$/g, "$$$$"),
  );
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
      result = replaceWholeWord(result, real, alias);
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
      result = replaceWholeWord(result, alias, real);
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
