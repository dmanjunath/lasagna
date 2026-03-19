import { Hono } from "hono";
import { eq, desc, syncLog, plaidItems } from "@lasagna/core";
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

// Trigger sync for a single item
syncRoutes.post("/:itemId", async (c) => {
  const session = c.get("session");
  const itemId = c.req.param("itemId");
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
