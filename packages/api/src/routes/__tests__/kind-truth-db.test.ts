/**
 * Money in and Money out: the rows a side lists and the total it shows follow
 * one rule, so a drill from Spending lands on the Spending figure and a list's
 * own rows add up to its tile.
 *
 * Reproduces the two mismatches a release gate found:
 * - a merchant credit ("TRAVEL CREDIT", +$296 back, category Other) listed
 *   under Money in but not counted in its total;
 * - a refund-heavy expense category (Other: a $29 charge, the $296 credit)
 *   left out of Spent but listed under Money out. Since 2026-11-24 refunds
 *   reduce Spent, so it counts -$267 and Spent equals the sum of the rows.
 *
 * Requires Postgres via DATABASE_URL, e.g.
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test kind-truth-db
 * Self-skips when the DB is unreachable. Synthetic rows on a throwaway tenant.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, tenants, plaidItems, accounts, categories, categoryGroups, transactions } from "@lasagna/core";
import { db } from "../../lib/db.js";
import { transactionRoutes } from "../transactions.js";
import { cashFlowForFilter } from "../../lib/cash-flow.js";
import type { AuthEnv } from "../../middleware/auth.js";

const nowRef = new Date();
const target = new Date(nowRef.getFullYear(), nowRef.getMonth() - 1, 1);
const DAY = (d: number) => new Date(Date.UTC(target.getFullYear(), target.getMonth(), d, 12));
const START = new Date(Date.UTC(target.getFullYear(), target.getMonth(), 1)).toISOString();
const END = new Date(Date.UTC(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59)).toISOString();

let tenantId: string | null = null;
let dbAvailable = false;

function app(tid: string) {
  const a = new Hono<AuthEnv>();
  a.use("*", async (c, next) => {
    c.set("session", { tenantId: tid, userId: "test-user-id", isDemo: false, isAdmin: false } as any);
    await next();
  });
  a.route("/", transactionRoutes);
  return a;
}

async function query(filters: Record<string, unknown>) {
  const res = await app(tenantId!).request("/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ filters: { startDate: START, endDate: END, ...filters }, limit: 100 }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  return { rows: body.transactions as Array<{ name: string; amount: string }>, summary: body.summary };
}

async function spendingSummary() {
  const res = await app(tenantId!).request(`/spending-summary?startDate=${encodeURIComponent(START)}&endDate=${encodeURIComponent(END)}`);
  expect(res.status).toBe(200);
  return (await res.json()) as { totalSpending: number; totalIncome: number };
}

const sum = (rows: Array<{ amount: string }>) => Math.round(rows.reduce((s, r) => s + parseFloat(r.amount), 0) * 100) / 100;

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "kind-truth.test" }).returning({ id: tenants.id });
    const tid = t.id;
    tenantId = tid;
    const [item] = await db.insert(plaidItems).values({ tenantId: tid, accessToken: "test-not-a-real-token" }).returning({ id: plaidItems.id });
    const [acct] = await db.insert(accounts).values({ tenantId: tid, plaidItemId: item.id, plaidAccountId: `t-kind-${tid}`, name: "Card (kind.test)", type: "credit" }).returning({ id: accounts.id });
    const [checking] = await db.insert(accounts).values({ tenantId: tid, plaidItemId: item.id, plaidAccountId: `t-kind-chk-${tid}`, name: "Checking (kind.test)", type: "depository" }).returning({ id: accounts.id });
    const group = async (name: string, type: "income" | "expense" | "transfer") =>
      (await db.insert(categoryGroups).values({ tenantId: tid, name, type }).returning({ id: categoryGroups.id }))[0].id;
    const cat = async (groupId: string, name: string) =>
      (await db.insert(categories).values({ tenantId: tid, groupId, name }).returning({ id: categories.id }))[0].id;
    const income = await cat(await group("Income (kind.test)", "income"), "Salary (kind.test)");
    const spend = await group("Spending (kind.test)", "expense");
    const groceries = await cat(spend, "Groceries (kind.test)");
    const other = await cat(spend, "Other (kind.test)");
    const transfer = await cat(await group("Transfers (kind.test)", "transfer"), "Card payment (kind.test)");
    const row = (name: string, categoryId: string, amount: string) =>
      ({ tenantId: tid, accountId: acct.id, date: DAY(10), source: "plaid", name, merchantName: name, categoryId, amount }) as any;
    await db.insert(transactions).values([
      row("Paycheck", income, "-5000.00"),
      row("Grocer", groceries, "100.00"),
      row("Snack", other, "29.00"),
      row("TRAVEL CREDIT", other, "-296.00"),
      // A linked card payment: $500 out of checking, $500 arriving on the card.
      { ...row("CARD PAYMENT", transfer, "500.00"), accountId: checking.id },
      row("AUTOMATIC PAYMENT - THANK", transfer, "-500.00"),
    ]);
    dbAvailable = true;
  } catch (e) {
    console.warn("kind-truth-db setup failed:", e);
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

const skip = () => {
  if (!dbAvailable) console.warn("SKIP: no DB at DATABASE_URL");
  return !dbAvailable;
};

describe("Money in and Money out follow one rule", () => {
  it("Money in lists only income, and its rows add up to its total", async () => {
    if (skip()) return;
    const { rows, summary } = await query({ kind: "in" });
    expect(rows.map((r) => r.name)).toEqual(["Paycheck"]);
    expect(summary.totalCredits).toBe(-sum(rows));
    expect(summary.totalCredits).toBe((await spendingSummary()).totalIncome);
  });

  it("Money out equals Spent, and the refund stays visible as a Money out row", async () => {
    if (skip()) return;
    const { rows, summary } = await query({ kind: "out" });
    const spent = (await spendingSummary()).totalSpending;
    // Other nets -$267 (money back), which reduces Spent: 100 - 267 = -167.
    // Spent, the Money out tile and the sum of the Money out rows are one figure.
    expect(spent).toBe(-167);
    expect(summary.totalDebits).toBe(spent);
    expect(sum(rows)).toBe(spent);
    expect(rows.map((r) => r.name).sort()).toEqual(["Grocer", "Snack", "TRAVEL CREDIT"]);
  });

  it("Spent is one figure across /query, /spending-summary, /monthly-trend and cashFlowForFilter", async () => {
    if (skip()) return;
    const out = await query({ kind: "out" });
    const spent = (await spendingSummary()).totalSpending;
    const flow = await cashFlowForFilter(tenantId!, { startDate: new Date(START), endDate: new Date(END) });
    const period = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
    const res = await app(tenantId!).request(`/monthly-trend?granularity=month&limit=3`);
    expect(res.status).toBe(200);
    const trend = (await res.json()).periods.find((p: { period: string }) => p.period === period);
    for (const figure of [out.summary.totalDebits, flow.spending, trend.expenses, sum(out.rows)]) expect(figure).toBe(spent);
  });

  it("counts a linked transfer pair once, by its outflow", async () => {
    if (skip()) return;
    const { rows, summary } = await query({ kind: "transfer" });
    expect(rows).toHaveLength(2);
    expect(summary.totalTransferred).toBe(500);
  });

  it("all three sides together list every row exactly once", async () => {
    if (skip()) return;
    const all = (await query({})).rows.length;
    const inn = (await query({ kind: "in" })).rows.length;
    const out = (await query({ kind: "out" })).rows.length;
    const xfer = (await query({ kind: "transfer" })).rows.length;
    expect(inn + out + xfer).toBe(all);
  });
});
