/**
 * The Spending page's per-category "usual": /spending-summary on a one-month
 * window carries each spending category's median over the three complete
 * months before it, under the same filter, and nothing when the household has
 * less than three months of history.
 *
 * Requires a running Postgres reachable via DATABASE_URL, e.g.
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test category-usual-db
 * Self-skips when the DB is unreachable. Uses throwaway tenants with
 * synthetic rows only, deleted in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, tenants, plaidItems, accounts, categories, categoryGroups, transactions } from "@lasagna/core";
import { db } from "../../lib/db.js";
import { transactionRoutes } from "../transactions.js";
import type { AuthEnv } from "../../middleware/auth.js";

// The window is last month; its baseline the three months before it.
const nowRef = new Date();
const Y = nowRef.getUTCFullYear();
const M = nowRef.getUTCMonth() - 1;
const at = (monthOffset: number, day = 15) => new Date(Date.UTC(Y, M + monthOffset, day, 12));
const START = new Date(Date.UTC(Y, M, 1)).toISOString();
const END = new Date(Date.UTC(Y, M + 1, 0, 23, 59, 59)).toISOString();

const tenantIds: string[] = [];
let dbAvailable = false;
const ids: Record<string, string> = {};

function app(tid: string) {
  const a = new Hono<AuthEnv>();
  a.use("*", async (c, next) => {
    c.set("session", { tenantId: tid, userId: "test-user-id", isDemo: false, isAdmin: false } as any);
    await next();
  });
  a.route("/", transactionRoutes);
  return a;
}

async function summary(tid: string, extra = "") {
  const res = await app(tid).request(`/spending-summary?startDate=${encodeURIComponent(START)}&endDate=${encodeURIComponent(END)}${extra}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  return Object.fromEntries((body.categories as any[]).map((c) => [c.name, c.usual]));
}

async function makeTenant(name: string, rows: (ids: Record<string, string>) => Record<string, unknown>[]) {
  const [t] = await db.insert(tenants).values({ name }).returning({ id: tenants.id });
  tenantIds.push(t.id);
  const [item] = await db.insert(plaidItems).values({ tenantId: t.id, accessToken: "test-not-a-real-token" }).returning({ id: plaidItems.id });
  const acct = async (n: string) =>
    (await db.insert(accounts).values({ tenantId: t.id, plaidItemId: item.id, plaidAccountId: `u-${n}-${t.id}`, name: n, type: "credit" }).returning({ id: accounts.id }))[0].id;
  const local: Record<string, string> = { card: await acct("Card (usual.test)"), other: await acct("Other card (usual.test)") };
  const [g] = await db.insert(categoryGroups).values({ tenantId: t.id, name: "Food (usual.test)", type: "expense" }).returning({ id: categoryGroups.id });
  const cat = async (n: string) => (await db.insert(categories).values({ tenantId: t.id, groupId: g.id, name: n }).returning({ id: categories.id }))[0].id;
  local.groceries = await cat("Groceries");
  local.dining = await cat("Dining");
  await db.insert(transactions).values(
    rows(local).map((o) => ({ tenantId: t.id, accountId: local.card, source: "plaid", ...o }) as any),
  );
  return { id: t.id, local };
}

beforeAll(async () => {
  try {
    // Groceries on the main card: 100, 200, 250 in the three baseline months (median 200).
    // With the other card's 300 in the oldest month, all accounts read 400, 200, 250 (median 250).
    // Dining: one baseline month of three (the median of 50, 0, 0 is 0): no usual.
    const full = await makeTenant("usual.test full", (l) => [
      { name: "g-3", categoryId: l.groceries, amount: "100.00", date: at(-3) },
      { name: "g-2", categoryId: l.groceries, amount: "200.00", date: at(-2) },
      { name: "g-1", categoryId: l.groceries, amount: "250.00", date: at(-1) },
      { name: "g-3 other card", categoryId: l.groceries, amount: "300.00", date: at(-3), accountId: l.other },
      { name: "g0", categoryId: l.groceries, amount: "260.00", date: at(0) },
      { name: "d-2", categoryId: l.dining, amount: "50.00", date: at(-2) },
      { name: "d0", categoryId: l.dining, amount: "80.00", date: at(0) },
    ]);
    ids.full = full.id;
    ids.card = full.local.card;
    // Two months of history only.
    const young = await makeTenant("usual.test young", (l) => [
      { name: "g-1", categoryId: l.groceries, amount: "150.00", date: at(-1) },
      { name: "g0", categoryId: l.groceries, amount: "200.00", date: at(0) },
    ]);
    ids.young = young.id;
    dbAvailable = true;
  } catch (e) {
    console.warn("category-usual-db setup failed:", e);
  }
});

afterAll(async () => {
  for (const tid of tenantIds) {
    await db.delete(transactions).where(eq(transactions.tenantId, tid)).catch(() => {});
    await db.delete(categories).where(eq(categories.tenantId, tid)).catch(() => {});
    await db.delete(categoryGroups).where(eq(categoryGroups.tenantId, tid)).catch(() => {});
    await db.delete(accounts).where(eq(accounts.tenantId, tid)).catch(() => {});
    await db.delete(plaidItems).where(eq(plaidItems.tenantId, tid)).catch(() => {});
    await db.delete(tenants).where(eq(tenants.id, tid)).catch(() => {});
  }
});

const skip = () => {
  if (!dbAvailable) console.warn("SKIP: no DB at DATABASE_URL");
  return !dbAvailable;
};

describe("/spending-summary usual", () => {
  it("is the median of the three complete months before the window", async () => {
    if (skip()) return;
    const u = await summary(ids.full);
    expect(u.Groceries).toBe(250);
    expect(u.Dining).toBeNull(); // spent in one baseline month of three
  });

  it("follows the filter, so a category is compared with itself", async () => {
    if (skip()) return;
    // On the main card only, the baseline months are 100, 200, 250.
    const u = await summary(ids.full, `&accountIds=${ids.card}`);
    expect(u.Groceries).toBe(200);
  });

  it("says nothing without three complete months of history", async () => {
    if (skip()) return;
    const u = await summary(ids.young);
    expect(u.Groceries).toBeNull();
  });

  it("is only for a one-month window", async () => {
    if (skip()) return;
    const twoMonths = new Date(Date.UTC(Y, M - 1, 1)).toISOString();
    const res = await app(ids.full).request(`/spending-summary?startDate=${encodeURIComponent(twoMonths)}&endDate=${encodeURIComponent(END)}`);
    const body = await res.json();
    expect((body.categories as any[]).every((c) => c.usual === null)).toBe(true);
  });
});
