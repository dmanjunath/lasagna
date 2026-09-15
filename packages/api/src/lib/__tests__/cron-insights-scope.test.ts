import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Who the daily insights run pays for.
 *
 * This query used to be `select id from tenants` with no WHERE at all, so every
 * tenant row ever created bought a full model call every day: 60 tenants, 38 of
 * them on test domains, many with nothing connected and nobody reading. Two
 * runs cost $9.45.
 *
 * The predicate is asserted against the SQL the query actually builds rather
 * than against a fixture the mock hands back, because a mock that returns two
 * rows passes just as well with no WHERE clause at all.
 */

/** The joins and the filter of the last selectDistinct built. */
let built: { joined: unknown[]; where: unknown } = { joined: [], where: null };

function selectChain(rows: Array<{ id: string }>) {
  built = { joined: [], where: null };
  const self: Record<string, unknown> = {
    from: () => self,
    innerJoin: (table: unknown) => {
      built.joined.push(table);
      return self;
    },
    where: (cond: unknown) => {
      built.where = cond;
      return self;
    },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(res, rej),
  };
  return self;
}

let tenantRows: Array<{ id: string }> = [];

vi.mock("../db.js", () => ({
  db: {
    selectDistinct: () => selectChain(tenantRows),
    query: { plaidItems: { findMany: async () => [] } },
  },
}));

const generateInsights = vi.fn(async (_id: string) => 1);
vi.mock("../insights-engine.js", () => ({
  generateInsights: (id: string) => generateInsights(id),
}));
vi.mock("../sync.js", () => ({ syncItem: vi.fn() }));
vi.mock("../billing.js", () => ({ resolveTenantPlan: async () => "free" }));

import { PgDialect, accounts, users } from "@lasagna/core";
import { runDailyInsights } from "../cron.js";

/** The filter, rendered as the SQL it becomes. */
function whereSql() {
  return new PgDialect().sqlToQuery(built.where as never);
}

beforeEach(() => {
  generateInsights.mockClear();
  tenantRows = [{ id: "t1" }, { id: "t2" }];
});

describe("the daily insights run is scoped, not unfiltered", () => {
  it("requires a tenant to have at least one account", async () => {
    await runDailyInsights();

    expect(built.joined).toContain(accounts);
  });

  it("requires a recent sign-in, so abandoned tenants stop being paid for", async () => {
    await runDailyInsights();

    expect(built.joined).toContain(users);
    expect(whereSql().sql).toContain("last_login_at");
  });

  it("bounds the idle window to about a month", async () => {
    await runDailyInsights();

    // Drizzle has already mapped the Date to the string it will bind.
    const cutoff = new Date(whereSql().params[0] as string);
    const daysAgo = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(25);
    expect(daysAgo).toBeLessThan(35);
  });

  it("generates only for the tenants the predicate returned", async () => {
    const res = await runDailyInsights();

    expect(generateInsights).toHaveBeenCalledTimes(2);
    expect(generateInsights).toHaveBeenCalledWith("t1");
    expect(generateInsights).toHaveBeenCalledWith("t2");
    expect(res.succeeded).toBe(2);
  });

  it("costs nothing when the predicate matches nobody", async () => {
    tenantRows = [];

    const res = await runDailyInsights();

    expect(generateInsights).not.toHaveBeenCalled();
    expect(res).toMatchObject({ succeeded: 0, failed: 0 });
  });
});
