/**
 * Money moved into the household's own savings or brokerage is saving, not
 * spending (audit W-2), and every "monthly spending" figure is one definition
 * (audit W-4): the Spending page month, the 3-month average the goals and the
 * journey price from, and the figure the retirement plan starts from.
 *
 * Requires a running Postgres reachable via DATABASE_URL, e.g.
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test savings-not-spending-db
 * Self-skips when the DB is unreachable. Uses a throwaway tenant with
 * synthetic rows only.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  eq, and, tenants, users, plaidItems, accounts, categories, categoryGroups, transactions,
  seedTaxonomyForTenant, reclassifySavingsAsTransfer,
} from "@lasagna/core";
import { db } from "../db.js";
import { computeCashFlow, lastFullMonthWindow } from "../cash-flow.js";
import { computeSpendingTotal } from "../spending.js";
import { readMonthlySpend } from "../monthly-spend.js";
import { resolveSimInputs } from "../../services/resolve-sim-inputs.js";

const now = new Date();
// Noon on the 15th of each of the last three full months.
const monthDate = (back: number) => new Date(now.getFullYear(), now.getMonth() - back, 15, 12);

let tenantId: string | null = null;
let userId: string | null = null;
let dbAvailable = false;

async function catId(tid: string, systemKey: string) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.tenantId, tid), eq(categories.systemKey, systemKey)));
  return row.id;
}

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "savings-not-spending.test" }).returning({ id: tenants.id });
    tenantId = t.id;
    const tid = t.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId: tid, email: `savings-not-spending-${tid}@example.test`, role: "owner" } as any)
      .returning({ id: users.id });
    userId = u.id;
    await seedTaxonomyForTenant(db, tid);
    const [item] = await db
      .insert(plaidItems)
      .values({ tenantId: tid, accessToken: "test-not-a-real-token" })
      .returning({ id: plaidItems.id });
    const [checking] = await db
      .insert(accounts)
      .values({ tenantId: tid, plaidItemId: item.id, plaidAccountId: "t-checking", name: "Checking", type: "depository" })
      .returning({ id: accounts.id });
    const groceries = await catId(tid, "groceries");
    const savings = await catId(tid, "savings_investment");
    const rows = [];
    // Groceries 900, 1200, 1500 (avg 1200). A 1,000 savings deposit every month.
    for (const [back, amount] of [[1, "900.00"], [2, "1200.00"], [3, "1500.00"]] as const) {
      rows.push(
        { tenantId: tid, accountId: checking.id, categoryId: groceries, date: monthDate(back), name: "Grocer", amount },
        { tenantId: tid, accountId: checking.id, categoryId: savings, date: monthDate(back), name: "Transfer to Savings", amount: "1000.00" },
      );
    }
    // A row the user hid from spending counts nowhere, in any window.
    rows.push({ tenantId: tid, accountId: checking.id, categoryId: groceries, date: monthDate(2), name: "Hidden grocer", amount: "3000.00", excludedAt: new Date() } as any);
    await db.insert(transactions).values(rows);
    dbAvailable = true;
  } catch (e) {
    console.warn("savings-not-spending-db setup failed:", e);
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (!tenantId) return;
  const tid = tenantId;
  await db.delete(transactions).where(eq(transactions.tenantId, tid)).catch(() => {});
  await db.delete(categories).where(eq(categories.tenantId, tid)).catch(() => {});
  await db.delete(categoryGroups).where(eq(categoryGroups.tenantId, tid)).catch(() => {});
  await db.delete(accounts).where(eq(accounts.tenantId, tid)).catch(() => {});
  await db.delete(plaidItems).where(eq(plaidItems.tenantId, tid)).catch(() => {});
  await db.delete(users).where(eq(users.tenantId, tid)).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, tid)).catch(() => {});
});

describe("savings transfers are not spending (W-2)", () => {
  it("the Spending month and the spending total leave out the savings deposit", async () => {
    if (!dbAvailable) return console.warn("SKIP: no DB at DATABASE_URL");
    const win = lastFullMonthWindow();
    const flow = await computeCashFlow(tenantId!, win.start, win.end);
    expect(flow.spending).toBe(900);
    expect(flow.categories.find((c) => c.systemKey === "savings_investment")?.groupType).toBe("transfer");
    expect(await computeSpendingTotal(tenantId!, win.start, win.end)).toBe(900);
  });
});

describe("one monthly spending figure (W-4)", () => {
  it("the 3-month average leaves out savings and the retirement plan starts from it", async () => {
    if (!dbAvailable) return console.warn("SKIP: no DB at DATABASE_URL");
    const { stableMonthlyExpenses } = await readMonthlySpend(tenantId!);
    expect(stableMonthlyExpenses).toBe(1200);
    const inputs = await resolveSimInputs(tenantId!, userId!);
    expect(inputs.monthlySpend).toBe(1200);
  });
});

describe("backfill: reclassifySavingsAsTransfer", () => {
  it("moves a tenant's Savings & Investment out of the expense group, once", async () => {
    if (!dbAvailable) return console.warn("SKIP: no DB at DATABASE_URL");
    const tid = tenantId!;
    // Put the tenant back on the old taxonomy: savings under Financial (expense).
    const [financial] = await db
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(and(eq(categoryGroups.tenantId, tid), eq(categoryGroups.systemKey, "financial")));
    await db
      .update(categories)
      .set({ groupId: financial.id })
      .where(and(eq(categories.tenantId, tid), eq(categories.systemKey, "savings_investment")));

    expect(await reclassifySavingsAsTransfer(db, { tenantId: tid, dryRun: true })).toEqual([tid]);
    expect(await reclassifySavingsAsTransfer(db, { tenantId: tid })).toEqual([tid]);
    expect(await reclassifySavingsAsTransfer(db, { tenantId: tid })).toEqual([]);

    const [row] = await db
      .select({ type: categoryGroups.type })
      .from(categories)
      .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(and(eq(categories.tenantId, tid), eq(categories.systemKey, "savings_investment")));
    expect(row.type).toBe("transfer");
  });
});
