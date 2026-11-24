import { describe, it, expect, vi } from "vitest";

// transaction-sync.ts imports plaid.ts at module level which reads env vars;
// mock it so these pure-function tests stay DB/network-free.
vi.mock("../plaid.js", () => ({ plaidClient: {} }));

import { mapCategory, categorize } from "../transaction-sync.js";
import type { TenantCategory } from "../taxonomy.js";
import type { RuleCriteria } from "../category-rules.js";

const pc = (primary?: string, detailed?: string) => ({ primary, detailed });

describe("mapCategory", () => {
  it("maps FOOD_AND_DRINK to food_dining (the D_AND_DRINK typo fix)", () => {
    expect(mapCategory(pc("FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"))).toBe("food_dining");
  });
  it("maps groceries via the detailed tier", () => {
    expect(mapCategory(pc("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"))).toBe("groceries");
  });
  it("maps rent to housing, not utilities", () => {
    expect(mapCategory(pc("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"))).toBe("housing");
    expect(mapCategory(pc("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY"))).toBe("utilities");
  });
  it("maps donations to gifts_donations and tax payments to taxes", () => {
    expect(mapCategory(pc("GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_DONATIONS"))).toBe("gifts_donations");
    expect(mapCategory(pc("GOVERNMENT_AND_NON_PROFIT", "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"))).toBe("taxes");
  });
  it("maps GENERAL_SERVICES specifics; unknown services fall to other", () => {
    expect(mapCategory(pc("GENERAL_SERVICES", "GENERAL_SERVICES_INSURANCE"))).toBe("insurance");
    expect(mapCategory(pc("GENERAL_SERVICES", "GENERAL_SERVICES_EDUCATION"))).toBe("education");
    expect(mapCategory(pc("GENERAL_SERVICES", "GENERAL_SERVICES_AUTOMOTIVE"))).toBe("transportation");
    expect(mapCategory(pc("GENERAL_SERVICES", "GENERAL_SERVICES_CHILDCARE"))).toBe("personal_care");
    expect(mapCategory(pc("GENERAL_SERVICES", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES"))).toBe("software_saas");
    expect(mapCategory(pc("GENERAL_SERVICES", "GENERAL_SERVICES_CONSULTING_AND_LEGAL"))).toBe("other");
  });
  it("keeps credit-card payments as transfers", () => {
    expect(mapCategory(pc("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"))).toBe("transfer");
    expect(mapCategory(pc("LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT"))).toBe("housing");
  });
  it("keeps investment transfers as transfers (never spending)", () => {
    expect(mapCategory(pc("TRANSFER_OUT", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"))).toBe("transfer");
  });
  it("falls back to other for unknown primaries and missing categories", () => {
    expect(mapCategory(pc("SOMETHING_NEW"))).toBe("other");
    expect(mapCategory(null)).toBe("other");
    expect(mapCategory(undefined)).toBe("other");
  });
  it("maps the phase-2 detailed targets", () => {
    expect(mapCategory(pc("TRANSPORTATION", "TRANSPORTATION_GAS"))).toBe("gas");
    expect(mapCategory(pc("TRANSPORTATION", "TRANSPORTATION_PARKING"))).toBe("parking_tolls");
    expect(mapCategory(pc("LOAN_PAYMENTS", "LOAN_PAYMENTS_CAR_PAYMENT"))).toBe("car_payment");
    expect(mapCategory(pc("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_INTERNET_AND_CABLE"))).toBe("internet_phone");
    expect(mapCategory(pc("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_TELEPHONE"))).toBe("internet_phone");
    expect(mapCategory(pc("FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"))).toBe("coffee_shops");
    expect(mapCategory(pc("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES"))).toBe("clothing");
    expect(mapCategory(pc("GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_ELECTRONICS"))).toBe("electronics");
    expect(mapCategory(pc("PERSONAL_CARE", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"))).toBe("fitness");
  });
  it("maps bank fees and home improvement to their new categories", () => {
    expect(mapCategory(pc("BANK_FEES"))).toBe("bank_fees");
    expect(mapCategory(pc("HOME_IMPROVEMENT"))).toBe("home_improvement");
  });
});

// Helpers for categorize() tests
const mkCat = (id: string, systemKey: string | null): TenantCategory => ({
  id, systemKey, disabledAt: null, groupId: "g1", groupType: "expense", name: systemKey ?? "Custom",
});

const mkRule = (setCategoryId: string): RuleCriteria => ({
  merchantContains: "amzn",
  amountEquals: null, amountMin: null, amountMax: null,
  accountId: null,
  matchCategoryId: null, setCategoryId,
});

describe("categorize", () => {
  const taxonomy: TenantCategory[] = [
    mkCat("id-shop", "shopping"),
    mkCat("id-custom", null),   // custom: systemKey is null
    mkCat("id-other", "other"),
  ];
  const txn = { name: "AMZN Mktp", merchantName: "Amazon", amount: "42.00", accountId: "acct-1" };

  it("rule targeting a custom category wins over the Plaid mapping", () => {
    const result = categorize(taxonomy, [mkRule("id-custom")], txn, pc("GENERAL_MERCHANDISE"));
    expect(result.categoryId).toBe("id-custom");
    expect(result.categorySource).toBe("rule");
  });

  it("rule targeting a system category wins over the Plaid mapping", () => {
    const result = categorize(taxonomy, [mkRule("id-shop")], txn, pc("ENTERTAINMENT"));
    expect(result.categoryId).toBe("id-shop");
    expect(result.categorySource).toBe("rule");
  });

  it("auto-path: no rule → Plaid mapped key resolved through the taxonomy", () => {
    const result = categorize(taxonomy, [], txn, pc("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"));
    // groceries is not in this tiny taxonomy, falls back to other
    expect(result.categoryId).toBe("id-other");
    expect(result.categorySource).toBe("auto");
  });
});

describe("money arriving on a credit card or loan", () => {
  const taxonomy: TenantCategory[] = [
    mkCat("id-income", "income"),
    mkCat("id-transfer", "transfer"),
    mkCat("id-shop", "shopping"),
    mkCat("id-other", "other"),
  ];
  const card = { name: "AUTOMATIC PAYMENT - THANK YOU", merchantName: null, amount: "-2840.15", accountId: "card-1", accountType: "credit" };
  const cat = (o: Partial<typeof card>, plaid: ReturnType<typeof pc> | null) => categorize(taxonomy, [], { ...card, ...o }, plaid).categoryId;

  it("a payment Plaid labels as income is a transfer", () => {
    expect(cat({}, pc("INCOME", "INCOME_SALARY"))).toBe("id-transfer");
    expect(cat({ accountType: "loan" }, pc("INCOME", "INCOME_WAGES"))).toBe("id-transfer");
  });
  it("Plaid's payment and transfer-in labels make it a transfer whatever the name", () => {
    expect(cat({ name: "CHASE CREDIT CRD" }, pc("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"))).toBe("id-transfer");
    expect(cat({ name: "Online Transfer from CHK" }, pc("TRANSFER_IN", "TRANSFER_IN_ACCOUNT_TRANSFER"))).toBe("id-transfer");
  });
  it("payment wording makes it a transfer even with no Plaid category", () => {
    for (const name of ["PAYMENT RECEIVED", "AUTOPAY 1234", "AUTO PAY", "ONLINE PMT", "MOBILE PYMT", "AMEX EPAYMENT", "E-PAYMENT", "THANK YOU"]) {
      expect(cat({ name }, null)).toBe("id-transfer");
    }
  });
  it("income on a card that is not a payment stays income", () => {
    expect(cat({ name: "AIRBNB * HMTEST0001" }, pc("INCOME", "INCOME_RENTAL"))).toBe("id-income");
  });
  it("a refund keeps its merchant category, even if it mentions a payment", () => {
    expect(cat({ name: "AMZN Mktp refund", amount: "-42.00" }, pc("GENERAL_MERCHANDISE"))).toBe("id-shop");
    expect(cat({ name: "PAYMENT RETURN", amount: "-42.00" }, pc("GENERAL_MERCHANDISE"))).toBe("id-shop");
  });
  it("a charge (money out) on a card is never a payment", () => {
    expect(cat({ name: "LATE PAYMENT FEE", amount: "39.00" }, pc("BANK_FEES"))).not.toBe("id-transfer");
  });
  it("the checking side stays a transfer and bank income stays income", () => {
    expect(cat({ name: "AMEX EPAYMENT", amount: "2840.15", accountType: "depository" }, pc("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"))).toBe("id-transfer");
    expect(cat({ name: "PAYROLL", accountType: "depository" }, pc("INCOME", "INCOME_SALARY"))).toBe("id-income");
  });
  it("a user rule still wins", () => {
    const rule = { ...mkRule("id-income"), merchantContains: "automatic payment" };
    expect(categorize(taxonomy, [rule], card, pc("INCOME", "INCOME_SALARY"))).toEqual({ categoryId: "id-income", categorySource: "rule" });
  });
});
