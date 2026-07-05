import { Hono } from "hono";
import { eq, and, desc, syncLog, plaidItems, accounts, canManualSync, PRO_MANUAL_SYNC_COOLDOWN_MS } from "@lasagna/core";
import { db } from "../lib/db.js";
import { syncItem, syncAllForTenant } from "../lib/sync.js";
import { type AuthEnv } from "../middleware/auth.js";
import { resolveTenantPlan, isTenantDisabled } from "../lib/billing.js";

export const syncRoutes = new Hono<AuthEnv>();

// Returns null if the tenant may run a manual sync now, else an error tuple.
// The cooldown is best-effort and COMPLETION-based: it keys off `lastSyncedAt`
// (written only on successful sync), so it throttles repeated *successful*
// syncs but does not hard-block a sync that's still in flight or one whose
// prior attempt failed. That's acceptable for cost throttling; a hard
// concurrency lock would need a separate in-progress flag (not in scope).
async function manualSyncGate(
  tenantId: string,
): Promise<{ status: 403 | 429; error: string; code: string } | null> {
  // Admin pause outranks everything — a clear signal instead of a silent no-op.
  if (await isTenantDisabled(tenantId)) {
    return { status: 403, error: "Account syncing is paused by the administrator", code: "account_paused" };
  }
  const plan = await resolveTenantPlan(tenantId);
  if (!canManualSync(plan)) {
    return { status: 403, error: "Manual sync is a Pro feature", code: "upgrade_required" };
  }
  const items = await db.query.plaidItems.findMany({
    where: eq(plaidItems.tenantId, tenantId),
    columns: { lastSyncedAt: true },
  });
  const lastMs = items.reduce((max, i) => Math.max(max, i.lastSyncedAt?.getTime() ?? 0), 0);
  if (lastMs && Date.now() - lastMs < PRO_MANUAL_SYNC_COOLDOWN_MS) {
    return { status: 429, error: "Synced recently — try again in a few minutes", code: "rate_limited" };
  }
  return null;
}

// Trigger sync for all items
syncRoutes.post("/", async (c) => {
  const session = c.get("session");
  const gate = await manualSyncGate(session.tenantId);
  if (gate) return c.json({ error: gate.error, code: gate.code }, gate.status);
  // Run sync in background, return immediately
  syncAllForTenant(session.tenantId).catch(console.error);
  return c.json({ ok: true, message: "Sync started" });
});

// Full resync — resets all cursors so Plaid re-sends all historical transactions,
// allowing updated categorization logic to be applied retroactively
syncRoutes.post("/resync", async (c) => {
  const session = c.get("session");
  const gate = await manualSyncGate(session.tenantId);
  if (gate) return c.json({ error: gate.error, code: gate.code }, gate.status);
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
  const gate = await manualSyncGate(session.tenantId);
  if (gate) return c.json({ error: gate.error, code: gate.code }, gate.status);
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
  const gate = await manualSyncGate(session.tenantId);
  if (gate) return c.json({ error: gate.error, code: gate.code }, gate.status);
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
