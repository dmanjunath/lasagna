/**
 * The universal transaction filter, end to end through the routes: every
 * dimension narrows POST /query, and the spending endpoints read the same
 * filter so their totals agree with the query's for the same scope.
 *
 * Requires a running Postgres reachable via DATABASE_URL, e.g.
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test txn-filters-db
 * Self-skips when the DB is unreachable. Uses a throwaway tenant with
 * synthetic rows only, deleted in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, tenants, plaidItems, accounts, categories, categoryGroups, transactions, recurringTransactions } from "@lasagna/core";
import { db } from "../../lib/db.js";
import { transactionRoutes } from "../transactions.js";
import type { AuthEnv } from "../../middleware/auth.js";

// Last month, mid-month at noon UTC, inside /monthly-trend's default window.
const nowRef = new Date();
const target = new Date(nowRef.getFullYear(), nowRef.getMonth() - 1, 1);
const PERIOD = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
const DAY = (d: number) => new Date(Date.UTC(target.getFullYear(), target.getMonth(), d, 12));
const START = new Date(Date.UTC(target.getFullYear(), target.getMonth(), 1)).toISOString();
const END = new Date(Date.UTC(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59)).toISOString();

let tenantId: string | null = null;
let dbAvailable = false;
const ids: Record<string, string> = {};

function makeApp(tid: string) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("session", { tenantId: tid, userId: "test-user-id", isDemo: false, isAdmin: false } as any);
    await next();
  });
  app.route("/", transactionRoutes);
  return app;
}

async function query(filters: Record<string, unknown>) {
  const res = await makeApp(tenantId!).request("/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filters: { startDate: START, endDate: END, ...filters }, limit: 100 }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  return { names: (body.transactions as any[]).map((t) => t.name).sort(), summary: body.summary };
}

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "txn-filters.test" }).returning({ id: tenants.id });
    const tid = t.id;
    tenantId = tid;
    const [item] = await db.insert(plaidItems).values({ tenantId: tid, accessToken: "test-not-a-real-token" }).returning({ id: plaidItems.id });
    const account = async (name: string) =>
      (await db.insert(accounts).values({ tenantId: tid, plaidItemId: item.id, plaidAccountId: `t-${name}-${tid}`, name, type: "depository" }).returning({ id: accounts.id }))[0].id;
    ids.checking = await account("Checking (filters.test)");
    ids.card = await account("Card (filters.test)");
    const group = async (name: string, type: "income" | "expense" | "transfer") =>
      (await db.insert(categoryGroups).values({ tenantId: tid, name, type }).returning({ id: categoryGroups.id }))[0].id;
    ids.food = await group("Food (filters.test)", "expense");
    ids.home = await group("Home (filters.test)", "expense");
    const income = await group("Income (filters.test)", "income");
    const xfer = await group("Transfers (filters.test)", "transfer");
    const category = async (groupId: string, name: string) =>
      (await db.insert(categories).values({ tenantId: tid, groupId, name }).returning({ id: categories.id }))[0].id;
    ids.groceries = await category(ids.food, "Groceries (filters.test)");
    ids.rent = await category(ids.home, "Rent (filters.test)");
    ids.salary = await category(income, "Salary (filters.test)");
    ids.transfer = await category(xfer, "To savings (filters.test)");

    const txn = (o: Record<string, unknown>) => ({ tenantId: tid, accountId: ids.checking, date: DAY(15), source: "plaid", ...o }) as any;
    await db.insert(transactions).values([
      txn({ name: "Grocer", merchantName: "Grocer", categoryId: ids.groceries, amount: "120.00" }),
      txn({ name: "Grocer pending", merchantName: "Grocer", categoryId: ids.groceries, amount: "30.00", pending: 1 }),
      txn({ name: "Corner Cafe", merchantName: "Corner Cafe", categoryId: ids.groceries, amount: "18.00", accountId: ids.card }),
      txn({ name: "Landlord", merchantName: "Landlord", categoryId: ids.rent, amount: "1500.00", notes: "November lease" }),
      txn({ name: "Paycheck", categoryId: ids.salary, amount: "-4000.00" }),
      txn({ name: "To savings", categoryId: ids.transfer, amount: "700.00" }),
      txn({ name: "From checking", categoryId: ids.transfer, amount: "-700.00" }),
      txn({ name: "Hidden", categoryId: ids.groceries, amount: "999.00", excludedAt: new Date() }),
      txn({ name: "Cash lunch", categoryId: ids.groceries, amount: "12.00", source: "seed" }),
      // A refund nets against its category: Groceries is 120+30+18+12-4 = 176.
      txn({ name: "Grocer refund", merchantName: "Grocer", categoryId: ids.groceries, amount: "-4.00" }),
    ]);
    await db.insert(recurringTransactions).values({
      tenantId: tid, accountId: ids.checking, name: "Landlord", merchantName: "Landlord", amount: "1500.00",
      frequency: "monthly", categoryId: ids.rent,
    } as any);
    dbAvailable = true;
  } catch (e) {
    console.warn("txn-filters-db setup failed:", e);
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (!tenantId) return;
  const tid = tenantId;
  await db.delete(recurringTransactions).where(eq(recurringTransactions.tenantId, tid)).catch(() => {});
  await db.delete(transactions).where(eq(transactions.tenantId, tid)).catch(() => {});
  await db.delete(categories).where(eq(categories.tenantId, tid)).catch(() => {});
  await db.delete(categoryGroups).where(eq(categoryGroups.tenantId, tid)).catch(() => {});
  await db.delete(accounts).where(eq(accounts.tenantId, tid)).catch(() => {});
  await db.delete(plaidItems).where(eq(plaidItems.tenantId, tid)).catch(() => {});
  await db.delete(tenants).where(eq(tenants.id, tid)).catch(() => {});
});

const skip = () => {
  if (!dbAvailable) console.warn("SKIP: no DB at DATABASE_URL");
  return !dbAvailable;
};

describe("POST /query, each dimension", () => {
  it("kind: in and out leave transfers out, transfer is only them", async () => {
    if (skip()) return;
    // One rule for rows and totals: Money in is the income categories, so a
    // refund is a Money out row that reduces its category.
    expect((await query({ kind: "in" })).names).toEqual(["Paycheck"]);
    expect((await query({ kind: "transfer" })).names).toEqual(["From checking", "To savings"]);
    const out = (await query({ kind: "out" })).names;
    expect(out).not.toContain("To savings");
    expect(out).toContain("Landlord");
    expect(out).toContain("Grocer refund");
  });
  it("direction still works, as the old name for kind", async () => {
    if (skip()) return;
    expect((await query({ direction: "credit" })).names).toEqual(["Paycheck"]);
    expect((await query({ direction: "debit" })).names).toEqual((await query({ kind: "out" })).names);
  });
  it("merchants (multi) and categoryGroups (multi)", async () => {
    if (skip()) return;
    expect((await query({ merchants: ["Corner Cafe", "Landlord"] })).names).toEqual(["Corner Cafe", "Landlord"]);
    expect((await query({ categoryGroups: [ids.home] })).names).toEqual(["Landlord"]);
  });
  it("status: pending, excluded, recurring, source", async () => {
    if (skip()) return;
    expect((await query({ pending: true })).names).toEqual(["Grocer pending"]);
    expect((await query({ excluded: true })).names).toEqual(["Hidden"]);
    expect((await query({ recurring: true })).names).toEqual(["Landlord"]);
    expect((await query({ source: "manual" })).names).toEqual(["Cash lunch"]);
    // A refund is a Money out row (it reduces Groceries), so it shows here too.
    expect((await query({ source: "bank", excluded: false, recurring: false, pending: false, kind: "out" })).names)
      .toEqual(["Corner Cafe", "Grocer", "Grocer refund"]);
  });
  it("search also matches notes and the category name", async () => {
    if (skip()) return;
    expect((await query({ search: "lease" })).names).toEqual(["Landlord"]);
    expect((await query({ search: "Salary (filters" })).names).toEqual(["Paycheck"]);
  });
});

describe("spending endpoints read the same filter", () => {
  async function spendingTotal(qs: string) {
    const res = await makeApp(tenantId!).request(`/spending-summary?startDate=${encodeURIComponent(START)}&endDate=${encodeURIComponent(END)}${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()).totalSpending as number;
  }
  async function trendExpenses(qs: string) {
    const res = await makeApp(tenantId!).request(`/monthly-trend?granularity=month&limit=13${qs}`);
    expect(res.status).toBe(200);
    return (await res.json()).periods.find((p: any) => p.period === PERIOD)?.expenses as number;
  }

  it.each([
    ["no filter", {}, ""],
    ["one account", { accountIds: ["CARD"] }, "&accountIds=CARD"],
    ["a merchant", { merchants: ["Grocer"] }, "&merchant=Grocer"],
    ["an amount range", { amountMin: 15, amountMax: 200 }, "&amountMin=15&amountMax=200"],
    ["bank, not pending", { source: "bank", pending: false }, "&source=bank&pending=false"],
    ["a category group", { categoryGroups: ["FOOD"] }, "&categoryGroups=FOOD"],
  ])("query, summary and trend agree on spending: %s", async (_label, filters, qs) => {
    if (skip()) return;
    const sub = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(sub) : v === "CARD" ? ids.card : v === "FOOD" ? ids.food : v;
    const f = Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, sub(v)]));
    const s = qs.replace("CARD", ids.card).replace("FOOD", ids.food);
    const { summary } = await query(f);
    // Exactly equal, not close: one number everywhere.
    expect(await spendingTotal(s)).toBe(summary.totalSpent);
    expect(await trendExpenses(s)).toBe(summary.totalSpent);
    expect(summary.totalDebits).toBe(summary.totalSpent);
    expect(summary.totalCredits).toBe(summary.totalIncome);
  });
  it("pins the unfiltered figure (transfers, income and excluded rows count nowhere)", async () => {
    if (skip()) return;
    expect(await spendingTotal("")).toBe(120 + 30 + 18 + 1500 + 12 - 4);
  });
  it("a refund nets against its category in /query too", async () => {
    if (skip()) return;
    const { summary } = await query({ categories: [ids.groceries] });
    expect(summary.totalSpent).toBe(176);
    expect(summary.totalDebits).toBe(176);
    // The refund is not money in: it cancelled against Groceries.
    expect(summary.totalCredits).toBe(0);
    const res = await makeApp(tenantId!).request(`/spending-summary?startDate=${encodeURIComponent(START)}&endDate=${encodeURIComponent(END)}&categories=${ids.groceries}`);
    expect((await res.json()).totalSpending).toBe(176);
  });
  it("income agrees between /query and /spending-summary", async () => {
    if (skip()) return;
    const res = await makeApp(tenantId!).request(`/spending-summary?startDate=${encodeURIComponent(START)}&endDate=${encodeURIComponent(END)}`);
    const body = await res.json();
    const { summary } = await query({});
    expect(summary.totalIncome).toBe(body.totalIncome);
    expect(summary.totalIncome).toBe(4000);
  });
});

describe("GET /merchants for the picker", () => {
  it("returns counts, narrows by q, and takes the filter scope", async () => {
    if (skip()) return;
    const app = makeApp(tenantId!);
    const all = await (await app.request("/merchants")).json();
    expect(all.counts.find((m: any) => m.name === "Grocer").count).toBe(3);
    expect(all.merchants).toContain("Landlord");
    const q = await (await app.request("/merchants?q=cafe")).json();
    expect(q.merchants).toEqual(["Corner Cafe"]);
    const scoped = await (await app.request(`/merchants?accountIds=${ids.card}`)).json();
    expect(scoped.merchants).toEqual(["Corner Cafe"]);
    // A merchant filter does not narrow the picker to what is already picked.
    const picked = await (await app.request("/merchants?merchant=Grocer")).json();
    expect(picked.merchants.length).toBeGreaterThan(1);
  });
});
