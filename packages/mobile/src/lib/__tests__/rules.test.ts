import type { CategoryRule } from "@web/lib/api";
import { bodyFromForm, EMPTY_RULE_FORM, formFromRule, formFromSeed, validateRuleForm } from "../rules";

const rule = (p: Partial<CategoryRule>): CategoryRule => ({
  id: "r",
  priority: 0,
  merchantContains: null,
  amountEquals: null,
  amountMin: null,
  amountMax: null,
  accountId: null,
  matchCategoryId: null,
  setCategoryId: "c-set",
  createdAt: "",
  ...p,
});

test("formFromRule picks the amount mode from the rule", () => {
  expect(formFromRule(rule({ amountEquals: "12" })).amountMode).toBe("equals");
  expect(formFromRule(rule({ amountMin: "1" })).amountMode).toBe("between");
  expect(formFromRule(rule({ merchantContains: "amzn", matchCategoryId: "c-m" }))).toMatchObject({
    amountMode: "any",
    merchantContains: "amzn",
    matchCategory: "c-m",
    setCategory: "c-set",
  });
});

test("a seed fills merchant and the category to set", () => {
  expect(formFromSeed({ merchantText: "Blue Bottle", category: "c-coffee" })).toEqual({
    ...EMPTY_RULE_FORM,
    merchantContains: "Blue Bottle",
    setCategory: "c-coffee",
  });
});

test("bodyFromForm sends only the amount fields of the chosen mode", () => {
  const f = { ...EMPTY_RULE_FORM, merchantContains: "  amzn ", amountEquals: "5", amountMin: "1", amountMax: "9", setCategory: "c" };
  expect(bodyFromForm({ ...f, amountMode: "equals" })).toMatchObject({ merchantContains: "amzn", amountEquals: "5", amountMin: null, amountMax: null });
  expect(bodyFromForm({ ...f, amountMode: "between" })).toMatchObject({ amountEquals: null, amountMin: "1", amountMax: "9" });
  expect(bodyFromForm({ ...f, amountMode: "any" })).toMatchObject({ amountEquals: null, amountMin: null, amountMax: null, accountId: null, matchCategory: null });
});

test("validation mirrors the API", () => {
  expect(validateRuleForm({ ...EMPTY_RULE_FORM, merchantContains: "x" })).toBe("Choose a category to set.");
  expect(validateRuleForm({ ...EMPTY_RULE_FORM, setCategory: "c" })).toBe("Add at least one condition.");
  expect(validateRuleForm({ ...EMPTY_RULE_FORM, setCategory: "c", amountMode: "equals", amountEquals: "abc" })).toBe("Amount must be a number.");
  expect(validateRuleForm({ ...EMPTY_RULE_FORM, setCategory: "c", amountMode: "between", amountMin: "9", amountMax: "1" })).toBe(
    "Minimum amount must be less than or equal to maximum.",
  );
  expect(validateRuleForm({ ...EMPTY_RULE_FORM, setCategory: "c", accountId: "a" })).toBeNull();
});
