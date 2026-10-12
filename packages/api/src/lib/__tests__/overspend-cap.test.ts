import { describe, it, expect } from "vitest";
import { capOverspend, isOverspend } from "../overspend-cap.js";

const row = (id: string, over: Partial<{ producer: string; metadata: unknown; monthlyValue: number | null; urgency: string; createdAt: string }> = {}) => ({
  id,
  producer: over.producer ?? "insights-engine",
  metadata: over.metadata ?? null,
  monthlyValue: over.monthlyValue ?? null,
  urgency: over.urgency ?? "medium",
  createdAt: over.createdAt ?? "2026-10-01T00:00:00Z",
});

describe("capOverspend", () => {
  it("recognises both producers' overspend rows and nothing else", () => {
    expect(isOverspend(row("a", { producer: "spend-cuts", metadata: { kind: "category_above_trend" } }))).toBe(true);
    expect(isOverspend(row("b", { metadata: { overspend: true } }))).toBe(true);
    expect(isOverspend(row("c", { producer: "spend-cuts", metadata: { kind: "fee" } }))).toBe(false);
    expect(isOverspend(row("d"))).toBe(false);
  });

  it("keeps one across the two producers, the largest monthly figure", () => {
    const engine = row("engine", { metadata: { overspend: true }, urgency: "high" });
    const cut = row("cut", { producer: "spend-cuts", metadata: { kind: "category_above_trend" }, monthlyValue: 367 });
    const other = row("other");
    expect(capOverspend([engine, other, cut]).map((r) => r.id)).toEqual(["other", "cut"]);
  });

  it("breaks a tie on urgency, then on the newest", () => {
    const low = row("low", { metadata: { overspend: true }, urgency: "low", createdAt: "2026-10-09T00:00:00Z" });
    const high = row("high", { metadata: { overspend: true }, urgency: "high", createdAt: "2026-10-01T00:00:00Z" });
    expect(capOverspend([low, high]).map((r) => r.id)).toEqual(["high"]);
    const older = row("older", { metadata: { overspend: true }, createdAt: "2026-10-01T00:00:00Z" });
    const newer = row("newer", { metadata: { overspend: true }, createdAt: "2026-10-09T00:00:00Z" });
    expect(capOverspend([older, newer]).map((r) => r.id)).toEqual(["newer"]);
  });

  it("leaves a list with one or none alone, in order", () => {
    const rows = [row("a"), row("b", { metadata: { overspend: true } }), row("c")];
    expect(capOverspend(rows)).toEqual(rows);
  });
});
