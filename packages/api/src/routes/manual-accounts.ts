import { Hono } from "hono";
import { eq, and, desc, accounts, accountTypeEnum, balanceSnapshots, plaidItems } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { validatePropertyLink } from "../lib/account-links.js";
import { kickOffValueEstimate } from "../lib/value-estimate.js";

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
  const { name, type, subtype, balance, metadata, apr, linkedAccountId } = body;
  // "own" pins the user's typed value as a durable override the auto-estimate
  // never overwrites (real_estate only; mirrors the property-details PATCH).
  const ownValueOverride = type === "real_estate" && body.valueSource === "own";

  if (!name || !type) {
    return c.json({ error: "name and type are required" }, 400);
  }

  // name is accounts.name, varchar(255) — anything longer is a Postgres error,
  // which reaches the user as a bare "Internal Server Error".
  if (typeof name !== "string" || name.length > 255) {
    return c.json({ error: "name must be a string of at most 255 characters" }, 400);
  }

  const validTypes: readonly string[] = accountTypeEnum.enumValues;
  if (!validTypes.includes(type)) {
    return c.json({ error: `type must be one of: ${validTypes.join(", ")}` }, 400);
  }

  // subtype is free-form (Plaid's vocabulary is open and quick-import writes its
  // own), but the column is varchar(100) — anything longer is a Postgres error,
  // not a 500.
  if (subtype !== undefined && subtype !== null) {
    if (typeof subtype !== "string" || subtype.length > 100) {
      return c.json({ error: "subtype must be a string of at most 100 characters" }, 400);
    }
  }

  // apr is numeric(6,4) — 100 or more overflows the column.
  let aprValue: string | null = null;
  if (apr !== undefined && apr !== null) {
    const n =
      typeof apr === "number"
        ? apr
        : typeof apr === "string" && apr.trim() !== ""
          ? Number(apr)
          : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 99.99) {
      return c.json({ error: "apr must be a number between 0 and 99.99" }, 400);
    }
    aprValue = String(n);
  }

  const plaidItemId = await getOrCreateManualItem(session.tenantId);

  // Resolve the optional link (property↔debt) before insert so we can
  // validate direction and write the FK on the correct side.
  const isDebt = type === "credit" || type === "loan";
  let linked: { id: string; type: string } | null = null;
  if (linkedAccountId) {
    const row = await db.query.accounts.findFirst({
      where: and(eq(accounts.id, linkedAccountId), eq(accounts.tenantId, session.tenantId)),
      columns: { id: true, type: true },
    });
    let err: string | null;
    if (isDebt) {
      err = validatePropertyLink({ type }, row);
    } else if (type === "real_estate" && row) {
      err = validatePropertyLink(row, { type });
    } else {
      err = "linkedAccountId must pair a debt with a property";
    }
    if (err) return c.json({ error: err }, 400);
    linked = row!;
  }

  // Seed the durable override flag so the estimate never clobbers the user's
  // value. When an address is present it's (re)applied via kickOffValueEstimate
  // below; this covers the no-address case where no estimate job runs.
  const metaObj: Record<string, unknown> = metadata && typeof metadata === "object" ? { ...metadata } : {};
  if (ownValueOverride) metaObj.valueEstimate = { override: true };
  const metaStr = Object.keys(metaObj).length > 0 ? JSON.stringify(metaObj) : null;

  const [account] = await db.insert(accounts).values({
    tenantId: session.tenantId,
    plaidItemId: plaidItemId,
    plaidAccountId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    type,
    subtype: subtype || null,
    mask: null,
    // Keep the column in step with the rate in metadata: the Debt page reads
    // metadata, the chat tools read this column.
    apr: aprValue,
    metadata: metaStr,
    // creating a debt linked to a property → FK on the new row
    propertyAccountId: isDebt && linked ? linked.id : null,
  }).returning();

  // creating a property linked to an existing debt → FK on that debt
  if (type === "real_estate" && linked) {
    await db.update(accounts).set({ propertyAccountId: account.id }).where(eq(accounts.id, linked.id));
  }

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

  // Real-estate account created with an address → kick off an async value
  // estimate. Don't block the create response on the full poll; the trigger is
  // quick and stores metadata.valueEstimate = { status: "pending" }, then the
  // client polls GET /accounts/:id/value-estimate for the result.
  const address = typeof metaObj.address === "string" ? metaObj.address : "";
  if (type === "real_estate" && address.trim()) {
    // "My own value" pins the typed value as a durable override; otherwise, if
    // the user typed a value the estimate is advisory — either way it must never
    // overwrite their number.
    const userEnteredValue = balance !== undefined && balance !== null;
    await kickOffValueEstimate(account.id, metaStr, address, {
      override: ownValueOverride,
      advisory: !ownValueOverride && userEnteredValue,
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
