/**
 * The Spending page hero (/spending-summary), /api/facts monthlyNetFlow and the
 * chat tool get_spending_summary must report the same net cash flow for the
 * same month. They used to differ: chat defaulted to the current partial month,
 * summed raw rows and kept excluded transactions.
 *
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test cash-flow-db
 *
 * If the DB is unreachable the DB tests self-skip (they do not fail).
 *
 * All data lives in a throwaway tenant this file creates in beforeAll and
 * deletes in afterAll. It never reads or writes any other tenant's rows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, tenants, plaidItems, accounts, categories, categoryGroups, transactions } from "@lasagna/core";
import { db } from "../db.js";
import { computeCashFlow, lastFullMonthWindow } from "../cash-flow.js";
import { computeMonthlyNetFlow } from "../facts.js";
import { createSpendingTools } from "../../agent/tools/spending.js";
import { transactionRoutes } from "../../routes/transactions.js";
import type { AuthEnv } from "../../middleware/auth.js";

// Last full month, mid-month at noon UTC so no timezone moves a row out of it.
const win = lastFullMonthWindow();
const y = win.start.getUTCFullYear();
const m = win.start.getUTCMonth();
const TXN_DATE = new Date(Date.UTC(y, m, 15, 12, 0, 0));
const pad = (n: number) => String(n).padStart(2, "0");
// The exact strings the Spending page sends for its default month.
const PAGE_START = `${y}-${pad(m + 1)}-01`;
const PAGE_END = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}T23:59:59`;

// Salary -5000 → income 5000. Groceries 1200. Electronics 100 - 300 refunded
// past zero → -200, money back that reduces spending (owner decision
// 2026-11-24). Transfer 2000 out → neither. Excluded rows and the excluded
// account add nothing. Spending = 1200 - 200 = 1000, net = 5000 - 1000 = 4000.
const EXPECTED = { income: 5000, spending: 1000, net: 4000 };

let tenantId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "cash-flow.test" }).returning({ id: tenants.id });
    const tid = t.id;
    tenantId = tid;
    const [item] = await db
      .insert(plaidItems)
      .values({ tenantId: tid, accessToken: "test-not-a-real-token" })
      .returning({ id: plaidItems.id });
    const [checking, hidden] = await db
      .insert(accounts)
      .values([
        { tenantId: tid, plaidItemId: item.id, plaidAccountId: "t-checking", name: "Checking", type: "depository" },
        { tenantId: tid, plaidItemId: item.id, plaidAccountId: "t-hidden", name: "Hidden", type: "depository", excludeTransactions: true },
      ])
      .returning({ id: accounts.id });
    const group = async (name: string, type: "income" | "expense" | "transfer") =>
      (await db.insert(categoryGroups).values({ tenantId: tid, name, type }).returning({ id: categoryGroups.id }))[0].id;
    const category = async (groupId: string, name: string) =>
      (await db.insert(categories).values({ tenantId: tid, groupId, name }).returning({ id: categories.id }))[0].id;
    const salary = await category(await group("Income", "income"), "Salary");
    const expenses = await group("Expenses", "expense");
    const groceries = await category(expenses, "Groceries");
    const electronics = await category(expenses, "Electronics");
    const transfer = await category(await group("Transfers", "transfer"), "Transfer");

    const txn = (categoryId: string, name: string, amount: string, extra: Record<string, unknown> = {}) => ({
      tenantId: tid,
      accountId: checking.id,
      categoryId,
      date: TXN_DATE,
      name,
      merchantName: name,
      amount,
      ...extra,
    });
    await db.insert(transactions).values([
      txn(salary, "Paycheck", "-5000.00"),
      txn(groceries, "Grocer", "1200.00"),
      txn(electronics, "Headphones", "100.00"),
      txn(electronics, "Headphones refund", "-300.00"),
      txn(transfer, "To savings", "2000.00"),
      txn(groceries, "Excluded grocer", "999.00", { excludedAt: new Date() }),
      txn(groceries, "Hidden grocer", "777.00", { accountId: hidden.id }),
    ]);
    dbAvailable = true;
  } catch {
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
  await db.delete(tenants).where(eq(tenants.id, tid)).catch(() => {});
});

describe("one monthly net cash flow", () => {
  it("route, computeCashFlow, facts and the chat tool agree on the last full month", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const app = new Hono<AuthEnv>();
    app.use("*", async (c, next) => {
      c.set("session", { userId: "user-1", tenantId: tenantId!, role: "owner", isDemo: false, isAdmin: false } as any);
      await next();
    });
    app.route("/", transactionRoutes);
    const route = await (
      await app.request(`/spending-summary?startDate=${PAGE_START}&endDate=${encodeURIComponent(PAGE_END)}`)
    ).json();

    const flow = await computeCashFlow(tenantId!, win.start, win.end);
    const facts = await computeMonthlyNetFlow(tenantId!);
    const chat: any = await createSpendingTools(tenantId!).get_spending_summary.execute!(
      {},
      { toolCallId: "t", messages: [] },
    );

    expect({ income: flow.income, spending: flow.spending, net: flow.net }).toEqual(EXPECTED);
    expect(route.netCashFlow).toBe(EXPECTED.net);
    expect(route.totalIncome).toBe(EXPECTED.income);
    expect(route.totalSpending).toBe(EXPECTED.spending);
    expect({ income: facts.income, spending: facts.spending, net: facts.net }).toEqual(EXPECTED);
    expect(facts.window.label).toBe(win.label);
    expect({ income: chat.income, spending: chat.spending, netCashFlow: chat.netCashFlow }).toEqual({
      income: EXPECTED.income,
      spending: EXPECTED.spending,
      netCashFlow: EXPECTED.net,
    });
    expect(chat.monthLabel).toBe(win.label);
    expect(chat.month).toBe(`${y}-${pad(m + 1)}`);
    // Signed parts that sum to spending: the money-back category is negative and last.
    expect(chat.categories).toEqual([
      { category: "Groceries", total: 1200, transactionCount: 1 },
      { category: "Electronics", total: -200, transactionCount: 2 },
    ]);
    expect(chat.topMerchants.map((r: { merchant: string }) => r.merchant)).not.toContain("Excluded grocer");
  });
});
