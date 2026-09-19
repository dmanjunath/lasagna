/**
 * The meter and the freeze recompute must read the same institution count.
 *
 * The regression this guards: /billing/status used to count rows in
 * `plaid_items`, while the freeze recompute inner-joins `accounts`. An item that
 * errored before its first account pull holds zero accounts, so it added 1 to
 * the meter and 0 to the freeze set — a tenant at the cap was told "2 of 3
 * syncing, some accounts are frozen" with nothing frozen at all. Both now read
 * loadInstitutionSlots, so the shape of that query is what this pins down.
 *
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5432/lasagna \
 *     pnpm -F @lasagna/api test institution-slots-db
 *
 * The default .env DATABASE_URL uses the docker-internal host `db:5432`, which
 * isn't resolvable from a host-run test — point DATABASE_URL at localhost:5432.
 * If the DB is unreachable the tests self-skip (they do not fail), so a run
 * without a DB stays green.
 *
 * All data lives in a throwaway tenant this file creates in beforeAll and
 * deletes in afterAll. It never reads or writes any other tenant's rows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and, tenants, plaidItems, accounts } from "@lasagna/core";
import { db } from "../db.js";
import { countInstitutions, loadInstitutionSlots, recomputeFrozenAccounts } from "../account-limits.js";

const TAG = "institution-slots.test";

let tenantId: string | null = null;
let dbAvailable = false;

const addItem = (tid: string, institutionId: string | null, label: string) =>
  db
    .insert(plaidItems)
    .values({
      tenantId: tid,
      accessToken: `test-not-a-real-token-${label}`,
      institutionId,
      institutionName: `${label} (${TAG})`,
    })
    .returning({ id: plaidItems.id })
    .then((rows) => rows[0].id);

const addAccount = (tid: string, itemId: string, label: string) =>
  db
    .insert(accounts)
    .values({
      tenantId: tid,
      plaidItemId: itemId,
      plaidAccountId: `test-${TAG}-${label}`,
      name: `${label} (${TAG})`,
      type: "depository",
    })
    .returning({ id: accounts.id })
    .then((rows) => rows[0].id);

const frozenIds = async (tid: string) =>
  (
    await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tid), eq(accounts.frozen, true)))
  ).map((r) => r.id);

beforeAll(async () => {
  try {
    const [tenant] = await db.insert(tenants).values({ name: TAG }).returning({ id: tenants.id });
    tenantId = tenant.id;
    const tid = tenant.id;

    // Two working banks, the second one holding two accounts.
    const bankA = await addItem(tid, "ins_test_a", "Bank A");
    await addAccount(tid, bankA, "a-checking");
    const bankB = await addItem(tid, "ins_test_b", "Bank B");
    await addAccount(tid, bankB, "b-checking");
    await addAccount(tid, bankB, "b-savings");
    // The bug: an item that never pulled an account. Still linked, but it holds
    // nothing, so it occupies no slot.
    await addItem(tid, "ins_test_c", "Bank C");
    // Manual is free and unlimited.
    const manual = await addItem(tid, "manual", "Manual");
    await addAccount(tid, manual, "m-cash");

    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  // Delete only what this file created, innermost FK first.
  if (!tenantId) return;
  const tid = tenantId;
  await db.delete(accounts).where(eq(accounts.tenantId, tid)).catch(() => {});
  await db.delete(plaidItems).where(eq(plaidItems.tenantId, tid)).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, tid)).catch(() => {});
});

describe("the institution count behind the meter", () => {
  it("ignores an institution that holds no accounts, and manual", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const slots = await loadInstitutionSlots(tenantId!);
    // Four items exist (two banks, one account-less bank, manual): 2 slots.
    expect(countInstitutions(slots)).toBe(2);
  });

  it("freezes nothing when the account-less institution is the one over the cap", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    await recomputeFrozenAccounts(tenantId!, "free");
    // The false-dunning case: the meter said 3 of 2 while this set was empty.
    expect(await frozenIds(tenantId!)).toEqual([]);
    expect(countInstitutions(await loadInstitutionSlots(tenantId!))).toBe(2);
  });

  it("counts a third institution that does hold an account, and freezes exactly it", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const bankD = await addItem(tenantId!, "ins_test_d", "Bank D");
    const dChecking = await addAccount(tenantId!, bankD, "d-checking");
    expect(countInstitutions(await loadInstitutionSlots(tenantId!))).toBe(3);
    await recomputeFrozenAccounts(tenantId!, "free");
    expect(await frozenIds(tenantId!)).toEqual([dChecking]);
    // What the nudge says ("1 institution is frozen") is count - cap.
    expect(countInstitutions(await loadInstitutionSlots(tenantId!)) - 2).toBe(1);
  });
});
