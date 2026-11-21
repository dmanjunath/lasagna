/**
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test actions-refresh-db
 *
 * If the DB is unreachable the tests self-skip (they do not fail).
 *
 * All data lives in throwaway tenants this file creates and deletes. Only
 * functions scoped to those tenants are called, never the all-tenant runner,
 * so no other tenant's refresh request is touched.
 *
 * The generators are mocked: nothing here bills a model call.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { eq, sql, tenants, financialProfiles } from "@lasagna/core";
import { db } from "../db.js";

/** Whether the claim's row lock was free at the moment each generator ran. */
const lockFreeWhenRun: boolean[] = [];

async function profileLockIsFree(tenantId: string): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select 1 from financial_profiles where tenant_id = ${tenantId} for update nowait`,
      );
    });
    return true;
  } catch {
    return false;
  }
}

/** Extra work a test makes each actions run do, such as a delay. */
let duringInsights: (() => Promise<void>) | null = null;

const generateInsights = vi.fn(async (tenantId: string) => {
  lockFreeWhenRun.push(await profileLockIsFree(tenantId));
  if (duringInsights) await duringInsights();
  return 0;
});
const generateSpendCuts = vi.fn(async (tenantId: string) => {
  lockFreeWhenRun.push(await profileLockIsFree(tenantId));
  return 0;
});
vi.mock("../insights-engine.js", () => ({
  generateInsights: (id: string) => generateInsights(id),
}));
vi.mock("../spend-cuts.js", () => ({
  generateSpendCuts: (id: string) => generateSpendCuts(id),
}));

import { inArray } from "@lasagna/core";
import {
  claimActionsRefresh,
  refreshTenant,
  refreshTenants,
  requestActionsRefresh,
} from "../actions-refresh.js";

let tenantId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "actions-refresh.test" }).returning({ id: tenants.id });
    tenantId = t.id;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
});

const DAY = 24 * 60 * 60 * 1000;

async function profile() {
  const [row] = await db.select().from(financialProfiles).where(eq(financialProfiles.tenantId, tenantId!));
  return row;
}

beforeEach(async () => {
  generateInsights.mockClear();
  generateSpendCuts.mockClear();
  lockFreeWhenRun.length = 0;
  duringInsights = null;
  if (!dbAvailable) return;
  // Both markers two days old, and no request: a stale household nobody has read.
  const stale = new Date(Date.now() - 2 * DAY);
  await db.delete(financialProfiles).where(eq(financialProfiles.tenantId, tenantId!));
  await db.insert(financialProfiles).values({
    tenantId: tenantId!,
    lastActionsGeneratedAt: stale,
    lastSpendCutsGeneratedAt: stale,
  });
});

function skip() {
  if (!dbAvailable) console.warn("SKIP: no DB at DATABASE_URL");
  return !dbAvailable;
}

describe("requestActionsRefresh", () => {
  it("keeps the first request time when asked again", async () => {
    if (skip()) return;
    await requestActionsRefresh(tenantId!);
    const first = (await profile()).actionsRefreshRequestedAt;
    expect(first).not.toBeNull();
    await requestActionsRefresh(tenantId!);
    expect((await profile()).actionsRefreshRequestedAt?.getTime()).toBe(first!.getTime());
  });
});

describe("claimActionsRefresh", () => {
  it("claims nothing when no refresh was asked for", async () => {
    if (skip()) return;
    expect(await claimActionsRefresh(tenantId!)).toBeNull();
  });

  it("lets exactly one of several concurrent claims through", async () => {
    if (skip()) return;
    await requestActionsRefresh(tenantId!);
    const claims = await Promise.all(Array.from({ length: 5 }, () => claimActionsRefresh(tenantId!)));
    expect(claims.filter((c) => c !== null)).toEqual([{ actions: true, spendCuts: true }]);
    // The request is consumed and both markers stamped before any work runs,
    // so a read in the next minute sees a fresh household and asks again for nothing.
    const row = await profile();
    expect(row.actionsRefreshRequestedAt).toBeNull();
    expect(Date.now() - row.lastActionsGeneratedAt!.getTime()).toBeLessThan(60_000);
    expect(Date.now() - row.lastSpendCutsGeneratedAt!.getTime()).toBeLessThan(60_000);
  });

  it("claims, but runs nothing, for a household the cadence pass already refreshed", async () => {
    if (skip()) return;
    await requestActionsRefresh(tenantId!);
    await db
      .update(financialProfiles)
      .set({ lastActionsGeneratedAt: new Date(), lastSpendCutsGeneratedAt: new Date() })
      .where(eq(financialProfiles.tenantId, tenantId!));
    expect(await claimActionsRefresh(tenantId!)).toEqual({ actions: false, spendCuts: false });
    expect((await profile()).actionsRefreshRequestedAt).toBeNull();
  });
});

describe("the claim's window, on the daily timeline", () => {
  // The read asks once a marker is a day old. The run that claims the request
  // comes later, so the marker is only older by then. The claim must not call
  // it fresh and clear the request without a run.
  it("treats a household stamped by yesterday's run as due, like the cadence pass does", async () => {
    if (skip()) return;
    const runToday = new Date();
    const stampedYesterday = new Date(runToday.getTime() - DAY + 60_000);
    await db
      .update(financialProfiles)
      .set({ lastActionsGeneratedAt: stampedYesterday, lastSpendCutsGeneratedAt: stampedYesterday })
      .where(eq(financialProfiles.tenantId, tenantId!));
    await requestActionsRefresh(tenantId!);
    expect(await claimActionsRefresh(tenantId!, runToday)).toEqual({ actions: true, spendCuts: true });
  });

  it("runs a household the read found just past a day old", async () => {
    if (skip()) return;
    const justStale = new Date(Date.now() - DAY - 60_000);
    await db
      .update(financialProfiles)
      .set({ lastActionsGeneratedAt: justStale, lastSpendCutsGeneratedAt: justStale })
      .where(eq(financialProfiles.tenantId, tenantId!));
    await requestActionsRefresh(tenantId!);
    expect(await claimActionsRefresh(tenantId!)).toEqual({ actions: true, spendCuts: true });
  });
});

describe("refreshTenant", () => {
  it("runs each generator once, after the claim's transaction has let go of the row", async () => {
    if (skip()) return;
    await requestActionsRefresh(tenantId!);
    expect(await refreshTenant(tenantId!)).toBe(true);
    expect(generateInsights).toHaveBeenCalledTimes(1);
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
    expect(lockFreeWhenRun).toEqual([true, true]);
  });

  it("generates at most once when several runners race for the same request", async () => {
    if (skip()) return;
    await requestActionsRefresh(tenantId!);
    const results = await Promise.all(Array.from({ length: 4 }, () => refreshTenant(tenantId!)));
    expect(results.filter((r) => r !== null)).toEqual([true]);
    expect(generateInsights).toHaveBeenCalledTimes(1);
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
  });

  it("still runs the spend cuts when the actions run fails", async () => {
    if (skip()) return;
    await requestActionsRefresh(tenantId!);
    generateInsights.mockImplementationOnce(async () => {
      throw new Error("model down");
    });
    expect(await refreshTenant(tenantId!)).toBe(false);
    expect(generateSpendCuts).toHaveBeenCalledTimes(1);
  });
});

describe("refreshTenants", () => {
  // Their own tenants, so the batch runs over households this file owns.
  const ids: string[] = [];

  beforeAll(async () => {
    if (!dbAvailable) return;
    const rows = await db
      .insert(tenants)
      .values(Array.from({ length: 6 }, (_, i) => ({ name: `actions-refresh.test batch ${i}` })))
      .returning({ id: tenants.id });
    ids.push(...rows.map((r) => r.id));
  });

  afterAll(async () => {
    if (ids.length > 0) await db.delete(tenants).where(inArray(tenants.id, ids));
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    const stale = new Date(Date.now() - 2 * DAY);
    await db.delete(financialProfiles).where(inArray(financialProfiles.tenantId, ids));
    await db.insert(financialProfiles).values(
      ids.map((id) => ({
        tenantId: id,
        lastActionsGeneratedAt: stale,
        lastSpendCutsGeneratedAt: stale,
        actionsRefreshRequestedAt: new Date(),
      })),
    );
  });

  async function stillQueued(): Promise<number> {
    const rows = await db
      .select({ requested: financialProfiles.actionsRefreshRequestedAt })
      .from(financialProfiles)
      .where(inArray(financialProfiles.tenantId, ids));
    return rows.filter((r) => r.requested !== null).length;
  }

  it("refreshes every household, never more than 4 at once", async () => {
    if (skip()) return;
    let inFlight = 0;
    let peak = 0;
    duringInsights = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 50));
      inFlight--;
    };
    expect(await refreshTenants(ids, Infinity)).toEqual({ succeeded: 6, failed: 0, deferred: 0 });
    expect(generateInsights).toHaveBeenCalledTimes(6);
    expect(peak).toBe(4);
    expect(await stillQueued()).toBe(0);
  });

  it("claims nothing once the time budget is spent, and leaves the requests queued", async () => {
    if (skip()) return;
    expect(await refreshTenants(ids, Date.now() - 1)).toEqual({ succeeded: 0, failed: 0, deferred: 6 });
    expect(generateInsights).not.toHaveBeenCalled();
    expect(await stillQueued()).toBe(6);
  });

  it("finishes what it claimed when the budget runs out mid-run, and claims no more", async () => {
    if (skip()) return;
    duringInsights = () => new Promise((r) => setTimeout(r, 400));
    expect(await refreshTenants(ids, Date.now() + 150)).toEqual({ succeeded: 4, failed: 0, deferred: 2 });
    expect(generateInsights).toHaveBeenCalledTimes(4);
    expect(await stillQueued()).toBe(2);
  });
});
