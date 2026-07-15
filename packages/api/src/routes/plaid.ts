import { Hono } from "hono";
import { CountryCode, Products } from "plaid";
import { eq, and, desc, plaidItems, accounts, balanceSnapshots, encrypt, decrypt } from "@lasagna/core";
import { db } from "../lib/db.js";
import { plaidClient } from "../lib/plaid.js";
import { env } from "../lib/env.js";
import { type AuthEnv } from "../middleware/auth.js";
import { syncItem } from "../lib/sync.js";
import { logPlaidEvent } from "../lib/activity.js";
import { resolveTenantPlan } from "../lib/billing.js";
import { recomputeFrozenAccounts } from "../lib/account-limits.js";

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
// item enters `item_login_required` or `error` state, and to add newly opened
// accounts at an already-linked institution (account_selection_enabled shows
// the account picker so the same item gains the new account — linking the
// institution again would create a second item that duplicates every account).
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
    update: { account_selection_enabled: true },
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

  // Meter the new connection (Plaid bills per linked item).
  logPlaidEvent({ tenantId: session.tenantId, source: "link" });

  // Sync accounts and balances immediately after linking
  syncItem(item.id).catch(console.error);

  return c.json({ itemId: item.id });
});

// List linked Plaid items with accounts and balances
plaidRoutes.get("/items", async (c) => {
  const session = c.get("session");

  // Keep freeze state current on every read: free tenants keep their oldest
  // `maxAccounts` active and freeze the rest. Idempotent (only writes on
  // change), so this is a no-op once settled — but it ensures the
  // active/frozen split is correct even for tenants that haven't synced since
  // the limit was introduced.
  const plan = await resolveTenantPlan(session.tenantId);
  await recomputeFrozenAccounts(session.tenantId, plan);

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
            apr: acct.apr,
            metadata: acct.metadata ? JSON.parse(acct.metadata) : null,
            excludeFromNetWorth: acct.excludeFromNetWorth,
            excludeTransactions: acct.excludeTransactions,
            invertBalance: acct.invertBalance,
            frozen: acct.frozen,
            propertyAccountId: acct.propertyAccountId ?? null,
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

// Post-link sync: pull an item's accounts right after the user completes an
// update-mode Link session (add accounts / re-auth). Mirrors the automatic
// sync in /exchange-token; deliberately NOT behind the manual-sync Pro gate
// because this is part of the linking flow, not a manual refresh.
plaidRoutes.post("/items/:id/sync", async (c) => {
  const session = c.get("session");
  const itemId = c.req.param("id");

  const item = await db.query.plaidItems.findFirst({
    where: and(eq(plaidItems.id, itemId), eq(plaidItems.tenantId, session.tenantId)),
    columns: { id: true },
  });
  if (!item) return c.json({ error: "Item not found" }, 404);

  syncItem(itemId).catch(console.error);
  return c.json({ ok: true });
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
