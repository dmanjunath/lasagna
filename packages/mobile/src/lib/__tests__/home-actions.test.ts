import type { ApiActionRow } from "@web/lib/action-rows";
import { actionChatPrompt, actionDestination, datesLine, homeActions, rowFigure, txnCountLine } from "../home-actions";

const row = (over: Partial<ApiActionRow>): ApiActionRow => ({
  id: "x",
  category: "tax",
  urgency: "medium",
  effort: null,
  type: "tax",
  title: "Title",
  description: "Desc",
  impact: "$100 saved",
  impactColor: "green",
  chatPrompt: "Why?",
  generatedBy: "ai",
  createdAt: "2026-11-01T00:00:00Z",
  pathStepKey: null,
  ...over,
});

test("ranks by effort, then urgency, then newest, and keeps three", () => {
  const ids = homeActions([
    row({ id: "involved", effort: "involved", urgency: "critical" }),
    row({ id: "quick-low", effort: "quick", urgency: "low" }),
    row({ id: "quick-high", effort: "quick", urgency: "high" }),
    row({ id: "unrated", effort: null, urgency: "critical" }),
    row({ id: "moderate-new", effort: "moderate", urgency: "critical", createdAt: "2026-11-05T00:00:00Z" }),
  ]).map((r) => r.id);
  expect(ids).toEqual(["quick-high", "quick-low", "moderate-new"]);
});

test("destination is the server drill, else the area page, else none", () => {
  const [drilled] = homeActions([row({ producer: "spend-cuts", drill: { label: "See them", href: "/transactions?x=1" } })]);
  expect(actionDestination(drilled)).toEqual({ label: "See them", href: "/transactions?x=1" });
  expect(actionDestination(homeActions([row({ type: "debt", category: "debt" })])[0])).toEqual({ label: "Open Debt", href: "/debt" });
  expect(actionDestination(homeActions([row({ type: "general", category: "general" })])[0])).toBeNull();
});

test("figure prints the amount label for money back, the words otherwise", () => {
  expect(rowFigure({ amount: { value: 40.4, period: "monthly" }, impact: null, handsMoneyBack: true })).toBe("about $40 a month");
  expect(rowFigure({ amount: { value: 367, period: "monthly" }, impact: "$367 above usual", handsMoneyBack: false })).toBe("$367 above usual");
  expect(rowFigure({ amount: null, impact: "", handsMoneyBack: false })).toBeNull();
});

test("chat prompt matches the web wording", () => {
  const [r] = homeActions([row({})]);
  expect(actionChatPrompt(r)).toBe("Walk me through this insight:\n\nTitle: Title\nDescription: Desc\nImpact: $100 saved\n\nWhy?");
});

test("dates line adds the update only on a later day", () => {
  const now = new Date(2026, 10, 21, 12);
  expect(datesLine(new Date(2026, 10, 3, 9).toISOString(), new Date(2026, 10, 3, 18).toISOString(), now)).toBe("Found Nov 3.");
  expect(datesLine(new Date(2026, 10, 3, 9).toISOString(), new Date(2026, 10, 21, 8).toISOString(), now)).toBe("Found Nov 3. Updated today.");
  expect(datesLine(new Date(2025, 10, 3, 9).toISOString(), undefined, now)).toBe("Found Nov 3, 2025.");
});

test("count line says the count once", () => {
  expect(txnCountLine(1, 1)).toBe("The transaction behind this");
  expect(txnCountLine(3, 3)).toBe("The 3 transactions behind this");
  expect(txnCountLine(3, 11, "coffee purchases this month")).toBe("The 11 coffee purchases this month, largest first");
});
