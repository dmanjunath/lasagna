import { Hono } from "hono";
import { eq, and, desc, accounts, balanceSnapshots, plaidItems } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";

export const manualAccountRoutes = new Hono<AuthEnv>();

// Helper: get or create the "Manual Entry" plaid item for this tenant
async function getOrCreateManualItem(tenantId: string): Promise<string> {
  const existing = await db.query.plaidItems.findFirst({
    where: and(
      eq(plaidItems.tenantId, tenantId),
      eq(plaidItems.institutionId, "manual"),
    ),
  });
  if (existing) return existing.id;

  const [item] = await db.insert(plaidItems).values({
    tenantId,
    accessToken: `manual-${Date.now()}`,
    institutionId: "manual",
    institutionName: "Manual Entry",
    status: "active",
    lastSyncedAt: new Date(),
  }).returning();
  return item.id;
}

// POST / - Create a manual account with initial balance
manualAccountRoutes.post("/", async (c) => {
  const session = c.get("session");
  const body = await c.req.json();
  const { name, type, subtype, balance, metadata } = body;

  if (!name || !type) {
    return c.json({ error: "name and type are required" }, 400);
  }

  const validTypes = ["depository", "investment", "credit", "loan", "real_estate", "alternative"];
  if (!validTypes.includes(type)) {
    return c.json({ error: `type must be one of: ${validTypes.join(", ")}` }, 400);
  }

  const plaidItemId = await getOrCreateManualItem(session.tenantId);

  const [account] = await db.insert(accounts).values({
    tenantId: session.tenantId,
    plaidItemId: plaidItemId,
    plaidAccountId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    type,
    subtype: subtype || null,
    mask: null,
    metadata: metadata ? JSON.stringify(metadata) : null,
  }).returning();

  // Create initial balance snapshot
  if (balance !== undefined && balance !== null) {
    await db.insert(balanceSnapshots).values({
      accountId: account.id,
      tenantId: session.tenantId,
      balance: String(balance),
      isoCurrencyCode: "USD",
      snapshotAt: new Date(),
    });
  }

  return c.json({ account }, 201);
});

// PATCH /:id - Update a manual account (name, balance, metadata)
manualAccountRoutes.patch("/:id", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("id");
  const body = await c.req.json();

  // Verify ownership
  const existing = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.tenantId, session.tenantId)),
  });
  if (!existing) return c.json({ error: "Account not found" }, 404);

  // Update account fields
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.subtype !== undefined) updates.subtype = body.subtype;
  if (body.metadata !== undefined) updates.metadata = body.metadata ? JSON.stringify(body.metadata) : null;

  if (Object.keys(updates).length > 0) {
    await db.update(accounts).set(updates).where(eq(accounts.id, accountId));
  }

  // Update balance by creating new snapshot
  if (body.balance !== undefined) {
    await db.insert(balanceSnapshots).values({
      accountId,
      tenantId: session.tenantId,
      balance: String(body.balance),
      isoCurrencyCode: "USD",
      snapshotAt: new Date(),
    });
  }

  return c.json({ ok: true });
});

// DELETE /:id - Delete a manual account
manualAccountRoutes.delete("/:id", async (c) => {
  const session = c.get("session");
  const accountId = c.req.param("id");

  const existing = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.tenantId, session.tenantId)),
  });
  if (!existing) return c.json({ error: "Account not found" }, 404);

  await db.delete(accounts).where(eq(accounts.id, accountId));
  return c.json({ ok: true });
});
