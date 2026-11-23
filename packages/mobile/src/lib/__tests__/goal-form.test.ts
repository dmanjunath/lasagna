import {
  EMPTY_CONTEXT,
  decimal2,
  draftFromDetails,
  emptyDraft,
  monthlyPace,
  plainFieldErrors,
  resolveDraft,
  type GoalFormContext,
} from "../goal-form";

const NOW = new Date("2026-11-22T12:00:00Z");
const CTX: GoalFormContext = { dateOfBirth: "1996-01-15T00:00:00.000Z", currentAge: 30, retirementAge: 65, monthlySpend: 1775.78, loaded: true };

test("decimal input keeps two places and one point", () => {
  expect(decimal2("1,234.567")).toBe("1234.56");
  expect(decimal2("1.2.3")).toBe("1.23");
  expect(decimal2("abc")).toBe("");
});

test("plain fields: target required, monthly optional (0 is no plan), current may be 0, no past date", () => {
  expect(plainFieldErrors({ target: "" }, "2026-11-22")).toMatchObject({ target: "Enter an amount above 0.", ok: false });
  expect(plainFieldErrors({ target: "500", monthly: "0", current: "0" }, "2026-11-22")).toEqual({ target: undefined, monthly: undefined, current: undefined, deadline: undefined, ok: true });
  expect(plainFieldErrors({ target: "500", deadline: "2026-01-01" }, "2026-11-22").deadline).toBe("Choose a date in the future.");
  expect(plainFieldErrors({ target: "2000000000000" }, "2026-11-22").target).toBe("Enter an amount under $1 trillion.");
  expect(plainFieldErrors({ target: ".", current: "" }, "2026-11-22")).toMatchObject({ target: "Enter an amount above 0.", current: "Enter 0 or more." });
});

test("a home purchase prices down payment plus closing costs, and needs a date to save", () => {
  const draft = { ...emptyDraft("home_purchase", CTX), homePrice: "450000" };
  const r = resolveDraft("home_purchase", draft, CTX, undefined, NOW);
  expect(r.target).toBe(103500);
  expect(r.derivation).toBe("20% of $450,000 plus 3% closing costs.");
  expect(r.details).toBeNull();
  expect(r.dateNeeded).toBe("Add the age you want it by to save this goal.");
  const dated = resolveDraft("home_purchase", { ...draft, byAge: "35" }, CTX, undefined, NOW);
  expect(dated.details).not.toBeNull();
  expect(dated.deadline).toBe("2031-01-15");
});

test("prompts say Add for an empty field and Fix for a bad one", () => {
  const blank = resolveDraft("home_purchase", emptyDraft("home_purchase", CTX), CTX, undefined, NOW);
  expect(blank.prompt).toBe("Add the home price to see your target.");
  const bad = resolveDraft("home_purchase", { ...emptyDraft("home_purchase", CTX), homePrice: "450000", downPaymentPct: "120" }, CTX, undefined, NOW);
  expect(bad.prompt).toBe("Fix the down payment percent to see your target.");
  expect(bad.errors.downPaymentPct).toBe("Enter a percent above 0 and up to 100.");
});

test("a car paid in cash is its full price, a past date is refused", () => {
  const r = resolveDraft("car", { ...emptyDraft("car", CTX), vehiclePrice: "32000", carPayCash: true, dateMode: "date", byDate: "2026-01-01" }, CTX, undefined, NOW);
  expect(r.target).toBe(32000);
  expect(r.errors.byDate).toBe("Choose a date in the future.");
  expect(r.details).toBeNull();
});

test("an age at or under the current age is refused", () => {
  const r = resolveDraft("car", { ...emptyDraft("car", CTX), vehiclePrice: "32000", byAge: "30" }, CTX, undefined, NOW);
  expect(r.errors.byAge).toBe("Choose an age above your current age (30).");
});

test("education shows its number before the start year, and saves only with one", () => {
  const draft = { ...emptyDraft("education", CTX), annualCost: "30000", years: "4" };
  const r = resolveDraft("education", draft, CTX, undefined, NOW);
  expect(r.target).toBe(120000);
  expect(r.details).toBeNull();
  const ok = resolveDraft("education", { ...draft, startYear: "2031" }, CTX, undefined, NOW);
  expect(ok.deadline).toBe("2031-09-01");
  expect(resolveDraft("education", { ...draft, startYear: "2070" }, CTX, undefined, NOW).errors.startYear).toBe("Enter a year between 2026 and 2056.");
});

test("retirement starts from the profile's age and is 25 times the income", () => {
  const draft = emptyDraft("retirement", CTX);
  expect(draft.targetAge).toBe("65");
  const r = resolveDraft("retirement", { ...draft, targetAnnualIncome: "80000" }, CTX, undefined, NOW);
  expect(r.target).toBe(2000000);
  expect(r.deadline).toBe("2061-01-15");
  // Without a birth date the age is not asked for and the goal still saves.
  const noDob = { ...CTX, dateOfBirth: null };
  expect(resolveDraft("retirement", { ...emptyDraft("retirement", noDob), targetAnnualIncome: "80000" }, noDob, undefined, NOW).details).not.toBeNull();
});

test("an emergency fund waits for the spend baseline, and says when there is none", () => {
  expect(resolveDraft("emergency_fund", emptyDraft("emergency_fund", EMPTY_CONTEXT), EMPTY_CONTEXT, undefined, NOW).pending).toBe(true);
  const none = { ...CTX, monthlySpend: null };
  expect(resolveDraft("emergency_fund", emptyDraft("emergency_fund", none), none, undefined, NOW).spendUnavailable).toBe(true);
  const r = resolveDraft("emergency_fund", emptyDraft("emergency_fund", CTX), CTX, undefined, NOW);
  expect(r.target).toBe(10654.68);
  expect(r.details).toEqual({ kind: "emergency_fund", months: 6, monthlySpendUsed: 1775.78 });
  // A saved goal falls back to the spend it was priced from.
  expect(resolveDraft("emergency_fund", emptyDraft("emergency_fund", none), none, { monthlySpend: 2000 }, NOW).target).toBe(12000);
});

test("an edit restores the saved details as form strings", () => {
  const d = draftFromDetails({ kind: "car", vehiclePrice: 30000, payCash: false, downPaymentPct: 15, byAge: null, byDate: "2028-05-01" }, CTX);
  expect(d).toMatchObject({ vehiclePrice: "30000", carDownPaymentPct: "15", dateMode: "date", byDate: "2028-05-01" });
});

test("monthly pace to reach a target by its date", () => {
  expect(monthlyPace(12000, 0, "2027-11-22", NOW)).toEqual({ amount: 1000, by: "November 2027" });
  expect(monthlyPace(12000, 12000, "2027-11-22", NOW)).toBeNull();
  expect(monthlyPace(12000, 0, null, NOW)).toBeNull();
});
