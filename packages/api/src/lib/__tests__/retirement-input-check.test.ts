import { describe, it, expect } from "vitest";
import { checkRetirementInputs } from "../retirement-input-check.js";
import type { DebtAccount } from "../debt-accounts.js";

function debt(o: Partial<DebtAccount> & { id: string; name: string }): DebtAccount {
  return {
    mask: null, type: "loan", subtype: "mortgage", balance: 300_000, apr: 6,
    minimumPayment: 2_000, minimumPaymentEstimated: false, minimumPaymentAssumedApr: null,
    termMonths: null, originationDate: null, payoffDate: null, propertyAccountId: null,
    liabilitySource: null, liabilityLastSyncedAt: null, lastUpdated: null,
    lastStatementBalance: null, lastPaymentAmount: null, paidInFullMonthly: false, ...o,
  };
}

const now = new Date("2026-06-15T00:00:00Z");
const base = { currentAge: 34, dobOnFile: true, retirementAgeOnFile: true, now };
const homeLoan = debt({ id: "m1", name: "Home Mortgage", payoffDate: "2056-07-01" });

describe("checkRetirementInputs", () => {
  it("asks about retiring in 2 years while a mortgage runs to 2056", () => {
    expect(checkRetirementInputs({ ...base, retirementAge: 36, debts: [homeLoan] })).toEqual({
      kind: "soon_with_mortgage",
      currentAge: 34,
      retirementAge: 36,
      yearsAway: 2,
      mortgageName: "Home Mortgage",
      mortgageEndYear: 2056,
    });
  });

  it("does not ask when retirement is 6 years away", () => {
    expect(checkRetirementInputs({ ...base, retirementAge: 40, debts: [homeLoan] })).toBeNull();
  });

  it("does not ask when the mortgage ends 10 years after retirement", () => {
    const shortLoan = debt({ id: "m2", name: "Home Mortgage", payoffDate: "2038-01-01" });
    expect(checkRetirementInputs({ ...base, retirementAge: 36, debts: [shortLoan] })).toBeNull();
  });

  it("does not ask when there is no mortgage", () => {
    const car = debt({ id: "a1", name: "Car loan", subtype: "auto", payoffDate: "2056-01-01" });
    expect(checkRetirementInputs({ ...base, retirementAge: 36, debts: [car] })).toBeNull();
    expect(checkRetirementInputs({ ...base, retirementAge: 36, debts: [] })).toBeNull();
  });

  it("ignores a paid-off mortgage", () => {
    const paid = { ...homeLoan, balance: 0 };
    expect(checkRetirementInputs({ ...base, retirementAge: 36, debts: [paid] })).toBeNull();
  });

  it("dates a mortgage from origination plus term when no payoff date is on file", () => {
    const seeded = debt({ id: "m3", name: "Home Mortgage", originationDate: "2025-03-01", termMonths: 360 });
    const check = checkRetirementInputs({ ...base, retirementAge: 36, debts: [seeded] });
    expect(check).toMatchObject({ kind: "soon_with_mortgage", mortgageEndYear: 2055 });
  });

  it("skips a mortgage whose payment the app estimated", () => {
    // No dates and no lender payment: the payment is a guessed fresh 30-year
    // loan, so any end year worked out from it is made up.
    const guessed = debt({ id: "m5", name: "Mortgage", minimumPaymentEstimated: true, minimumPayment: 1_800 });
    expect(checkRetirementInputs({ ...base, retirementAge: 36, debts: [guessed] })).toBeNull();
  });

  it("skips a mortgage dated only by an assumed 30-year term", () => {
    const noTerm = debt({ id: "m6", name: "Mortgage", originationDate: "2025-03-01", minimumPaymentEstimated: true });
    expect(checkRetirementInputs({ ...base, retirementAge: 36, debts: [noTerm] })).toBeNull();
  });

  it("dates a mortgage from the lender's payment when no dates are on file", () => {
    // $300k at 6% with a $2,000 lender payment clears in about 23 years.
    const paid = debt({ id: "m7", name: "Home Mortgage" });
    expect(checkRetirementInputs({ ...base, retirementAge: 36, debts: [paid] })).toMatchObject({
      kind: "soon_with_mortgage",
      mortgageEndYear: 2049,
    });
  });

  it("still asks about a dated mortgage alongside an estimated one", () => {
    const guessed = debt({ id: "m8", name: "Mortgage", minimumPaymentEstimated: true, minimumPayment: 1_000 });
    expect(
      checkRetirementInputs({ ...base, retirementAge: 36, debts: [guessed, homeLoan] }),
    ).toMatchObject({ kind: "soon_with_mortgage", mortgageName: "Home Mortgage", mortgageEndYear: 2056 });
  });

  it("names the mortgage that ends latest", () => {
    const later = debt({ id: "m4", name: "Lake house mortgage", payoffDate: "2058-01-01" });
    const check = checkRetirementInputs({ ...base, retirementAge: 36, debts: [homeLoan, later] });
    expect(check).toMatchObject({ mortgageName: "Lake house mortgage", mortgageEndYear: 2058 });
  });

  it("asks when the saved retirement age has already passed", () => {
    expect(
      checkRetirementInputs({ ...base, currentAge: 62, retirementAge: 60, debts: [] }),
    ).toEqual({ kind: "age_passed", currentAge: 62, retirementAge: 60 });
  });

  it("asks for a date of birth when the age is the default", () => {
    expect(
      checkRetirementInputs({ ...base, currentAge: 40, dobOnFile: false, retirementAge: 65, debts: [] }),
    ).toEqual({ kind: "missing_dob", assumedAge: 40 });
  });

  it("asks to confirm an assumed retirement age", () => {
    expect(
      checkRetirementInputs({ ...base, retirementAge: 65, retirementAgeOnFile: false, debts: [] }),
    ).toEqual({ kind: "missing_retirement_age", assumedAge: 65 });
  });

  it("returns the first match in priority order", () => {
    // Missing date of birth beats everything else.
    expect(
      checkRetirementInputs({
        ...base, dobOnFile: false, retirementAgeOnFile: false, retirementAge: 36, debts: [homeLoan],
      })?.kind,
    ).toBe("missing_dob");
    // A passed age beats a soon retirement with a mortgage.
    expect(
      checkRetirementInputs({ ...base, currentAge: 62, retirementAge: 60, debts: [homeLoan] })?.kind,
    ).toBe("age_passed");
    // A soon retirement with a mortgage beats an assumed retirement age.
    expect(
      checkRetirementInputs({ ...base, retirementAgeOnFile: false, retirementAge: 36, debts: [homeLoan] })?.kind,
    ).toBe("soon_with_mortgage");
  });
});
