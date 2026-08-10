import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, accounts, balanceSnapshots, users } from "@lasagna/core";
import { db } from "../../lib/db.js";
import { resolvePersonContext } from "../plan-grounding.js";

// ── DB integration ────────────────────────────────────────────────────────────
// Requires a running, seeded Postgres reachable via DATABASE_URL. Run from the
// repo root:
//   pnpm db:seed
//   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5432/lasagna \
//     pnpm -F @lasagna/api test plan-grounding
//
// The default .env DATABASE_URL uses the docker-internal host `db:5432`, which
// isn't resolvable from a host-run test — point DATABASE_URL at localhost:5432.
// If the DB is unreachable or no seeded tenant has a real-estate account, the
// suite self-skips (it does not fail) so CI without a DB stays green.
//
// Setup patches the discovered seed tenant IN A REVERSIBLE way: it stamps rent
// metadata onto an existing property and inserts a temp mortgage debt account
// (with a balance snapshot) linked to it via propertyAccountId. afterAll deletes
// the temp mortgage and restores the property's original metadata — no seed data
// is left mutated. It never touches real user records.

let tenantId: string | null = null;
let userId: string | null = null;
let propertyId: string | null = null;
let propertyOriginalMeta: string | null = null;
let tempMortgageId: string | null = null;
let tempUnlinkedMortgageId: string | null = null;
// Baseline unlinkedMortgageTotal BEFORE we insert our temp unlinked mortgage —
// the seed tenant may already carry unlinked mortgage-subtype loans, so we
// assert on the DELTA our insert contributes rather than an absolute.
let baselineUnlinkedMortgage = 0;
let dbAvailable = false;

const MORTGAGE_BALANCE = 275_000;
const UNLINKED_MORTGAGE_BALANCE = 120_000;
const PROPERTY_RENT = 3_100;
const PROPERTY_INSURANCE = 1_800;
const PROPERTY_MAINTENANCE = 3_000;

beforeAll(async () => {
  try {
    // Discover a seed tenant that has a real-estate account (the seed generator
    // creates a Primary Residence / rentals). Ids regenerate each `db:seed`, so
    // we find one at runtime rather than hardcoding.
    const [prop] = await db
      .select({
        id: accounts.id,
        tenantId: accounts.tenantId,
        plaidItemId: accounts.plaidItemId,
        metadata: accounts.metadata,
      })
      .from(accounts)
      .where(eq(accounts.type, "real_estate"))
      .limit(1);
    if (!prop) return;

    tenantId = prop.tenantId;
    propertyId = prop.id;
    propertyOriginalMeta = prop.metadata;

    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .limit(1);
    userId = u?.id ?? null;
    if (!userId) return;

    // Stamp rent + carrying-cost metadata onto the property (reversible in afterAll).
    const meta = {
      ...(propertyOriginalMeta ? JSON.parse(propertyOriginalMeta) : {}),
      monthlyRent: PROPERTY_RENT,
      annualInsurance: PROPERTY_INSURANCE,
      annualMaintenance: PROPERTY_MAINTENANCE,
    };
    await db.update(accounts).set({ metadata: JSON.stringify(meta) }).where(eq(accounts.id, propertyId));

    // Insert a temp mortgage (loan) linked to the property + a balance snapshot.
    const [mortgage] = await db
      .insert(accounts)
      .values({
        tenantId,
        plaidItemId: prop.plaidItemId,
        plaidAccountId: `test-mortgage-${Date.now()}`,
        name: "Test Mortgage (plan-grounding.test)",
        type: "loan",
        subtype: "mortgage",
        propertyAccountId: propertyId,
      })
      .returning({ id: accounts.id });
    tempMortgageId = mortgage.id;
    await db.insert(balanceSnapshots).values({
      accountId: tempMortgageId,
      tenantId,
      balance: String(MORTGAGE_BALANCE),
      isoCurrencyCode: "USD",
    });

    // Capture the baseline unlinked-mortgage total (seed tenants can already
    // carry unlinked mortgage-subtype loans) so the assertion checks the delta
    // our insert adds, not an absolute that depends on seed contents.
    baselineUnlinkedMortgage = (await resolvePersonContext(tenantId, userId))
      .realEstate!.unlinkedMortgageTotal;

    // Insert a temp mortgage-subtype loan that is NOT linked to any property
    // (propertyAccountId null) — the data-linkage gap totalEquity must net out.
    const [unlinked] = await db
      .insert(accounts)
      .values({
        tenantId,
        plaidItemId: prop.plaidItemId,
        plaidAccountId: `test-unlinked-mortgage-${Date.now()}`,
        name: "Test Unlinked Mortgage (plan-grounding.test)",
        type: "loan",
        subtype: "mortgage",
      })
      .returning({ id: accounts.id });
    tempUnlinkedMortgageId = unlinked.id;
    await db.insert(balanceSnapshots).values({
      accountId: tempUnlinkedMortgageId,
      tenantId,
      balance: String(-UNLINKED_MORTGAGE_BALANCE),
      isoCurrencyCode: "USD",
    });

    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  // Revert everything the setup wrote so seed data is left exactly as found.
  if (tempMortgageId) {
    await db.delete(accounts).where(eq(accounts.id, tempMortgageId)).catch(() => {});
  }
  if (tempUnlinkedMortgageId) {
    await db.delete(accounts).where(eq(accounts.id, tempUnlinkedMortgageId)).catch(() => {});
  }
  if (propertyId) {
    await db
      .update(accounts)
      .set({ metadata: propertyOriginalMeta })
      .where(eq(accounts.id, propertyId))
      .catch(() => {});
  }
});

describe("resolvePersonContext (integration)", () => {
  it("surfaces real estate with linked-mortgage equity, SS, rental income, and demographics", async () => {
    if (!dbAvailable || !tenantId || !userId) {
      console.warn("SKIP: no DB / no seeded tenant with a real-estate account");
      return;
    }
    const ctx = await resolvePersonContext(tenantId, userId);

    // ── Real estate: the property and its linked mortgage are joined, equity = value − mortgage.
    expect(ctx.realEstate).not.toBeNull();
    const patched = ctx.realEstate!.properties.find((p) => p.mortgage > 0);
    expect(patched).toBeTruthy();
    expect(patched!.mortgage).toBeCloseTo(MORTGAGE_BALANCE, 0);
    expect(patched!.monthlyRent).toBeCloseTo(PROPERTY_RENT, 0);
    // equity is derived, not stored.
    expect(patched!.equity).toBeCloseTo(patched!.value - patched!.mortgage, 0);

    // ── Pre-computed derived figures so the narrative cites rather than computes.
    expect(patched!.annualRent).toBeCloseTo(PROPERTY_RENT * 12, 0);
    expect(patched!.annualCarryingCosts).toBeCloseTo(
      PROPERTY_INSURANCE + PROPERTY_MAINTENANCE,
      0,
    );
    expect(patched!.netAnnualRent).toBeCloseTo(
      PROPERTY_RENT * 12 - (PROPERTY_INSURANCE + PROPERTY_MAINTENANCE),
      0,
    );
    // Totals reconcile to the per-property derived rows.
    expect(ctx.realEstate!.totalNetAnnualRent).toBeCloseTo(
      ctx.realEstate!.totalAnnualRent - ctx.realEstate!.totalAnnualCarryingCosts,
      0,
    );

    // ── Total equity nets out the UNLINKED mortgage too (data-linkage robustness).
    // Assert on the DELTA our insert adds so the test is robust to any unlinked
    // mortgages the seed tenant already carries.
    expect(ctx.realEstate!.unlinkedMortgageTotal).toBeCloseTo(
      baselineUnlinkedMortgage + UNLINKED_MORTGAGE_BALANCE,
      0,
    );
    expect(ctx.realEstate!.totalEquity).toBeCloseTo(
      ctx.realEstate!.totalValue -
        ctx.realEstate!.totalMortgage -
        ctx.realEstate!.unlinkedMortgageTotal,
      0,
    );
    expect(ctx.realEstate!.totalMonthlyRent).toBeGreaterThanOrEqual(PROPERTY_RENT);

    // ── Guaranteed income surfaces the rental as a named source (not simulated).
    expect(ctx.guaranteedIncome.some((g) => g.source === "Rental income")).toBe(true);

    // ── Social Security is surfaced from the already-computed sim inputs (or null
    // when the seed profile has no income to derive it from).
    if (ctx.socialSecurity) {
      expect(ctx.socialSecurity.claimAge).toBe(67);
      expect(ctx.socialSecurity.monthlyBenefit).toBeGreaterThan(0);
    }

    // ── Demographics block is present (fields may be null on a sparse profile).
    expect(ctx.demographics).toHaveProperty("filingStatus");
    expect(ctx.demographics).toHaveProperty("stateOfResidence");
    expect(ctx.demographics).toHaveProperty("dependentCount");
    expect(ctx.demographics).toHaveProperty("riskTolerance");
    expect(ctx.demographics).toHaveProperty("employmentType");

    // ── Cheap extras are shaped correctly (contents depend on seed).
    expect(Array.isArray(ctx.topSpendingCategories)).toBe(true);
    expect(Array.isArray(ctx.goals)).toBe(true);
    expect(Array.isArray(ctx.guaranteedIncome)).toBe(true);
  });

  it("a sold property drops out of realEstate and surfaces in soldProperties", async () => {
    if (!dbAvailable || !tenantId || !userId || !propertyId) {
      console.warn("SKIP: no DB / no seeded tenant with a real-estate account");
      return;
    }
    // Baseline: the patched property (with its linked mortgage + rent) is present.
    const before = await resolvePersonContext(tenantId, userId);
    const soldName = before.realEstate!.properties.find((p) => p.id === propertyId)!.name;
    expect(before.realEstate!.properties.some((p) => p.id === propertyId)).toBe(true);
    expect(before.guaranteedIncome.some((g) => g.source === "Rental income")).toBe(true);

    // Sell it. Its net equity = value − linked mortgage.
    const after = await resolvePersonContext(tenantId, userId, {
      soldPropertyAccountIds: [propertyId],
    });

    // The sold property is gone from realEstate (never cited again) and its rent
    // no longer contributes to guaranteed income.
    const stillListed = after.realEstate?.properties.some((p) => p.id === propertyId) ?? false;
    expect(stillListed).toBe(false);
    expect(after.guaranteedIncome.some((g) => g.source === "Rental income")).toBe(false);

    // It surfaces in soldProperties with the net equity that was reclassified.
    const sold = after.soldProperties.find((p) => p.name === soldName);
    expect(sold).toBeTruthy();
    // netEquity = the property's value − its linked mortgage (MORTGAGE_BALANCE).
    const propVal = before.realEstate!.properties.find((p) => p.id === propertyId)!.value;
    expect(sold!.netEquity).toBeCloseTo(propVal - MORTGAGE_BALANCE, 0);
  });
});
