import { Hono } from "hono";
import { CountryCode, Products } from "plaid";
import { eq, and, desc, plaidItems, accounts, balanceSnapshots, encrypt, decrypt } from "@lasagna/core";
import { db } from "../lib/db.js";
import { plaidClient } from "../lib/plaid.js";
import { env } from "../lib/env.js";
import { type AuthEnv } from "../middleware/auth.js";
import { syncItem } from "../lib/sync.js";
import { logPlaidEvent } from "../lib/activity.js";
import { verifyPlaidWebhook } from "../lib/plaid-webhook.js";
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
    // Plaid POSTs here when it pulls new data for the item, so we sync on its
    // schedule (1-4x/day) instead of waiting for the next cron run. Omitted in
    // local dev, where Plaid can't reach the API.
    ...(env.PLAID_WEBHOOK_URL ? { webhook: env.PLAID_WEBHOOK_URL } : {}),
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
      // Webhooks are keyed by Plaid's item_id, so store it at link time.
      plaidItemId: response.data.item_id,
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

// ── Plaid webhook ──────────────────────────────────────────────────────────
// Unauthenticated (exempted in server.ts) and verified by JWT signature.
// Plaid calls this when it finishes its own pull of an item, which is how we
// get fresh data without polling. Everything it triggers is free: /accounts/get
// is unbilled and /transactions/sync is covered by the item's subscription.
//
// A burst of webhooks for one item (transactions + holdings + liabilities land
// seconds apart) would otherwise run three full syncs, so collapse them.
const WEBHOOK_SYNC_DEBOUNCE_MS = 5 * 60 * 1000;
const lastWebhookSync = new Map<string, number>();

plaidRoutes.post("/webhook", async (c) => {
  const raw = await c.req.text(); // RAW body — the signature pins its bytes
  const ok = await verifyPlaidWebhook(c.req.header("plaid-verification"), raw);
  if (!ok) {
    console.error("[Plaid] webhook verification failed");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const body = JSON.parse(raw) as {
    webhook_type?: string;
    webhook_code?: string;
    item_id?: string;
    error?: { error_code?: string };
  };
  const { webhook_type: type, webhook_code: code, item_id: plaidItemId } = body;
  if (!plaidItemId) return c.json({ ok: true });

  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.plaidItemId, plaidItemId),
    columns: { id: true },
  });
  if (!item) {
    // Not ours (or predates the plaid_item_id backfill). 200 so Plaid stops
    // retrying — a retry can't make the row appear.
    console.warn(`[Plaid] webhook ${type}/${code} for unknown item ${plaidItemId}`);
    return c.json({ ok: true });
  }

  // New data is ready for this item.
  const isUpdate =
    (type === "TRANSACTIONS" && (code === "SYNC_UPDATES_AVAILABLE" || code === "DEFAULT_UPDATE")) ||
    (type === "HOLDINGS" && code === "DEFAULT_UPDATE") ||
    (type === "LIABILITIES" && code === "DEFAULT_UPDATE");

  if (isUpdate) {
    const last = lastWebhookSync.get(item.id) ?? 0;
    if (Date.now() - last < WEBHOOK_SYNC_DEBOUNCE_MS) {
      console.log(`[Plaid] webhook ${type}/${code} debounced for item ${item.id}`);
      return c.json({ ok: true });
    }
    lastWebhookSync.set(item.id, Date.now());
    console.log(`[Plaid] webhook ${type}/${code} — syncing item ${item.id}`);
    // Background: Plaid retries on a slow or non-2xx response.
    syncItem(item.id).catch(console.error);
  } else if (type === "ITEM" && (code === "ERROR" || code === "USER_PERMISSION_REVOKED")) {
    // Surfaces the existing re-auth path in the UI.
    console.warn(`[Plaid] item ${item.id} needs attention: ${body.error?.error_code ?? code}`);
    await db
      .update(plaidItems)
      .set({ status: "error" })
      .where(eq(plaidItems.id, item.id));
  } else {
    console.log(`[Plaid] webhook ${type}/${code} ignored for item ${item.id}`);
  }

  return c.json({ ok: true });
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
          // Where the displayed value comes from: a Plaid-linked institution
          // syncs it; otherwise a latest "estimate" snapshot means we valued it;
          // else the user typed it in.
          const valueSource: "synced" | "estimated" | "manual" =
            item.institutionId !== "manual"
              ? "synced"
              : latest?.source === "estimate"
                ? "estimated"
                : "manual";
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
            valueSource,
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

  // Scope the delete to the caller's tenant — matching on id alone would let a
  // user delete another tenant's item (its accounts/transactions cascade off it).
  const [deleted] = await db
    .delete(plaidItems)
    .where(and(eq(plaidItems.id, itemId), eq(plaidItems.tenantId, session.tenantId)))
    .returning();

  if (!deleted) {
    return c.json({ error: "Item not found" }, 404);
  }

  return c.json({ ok: true });
});
