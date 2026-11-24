/**
 * Guard: money arriving on a credit card or loan to pay it off never counts as
 * income. Plaid labels the card side of a payment many ways (LOAN_PAYMENTS,
 * TRANSFER_IN, INCOME_SALARY on "AUTOMATIC PAYMENT - THANK YOU", or nothing),
 * so each realistic variant goes through the sync's categorize() and then the
 * three totals paths: cashFlowForFilter, POST /query and /spending-summary.
 *
 * Requires a running Postgres reachable via DATABASE_URL, e.g.
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test card-payment-income-db
 * Self-skips when the DB is unreachable. Uses a throwaway tenant with
 * synthetic rows only, deleted in afterAll.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// transaction-sync.ts imports plaid.ts at module level, which reads env vars.
vi.mock("../plaid.js", () => ({ plaidClient: {} }));

import { Hono } from "hono";
import { eq, tenants, plaidItems, accounts, categories, categoryGroups, transactions } from "@lasagna/core";
import { db } from "../db.js";
import { categorize } from "../transaction-sync.js";
import { loadTaxonomy } from "../taxonomy.js";
import { cashFlowForFilter } from "../cash-flow.js";
import { transactionRoutes } from "../../routes/transactions.js";
import type { AuthEnv } from "../../middleware/auth.js";

const DAY = (d: number) => new Date(Date.UTC(2026, 9, d, 12));
const START = new Date(Date.UTC(2026, 9, 1));
const END = new Date(Date.UTC(2026, 9, 31, 23, 59, 59));

// Real income (payroll into checking, a rental payout onto the card) and real spending net of a refund.
const INCOME = 5000 + 331;
const SPENDING = 200 - 50;

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

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "card-payment-income.test" }).returning({ id: tenants.id });
    const tid = t.id;
    tenantId = tid;
    const [item] = await db.insert(plaidItems).values({ tenantId: tid, accessToken: "test-not-a-real-token" }).returning({ id: plaidItems.id });
    const account = async (name: string, type: "depository" | "credit" | "loan") =>
      (await db.insert(accounts).values({ tenantId: tid, plaidItemId: item.id, plaidAccountId: `t-${name}-${tid}`, name, type }).returning({ id: accounts.id }))[0].id;
    const checking = await account("Checking (card-payment.test)", "depository");
    const card = await account("Card (card-payment.test)", "credit");
    const loan = await account("Car loan (card-payment.test)", "loan");

    const group = async (name: string, type: "income" | "expense" | "transfer") =>
      (await db.insert(categoryGroups).values({ tenantId: tid, name, type }).returning({ id: categoryGroups.id }))[0].id;
    const income = await group("Income (card-payment.test)", "income");
    const xfer = await group("Transfers (card-payment.test)", "transfer");
    const spend = await group("Shopping (card-payment.test)", "expense");
    const category = (groupId: string, name: string, systemKey: string) => db.insert(categories).values({ tenantId: tid, groupId, name, systemKey });
    await category(income, "Income", "income");
    await category(xfer, "Transfer", "transfer");
    await category(spend, "Shopping", "shopping");
    await category(spend, "Debt payment", "debt_payment");
    await category(spend, "Other", "other");

    const taxonomy = await loadTaxonomy(tid);
    const types: Record<string, string> = { [checking]: "depository", [card]: "credit", [loan]: "loan" };
    const row = (name: string, amount: string, accountId: string, plaid: { primary?: string; detailed?: string } | null) => {
      const { categoryId, categorySource } = categorize(taxonomy, [], { name, merchantName: null, amount, accountId, accountType: types[accountId] }, plaid);
      return { tenantId: tid, accountId, date: DAY(10), source: "plaid", name, amount, categoryId, categorySource } as any;
    };
    await db.insert(transactions).values([
      row("PAYROLL", "-5000.00", checking, { primary: "INCOME", detailed: "INCOME_SALARY" }),
      row("CHASE CREDIT CRD EPAY", "2840.15", checking, { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
      // The card side of payments, labeled every way Plaid does.
      row("AUTOMATIC PAYMENT - THANK", "-2840.15", card, { primary: "INCOME", detailed: "INCOME_SALARY" }),
      row("AUTOMATIC PAYMENT - THANK", "-512.60", card, { primary: "INCOME", detailed: "INCOME_CONTRACTOR" }),
      row("PAYMENT RECEIVED", "-500.00", card, { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
      row("Online Transfer from CHK", "-250.00", card, { primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" }),
      row("AUTOPAY 4417", "-120.00", card, null),
      row("MOBILE PYMT", "-80.00", card, { primary: "INCOME", detailed: "INCOME_OTHER" }),
      row("LOAN PAYMENT", "-410.00", loan, { primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CAR_PAYMENT" }),
      // Real money in on a card stays income.
      row("AIRBNB * HMTEST0002", "-331.00", card, { primary: "INCOME", detailed: "INCOME_RENTAL" }),
      // Spending on the card, and a refund of part of it.
      row("Store", "200.00", card, { primary: "GENERAL_MERCHANDISE" }),
      row("Store refund", "-50.00", card, { primary: "GENERAL_MERCHANDISE" }),
    ]);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (!tenantId) return;
  await db.delete(transactions).where(eq(transactions.tenantId, tenantId));
  await db.delete(categories).where(eq(categories.tenantId, tenantId));
  await db.delete(categoryGroups).where(eq(categoryGroups.tenantId, tenantId));
  await db.delete(accounts).where(eq(accounts.tenantId, tenantId));
  await db.delete(plaidItems).where(eq(plaidItems.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
});

const skip = () => {
  if (!dbAvailable) console.warn("SKIP: no DB at DATABASE_URL");
  return !dbAvailable;
};

describe("credit card and loan payments never count as income", () => {
  it("in the cash flow every page reads", async () => {
    if (skip()) return;
    const flow = await cashFlowForFilter(tenantId!, { startDate: START, endDate: END });
    expect(flow.income).toBe(INCOME);
    expect(flow.spending).toBe(SPENDING);
    const moneyIn = await cashFlowForFilter(tenantId!, { startDate: START, endDate: END, kind: "in" });
    expect(moneyIn.income).toBe(INCOME);
  });

  it("in POST /query's summary", async () => {
    if (skip()) return;
    const res = await app(tenantId!).request("/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filters: { startDate: START.toISOString(), endDate: END.toISOString() }, limit: 100 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).summary.totalIncome).toBe(INCOME);
  });

  it("in /spending-summary", async () => {
    if (skip()) return;
    const res = await app(tenantId!).request(`/spending-summary?startDate=${START.toISOString()}&endDate=${END.toISOString()}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalIncome).toBe(INCOME);
    expect(body.totalSpending ?? body.totalSpent).toBe(SPENDING);
  });
});
