import { describe, it, expect } from "vitest";
import { buildPeriods } from "../trend.js";

const NOW = new Date("2026-07-06T12:00:00");

describe("buildPeriods (month)", () => {
  it("zero-fills the last N months and aggregates income/expenses/net", () => {
    const rows = [
      { period: "2026-06", amount: "100.00", groupType: "expense" },
      { period: "2026-06", amount: "-3000.00", groupType: "income" },
      { period: "2026-05", amount: "50.00", groupType: "expense" },
    ];
    const out = buildPeriods(rows, { granularity: "month", limit: 3, now: NOW });
    expect(out.map((p) => p.period)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(out[1]).toEqual({ period: "2026-06", income: 3000, expenses: 100, net: 2900 });
    expect(out[2]).toEqual({ period: "2026-07", income: 0, expenses: 0, net: 0 });
  });
  it("excludes transfers by groupType", () => {
    const rows = [
      { period: "2026-07", amount: "500.00", groupType: "transfer" },
      { period: "2026-07", amount: "-500.00", groupType: "transfer" },
    ];
    const out = buildPeriods(rows, { granularity: "month", limit: 1, now: NOW });
    expect(out[0]).toEqual({ period: "2026-07", income: 0, expenses: 0, net: 0 });
  });
  it("classifies a null groupType as expense (defensive)", () => {
    const rows = [
      { period: "2026-07", amount: "10.00", groupType: null },
    ];
    const out = buildPeriods(rows, { granularity: "month", limit: 1, now: NOW });
    expect(out[0]).toEqual({ period: "2026-07", income: 0, expenses: 10, net: -10 });
  });
});

describe("buildPeriods (year)", () => {
  it("spans earliest data year through the current year when limit is null", () => {
    const rows = [
      { period: "2024", amount: "10.00", groupType: "expense" },
      { period: "2026", amount: "20.00", groupType: "expense" },
    ];
    const out = buildPeriods(rows, { granularity: "year", limit: null, now: NOW });
    expect(out.map((p) => p.period)).toEqual(["2024", "2025", "2026"]);
    expect(out[1]).toEqual({ period: "2025", income: 0, expenses: 0, net: 0 });
  });
  it("respects an explicit year limit", () => {
    const rows = [{ period: "2020", amount: "10.00", groupType: "expense" }];
    const out = buildPeriods(rows, { granularity: "year", limit: 2, now: NOW });
    expect(out.map((p) => p.period)).toEqual(["2025", "2026"]);
  });
});
