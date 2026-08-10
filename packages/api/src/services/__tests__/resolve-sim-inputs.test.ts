import { describe, it, expect, beforeAll } from "vitest";
import { eq, sql, holdings, users } from "@lasagna/core";
import { db } from "../../lib/db.js";
import { fetchAccountsWithBalances } from "../../lib/account-balances.js";
import { getHoldingsInput } from "../../routes/portfolio.js";
import { aggregatePortfolio, extractAllocation } from "../portfolio-aggregator.js";
import { resolveSimInputs } from "../resolve-sim-inputs.js";

// ── DB integration ────────────────────────────────────────────────────────────
// Requires a running, seeded Postgres reachable via DATABASE_URL. Run from the
// repo root:
//   pnpm db:seed
//   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5432/lasagna \
//     pnpm -F @lasagna/api test resolve-sim-inputs
//
// The default .env DATABASE_URL uses the docker-internal host `db:5432`, which
// isn't resolvable from a host-run test — point DATABASE_URL at localhost:5432.
// If the DB is unreachable or has no seeded tenant with holdings, the suite
// self-skips (it does not fail) so CI without a DB stays green.

const INVESTABLE_TYPES = new Set(["investment", "depository"]);

let tenantId: string | null = null;
let userId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    // Pick the first tenant that has holdings — seed ids are regenerated on each
    // `db:seed`, so we discover one at runtime rather than hardcoding.
    const rows = await db
      .select({ tenantId: holdings.tenantId })
      .from(holdings)
      .groupBy(holdings.tenantId)
      .limit(1);
    if (rows.length > 0) {
      tenantId = rows[0].tenantId;
      // Personal profile fields now resolve per-user, so the resolver needs a
      // user id — use any member of the discovered tenant.
      const urows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.tenantId, tenantId))
        .limit(1);
      userId = urows[0]?.id ?? null;
      dbAvailable = userId != null;
    }
  } catch {
    dbAvailable = false;
  }
});

describe("resolveSimInputs (integration)", () => {
  it("matches the portfolio pipeline's allocation exactly", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    const resolved = await resolveSimInputs(tenantId, userId!);
    const expected = extractAllocation(
      aggregatePortfolio(await getHoldingsInput(tenantId)),
    );
    expect(resolved.allocation).toEqual(expected);
  });

  it("startingBalance equals the investable (investment+depository, >0) total", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    const resolved = await resolveSimInputs(tenantId, userId!);
    const accts = await fetchAccountsWithBalances(tenantId);
    let expected = 0;
    for (const a of accts) {
      if (!INVESTABLE_TYPES.has(a.type)) continue;
      if (!(a.rawBalance > 0)) continue;
      expected += a.rawBalance;
    }
    expect(resolved.startingBalance).toBe(Math.round(expected));
  });

  it("produces a fully-populated, defaulted SimInputs", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    const resolved = await resolveSimInputs(tenantId, userId!);
    // Scalar defaults always applied by the pure deriver.
    expect(resolved.planThroughAge).toBe(90);
    expect(resolved.ssClaimAge).toBe(67);
    expect(resolved.strategy).toBe("constant_dollar");
    expect(resolved.inflationAdjusted).toBe(true);
    expect(resolved.numSimulations).toBe(1000);
    expect(resolved.otherMonthly).toBe(0);
    expect(resolved.otherStartAge).toBe(resolved.retirementAge);
    // Sanity ranges on the derived levers.
    expect(resolved.monthlySpend).toBeGreaterThanOrEqual(1000);
    expect(resolved.monthlySpend).toBeLessThanOrEqual(30000);
    expect(resolved.monthlySavings).toBeGreaterThanOrEqual(0);
    expect(resolved.monthlySavings).toBeLessThanOrEqual(15000);
    expect(resolved.currentAge).toBeGreaterThanOrEqual(18);
  });

  it("extraInvestable folds into startingBalance by exactly that amount", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    // A reinvested property-sale net equity is a clean add on top of the raw
    // investable sum (real estate was never in that sum), so the starting balance
    // rises by exactly the extra amount.
    const base = await resolveSimInputs(tenantId, userId!);
    const withEquity = await resolveSimInputs(tenantId, userId!, undefined, undefined, 250000);
    expect(withEquity.startingBalance).toBe(base.startingBalance + 250000);
  });

  it("applies overrides on top of resolved data", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    const resolved = await resolveSimInputs(tenantId, userId!, { retirementAge: 55, numSimulations: 200 });
    expect(resolved.retirementAge).toBe(55);
    expect(resolved.numSimulations).toBe(200);
  });

  it("flatReturn forces assetClassReturns for EVERY class, clobbering the holdings-derived map", async () => {
    if (!dbAvailable || !tenantId) {
      console.warn("SKIP: no DB / no seeded tenant with holdings");
      return;
    }
    // A flat 6% must win over the holdings-derived per-class returns that
    // resolveSimInputs re-attaches last for the real portfolio.
    const resolved = await resolveSimInputs(tenantId, userId!, undefined, 0.06);
    expect(resolved.assetClassReturns).toBeDefined();
    for (const cls of ["usStocks", "intlStocks", "bonds", "reits", "cash"] as const) {
      expect(resolved.assetClassReturns![cls]).toBe(0.06);
    }
  });
});
