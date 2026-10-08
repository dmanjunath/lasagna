/**
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test net-worth-history-db
 *
 * If the DB is unreachable the DB tests self-skip (they do not fail).
 *
 * All data lives in a throwaway tenant this file creates in beforeAll and
 * deletes in afterAll. It never reads or writes any other tenant's rows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, tenants, plaidItems, accounts, balanceSnapshots } from "@lasagna/core";
import { db } from "../db.js";
import { netWorthHistory, validTimeZone } from "../net-worth-history.js";

let tenantId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "net-worth-history.test" }).returning({ id: tenants.id });
    tenantId = t.id;
    const [item] = await db
      .insert(plaidItems)
      .values({ tenantId, accessToken: "test-not-a-real-token" })
      .returning({ id: plaidItems.id });
    const [acct] = await db
      .insert(accounts)
      .values({ tenantId, plaidItemId: item.id, plaidAccountId: "test-acct", name: "Checking", type: "depository" })
      .returning({ id: accounts.id });
    await db.insert(balanceSnapshots).values([
      { tenantId, accountId: acct.id, balance: "100", snapshotAt: new Date("2026-10-05T18:00:00Z") },
      // 8pm on Oct 6 in Los Angeles, already Oct 7 in UTC.
      { tenantId, accountId: acct.id, balance: "250", snapshotAt: new Date("2026-10-07T03:00:00Z") },
    ]);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
});

describe("validTimeZone", () => {
  it("accepts an IANA zone", () => {
    expect(validTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
  });
  it("rejects missing, unknown, and injected values", () => {
    expect(validTimeZone(undefined)).toBeNull();
    expect(validTimeZone("")).toBeNull();
    expect(validTimeZone("Not/AZone")).toBeNull();
    expect(validTimeZone("UTC'); drop table users; --")).toBeNull();
  });
});

describe("netWorthHistory", () => {
  it("groups by the UTC day without a zone", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    expect(await netWorthHistory(tenantId!, null)).toEqual([
      { date: "2026-10-05", value: 100 },
      { date: "2026-10-07", value: 250 },
    ]);
  });

  it("groups by the caller's local day with a zone", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    expect(await netWorthHistory(tenantId!, "America/Los_Angeles")).toEqual([
      { date: "2026-10-05", value: 100 },
      { date: "2026-10-06", value: 250 },
    ]);
  });
});
