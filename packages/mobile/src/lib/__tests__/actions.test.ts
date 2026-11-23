import type { ActionRow, ApiActionRow } from "@web/lib/action-rows";
import { ALL_AREAS, areaFilters, bandRows, canRefresh, inArea, spendingActions, updatedLine } from "../actions";

const row = (p: Partial<ActionRow>) => ({ id: "x", type: "debt", category: null, urgency: "medium", title: "t", createdAt: "2026-11-01", ...p }) as ActionRow;

test("bands by urgency, most urgent first, empty bands left out", () => {
  const bands = bandRows([row({ id: "a", urgency: "high" }), row({ id: "b", urgency: "low" }), row({ id: "c", urgency: "critical" })]);
  expect(bands.map((b) => b.title)).toEqual(["Worth doing now", "Keep an eye on"]);
  expect(bands[0].rows.map((r) => r.id)).toEqual(["c", "a"]);
});

test("the area rail lists only areas with actions, and none for one area", () => {
  expect(areaFilters([row({ type: "debt" }), row({ type: "debt" })])).toEqual([]);
  const f = areaFilters([row({ type: "debt" }), row({ type: "tax" })]);
  expect(f[0]).toEqual({ value: ALL_AREAS, label: "All" });
  expect(f.map((x) => x.label)).toContain("Taxes");
  expect(inArea(row({ type: "tax" }), "/tax")).toBe(true);
  expect(inArea(row({ type: "debt" }), "/tax")).toBe(false);
});

test("spending actions keep spending and behavioral advice", () => {
  const api = (type: string | null, id: string) =>
    ({ id, type, category: null, urgency: "medium", title: id, description: "", createdAt: "2026-11-01", producer: "insights" }) as unknown as ApiActionRow;
  expect(spendingActions([api("spending", "a"), api("debt", "b"), api("behavioral", "c"), api(null, "d")]).map((r) => r.id).sort()).toEqual(["a", "c"]);
});

test("refresh cooldown and its line", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  expect(canRefresh(null)).toBe(true);
  expect(canRefresh("2026-11-22T10:00:00Z", now.getTime())).toBe(false);
  expect(canRefresh("2026-11-22T08:00:00Z", now.getTime())).toBe(true);
  expect(updatedLine("2026-11-22T09:00:00Z", now)).toBe("Updated 3 hours ago");
  expect(updatedLine("2026-11-22T11:59:30Z", now)).toBe("Updated just now");
});
