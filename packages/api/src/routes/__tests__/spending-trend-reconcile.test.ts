/**
 * Reconciliation guard: GET /monthly-trend and GET /spending-summary must
 * report the same spending for the same window.
 *
 * /spending-summary has always summed PER CATEGORY (GROUP BY category) before
 * classifying, so a refund cancels inside its own category. /monthly-trend used
 * to sum raw transaction ROWS, so a refund was skipped instead of cancelling and
 * the same month reported two different totals. The fix is the GROUP BY in the
 * /monthly-trend query. These tests fail if that grouping is reverted to per-row
 * summation: the trend would report 880.00 where the summary reports 750.00.
 *
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5432/lasagna \
 *     pnpm -F @lasagna/api test spending-trend-reconcile
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
import { Hono } from "hono";
import { eq, tenants, plaidItems, accounts, categories, categoryGroups, transactions } from "@lasagna/core";
import { db } from "../../lib/db.js";
import { transactionRoutes } from "../transactions.js";
import type { AuthEnv } from "../../middleware/auth.js";

// ── The window under test ─────────────────────────────────────────────────────
// Last month: safely inside /monthly-trend's default 13-month window and fully
// in the past. Fixture rows sit mid-month at noon UTC so to_char() buckets them
// into PERIOD under any plausible DB session timezone.
const nowRef = new Date();
const target = new Date(nowRef.getFullYear(), nowRef.getMonth() - 1, 1);
const PERIOD = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
const TXN_DATE = new Date(Date.UTC(target.getFullYear(), target.getMonth(), 15, 12, 0, 0));
const START = new Date(Date.UTC(target.getFullYear(), target.getMonth(), 1, 0, 0, 0)).toISOString();
const END = new Date(Date.UTC(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59)).toISOString();

// ── Fixture arithmetic ────────────────────────────────────────────────────────
// Groceries  500.00                   → net  500.00  (no refund)
// Dining     300.00 + (-50.00)        → net  250.00  (partly refunded)
// Electronics 80.00 + (-200.45)       → net -120.45  (refunded past zero)
// Salary            (-4000.00)        → income 4000.00
//
// Netting per category: 500.00 + 250.00 = 750.00, Electronics counts as neither
// spending nor income. Summing rows instead skips the two negatives and yields
// 500.00 + 300.00 + 80.00 = 880.00 — the disagreement this guards against.
const EXPECTED_SPENDING = 750;
const EXPECTED_INCOME = 4000;
const REFUNDED_CATEGORY = "Electronics (reconcile.test)";

function makeApp(tenantId: string) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("session", {
      tenantId,
      userId: "test-user-id",
      isDemo: false,
      isAdmin: false,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    } as any);
    await next();
  });
  app.route("/", transactionRoutes);
  return app;
}

let tenantId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "spending-trend-reconcile.test" })
      .returning({ id: tenants.id });
    const tid = tenant.id;
    tenantId = tid;

    const [item] = await db
      .insert(plaidItems)
      .values({ tenantId: tid, accessToken: "test-not-a-real-token" })
      .returning({ id: plaidItems.id });
    const [account] = await db
      .insert(accounts)
      .values({
        tenantId: tid,
        plaidItemId: item.id,
        plaidAccountId: `test-reconcile-${tid}`,
        name: "Test Checking (reconcile.test)",
        type: "depository",
      })
      .returning({ id: accounts.id });

    const group = async (name: string, type: "income" | "expense") =>
      (
        await db
          .insert(categoryGroups)
          .values({ tenantId: tid, name, type })
          .returning({ id: categoryGroups.id })
      )[0].id;
    const expenseGroup = await group("Test Expenses (reconcile.test)", "expense");
    const incomeGroup = await group("Test Income (reconcile.test)", "income");

    // systemKey stays null — the (tenantId, systemKey) unique index tolerates it
    // and nothing here needs to resolve by key.
    const category = async (groupId: string, name: string) =>
      (
        await db
          .insert(categories)
          .values({ tenantId: tid, groupId, name })
          .returning({ id: categories.id })
      )[0].id;
    const groceries = await category(expenseGroup, "Groceries (reconcile.test)");
    const dining = await category(expenseGroup, "Dining (reconcile.test)");
    const electronics = await category(expenseGroup, REFUNDED_CATEGORY);
    const salary = await category(incomeGroup, "Salary (reconcile.test)");

    const txn = (categoryId: string, name: string, amount: string) => ({
      tenantId: tid,
      accountId: account.id,
      categoryId,
      date: TXN_DATE,
      name,
      amount,
    });
    await db.insert(transactions).values([
      txn(groceries, "Grocery run", "500.00"),
      txn(dining, "Dinner", "300.00"),
      txn(dining, "Dinner refund", "-50.00"),
      txn(electronics, "Headphones", "80.00"),
      txn(electronics, "Headphones returned", "-200.45"),
      txn(salary, "Paycheck", "-4000.00"),
    ]);

    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  // Delete only what this file created, innermost FK first.
  if (!tenantId) return;
  const tid = tenantId;
  await db.delete(transactions).where(eq(transactions.tenantId, tid)).catch(() => {});
  await db.delete(categories).where(eq(categories.tenantId, tid)).catch(() => {});
  await db.delete(categoryGroups).where(eq(categoryGroups.tenantId, tid)).catch(() => {});
  await db.delete(accounts).where(eq(accounts.tenantId, tid)).catch(() => {});
  await db.delete(plaidItems).where(eq(plaidItems.tenantId, tid)).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, tid)).catch(() => {});
});

async function fetchBoth() {
  const app = makeApp(tenantId!);
  const trendRes = await app.request("/monthly-trend?granularity=month&limit=13");
  const summaryRes = await app.request(
    `/spending-summary?startDate=${encodeURIComponent(START)}&endDate=${encodeURIComponent(END)}`,
  );
  expect(trendRes.status).toBe(200);
  expect(summaryRes.status).toBe(200);
  const trendBody = await trendRes.json();
  const summary = await summaryRes.json();
  const period = trendBody.periods.find((p: any) => p.period === PERIOD);
  expect(period, `no ${PERIOD} bucket in /monthly-trend`).toBeTruthy();
  return { period, summary };
}

describe("/monthly-trend and /spending-summary reconcile", () => {
  it("agree on spending for a month whose categories contain refunds", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const { period, summary } = await fetchBoth();
    // The reconciliation itself. Per-row summation makes this 880 vs 750.
    expect(period.expenses).toBe(summary.totalSpending);
    // Pin the value too, so making both endpoints wrong the same way still fails.
    expect(period.expenses).toBe(EXPECTED_SPENDING);
    expect(summary.totalSpending).toBe(EXPECTED_SPENDING);
  });

  it("agree on income for that month", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const { period, summary } = await fetchBoth();
    expect(period.income).toBe(summary.totalIncome);
    expect(period.income).toBe(EXPECTED_INCOME);
  });

  it("excludes a category refunded past zero from both the total and the breakdown", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const { summary } = await fetchBoth();
    expect(summary.categories.map((cat: any) => cat.name)).not.toContain(REFUNDED_CATEGORY);
    // The rows listed under the hero have to add up to the hero.
    const breakdown = summary.categories
      .filter((cat: any) => cat.groupType !== "income" && cat.groupType !== "transfer")
      .reduce((sum: number, cat: any) => sum + cat.total, 0);
    expect(Math.round(breakdown * 100) / 100).toBe(summary.totalSpending);
  });
});
