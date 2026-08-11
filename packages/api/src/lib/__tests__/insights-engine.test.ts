import { describe, it, expect } from "vitest";
import { normalizePunctuation } from "../insights-engine.js";

describe("normalizePunctuation", () => {
  it("replaces the spaced em dash seen in generated insights with a comma", () => {
    const out = normalizePunctuation(
      "overpaid by $61,821 federally and $10,358 to Virginia — a combined $72,179",
    );
    expect(out).toBe(
      "overpaid by $61,821 federally and $10,358 to Virginia, a combined $72,179",
    );
  });

  it("converts dashes between digits to 'to' ranges", () => {
    expect(normalizePunctuation("expected returns of 7–10% beat 3—5% savings")).toBe(
      "expected returns of 7 to 10% beat 3 to 5% savings",
    );
  });

  it("replaces unspaced dashes and middots with commas", () => {
    expect(normalizePunctuation("Rebalance now—your allocation drifted")).toBe(
      "Rebalance now, your allocation drifted",
    );
    expect(normalizePunctuation("Dining $840 · Groceries $410")).toBe(
      "Dining $840, Groceries $410",
    );
  });

  it("leaves hyphens, currency, and URLs untouched", () => {
    const s = "Set up a $500/mo auto-transfer via https://example.com/my-bank";
    expect(normalizePunctuation(s)).toBe(s);
  });
});
