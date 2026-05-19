import { Hono } from "hono";
import { eq, and, desc, syncLog, plaidItems, accounts } from "@lasagna/core";
import { db } from "../lib/db.js";
import { syncItem, syncAllForTenant } from "../lib/sync.js";
import { type AuthEnv } from "../middleware/auth.js";

export const syncRoutes = new Hono<AuthEnv>();

// Trigger sync for all items
syncRoutes.post("/", async (c) => {
  const session = c.get("session");
  // Run sync in background, return immediately
  syncAllForTenant(session.tenantId).catch(console.error);
  return c.json({ ok: true, message: "Sync started" });
});

// Full resync — resets all cursors so Plaid re-sends all historical transactions,
// allowing updated categorization logic to be applied retroactively
syncRoutes.post("/resync", async (c) => {
  const session = c.get("session");
  await db.update(plaidItems)
    .set({ transactionCursor: null })
    .where(eq(plaidItems.tenantId, session.tenantId));
  syncAllForTenant(session.tenantId).catch(console.error);
  return c.json({ ok: true, message: "Full resync started" });
});

// Trigger sync for a single account — looks up its parent Plaid item and
// syncs the whole item (Plaid's smallest sync unit is the item, not the
// account). Tenant-scoped so a user can't sync someone else's account.
syncRoutes.post("/account/:accountId", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("accountId");
  const acct = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.tenantId, session.tenantId)),
    columns: { plaidItemId: true },
  });
  if (!acct) return c.json({ error: "Account not found" }, 404);
  if (!acct.plaidItemId) return c.json({ error: "Account is not linked to a Plaid item" }, 400);
  syncItem(acct.plaidItemId).catch(console.error);
  return c.json({ ok: true, itemId: acct.plaidItemId });
});

// Trigger sync for a single item
syncRoutes.post("/:itemId", async (c) => {
  const session = c.get("session");
  const itemId = c.req.param("itemId");
  // Tenant-scope the request to prevent cross-tenant sync triggers.
  const item = await db.query.plaidItems.findFirst({
    where: and(eq(plaidItems.id, itemId), eq(plaidItems.tenantId, session.tenantId)),
    columns: { id: true },
  });
  if (!item) return c.json({ error: "Item not found" }, 404);
  syncItem(itemId).catch(console.error);
  return c.json({ ok: true, message: `Sync started for item ${itemId}` });
});

// Get sync history
syncRoutes.get("/history", async (c) => {
  const session = c.get("session");

  const logs = await db.query.syncLog.findMany({
    where: eq(syncLog.tenantId, session.tenantId),
    orderBy: [desc(syncLog.startedAt)],
    limit: 50,
  });

  return c.json({ logs });
});
