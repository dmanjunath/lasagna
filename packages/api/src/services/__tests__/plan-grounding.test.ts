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
let dbAvailable = false;

const MORTGAGE_BALANCE = 275_000;
const PROPERTY_RENT = 3_100;

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

    // Stamp rent metadata onto the property (reversible in afterAll).
    const meta = { ...(propertyOriginalMeta ? JSON.parse(propertyOriginalMeta) : {}), monthlyRent: PROPERTY_RENT };
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
    // Totals reconcile to the per-property rows.
    expect(ctx.realEstate!.totalEquity).toBeCloseTo(
      ctx.realEstate!.totalValue - ctx.realEstate!.totalMortgage,
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
});
