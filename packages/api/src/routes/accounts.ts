import { Hono } from "hono";
import { eq, desc, accounts, balanceSnapshots } from "@lasagna/core";
import { db } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const accountRoutes = new Hono<AuthEnv>();
accountRoutes.use("*", requireAuth);

// List all accounts for the tenant
accountRoutes.get("/", async (c) => {
  const session = c.get("session");

  const result = await db.query.accounts.findMany({
    where: eq(accounts.tenantId, session.tenantId),
  });

  return c.json({ accounts: result });
});

// Get latest balances for all accounts
accountRoutes.get("/balances", async (c) => {
  const session = c.get("session");

  const accts = await db.query.accounts.findMany({
    where: eq(accounts.tenantId, session.tenantId),
  });

  const balances = await Promise.all(
    accts.map(async (acct) => {
      const latest = await db.query.balanceSnapshots.findFirst({
        where: eq(balanceSnapshots.accountId, acct.id),
        orderBy: [desc(balanceSnapshots.snapshotAt)],
      });
      return {
        accountId: acct.id,
        name: acct.name,
        type: acct.type,
        mask: acct.mask,
        balance: latest?.balance ?? null,
        available: latest?.available ?? null,
        currency: latest?.isoCurrencyCode ?? "USD",
        asOf: latest?.snapshotAt ?? null,
      };
    }),
  );

  return c.json({ balances });
});

// Get balance history for a single account
accountRoutes.get("/:id/history", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("id");

  const acct = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });
  if (!acct || acct.tenantId !== session.tenantId) {
    return c.json({ error: "Account not found" }, 404);
  }

  const snapshots = await db.query.balanceSnapshots.findMany({
    where: eq(balanceSnapshots.accountId, accountId),
    orderBy: [desc(balanceSnapshots.snapshotAt)],
  });

  return c.json({ account: acct, snapshots });
});
