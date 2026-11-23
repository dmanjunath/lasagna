import type { FinancialPath } from "@web/lib/api";
import { setAmountsHidden } from "../hide-amounts";
import { currentStep, journeySummary, levelStateOf, stepDetail, stepHelpPrompt } from "../journey";

afterEach(() => setAmountsHidden(false));

const step = (id: string, status: string, over: Record<string, unknown> = {}) => ({ id, order: 1, kind: "buffer", title: id, status, rateShaped: false, ...over });
const path = (steps: ReturnType<typeof step>[], currentStepId: string) => ({ steps, currentStepId }) as unknown as FinancialPath;

test("state reads rate-shaped steps as ongoing, never done or current", () => {
  expect(levelStateOf(step("a", "complete", { rateShaped: true }), "a")).toBe("ongoing");
  expect(levelStateOf(step("a", "complete"), "b")).toBe("done");
  expect(levelStateOf(step("a", "pending"), "a")).toBe("current");
  expect(levelStateOf(step("a", "pending"), "b")).toBe("future");
});

test("summary counts states and only completes a non-empty path", () => {
  const p = path([step("a", "complete"), step("b", "in_progress"), step("c", "pending", { rateShaped: true }), step("d", "pending")], "b");
  expect(journeySummary(p)).toMatchObject({ states: ["done", "current", "ongoing", "future"], total: 4, done: 1, ongoing: 1, future: 1, allComplete: false });
  expect(journeySummary(path([], "")).allComplete).toBe(false);
  expect(journeySummary(path([step("a", "complete")], "a")).allComplete).toBe(true);
});

test("current step falls back to the first", () => {
  expect(currentStep(path([step("a", "pending"), step("b", "pending")], "b"))?.id).toBe("b");
  expect(currentStep(path([step("a", "pending")], "zzz"))?.id).toBe("a");
  expect(currentStep(undefined)).toBeNull();
});

test("step detail states a balance or a monthly rate, masked when hidden", () => {
  expect(stepDetail({ kind: "buffer", current: 1200, target: 5000 })).toBe("$1.2K saved of $5.0K target");
  expect(stepDetail({ kind: "savings-rate", current: 500, target: 1000 })).toBe("$500 of $1.0K a month");
  expect(stepDetail({ kind: "debt", current: 2878, target: 0 })).toBeNull();
  setAmountsHidden(true);
  expect(stepDetail({ kind: "buffer", current: 1, target: 2 })).toBe("$••••• saved of $••••• target");
});

test("help prompt names the step", () => {
  expect(stepHelpPrompt({ order: 2, title: "Pay off card" })).toContain('step 2 of my financial path, "Pay off card"');
});

// ── The journey page ─────────────────────────────────────────────────────────
import { aprLabel, canTick, needsNumbers, offPathLine, statePillLabel, stepAccount, stepActions, stepGuidance, updatedLine, whyTheseSteps } from "../journey";

test("updated line puts the date first and names a known cause only", () => {
  const at = "2026-11-21T15:00:00.000Z";
  expect(updatedLine(at, "goal_added")).toBe("Updated November 21, 2026, after you added a goal.");
  expect(updatedLine(at, "inputs_changed")).toBe("Updated November 21, 2026.");
  expect(updatedLine(at, "no_active_path")).toBe("Built for you on November 21, 2026.");
});

test("needs numbers only when there is no income, cash or investments", () => {
  expect(needsNumbers({ monthlyIncome: 0, totalCash: 0, totalInvested: 0 })).toBe(true);
  expect(needsNumbers({ monthlyIncome: 0, totalCash: 1, totalInvested: 0 })).toBe(false);
});

test("only an unmeasured step takes a tick", () => {
  expect(canTick({ target: null })).toBe(true);
  expect(canTick({ target: 0 })).toBe(false);
});

test("a rate keeps its precision, 0 is a rate, and none asks for one", () => {
  expect(aprLabel(24.99)).toBe("24.99% APR");
  expect(aprLabel(7.125)).toBe("7.13% APR");
  expect(aprLabel(0)).toBe("0% APR");
  expect(aprLabel(null)).toBe("Add rate");
});

test("a debt step's account skips one that would print as $0", () => {
  const a = (id: string, balance: number) => ({ id, name: id, mask: null, balance, apr: null });
  expect(stepAccount({ accounts: [a("x", 0.4), a("y", 2879)] })?.id).toBe("y");
  expect(stepAccount({ accounts: [a("x", 0.4)] })).toBeNull();
  expect(stepAccount({})).toBeNull();
});

test("guidance: the order on the current step, the monthly rule on a rate step, else the fact", () => {
  const s = { action: "Pay $100", fact: "$50 owed.", rateShaped: false };
  expect(stepGuidance(s, "current")).toEqual({ heading: "Next step", text: "Pay $100" });
  expect(stepGuidance(s, "future")).toEqual({ heading: null, text: "$50 owed." });
  expect(stepGuidance({ ...s, rateShaped: true }, "ongoing")).toEqual({ heading: "Every month", text: "Pay $100" });
  expect(stepGuidance({ action: "", fact: "", rateShaped: false }, "done")).toBeNull();
  expect(stepGuidance({ action: "", fact: "x", rateShaped: false }, "current")).toBeNull();
});

test("state pills never call a rate step done or ahead", () => {
  expect(statePillLabel("done", true)).toBe("Ongoing");
  expect(statePillLabel("current", false)).toBe("You are here");
  expect(statePillLabel("done", false)).toBe("Done");
  expect(statePillLabel("future", false)).toBe("Ahead");
});

test("an off-path line says who took it off, or the plan's reason, or nothing", () => {
  expect(offPathLine({ byYou: true, reason: "x" })).toBe("You said this does not apply to you.");
  expect(offPathLine({ byYou: false, reason: "Same as step 2." })).toBe("Same as step 2.");
  expect(offPathLine({ byYou: false, reason: "" })).toBeNull();
});

test("why these steps is written for the balances actually there", () => {
  const debt = (apr: number | null) => ({ kind: "debt", accounts: [{ id: "a", name: "a", mask: null, balance: 1, apr }] });
  const p = (steps: object[], surplus: number | null, orderSource: "model" | "deterministic" = "model") =>
    ({ steps, orderSource, summary: { monthlySurplus: surplus } }) as unknown as Parameters<typeof whyTheseSteps>[0];
  const one = whyTheseSteps(p([debt(24.99), { kind: "goal" }], 5308));
  expect(one[0]).toBe("These 2 steps are built from your own accounts, goals and profile. One step each for 1 debt account and 1 goal, named individually. Anything that does not apply to you is left out rather than shown greyed.");
  expect(one[1]).toContain("Your balance sits where its own interest rate puts it");
  expect(one[2]).toBe("Your $5,308 a month goes to the step you are on, then moves down as each finishes.");
  expect(whyTheseSteps(p([debt(null), debt(null)], null, "deterministic"))[1]).toMatch(/^The order is our default sequence.*No lender on your path reports a rate/);
  expect(whyTheseSteps(p([], 0))[2]).toBe("Add income or link a spending account and each step gets a monthly figure and a date.");
  setAmountsHidden(true);
  expect(whyTheseSteps(p([], 5308))[2]).toBe("Your $••••• a month goes to the step you are on, then moves down as each finishes.");
});

test("a step's actions are the ones that serve it", () => {
  const rows = [{ id: "1", pathStepKey: "a" }, { id: "2", pathStepKey: null }, { id: "3", pathStepKey: "a" }];
  expect(stepActions(rows, "a").map((r) => r.id)).toEqual(["1", "3"]);
});
