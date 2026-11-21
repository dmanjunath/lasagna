/**
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test cron-due-db
 *
 * If the DB is unreachable the tests self-skip (they do not fail).
 *
 * All data lives in a throwaway tenant this file creates in beforeAll and
 * deletes in afterAll. The due query reads every tenant, but the assertions
 * look only at this one, and nothing is written outside it. Nothing generates.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, tenants, users, plaidItems, accounts, financialProfiles } from "@lasagna/core";
import { db } from "../db.js";

vi.mock("../insights-engine.js", () => ({ generateInsights: vi.fn() }));
vi.mock("../spend-cuts.js", () => ({ generateSpendCuts: vi.fn() }));
vi.mock("../sync.js", () => ({ syncItem: vi.fn() }));
vi.mock("../billing.js", () => ({ resolveTenantPlan: async () => "free" }));
vi.mock("../value-estimate.js", () => ({ refreshValueEstimates: vi.fn() }));

import { tenantsWorthGenerating } from "../cron.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let tenantId: string | null = null;
let userId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "cron-due.test" }).returning({ id: tenants.id });
    tenantId = t.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `cron-due-${Date.now()}@example.com` })
      .returning({ id: users.id });
    userId = u.id;
    const [item] = await db
      .insert(plaidItems)
      .values({ tenantId, accessToken: "test-not-a-real-token" })
      .returning({ id: plaidItems.id });
    await db
      .insert(accounts)
      .values({ tenantId, plaidItemId: item.id, plaidAccountId: "t-checking", name: "Checking", type: "depository" });
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (tenantId) {
    await db.delete(plaidItems).where(eq(plaidItems.tenantId, tenantId)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

/** Whether a run at `runAt` picks this household up, given its last run and sign-in. */
async function dueAt(runAt: Date, generatedAt: Date, lastLoginAt: Date): Promise<boolean> {
  await db.update(users).set({ lastLoginAt }).where(eq(users.id, userId!));
  await db
    .insert(financialProfiles)
    .values({ tenantId: tenantId!, lastActionsGeneratedAt: generatedAt })
    .onConflictDoUpdate({ target: financialProfiles.tenantId, set: { lastActionsGeneratedAt: generatedAt } });
  const rows = await tenantsWorthGenerating(runAt);
  return rows.some((r) => r.id === tenantId);
}

function skip() {
  if (!dbAvailable) console.warn("SKIP: no DB at DATABASE_URL");
  return !dbAvailable;
}

describe("the daily run's due check", () => {
  // Day 2's 17:30 run. Yesterday's run stamped the household at 17:31, a
  // minute after it started.
  const day2Run = new Date();
  const day1Stamp = new Date(day2Run.getTime() - DAY + MIN);

  it("refreshes an active household every day, not every other day", async () => {
    if (skip()) return;
    const signedInToday = new Date(day2Run.getTime() - 2 * HOUR);
    expect(await dueAt(day2Run, day1Stamp, signedInToday)).toBe(true);
  });

  it("does not refresh it twice in one run", async () => {
    if (skip()) return;
    const signedInToday = new Date(day2Run.getTime() - 2 * HOUR);
    expect(await dueAt(day2Run, new Date(day2Run.getTime() - 10 * MIN), signedInToday)).toBe(false);
  });

  it("refreshes an idle household every 3 days, not every 4", async () => {
    if (skip()) return;
    const signedIn10DaysAgo = new Date(day2Run.getTime() - 10 * DAY);
    // Stamped by the run 3 days before, at 17:31.
    expect(await dueAt(day2Run, new Date(day2Run.getTime() - 3 * DAY + MIN), signedIn10DaysAgo)).toBe(true);
    // Stamped by the run 2 days before: not due yet.
    expect(await dueAt(day2Run, new Date(day2Run.getTime() - 2 * DAY + MIN), signedIn10DaysAgo)).toBe(false);
  });
});
