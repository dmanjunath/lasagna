import {
  cardLine,
  canMarkComplete,
  completedLine,
  goalStatus,
  goalSymbol,
  goalsSummary,
  heroLine,
  heroTiles,
  humanizeDaysLeft,
  paceLine,
  pickerGroups,
  pickerTotalLine,
  savingsActions,
  shownCategory,
  suggestedPresets,
  type Goal,
  type GoalBalance,
} from "../goals";
import { setAmountsHidden } from "../hide-amounts";

const NOW = new Date("2026-11-22T12:00:00Z");

const goal = (over: Partial<Goal>): Goal => ({
  id: "g1",
  name: "Trip",
  targetAmount: "1000.00",
  currentAmount: "250.00",
  monthlyContribution: null,
  deadline: null,
  category: "vacation",
  details: null,
  status: "active",
  icon: "plane",
  accountIds: [],
  isAutoTracked: false,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

afterEach(() => setAmountsHidden(false));

test("icons map lucide keys and legacy emoji to SF Symbols", () => {
  expect(goalSymbol("home")).toBe("house");
  expect(goalSymbol("🛡️")).toBe("shield");
  expect(goalSymbol("💪")).toBe("target");
  expect(goalSymbol(null)).toBe("target");
  expect(goalSymbol("unknown")).toBe("target");
});

test("suggested hides kinds the user already has, active or done (W-16), but keeps general savings", () => {
  const s = suggestedPresets([goal({ category: "emergency_fund", status: "completed" }), goal({ category: "savings" })]);
  expect(s.map((p) => p.category)).not.toContain("emergency_fund");
  expect(s).toHaveLength(6);
  expect(suggestedPresets([]).map((p) => p.category)[0]).toBe("emergency_fund");
});

test("the category shows unless the name already says it", () => {
  expect(shownCategory(goal({ name: "Retirement Savings", category: "retirement" }))).toBeNull();
  expect(shownCategory(goal({ name: "Become Debt Free", category: "debt_payoff" }))).toBe("Debt payoff");
});

test("summary counts reached goals once, active and completed together (W-17)", () => {
  const s = goalsSummary([
    goal({ id: "a", targetAmount: "8000", currentAmount: "1200" }),
    goal({ id: "b", targetAmount: "2125000", currentAmount: "65000" }),
    goal({ id: "c", status: "completed", targetAmount: "25500", currentAmount: "25500" }),
  ]);
  expect(s.reached).toBe(1);
  expect(s.total).toBe(3);
  expect(s.saved).toBe(66200);
  expect(s.target).toBe(2133000);
  expect(s.pct).toBe(3);
  expect(s.avgPct).toBe(9); // (15 + 3.06) / 2
});

test("pace: a monthly plan projects the finish and compares it with the deadline", () => {
  const g = goal({ monthlyContribution: "150", deadline: "2027-06-30T00:00:00.000Z" });
  expect(paceLine(g, NOW)).toBe("$150/mo planned, on track for Jun 2027");
  const behind = goal({ monthlyContribution: "50", deadline: "2027-03-31T00:00:00.000Z" });
  expect(paceLine(behind, NOW)).toBe("$50/mo planned, on pace for Feb 2028 (behind your Mar 2027 target)");
  expect(paceLine(goal({ monthlyContribution: "75" }), NOW)).toBe("$75/mo planned, on pace for Sep 2027");
  expect(paceLine(goal({ monthlyContribution: "1", targetAmount: "20000000000" }), NOW)).toBe("$1/mo planned, more than 100 years at this pace");
});

test("status: the pace comparison as a verdict, never parsed from the line", () => {
  // $750 left at $150/mo lands Apr 2027, before a Jun 2027 deadline.
  expect(goalStatus(goal({ monthlyContribution: "150", deadline: "2027-06-30T00:00:00.000Z" }), NOW)).toBe("good");
  // $750 at $100/mo lands Jul 2027: one to three months past an Apr or Jun deadline is slipping.
  expect(goalStatus(goal({ monthlyContribution: "100", deadline: "2027-06-30T00:00:00.000Z" }), NOW)).toBe("attention");
  expect(goalStatus(goal({ monthlyContribution: "100", deadline: "2027-04-30T00:00:00.000Z" }), NOW)).toBe("attention");
  // Feb 2028 against Mar 2027 is eleven months late.
  expect(goalStatus(goal({ monthlyContribution: "50", deadline: "2027-03-31T00:00:00.000Z" }), NOW)).toBe("bad");
  expect(goalStatus(goal({ monthlyContribution: "1", targetAmount: "20000000000", deadline: "2030-01-31T00:00:00.000Z" }), NOW)).toBe("bad");
});

test("status: nothing to judge is no status", () => {
  expect(goalStatus(goal({ monthlyContribution: "150" }), NOW)).toBeNull(); // no deadline
  expect(goalStatus(goal({ deadline: "2027-06-30T00:00:00.000Z" }), NOW)).toBeNull(); // no plan
  expect(goalStatus(goal({ monthlyContribution: "150", deadline: "2026-01-31T00:00:00.000Z" }), NOW)).toBeNull(); // deadline passed
  expect(goalStatus(goal({ monthlyContribution: "150", currentAmount: "1000", deadline: "2027-06-30T00:00:00.000Z" }), NOW)).toBeNull(); // reached
  expect(goalStatus(goal({ monthlyContribution: "150", currentAmount: "0", deadline: "2027-06-30T00:00:00.000Z" }), NOW)).toBeNull(); // not started
  expect(goalStatus(goal({ monthlyContribution: "150", deadline: "2027-06-30T00:00:00.000Z", status: "completed" }), NOW)).toBeNull();
});

test("pace: a deadline alone says what a month would take", () => {
  expect(paceLine(goal({ deadline: "2029-12-31T00:00:00.000Z", targetAmount: "8000", currentAmount: "1200" }), NOW)).toBe("About $184/mo would hit Dec 2029");
  expect(paceLine(goal({}), NOW)).toBeNull();
  expect(paceLine(goal({ currentAmount: "0", deadline: "2029-12-31T00:00:00.000Z" }), NOW)).toBeNull();
});

test("card line covers funded, not started, to go and past due", () => {
  expect(cardLine(goal({ currentAmount: "1200" }), NOW)).toBe("Funded. $200 above target.");
  expect(cardLine(goal({ currentAmount: "1000" }), NOW)).toBe("Funded.");
  expect(cardLine(goal({ currentAmount: "0", deadline: "2027-06-30T00:00:00.000Z" }), NOW)).toBe("Just getting started, target Jun 2027");
  expect(cardLine(goal({}), NOW)).toBe("$750 to go");
  expect(cardLine(goal({ deadline: "2026-01-01T00:00:00.000Z" }), NOW)).toBe("$750 to go, past the target date");
});

test("hidden amounts mask every figure in the lines", () => {
  setAmountsHidden(true);
  expect(cardLine(goal({}), NOW)).toBe("$••••• to go");
  expect(pickerTotalLine([bal("a", "500")], ["a"], 1000)).toBe("This account holds $••••• of the $••••• target.");
});

test("completed rows only claim Reached when the target was hit", () => {
  expect(completedLine(goal({ name: "Emergency Fund", category: "emergency_fund", status: "completed", currentAmount: "1000" }))).toBe("Reached");
  expect(completedLine(goal({ status: "completed", currentAmount: "600" }))).toBe("Completed at 60%. Vacation");
});

test("mark complete appears from halfway", () => {
  expect(canMarkComplete(goal({ currentAmount: "499" }))).toBe(false);
  expect(canMarkComplete(goal({ currentAmount: "500" }))).toBe(true);
  expect(canMarkComplete(goal({ currentAmount: "1000", status: "completed" }))).toBe(false);
});

test("hero line and tiles", () => {
  expect(heroLine(goal({ currentAmount: "0" }), NOW)).toMatch(/^Not started yet/);
  expect(heroLine(goal({ status: "completed", currentAmount: "600", completedAt: "2026-10-02T12:00:00Z" }), NOW)).toBe("Marked complete on Oct 2, 2026 with $600 saved");
  // What's left is the To go tile's, so a goal without a plan has no line.
  expect(heroLine(goal({}), NOW)).toBeNull();
  const tiles = heroTiles(goal({ deadline: "2027-06-30T00:00:00.000Z", isAutoTracked: true, accountIds: ["a", "b"] }), NOW);
  expect(tiles.map((t) => [t.label, t.value, t.caption])).toEqual([
    ["To go", "$750", undefined],
    ["Target date", "Jun 2027", "7 months left"],
    ["Tracking", "Auto", "from 2 accounts"],
  ]);
  // Tracked by hand, with no accounts: the page's "Tracked manually" card says so, not a tile.
  expect(heroTiles(goal({ deadline: "2027-06-30T00:00:00.000Z", accountIds: [] }), NOW).map((t) => t.key)).toEqual(["go", "date"]);
  expect(heroTiles(goal({}), NOW)[1]).toMatchObject({ value: "Set a date", action: "date" });
  expect(heroTiles(goal({ currentAmount: "1500" }), NOW)[0]).toMatchObject({ label: "Over target", value: "$500" });
});

test("a very large target never shows an invalid date", () => {
  const huge = ["1000000000", "999999999999", "1e15", String(Number.MAX_SAFE_INTEGER), "1e300"];
  const plans = [null, "1", "50", "100000"];
  for (const targetAmount of huge) {
    for (const monthlyContribution of plans) {
      for (const deadline of [null, "2029-12-31T00:00:00.000Z"]) {
        const g = goal({ targetAmount, currentAmount: "1200", monthlyContribution, deadline });
        const texts = [paceLine(g, NOW), cardLine(g, NOW), heroLine(g, NOW), ...heroTiles(g, NOW).flatMap((t) => [t.value, t.caption])];
        for (const text of texts) expect(text ?? "").not.toMatch(/Invalid|NaN|Infinity/);
      }
    }
  }
  // A plan too slow to name a month says so in years.
  expect(paceLine(goal({ targetAmount: "1e15", currentAmount: "1200", monthlyContribution: "50" }), NOW)).toBe("$50/mo planned, more than 100 years at this pace");
});

test("days left reads in its largest unit", () => {
  expect(humanizeDaysLeft(0)).toBe("Past deadline");
  expect(humanizeDaysLeft(1)).toBe("1 day left");
  expect(humanizeDaysLeft(200)).toBe("7 months left");
  expect(humanizeDaysLeft(1500)).toBe("4 yr 1 mo left");
});

const bal = (id: string, balance: string, type = "depository"): GoalBalance => ({
  accountId: id,
  name: id,
  type,
  mask: null,
  institutionId: null,
  institutionName: null,
  balance,
  asOf: null,
});

test("picker puts the kind's usual type first, linked accounts then the largest first", () => {
  const groups = pickerGroups([bal("a", "10"), bal("b", "500"), bal("c", "50", "investment"), bal("d", "5")], "investment", new Set(["d"]));
  expect(groups.map((g) => g.title)).toEqual(["Investments", "Cash"]);
  expect(groups[1].rows.map((r) => r.accountId)).toEqual(["d", "b", "a"]);
});

test("picker total reads against the target", () => {
  const accts = [bal("a", "600"), bal("b", "500")];
  expect(pickerTotalLine(accts, [], 1000)).toBeNull();
  expect(pickerTotalLine(accts, ["a", "b"], 1000)).toBe("These 2 accounts hold $1,100 of the $1,000 target. That reaches the target.");
  expect(pickerTotalLine(accts, ["a"], null)).toBe("This account holds $600.");
});

test("savings actions keep only the savings type", () => {
  const rows = savingsActions([
    { id: "1", type: "savings", title: "Save more", description: "", urgency: "medium", category: null } as never,
    { id: "2", type: "debt", title: "Pay debt", description: "", urgency: "high", category: null } as never,
  ]);
  expect(rows.map((r) => r.id)).toEqual(["1"]);
});
