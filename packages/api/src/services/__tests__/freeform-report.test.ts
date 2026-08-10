import { describe, it, expect } from "vitest";
import { sanitizeBrand, extractHtml } from "../freeform-report.js";
import { descrub, type AliasMap } from "../../lib/pii-scrubber.js";

describe("sanitizeBrand", () => {
  it("replaces banned positioning vocabulary with the brand", () => {
    const html =
      "<h1>Comprehensive Financial Advisory Report</h1><p>Private Wealth Advisory for you. Our wealth management approach.</p>";
    const out = sanitizeBrand(html);
    expect(out).not.toMatch(/wealth|advisory/i);
    expect(out).toContain("LasagnaFi Financial Insights");
  });

  it("maps persona nouns to 'licensed professional' so disclaimers stay coherent", () => {
    const out = sanitizeBrand("<p>Consult a financial advisor or financial planner.</p>");
    expect(out).toBe("<p>Consult a licensed professional or licensed professional.</p>");
  });

  it("softens standalone 'financial planning' without touching unrelated text", () => {
    const out = sanitizeBrand("<p>Your financial planning journey and your spending.</p>");
    expect(out).toContain("financial insights journey");
    expect(out).toContain("your spending");
  });

  it("runs BEFORE descrub so restored real names containing banned vocabulary survive", () => {
    // The pipeline is descrub(sanitizeBrand(html)): the model only ever emits
    // aliases (no banned vocabulary), so sanitize sees pure model output and a
    // real account name like "X Wealth Management Brokerage" is restored
    // untouched afterwards.
    const map: AliasMap = {
      forward: new Map([["X Wealth Management Brokerage", "Account 3"]]),
      reverse: new Map([["Account 3", "X Wealth Management Brokerage"]]),
    };
    const html = "<h1>Your wealth management plan</h1><p>Account 3 holds $10,000.</p>";
    const out = descrub(sanitizeBrand(html), map, "freeform");
    // Banned phrase from the MODEL is replaced...
    expect(out).toContain("<h1>Your LasagnaFi Financial Insights plan</h1>");
    // ...but the restored REAL name keeps its "Wealth Management" verbatim.
    expect(out).toContain("X Wealth Management Brokerage holds $10,000.");
  });
});

describe("extractHtml", () => {
  it("refuses truncated documents", () => {
    expect(extractHtml("<!DOCTYPE html><html><body>cut off")).toBeNull();
  });
  it("extracts complete documents from fenced text", () => {
    const html = extractHtml("here you go\n```html\n<!DOCTYPE html><html><body>x</body></html>\n```");
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toMatch(/<\/html>$/);
  });
});
