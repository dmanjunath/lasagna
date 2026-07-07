// Pure rule-matching logic for user-defined category rules.
// First match (by caller-provided order) wins; all non-null criteria AND.
// Amounts compare against abs(amount) so a rule catches both charge and refund.

import { UUID_RE } from "./taxonomy.js";

export interface RuleCriteria {
  merchantContains: string | null;
  amountEquals: string | null;
  amountMin: string | null;
  amountMax: string | null;
  accountId: string | null;
  matchCategoryId: string | null;
  setCategoryId: string | null;
}

export interface TxnForRules {
  name: string;
  merchantName: string | null;
  amount: string;
  categoryId: string | null;
  accountId: string;
}

// Tenant category id if it exists; null when unresolvable (ids only).
export function resolveCategoryRef(
  value: string,
  tax: Array<{ id: string; systemKey: string | null }>,
): string | null {
  if (!UUID_RE.test(value)) return null;
  return tax.find((c) => c.id === value)?.id ?? null;
}

export function ruleMatches(rule: RuleCriteria, txn: TxnForRules): boolean {
  const hasCriteria =
    rule.merchantContains !== null || rule.amountEquals !== null ||
    rule.amountMin !== null || rule.amountMax !== null ||
    rule.accountId !== null || rule.matchCategoryId !== null;
  if (!hasCriteria) return false;

  if (rule.merchantContains !== null) {
    const needle = rule.merchantContains.toLowerCase();
    const inName = txn.name.toLowerCase().includes(needle);
    const inMerchant = (txn.merchantName ?? "").toLowerCase().includes(needle);
    if (!inName && !inMerchant) return false;
  }
  const abs = Math.abs(parseFloat(txn.amount));
  if (rule.amountEquals !== null && abs !== parseFloat(rule.amountEquals)) return false;
  if (rule.amountMin !== null && abs < parseFloat(rule.amountMin)) return false;
  if (rule.amountMax !== null && abs > parseFloat(rule.amountMax)) return false;
  if (rule.accountId !== null && txn.accountId !== rule.accountId) return false;
  if (rule.matchCategoryId !== null && txn.categoryId !== rule.matchCategoryId) return false;
  return true;
}

export function firstMatchingRule<T extends RuleCriteria>(rules: T[], txn: TxnForRules): T | null {
  for (const r of rules) if (ruleMatches(r, txn)) return r;
  return null;
}

// Returns an error message, or null if the body is a valid rule.
// Category refs are tenant category ids, validated against the taxonomy.
export function validateRule(
  body: Record<string, unknown>,
  tax: Array<{ id: string; systemKey: string | null; disabledAt?: Date | null }>,
): string | null {
  const s = (k: string) => (body[k] === undefined || body[k] === null || body[k] === "" ? null : String(body[k]));
  const merchantContains = s("merchantContains");
  const amountEquals = s("amountEquals");
  const amountMin = s("amountMin");
  const amountMax = s("amountMax");
  const accountId = s("accountId");
  const matchCategory = s("matchCategory");
  const setCategory = s("setCategory");

  const setCatId = setCategory ? resolveCategoryRef(setCategory, tax) : null;
  if (!setCatId) return "setCategory must be a valid category";
  if (tax.find((c) => c.id === setCatId)?.disabledAt) return "setCategory targets a disabled category";
  if (matchCategory && resolveCategoryRef(matchCategory, tax) === null) {
    return "matchCategory must be a valid category";
  }
  if (!merchantContains && !amountEquals && !amountMin && !amountMax && !accountId && !matchCategory) {
    return "At least one criterion is required";
  }
  for (const [k, v] of [["amountEquals", amountEquals], ["amountMin", amountMin], ["amountMax", amountMax]] as const) {
    if (v !== null && !Number.isFinite(Number(v))) return `${k} must be a number`;
  }
  if (amountEquals && (amountMin || amountMax)) return "amountEquals cannot be combined with a range";
  if (amountMin && amountMax && parseFloat(amountMin) > parseFloat(amountMax)) {
    return "amountMin must be <= amountMax";
  }
  return null;
}
