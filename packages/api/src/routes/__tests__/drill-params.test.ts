import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One spelling for the /transactions scope, on both sides of the wire.
 *
 * A spend-cut row's drill is built here and read by the transactions page. The
 * two once used different names for the same scope, so an href promising
 * "See August's Software & SaaS transactions" arrived with its month and its
 * merchant silently dropped and landed on nine months of rows. The client no
 * longer renames anything, so the names emitted HERE are the only ones there
 * are, and this is where a drift back would start.
 *
 * Asserted against the source text, the way insights-producer-scope.test.ts
 * asserts its delete predicate, because the behaviour needs a database and the
 * parameter names are the thing that would be wrong.
 */
const ROUTE = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "..", "insights.ts"),
  "utf8",
);

// Just the drill builder, so a parameter name used elsewhere in the file for
// something unrelated cannot make this pass or fail.
const drillFor = ROUTE.slice(
  ROUTE.indexOf("function drillFor("),
  ROUTE.indexOf("function txnsBehindFindings("),
);

describe("a drill names its scope the way /transactions reads it", () => {
  it("was found in the source, or every assertion below is vacuous", () => {
    expect(drillFor).toContain("/transactions?");
  });

  it("scopes a category month with categories, startDate and endDate", () => {
    expect(drillFor).toContain("categories: meta.categoryId");
    expect(drillFor).toContain("startDate: ymd(analysisStart)");
    expect(drillFor).toContain("endDate: ymd(analysisEnd)");
  });

  it("scopes a merchant with search, which the page reads as its text query", () => {
    expect(drillFor).toContain("search: meta.merchantName");
  });

  it("holds a merchant search to the days its own transactions fall on", () => {
    // The window is only the fallback for a finding whose transactions are
    // gone. Reaching for it first is what sent a one-transaction fee row to
    // three rows totalling four times its figure.
    expect(drillFor).toContain("startDate: txnDays?.start ??");
    expect(drillFor).toContain("endDate: txnDays?.end ??");
  });

  it("spells none of them the old way, which the page would ignore", () => {
    for (const dropped of ["q:", "start:", "end:"]) {
      expect(drillFor).not.toContain(dropped);
    }
  });
});

/**
 * The day range a merchant drill is held to, and the noun phrase the count line
 * names its rows with. Both are derived from the finding's own metadata, so
 * they are asserted on the source the same way the drill parameters are.
 */
const txnDayRange = ROUTE.slice(
  ROUTE.indexOf("function txnDayRange("),
  ROUTE.indexOf("function drillFor("),
);
const txnScopeFor = ROUTE.slice(
  ROUTE.indexOf("function txnScopeFor("),
  ROUTE.indexOf("function txnDayRange("),
);

describe("a finding's own transactions bound its drill", () => {
  it("was found in the source, or every assertion below is vacuous", () => {
    expect(txnDayRange).toContain("meta.txnIds");
    expect(txnScopeFor).toContain("meta.categoryName");
  });

  it("takes the first and last day from the counted ids, not from the window", () => {
    expect(txnDayRange).toContain("hydrated.get(id)?.date.slice(0, 10)");
    expect(txnDayRange).not.toContain("meta.window");
  });

  it("names the category and the month it measured", () => {
    expect(txnScopeFor).toContain("transactions in ${MONTH_NAMES[month.getUTCMonth()]}");
  });
});
