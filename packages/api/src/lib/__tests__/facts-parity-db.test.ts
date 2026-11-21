/**
 * Parity guard: every fact a page states and the chat tool that quotes it must
 * return the same number for the same tenant. Each page source is called as the
 * page calls it, through the real Hono app with a minted session, and compared
 * with the chat tool's execute(). The definitions live in lib/facts.ts.
 *
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test facts-parity-db
 *
 * If the DB is unreachable the DB tests self-skip (they do not fail).
 *
 * All data is synthetic and lives in a throwaway tenant this file creates in
 * beforeAll and deletes in afterAll. It never reads or writes any other
 * tenant's rows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// plaid.ts and session.ts read these at import time (same as the other
// server.ts integration tests).
process.env.PLAID_CLIENT_ID ??= "test-plaid-client";
process.env.PLAID_SECRET ??= "test-plaid-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-0123456789ab";

import {
  eq,
  tenants,
  users,
  userProfiles,
  plaidItems,
  accounts,
  balanceSnapshots,
  categories,
  categoryGroups,
  transactions,
} from "@lasagna/core";
import { db } from "../db.js";
import { lastFullMonthWindow } from "../cash-flow.js";
import { createSessionToken } from "../session.js";
import { createFinancialTools } from "../../agent/tools/financial.js";
import { createSpendingTools } from "../../agent/tools/spending.js";
import { createSimulationTools } from "../../agent/tools/simulation.js";

let app: typeof import("../../server.js").app;
let tenantId: string | null = null;
let userId: string | null = null;
let token = "";
let dbAvailable = false;

// Last full month, mid-month at noon UTC so no timezone moves a row out of it.
const win = lastFullMonthWindow();
const y = win.start.getUTCFullYear();
const m = win.start.getUTCMonth();
const TXN_DATE = new Date(Date.UTC(y, m, 15, 12, 0, 0));
const pad = (n: number) => String(n).padStart(2, "0");
// The exact strings the Spending page sends for its default month.
const PAGE_START = `${y}-${pad(m + 1)}-01`;
const PAGE_END = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}T23:59:59`;

// Counted: checking 6000 + 401k 200000 = 206000 assets. Debt: revolving card
// 2400 (inverted from -2400) + clears-monthly card 1500 + needs-rate card 300 +
// loan 9000 = 13200. The excluded loan (4000) is in neither total.
const EXPECTED_NET_WORTH = { assets: 206000, debt: 13200, netWorth: 192800 };
const EXPECTED_DEBT = {
  totalDebt: 13200,
  debtOnPayoffPlan: {
    amount: 11400,
    notInPlan: {
      amount: 1800,
      count: 2,
      clearsMonthly: { amount: 1500, count: 1 },
      needsRate: { amount: 300, count: 1 },
    },
  },
};
// Paycheck 5000 in. Groceries 1200 less a 200 refund = 1000 spent. The 2000
// transfer is neither.
const EXPECTED_FLOW = { income: 5000, spending: 1000, net: 4000 };

const toolCtx = { toolCallId: "t", messages: [] };

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "facts-parity.test" }).returning({ id: tenants.id });
    const tid = t.id;
    tenantId = tid;
    const [u] = await db
      .insert(users)
      .values({ tenantId: tid, email: `facts-parity-${tid}@example.com`, role: "owner" })
      .returning({ id: users.id });
    userId = u.id;
    await db.insert(userProfiles).values({
      tenantId: tid,
      userId: u.id,
      dateOfBirth: new Date("1985-06-15T00:00:00Z"),
      annualIncome: "120000",
      retirementAge: 60,
      employerMatch: "4",
    });
    const [item] = await db
      .insert(plaidItems)
      .values({ tenantId: tid, accessToken: "test-not-a-real-token" })
      .returning({ id: plaidItems.id });
    const base = { tenantId: tid, plaidItemId: item.id };
    const rows = await db
      .insert(accounts)
      .values([
        { ...base, plaidAccountId: "p-checking", name: "Checking", type: "depository" },
        { ...base, plaidAccountId: "p-401k", name: "401k", type: "investment" },
        // Rate on file and carrying a balance. Reported negative, so the user flipped it.
        { ...base, plaidAccountId: "p-revolving", name: "Rewards card", type: "credit", apr: "22.99", invertBalance: true },
        // Cleared every month by the user's own designation.
        { ...base, plaidAccountId: "p-transactor", name: "Travel card", type: "credit", paidInFullMonthly: true },
        // No rate and no statement data: off the payoff plan until a rate is added.
        { ...base, plaidAccountId: "p-norate", name: "Store card", type: "credit" },
        { ...base, plaidAccountId: "p-loan", name: "Car loan", type: "loan", apr: "6.5" },
        // The user keeps this out of net worth.
        { ...base, plaidAccountId: "p-excluded", name: "Family loan", type: "loan", excludeFromNetWorth: true },
      ])
      .returning({ id: accounts.id, plaidAccountId: accounts.plaidAccountId });
    const id = (p: string) => rows.find((r) => r.plaidAccountId === p)!.id;
    const at = new Date(Date.now() - 60 * 60 * 1000);
    await db.insert(balanceSnapshots).values([
      { tenantId: tid, accountId: id("p-checking"), balance: "6000", snapshotAt: at },
      { tenantId: tid, accountId: id("p-401k"), balance: "200000", snapshotAt: at },
      { tenantId: tid, accountId: id("p-revolving"), balance: "-2400", snapshotAt: at },
      { tenantId: tid, accountId: id("p-transactor"), balance: "1500", snapshotAt: at },
      { tenantId: tid, accountId: id("p-norate"), balance: "300", snapshotAt: at },
      { tenantId: tid, accountId: id("p-loan"), balance: "9000", snapshotAt: at },
      { tenantId: tid, accountId: id("p-excluded"), balance: "4000", snapshotAt: at },
    ]);

    const group = async (name: string, type: "income" | "expense" | "transfer") =>
      (await db.insert(categoryGroups).values({ tenantId: tid, name, type }).returning({ id: categoryGroups.id }))[0].id;
    const category = async (groupId: string, name: string) =>
      (await db.insert(categories).values({ tenantId: tid, groupId, name }).returning({ id: categories.id }))[0].id;
    const salary = await category(await group("Income", "income"), "Salary");
    const groceries = await category(await group("Expenses", "expense"), "Groceries");
    const transfer = await category(await group("Transfers", "transfer"), "Transfer");
    const txn = (categoryId: string, name: string, amount: string) => ({
      tenantId: tid,
      accountId: id("p-checking"),
      categoryId,
      date: TXN_DATE,
      name,
      merchantName: name,
      amount,
    });
    await db.insert(transactions).values([
      txn(salary, "Paycheck", "-5000.00"),
      txn(groceries, "Grocer", "1200.00"),
      txn(groceries, "Grocer refund", "-200.00"),
      txn(transfer, "To savings", "2000.00"),
    ]);

    token = await createSessionToken({ userId: u.id, tenantId: tid, role: "owner", isDemo: false, isAdmin: false });
    ({ app } = await import("../../server.js"));
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
  await db.delete(balanceSnapshots).where(eq(balanceSnapshots.tenantId, tid)).catch(() => {});
  await db.delete(accounts).where(eq(accounts.tenantId, tid)).catch(() => {});
  await db.delete(plaidItems).where(eq(plaidItems.tenantId, tid)).catch(() => {});
  await db.delete(userProfiles).where(eq(userProfiles.tenantId, tid)).catch(() => {});
  await db.delete(users).where(eq(users.tenantId, tid)).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, tid)).catch(() => {});
});

async function api(path: string, init: RequestInit = {}) {
  const res = await app.request(`http://localhost${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
  });
  expect(res.status, `${init.method ?? "GET"} ${path}`).toBe(200);
  return res.json() as Promise<any>;
}

function skip() {
  if (dbAvailable) return false;
  console.warn("SKIP: no DB at DATABASE_URL");
  return true;
}

describe("one value per concept: page source == chat tool", () => {
  it("accountsCounted, accountsConnected and netWorth: /api/facts == get_net_worth", async () => {
    if (skip()) return;
    const facts = await api("/api/facts");
    const chat: any = await createFinancialTools(tenantId!, userId!).get_net_worth.execute!({ timeframe: "3m" }, toolCtx);

    expect(facts.accountsConnected).toBe(7);
    expect(facts.accountsCounted).toBe(6);
    expect({ assets: facts.netWorth.assets, debt: facts.netWorth.debt, netWorth: facts.netWorth.netWorth }).toEqual(
      EXPECTED_NET_WORTH,
    );

    expect(chat.accountsConnected).toBe(facts.accountsConnected);
    expect(chat.accountsCounted).toBe(facts.accountsCounted);
    expect(chat.netWorth).toBe(facts.netWorth.netWorth);
    expect(chat.assets).toBe(facts.netWorth.assets);
    expect(chat.debt).toBe(facts.netWorth.debt);
    expect(chat.byType).toEqual(facts.netWorth.byType);
  });

  it("totalDebt and debtOnPayoffPlan: /api/accounts/debts == /api/facts == get_debts", async () => {
    if (skip()) return;
    const debtsPage = await api("/api/accounts/debts");
    const facts = await api("/api/facts");
    const chat: any = await createFinancialTools(tenantId!, userId!).get_debts.execute!({}, toolCtx);

    expect(debtsPage.totalDebt).toBe(EXPECTED_DEBT.totalDebt);
    expect(debtsPage.debtOnPayoffPlan).toEqual(EXPECTED_DEBT.debtOnPayoffPlan);

    expect(facts.totalDebt).toBe(debtsPage.totalDebt);
    expect(facts.totalDebt).toBe(facts.netWorth.debt);
    expect(facts.debtOnPayoffPlan).toEqual(debtsPage.debtOnPayoffPlan);

    expect(chat.totalDebt).toBe(debtsPage.totalDebt);
    expect(chat.debtOnPayoffPlan).toEqual(debtsPage.debtOnPayoffPlan);
    // The excluded loan is listed for chat, but flagged and in neither total.
    expect(chat.debts.find((d: { name: string }) => d.name === "Family loan").countedInNetWorth).toBe(false);
  });

  it("monthlyNetFlow: /api/transactions/spending-summary == get_spending_summary == /api/facts", async () => {
    if (skip()) return;
    const page = await api(
      `/api/transactions/spending-summary?startDate=${PAGE_START}&endDate=${encodeURIComponent(PAGE_END)}`,
    );
    const facts = await api("/api/facts");
    const chat: any = await createSpendingTools(tenantId!).get_spending_summary.execute!({}, toolCtx);

    expect({ income: page.totalIncome, spending: page.totalSpending, net: page.netCashFlow }).toEqual(EXPECTED_FLOW);

    expect({ income: chat.income, spending: chat.spending, net: chat.netCashFlow }).toEqual(EXPECTED_FLOW);
    expect(chat.monthLabel).toBe(win.label);

    expect({
      income: facts.monthlyNetFlow.income,
      spending: facts.monthlyNetFlow.spending,
      net: facts.monthlyNetFlow.net,
    }).toEqual(EXPECTED_FLOW);
    expect(facts.monthlyNetFlow.window.label).toBe(win.label);
  });

  it("retirementSuccess: POST /api/retirement/simulate {} == run_monte_carlo == /api/facts?include=retirement", async () => {
    if (skip()) return;
    const page = await api("/api/retirement/simulate", { method: "POST", body: "{}" });
    const facts = await api("/api/facts?include=retirement");
    const chat: any = await createSimulationTools(tenantId!, userId!).run_monte_carlo.execute!({}, toolCtx);

    // The page prints the engine's rate as a whole percent.
    const pagePercent = Math.round(page.successRate * 100);
    expect(pagePercent).toBeGreaterThanOrEqual(0);
    expect(pagePercent).toBeLessThanOrEqual(100);

    expect(chat.successRate).toBe(pagePercent);
    expect(facts.retirementSuccess.percent).toBe(pagePercent);
    expect(facts.retirementSuccess.method).toBe("monte_carlo");
  });
});
