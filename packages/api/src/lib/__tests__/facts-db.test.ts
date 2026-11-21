/**
 * Requires a running Postgres reachable via DATABASE_URL. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test facts-db
 *
 * If the DB is unreachable the DB tests self-skip (they do not fail).
 *
 * All data lives in a throwaway tenant this file creates in beforeAll and
 * deletes in afterAll. It never reads or writes any other tenant's rows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, tenants, plaidItems, accounts, balanceSnapshots } from "@lasagna/core";
import { db } from "../db.js";
import { computeAccountFacts, debtFactsFrom } from "../facts.js";
import { resolveDebtAccounts } from "../debt-accounts.js";
import type { AuthEnv } from "../../middleware/auth.js";
import { accountRoutes } from "../../routes/accounts.js";
import { factsRoutes } from "../../routes/facts.js";

let tenantId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  try {
    const [t] = await db.insert(tenants).values({ name: "facts.test" }).returning({ id: tenants.id });
    tenantId = t.id;
    const [item] = await db
      .insert(plaidItems)
      .values({ tenantId, accessToken: "test-not-a-real-token" })
      .returning({ id: plaidItems.id });
    const base = { tenantId, plaidItemId: item.id };
    const rows = await db
      .insert(accounts)
      .values([
        { ...base, plaidAccountId: "t-checking", name: "Checking", type: "depository" },
        // Reported with the wrong sign by its institution, so the user flipped it.
        { ...base, plaidAccountId: "t-brokerage", name: "Brokerage", type: "investment", invertBalance: true },
        { ...base, plaidAccountId: "t-house", name: "House", type: "real_estate" },
        // No rate and no statement data: off the payoff plan until a rate is added.
        { ...base, plaidAccountId: "t-card", name: "Card", type: "credit" },
        { ...base, plaidAccountId: "t-loan", name: "Car loan", type: "loan" },
        // Cleared every month by the user's own designation.
        { ...base, plaidAccountId: "t-transactor", name: "Travel card", type: "credit", paidInFullMonthly: true },
        // Rate on file, and reported as a negative balance so the user flipped it.
        { ...base, plaidAccountId: "t-rated", name: "Store card", type: "credit", apr: "24.99", invertBalance: true },
        // The user keeps these out of net worth.
        { ...base, plaidAccountId: "t-joint", name: "Joint savings", type: "depository", excludeFromNetWorth: true },
        { ...base, plaidAccountId: "t-old-loan", name: "Parent's loan", type: "loan", excludeFromNetWorth: true },
      ])
      .returning({ id: accounts.id, plaidAccountId: accounts.plaidAccountId });
    const id = (p: string) => rows.find((r) => r.plaidAccountId === p)!.id;
    const at = new Date("2026-10-01T12:00:00Z");
    await db.insert(balanceSnapshots).values([
      { tenantId, accountId: id("t-checking"), balance: "1000", snapshotAt: at },
      { tenantId, accountId: id("t-brokerage"), balance: "-5000", snapshotAt: at },
      { tenantId, accountId: id("t-house"), balance: "300000", snapshotAt: at },
      { tenantId, accountId: id("t-card"), balance: "200", snapshotAt: at },
      { tenantId, accountId: id("t-loan"), balance: "8000", snapshotAt: at },
      { tenantId, accountId: id("t-transactor"), balance: "1500", snapshotAt: at },
      { tenantId, accountId: id("t-rated"), balance: "-600", snapshotAt: at },
      { tenantId, accountId: id("t-joint"), balance: "9999", snapshotAt: at },
      { tenantId, accountId: id("t-old-loan"), balance: "4000", snapshotAt: at },
    ]);
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
});

describe("computeAccountFacts", () => {
  it("counts every account as connected and leaves the excluded ones out of net worth", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const facts = await computeAccountFacts(tenantId!);
    expect(facts.accountsConnected).toBe(9);
    expect(facts.accountsCounted).toBe(7);
    expect(facts.netWorth).toEqual({
      assets: 306000,
      debt: 10300,
      netWorth: 295700,
      byType: {
        cash: { total: 1000, count: 1 },
        investments: { total: 5000, count: 1 },
        realEstate: { total: 300000, count: 1 },
        alternative: { total: 0, count: 0 },
        creditCards: { total: 2300, count: 3 },
        loans: { total: 8000, count: 1 },
      },
    });
  });
});

const expectedDebtFacts = {
  totalDebt: 10300,
  debtOnPayoffPlan: {
    amount: 8600,
    notInPlan: {
      amount: 1700,
      count: 2,
      clearsMonthly: { amount: 1500, count: 1 },
      needsRate: { amount: 200, count: 1 },
    },
  },
};

describe("debtFactsFrom", () => {
  it("splits total debt into the payoff plan and what it leaves out", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const facts = await computeAccountFacts(tenantId!);
    const debts = await resolveDebtAccounts(tenantId!);
    expect(debtFactsFrom(facts.netWorth.debt, debts)).toEqual(expectedDebtFacts);
  });

  it("lists the same balances /debt sums, the inverted card included", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const debts = await resolveDebtAccounts(tenantId!);
    expect(debts.map((d) => d.name).sort()).toEqual(["Car loan", "Card", "Store card", "Travel card"]);
    expect(debts.find((d) => d.name === "Store card")!.balance).toBe(600);
    expect(debts.reduce((s, d) => s + d.balance, 0)).toBe(expectedDebtFacts.totalDebt);
  });
});

describe("GET /accounts/debts and GET /facts", () => {
  function app() {
    const a = new Hono<AuthEnv>();
    a.use("*", async (c, next) => {
      c.set("session", { userId: "user-1", tenantId: tenantId!, role: "owner", isDemo: false, isAdmin: false });
      await next();
    });
    a.route("/accounts", accountRoutes);
    a.route("/facts", factsRoutes);
    return a;
  }

  it("both return the canonical totalDebt and debtOnPayoffPlan", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const debtsRes = await (await app().request("/accounts/debts")).json();
    expect(debtsRes.totalDebt).toBe(expectedDebtFacts.totalDebt);
    expect(debtsRes.debtOnPayoffPlan).toEqual(expectedDebtFacts.debtOnPayoffPlan);
    expect(debtsRes.debts).toHaveLength(4);

    const factsRes = await (await app().request("/facts")).json();
    expect(factsRes.totalDebt).toBe(factsRes.netWorth.debt);
    expect(factsRes.totalDebt).toBe(expectedDebtFacts.totalDebt);
    expect(factsRes.debtOnPayoffPlan).toEqual(expectedDebtFacts.debtOnPayoffPlan);
  });
});
