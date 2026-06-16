import { Hono } from "hono";
import { CountryCode, Products } from "plaid";
import { eq, and, desc, plaidItems, accounts, balanceSnapshots, encrypt, decrypt } from "@lasagna/core";
import { db } from "../lib/db.js";
import { plaidClient } from "../lib/plaid.js";
import { env } from "../lib/env.js";
import { type AuthEnv } from "../middleware/auth.js";
import { syncItem } from "../lib/sync.js";

export const plaidRoutes = new Hono<AuthEnv>();

// Create a link token for Plaid Link
plaidRoutes.post("/link-token", async (c) => {
  const session = c.get("session");

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: session.userId },
    client_name: "Lasagna",
    products: [Products.Transactions],
    optional_products: [Products.Investments, Products.Liabilities],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return c.json({ linkToken: response.data.link_token });
});

// Update-mode link token: lets the user re-authenticate an existing Plaid
// item without losing its access_token / transaction history. Used when the
// item enters `item_login_required` or `error` state.
plaidRoutes.post("/link-token/update", async (c) => {
  const session = c.get("session");
  const { itemId } = await c.req.json<{ itemId: string }>();
  if (!itemId) return c.json({ error: "itemId is required" }, 400);

  const item = await db.query.plaidItems.findFirst({
    where: and(eq(plaidItems.id, itemId), eq(plaidItems.tenantId, session.tenantId)),
    columns: { accessToken: true },
  });
  if (!item) return c.json({ error: "Item not found" }, 404);

  const accessToken = await decrypt(item.accessToken, env.ENCRYPTION_KEY);
  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: session.userId },
    client_name: "Lasagna",
    country_codes: [CountryCode.Us],
    language: "en",
    access_token: accessToken,
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
  syncItem(item.id).catch(console.error);

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
            metadata: acct.metadata ? JSON.parse(acct.metadata) : null,
            excludeFromNetWorth: acct.excludeFromNetWorth,
            excludeTransactions: acct.excludeTransactions,
            invertBalance: acct.invertBalance,
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

  return c.json({ ok: true });
});
