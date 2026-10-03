import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reading the actions page never waits on a generation, and never holds a
 * transaction across one.
 *
 * GET /api/insights backs up the daily cron: a household whose actions are
 * older than 48 hours triggers a fresh generation on the next read. That
 * generation used to be AWAITED, inside `db.transaction`, so a person returning
 * after two days sat through a 45-to-60-second model call before the page
 * answered — and one of postgres.js's ten pooled connections sat with it, doing
 * no database work at all, because `generateInsights` opens its own.
 *
 * Both halves are now split: `claimRegeneration` takes the advisory lock and
 * stamps the freshness marker in one short transaction, and the generator runs
 * outside it with nothing waiting on it.
 *
 * Asserted against the source text, the way drill-params.test.ts asserts its
 * parameter names, because exercising the behaviour needs a database and a paid
 * model call and the SHAPE is the thing that would be wrong.
 */
const ROUTE = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "..", "insights.ts"),
  "utf8",
);

const claimRegeneration = ROUTE.slice(
  ROUTE.indexOf("async function claimRegeneration("),
  ROUTE.indexOf("/**\n * Whether the stored spend cuts are old enough to redo."),
);

// The GET / handler alone, so a transaction elsewhere in the file cannot make
// this pass or fail. It ends where the backstops do.
const listHandler = ROUTE.slice(
  ROUTE.indexOf('insightsRoutes.get("/", async (c) => {'),
  ROUTE.indexOf("const pathSteps = await readPathSteps("),
);

describe("the read backstop claims, then generates outside the claim", () => {
  it("found both slices, or every assertion below is vacuous", () => {
    expect(claimRegeneration).toContain("pg_try_advisory_xact_lock");
    expect(listHandler).toContain("REGEN_STALE_MS");
    expect(listHandler).toContain("spendCutsStale(");
  });

  it("holds the transaction for the lock and the marker, and nothing else", () => {
    expect(claimRegeneration).toContain("db.transaction(");
    expect(claimRegeneration).toContain("financialProfiles");
    // The generators are what must never be inside it.
    expect(claimRegeneration).not.toContain("generateInsights");
    expect(claimRegeneration).not.toContain("generateSpendCuts");
  });

  it("opens no transaction of its own in the handler", () => {
    // `claimRegeneration` owns the only one, above the handler. A second
    // `db.transaction` here is how the model call got back inside one.
    expect(listHandler).not.toContain("db.transaction(");
  });

  it("never awaits either generator on the read path", () => {
    expect(listHandler).not.toContain("await generateInsights(");
    expect(listHandler).not.toContain("await generateSpendCuts(");
    expect(listHandler).toContain("void generateInsights(session.tenantId)");
    expect(listHandler).toContain("void generateSpendCuts(session.tenantId)");
  });

  it("keeps both generators behind a claim, so a page view cannot fire two", () => {
    for (const mark of ["lastActionsGeneratedAt", "lastSpendCutsGeneratedAt"]) {
      expect(listHandler).toContain(`claimRegeneration(session.tenantId, { ${mark}: new Date() })`);
    }
    expect(listHandler).toContain("if (claimed) {");
  });

  it("serves the rows and the timestamp it already loaded, rather than re-reading", () => {
    // A re-read after the claim would print a fresh "generated at" over the
    // stale rows the response still carries.
    expect(listHandler).not.toContain("rows = await loadActiveInsights(session.tenantId);\n      ");
    expect(ROUTE).toContain("const rows = await loadActiveInsights(session.tenantId);");
    expect(ROUTE).toContain("const profile = await readHouseholdProfile(session.tenantId);");
  });
});
