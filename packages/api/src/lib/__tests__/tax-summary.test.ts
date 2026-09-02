import { describe, it, expect } from "vitest";
import { clampToSentence } from "../tax-summary.js";

/**
 * The summary is bounded here, not by the prompt.
 *
 * Asked for "400 characters at the very most", a twenty document household came
 * back with 763, and the hero it lands in has no line clamp, so it just grew
 * past a 390 wide phone. The prompt now asks for less and this decides.
 */
describe("clampToSentence", () => {
  const A = "Your 2023 W-2 shows $250,000 in wages and $41,200 in federal tax withheld.";
  const B = "A 1099-INT reports $3,400 of interest.";
  const C = "No 1098 or state return is on file for that year.";

  it("leaves a summary that already fits exactly as it is", () => {
    const text = `${A} ${B}`;
    expect(text.length).toBeLessThanOrEqual(400);
    expect(clampToSentence(text)).toBe(text);
  });

  it("keeps whole sentences and drops the ones that do not fit", () => {
    expect(clampToSentence(`${A} ${B} ${C}`, 90)).toBe(A);
  });

  it("holds a long summary under the bound", () => {
    const long = Array.from({ length: 10 }, () => `${A} ${B}`).join(" ");
    expect(long.length).toBeGreaterThan(763);
    const clamped = clampToSentence(long);
    expect(clamped.length).toBeLessThanOrEqual(400);
    expect(clamped.endsWith(".")).toBe(true);
  });

  it("never cuts inside a decimal or an abbreviated figure", () => {
    // "$1,234.56" carries a period that no sentence ends at.
    const text = `Your 1099-DIV reports $1,234.56 of qualified dividends. ${B} ${C}`;
    expect(clampToSentence(text, 60)).toBe(
      "Your 1099-DIV reports $1,234.56 of qualified dividends.",
    );
  });

  it("cuts a single over-long sentence on a word and closes it", () => {
    const runOn = `Your filings cover ${"2019, 2020, 2021, 2022, ".repeat(30)}and 2023`;
    const clamped = clampToSentence(runOn);
    expect(clamped.length).toBeLessThanOrEqual(400);
    expect(clamped.endsWith(".")).toBe(true);
    // No dangling comma before the period, and no half word before that.
    expect(clamped).toMatch(/[0-9A-Za-z]\.$/);
    expect(runOn.startsWith(clamped.slice(0, -1))).toBe(true);
  });
});
