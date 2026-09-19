import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The daily insights generation may only throw away its OWN rows.
 *
 * Its delete used to read "every non-dismissed row for this tenant", which was
 * true of the table while one workflow wrote to it. A second producer now
 * writes the household's spend cuts into the same table, so that predicate had
 * become "erase every household's spend cuts on the first cron run after
 * deploy" — silently, a day late, with the rows simply gone.
 *
 * Asserted as SQL rather than as behaviour, because the behaviour needs a
 * database and a model call, and the SQL is the thing that would be wrong. The
 * predicate is also read straight out of the source at the delete site, so the
 * seam cannot be tested green while the call site quietly stops using it.
 */

import { PgDialect } from "@lasagna/core";
import { INSIGHTS_ENGINE_PRODUCER, insightsEngineRowsToReplace } from "../insights-engine.js";

const TENANT = "00000000-0000-4000-8000-0000000000aa";
const ENGINE = join(fileURLToPath(new URL(".", import.meta.url)), "..", "insights-engine.ts");

describe("the insights engine deletes only its own rows", () => {
  const { sql, params } = new PgDialect().sqlToQuery(insightsEngineRowsToReplace(TENANT) as never);

  it("filters on the tenant", () => {
    expect(sql).toContain('"tenant_id" = $');
    expect(params).toContain(TENANT);
  });

  it("filters on the producer, which is what keeps the other producer's rows", () => {
    expect(sql).toContain('"producer" = $');
    expect(params).toContain(INSIGHTS_ENGINE_PRODUCER);
    expect(INSIGHTS_ENGINE_PRODUCER).toBe("insights-engine");
  });

  it("still keeps a dismissed row, as it always did", () => {
    expect(sql).toContain('"dismissed_at" IS NULL');
  });

  it("is what the delete at the generation site actually uses", () => {
    const src = readFileSync(ENGINE, "utf8");
    expect(src).toContain(".delete(insights).where(insightsEngineRowsToReplace(tenantId))");
    // And the rows it writes name the same producer, rather than leaning on the
    // column default, so the insert and the delete cannot drift apart.
    expect(src).toContain("producer: INSIGHTS_ENGINE_PRODUCER,");
  });
});
