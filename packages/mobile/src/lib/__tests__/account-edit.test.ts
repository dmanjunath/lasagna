import { createBody, EMPTY_ADD_FORM, formForType, friendlyAddError } from "../add-account";
import { editFormFrom, loanFacts, loanTypeOf, savePlan, typeOptionsFor } from "../account-edit";
import type { ItemAccount } from "../account-list";
import { ADD_FORMS } from "../add-account";

const base: ItemAccount = { id: "a", name: "Card", type: "credit", subtype: "credit card", mask: null, balance: "-500.00", currency: "USD" };

test("a catalogued synced subtype keeps its spelling, an unknown one leads the list", () => {
  const opts = typeOptionsFor(base);
  expect(opts.find((o) => o.label === "Credit card")!.subtype).toBe("credit card");
  expect(opts.length).toBe(15);
  expect(typeOptionsFor({ type: "depository", subtype: "cd" })[0]).toEqual({ label: "CD", type: "depository", subtype: "cd" });
});

test("loan type from type, subtype and name", () => {
  expect(loanTypeOf(base)).toBe("credit_card");
  expect(loanTypeOf({ type: "loan", subtype: null, name: "Home mortgage" })).toBe("mortgage");
  expect(loanTypeOf({ type: "loan", subtype: "student_loan", name: "x" })).toBe("student_loan");
  expect(loanTypeOf({ type: "loan", subtype: "auto", name: "x" })).toBe("other_loan");
});

test("a manual debt's value is unsigned in the form and keeps its stored sign on save", () => {
  const f = editFormFrom(base);
  expect(f.value).toBe("500.00");
  const plan = savePlan(base, true, { ...f, value: "450" }, f);
  expect(plan.manualBalance).toBe(-450);
  expect(plan.loan).toBeUndefined();
  expect(plan.update).toEqual({ type: "credit", subtype: "credit card", excludeFromNetWorth: false, excludeTransactions: false, invertBalance: false });
});

test("nothing changed sends only the settings patch", () => {
  const f = editFormFrom(base);
  const plan = savePlan(base, false, f, f);
  expect(plan.manualBalance).toBeUndefined();
  expect(plan.crossesBucket).toBe(false);
});

test("a card's loan fields: purchase APR and minimum", () => {
  const card = { ...base, apr: "19.99" };
  const f = editFormFrom(card);
  expect(f.purchaseApr).toBe("19.99");
  // Only the edited field goes up: the stored APR is never rewritten (the API merges).
  const plan = savePlan(card, false, { ...f, minPayment: "35" }, f);
  expect(plan.loan).toEqual({ type: "credit_card", minimumPaymentAmount: 35 });
});

test("editing one loan field never zeroes the other", () => {
  const card = { ...base, metadata: { type: "credit_card", minimumPaymentAmount: 89, aprs: [{ aprType: "purchase_apr", aprPercentage: 24.99 }] } };
  const f = editFormFrom(card);
  expect(f.minPayment).toBe("89");
  expect(f.purchaseApr).toBe("24.99");
  expect(savePlan(card, false, { ...f, purchaseApr: "21.5" }, f).loan).toEqual({ type: "credit_card", aprs: [{ aprType: "purchase_apr", aprPercentage: 21.5 }] });
  const loan: ItemAccount = { ...base, type: "loan", subtype: "auto", name: "Auto Loan", metadata: { type: "other_loan", interestRatePercentage: 6.5, minimumPaymentAmount: 410 } };
  const lf = editFormFrom(loan);
  expect(savePlan(loan, false, { ...lf, minPayment: "450" }, lf).loan).toEqual({ type: "other_loan", minimumPaymentAmount: 450 });
  // A field cleared to empty is left alone, not written as 0.
  expect(savePlan(loan, false, { ...lf, interestRate: "" }, lf).loan).toBeUndefined();
});

test("the form is seeded from the payoff plan when the account's own details are empty", () => {
  const f = editFormFrom(base, { interestRate: 24.99, minimumPayment: 89 });
  expect(f.purchaseApr).toBe("24.99");
  expect(f.minPayment).toBe("89");
  expect(f.interestRate).toBe("24.99");
  // Seeded figures are the starting point, not edits: saving untouched sends no loan patch.
  expect(savePlan(base, false, f, f).loan).toBeUndefined();
  // The account's own figures win over the plan's.
  const own = editFormFrom({ ...base, apr: "19.99" }, { interestRate: 24.99, minimumPayment: 89 });
  expect(own.purchaseApr).toBe("19.99");
  expect(editFormFrom(base, null).minPayment).toBe("");
});

test("reclassifying across assets and debt is flagged, the link only when it changed", () => {
  const f = editFormFrom(base);
  const plan = savePlan(base, false, { ...f, typeKey: "depository:checking", linkedPropertyId: "p1" }, f);
  expect(plan.crossesBucket).toBe(true);
  expect(plan.update.propertyAccountId).toBe("p1");
});

test("property: changed fields only, cleared ones as null, own value pins it", () => {
  const home: ItemAccount = {
    ...base,
    type: "real_estate",
    subtype: "rental",
    balance: "400000",
    metadata: { address: "1 Maplewood Ct", monthlyRent: 2000, valueEstimate: { status: "ready" } },
  };
  const f = editFormFrom(home);
  expect(f.valueSource).toBe("market");
  const plan = savePlan(home, true, { ...f, monthlyRent: "", address: "2 Maplewood Ct", valueSource: "own", ownValue: "410000" }, f);
  expect(plan.property).toEqual({ address: "2 Maplewood Ct", monthlyRent: null, valueSource: "own", ownValue: 410000 });
  expect(plan.reEstimates).toBe(false);
  expect(savePlan(home, true, { ...f, address: "2 Maplewood Ct" }, f).reEstimates).toBe(true);
  expect(plan.manualBalance).toBeUndefined();
});

test("loan facts read the stored metadata", () => {
  const loan: ItemAccount = {
    ...base,
    type: "loan",
    subtype: "auto",
    name: "Car",
    metadata: { interestRatePercentage: 6.5, minimumPaymentAmount: 410, originationDate: "2024-03-01", loanTermYears: 5 },
  };
  expect(loanFacts(loan)).toEqual([
    { label: "Interest rate", value: "6.5%", figure: true },
    { label: "Monthly payment", value: "", money: 410 },
    { label: "Originated", value: "Mar 2024" },
    { label: "Term", value: "5 years" },
    { label: "Payoff", value: "Mar 2029" },
  ]);
});

test("add: deep link types, create bodies, error words", () => {
  expect(formForType("loan:mortgage")).toEqual({ kind: "manual", type: expect.objectContaining({ label: "Mortgage" }) });
  expect(formForType("real_estate")).toEqual({ kind: "property", type: null });
  expect(formForType("nope")).toBeNull();
  const mortgage = ADD_FORMS.manual.types.find((t) => t.label === "Mortgage")!;
  expect(createBody(mortgage, { ...EMPTY_ADD_FORM, name: " Loan ", balance: "250000", rate: "6.1", minPayment: "900", linkedId: "p1" })).toEqual({
    name: "Loan",
    type: "loan",
    subtype: "mortgage",
    balance: 250000,
    apr: 6.1,
    metadata: { type: "mortgage", source: "manual", interestRatePercentage: 6.1 },
    linkedAccountId: "p1",
  });
  const primary = ADD_FORMS.property.types[0];
  expect(createBody(primary, { ...EMPTY_ADD_FORM, name: "Home", address: "1 Maplewood Ct" })).toEqual({
    name: "Home",
    type: "real_estate",
    subtype: "primary",
    balance: undefined,
    metadata: { address: "1 Maplewood Ct" },
  });
  const other = ADD_FORMS.manual.types.find((t) => t.label === "Other asset")!;
  expect(createBody(other, { ...EMPTY_ADD_FORM, name: "Car" }).balance).toBe(0);
  expect(friendlyAddError("apr must be a number between 0 and 99.99")).toBe("Enter a rate between 0 and 99.99.");
  expect(friendlyAddError("boom")).toBe("We couldn't add this account. Try again.");
});
