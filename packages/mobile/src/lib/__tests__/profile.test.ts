import { setAmountsHidden } from "../hide-amounts";
import {
  canDeleteAccount,
  decimalNumber,
  exactTime,
  formErrors,
  formFrom,
  incomeRows,
  initialsOf,
  inviteLine,
  latestAdultBirthDate,
  personalRows,
  planSummary,
  updatesFor,
  wholeNumber,
  type FinancialProfile,
} from "../profile";

afterEach(() => setAmountsHidden(false));

const profile: FinancialProfile = {
  dateOfBirth: "1990-05-04T00:00:00.000Z",
  age: 36,
  annualIncome: 85000,
  filingStatus: "married_joint",
  stateOfResidence: "WA",
  employmentType: null,
  riskTolerance: "moderate",
  retirementAge: 65,
  employerMatchPercent: 4,
  dependentCount: null,
  hasHDHP: null,
  isPSLFEligible: true,
};

test("rows show stored values in words and mute what is not set", () => {
  expect(personalRows(profile)).toEqual([
    { label: "Date of birth", value: "May 4, 1990", muted: false },
    { label: "Age", value: "36", muted: false },
    { label: "Retirement age", value: "65", muted: false },
    { label: "Filing status", value: "Married filing jointly", muted: false },
    { label: "State of residence", value: "WA", muted: false },
    { label: "Risk tolerance", value: "Moderate", muted: false },
    { label: "Dependents", value: "Not set", muted: true },
  ]);
  expect(incomeRows(profile).map((r) => r.value)).toEqual(["$85,000/yr", "Not set", "4%"]);
  expect(personalRows(null).every((r) => r.muted)).toBe(true);
});

test("income masks when amounts are hidden", () => {
  setAmountsHidden(true);
  expect(incomeRows(profile)[0].value).toBe("$•••••/yr");
});

test("the form starts from the profile, W2 when no employment is stored", () => {
  const f = formFrom(profile);
  expect(f).toMatchObject({ dateOfBirth: "1990-05-04", annualIncome: "85000", employmentType: "w2", dependentCount: "", hasHDHP: false, isPSLFEligible: true });
  expect(formFrom(null).retirementAge).toBe("");
});

test("save sends each section's fields as the web does", () => {
  const f = { ...formFrom(profile), stateOfResidence: "or", dependentCount: "0", retirementAge: "" };
  expect(updatesFor("personal", f)).toEqual({
    dateOfBirth: "1990-05-04",
    filingStatus: "married_joint",
    stateOfResidence: "OR",
    riskTolerance: "moderate",
    retirementAge: null,
    dependentCount: 0,
    hasHDHP: false,
    isPSLFEligible: true,
  });
  expect(updatesFor("income", { ...f, employerMatchPercent: "" })).toEqual({ annualIncome: 85000, employerMatchPercent: null, employmentType: "w2" });
});

test("validation names each bad field and blocks only on an underage birth date", () => {
  const today = new Date(2026, 10, 22);
  expect(latestAdultBirthDate(today)).toBe("2008-11-22");
  const bad = { ...formFrom(profile), stateOfResidence: "W", retirementAge: "120", dependentCount: "11", dateOfBirth: "2010-01-01" };
  const r = formErrors("personal", bad, today);
  expect(Object.keys(r.errors).sort()).toEqual(["dateOfBirth", "dependentCount", "retirementAge", "stateOfResidence"]);
  expect(r.blocking).toBe(true);
  expect(formErrors("personal", { ...bad, dateOfBirth: "2008-11-22" }, today).blocking).toBe(false);
  expect(formErrors("income", { ...bad, employerMatchPercent: "101" }, today).errors).toEqual({ employerMatchPercent: "Employer match is between 0 and 100%." });
  expect(formErrors("personal", formFrom(profile), today).errors).toEqual({});
});

test("number fields keep only what the field can hold", () => {
  expect(wholeNumber("6a5.")).toBe("65");
  expect(decimalNumber("4.5.1%")).toBe("4.51");
});

test("initials take up to two words", () => {
  expect(initialsOf("Alex Rivera Lee")).toBe("AR");
  expect(initialsOf("")).toBe("U");
});

test("only a real owner can delete", () => {
  const owner = { role: "owner", isAdmin: false, isDemo: false };
  expect(canDeleteAccount(owner, false)).toBe(true);
  expect(canDeleteAccount({ ...owner, role: "member" }, false)).toBe(false);
  expect(canDeleteAccount({ ...owner, isAdmin: true }, false)).toBe(false);
  expect(canDeleteAccount({ ...owner, isDemo: true }, false)).toBe(false);
  expect(canDeleteAccount(owner, true)).toBe(false);
  expect(canDeleteAccount(null, false)).toBe(false);
});

test("plan summary says renews or cancels, and nothing about status twice", () => {
  const end = "2026-12-15T12:00:00.000Z";
  expect(planSummary({ plan: "free", subscriptionStatus: null, currentPeriodEnd: null, cancelAtPeriodEnd: false })).toBe("Upgrade any time");
  expect(planSummary({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: end, cancelAtPeriodEnd: false })).toBe("Active, renews December 15, 2026");
  expect(planSummary({ plan: "pro", subscriptionStatus: "past_due", currentPeriodEnd: null, cancelAtPeriodEnd: false })).toBe("Past Due");
  expect(planSummary({ plan: "pro", subscriptionStatus: "active", currentPeriodEnd: end, cancelAtPeriodEnd: true })).toBe("Cancels December 15, 2026");
});

test("an invite says when it expires, or that it has", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  expect(inviteLine("2026-11-29T12:00:00Z", now)).toEqual({ text: "Pending, expires Nov 29, 2026", expired: false });
  expect(inviteLine("2026-11-20T12:00:00Z", now).expired).toBe(true);
});

test("an exact time, or null for nothing", () => {
  expect(exactTime(null)).toBeNull();
  expect(exactTime("nope")).toBeNull();
  expect(exactTime("2026-11-22T23:41:00Z")).toMatch(/2026/);
});
