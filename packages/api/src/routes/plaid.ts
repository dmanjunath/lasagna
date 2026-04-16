import { Hono } from "hono";
import { CountryCode, Products } from "plaid";
import { eq, desc, plaidItems, accounts, balanceSnapshots, encrypt } from "@lasagna/core";
import { db } from "../lib/db.js";
import { plaidClient } from "../lib/plaid.js";
import { env } from "../lib/env.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { syncItem } from "../lib/sync.js";
import { generateInsights } from "../lib/insights-engine.js";

export const plaidRoutes = new Hono<AuthEnv>();
plaidRoutes.use("*", requireAuth);

// Create a link token for Plaid Link
plaidRoutes.post("/link-token", async (c) => {
  const session = c.get("session");

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: session.userId },
    client_name: "Lasagna",
    products: [Products.Transactions, Products.Investments],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return c.json({ linkToken: response.data.link_token });
});

// Exchange public token for access token and store Plaid item
plaidRoutes.post("/exchange-token", async (c) => {
  const session = c.get("session");
  const { publicToken, institutionId, institutionName } = await c.req.json<{
    publicToken: string;
    institutionId?: string;
    institutionName?: string;
  }>();

  if (!publicToken) {
    return c.json({ error: "publicToken is required" }, 400);
  }

  const response = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });

  const encryptedToken = await encrypt(
    response.data.access_token,
    env.ENCRYPTION_KEY,
  );

  const [item] = await db
    .insert(plaidItems)
    .values({
      tenantId: session.tenantId,
      accessToken: encryptedToken,
      institutionId: institutionId ?? null,
      institutionName: institutionName ?? null,
    })
    .returning();

  // Sync accounts and balances immediately after linking
  syncItem(item.id)
    .then(() => generateInsights(session.tenantId))
    .catch(console.error);

  return c.json({ itemId: item.id });
});

// List linked Plaid items with accounts and balances
plaidRoutes.get("/items", async (c) => {
  const session = c.get("session");

  const items = await db.query.plaidItems.findMany({
    where: eq(plaidItems.tenantId, session.tenantId),
    columns: {
      id: true,
      institutionId: true,
      institutionName: true,
      status: true,
      lastSyncedAt: true,
    },
  });

  // Fetch accounts with latest balances for each item
  const itemsWithAccounts = await Promise.all(
    items.map(async (item) => {
      const accts = await db.query.accounts.findMany({
        where: eq(accounts.plaidItemId, item.id),
      });

      const accountsWithBalances = await Promise.all(
        accts.map(async (acct) => {
          const latest = await db.query.balanceSnapshots.findFirst({
            where: eq(balanceSnapshots.accountId, acct.id),
            orderBy: [desc(balanceSnapshots.snapshotAt)],
          });
          return {
            id: acct.id,
            name: acct.name,
            type: acct.type,
            subtype: acct.subtype,
            mask: acct.mask,
            balance: latest?.balance ?? null,
            currency: latest?.isoCurrencyCode ?? "USD",
          };
        })
      );

      return {
        ...item,
        accounts: accountsWithBalances,
      };
    })
  );

  return c.json({ items: itemsWithAccounts });
});

// Delete a Plaid item
plaidRoutes.delete("/items/:id", async (c) => {
  const session = c.get("session");
  const itemId = c.req.param("id");

  const [deleted] = await db
    .delete(plaidItems)
    .where(eq(plaidItems.id, itemId))
    .returning();

  if (!deleted || deleted.tenantId !== session.tenantId) {
    return c.json({ error: "Item not found" }, 404);
  }

  // Regenerate insights after disconnecting an account
  generateInsights(session.tenantId).catch(console.error);

  return c.json({ ok: true });
});
