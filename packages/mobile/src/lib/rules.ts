// The category rule form of packages/web/src/components/rules/RulesPanel.tsx.
import type { CategoryRule, CategoryRuleInput } from "@web/lib/api";

// matchCategory/setCategory hold category ids. The API field names are historical.
export interface RuleForm {
  merchantContains: string;
  amountMode: "any" | "equals" | "between";
  amountEquals: string;
  amountMin: string;
  amountMax: string;
  accountId: string;
  matchCategory: string;
  setCategory: string;
}

export const EMPTY_RULE_FORM: RuleForm = {
  merchantContains: "",
  amountMode: "any",
  amountEquals: "",
  amountMin: "",
  amountMax: "",
  accountId: "",
  matchCategory: "",
  setCategory: "",
};

export function formFromRule(rule: CategoryRule): RuleForm {
  return {
    merchantContains: rule.merchantContains ?? "",
    amountMode: rule.amountEquals ? "equals" : rule.amountMin || rule.amountMax ? "between" : "any",
    amountEquals: rule.amountEquals ?? "",
    amountMin: rule.amountMin ?? "",
    amountMax: rule.amountMax ?? "",
    accountId: rule.accountId ?? "",
    matchCategory: rule.matchCategoryId ?? "",
    setCategory: rule.setCategoryId,
  };
}

/** A new rule prefilled from a recategorize: the merchant and the category it moved to. */
export function formFromSeed(seed: { merchantText: string; category: string }): RuleForm {
  return { ...EMPTY_RULE_FORM, merchantContains: seed.merchantText, setCategory: seed.category };
}

export function bodyFromForm(f: RuleForm): CategoryRuleInput {
  return {
    merchantContains: f.merchantContains.trim() || null,
    amountEquals: f.amountMode === "equals" ? f.amountEquals.trim() || null : null,
    amountMin: f.amountMode === "between" ? f.amountMin.trim() || null : null,
    amountMax: f.amountMode === "between" ? f.amountMax.trim() || null : null,
    accountId: f.accountId || null,
    matchCategory: f.matchCategory || null,
    setCategory: f.setCategory,
  };
}

/** Mirrors the API's validateRule so most errors surface before the request. */
export function validateRuleForm(f: RuleForm): string | null {
  const body = bodyFromForm(f);
  if (!body.setCategory) return "Choose a category to set.";
  if (!body.merchantContains && !body.amountEquals && !body.amountMin && !body.amountMax && !body.accountId && !body.matchCategory) {
    return "Add at least one condition.";
  }
  for (const [label, v] of [
    ["Amount", body.amountEquals],
    ["Minimum amount", body.amountMin],
    ["Maximum amount", body.amountMax],
  ] as const) {
    if (v && !Number.isFinite(Number(v))) return `${label} must be a number.`;
  }
  if (body.amountMin && body.amountMax && parseFloat(body.amountMin) > parseFloat(body.amountMax)) {
    return "Minimum amount must be less than or equal to maximum.";
  }
  return null;
}
