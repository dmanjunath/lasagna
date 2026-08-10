import { eq, plaidItems, tenants, users, decrypt } from "@lasagna/core";
import { db } from "./db.js";
import { env } from "./env.js";
import { plaidClient } from "./plaid.js";
import { getStripe } from "./stripe.js";
import { deleteWorkosUser } from "./auth/workos.js";

/**
 * Self-serve account deletion (App Store guideline 5.1.1(v)).
 *
 * Order matters: external cleanup first (Plaid items hold live bank
 * credentials; Stripe would keep billing), tenant row last — its cascade
 * removes users/accounts/items/etc. Every external step is best-effort:
 * a Plaid/Stripe/WorkOS outage must not make deletion impossible. Token
 * decryption happens inside removePlaidItem so one corrupt token counts
 * as a per-item failure instead of wedging the whole deletion.
 */
export interface DeletionDeps {
  listEncryptedPlaidTokens(tenantId: string): Promise<string[]>;
  removePlaidItem(encryptedAccessToken: string): Promise<void>;
  getStripeSubscriptionId(tenantId: string): Promise<string | null>;
  cancelStripeSubscription(subscriptionId: string): Promise<void>;
  listWorkosUserIds(tenantId: string): Promise<string[]>;
  deleteWorkosUser(workosUserId: string): Promise<void>;
  deleteTenantRow(tenantId: string): Promise<void>;
}

export const defaultDeps: DeletionDeps = {
  listEncryptedPlaidTokens: async (tenantId) => {
    const items = await db.query.plaidItems.findMany({
      where: eq(plaidItems.tenantId, tenantId),
      columns: { accessToken: true },
    });
    return items.map((i) => i.accessToken);
  },
  removePlaidItem: async (encryptedAccessToken) => {
    const accessToken = await decrypt(encryptedAccessToken, env.ENCRYPTION_KEY);
    await plaidClient.itemRemove({ access_token: accessToken });
  },
  getStripeSubscriptionId: async (tenantId) => {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { stripeSubscriptionId: true },
    });
    return tenant?.stripeSubscriptionId ?? null;
  },
  cancelStripeSubscription: async (subscriptionId) => {
    if (!env.STRIPE_SECRET_KEY) return; // billing unconfigured — nothing to cancel
    await getStripe().subscriptions.cancel(subscriptionId);
  },
  listWorkosUserIds: async (tenantId) => {
    const tenantUsers = await db.query.users.findMany({
      where: eq(users.tenantId, tenantId),
      columns: { workosUserId: true },
    });
    return tenantUsers.map((u) => u.workosUserId).filter((id): id is string => Boolean(id));
  },
  deleteWorkosUser: (id) => deleteWorkosUser(id),
  deleteTenantRow: async (tenantId) => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  },
};

export async function deleteTenantAccount(
  tenantId: string,
  deps: DeletionDeps = defaultDeps,
): Promise<{ plaidRemoved: number; plaidFailed: number }> {
  let plaidRemoved = 0;
  let plaidFailed = 0;
  for (const encryptedToken of await deps.listEncryptedPlaidTokens(tenantId)) {
    try {
      await deps.removePlaidItem(encryptedToken);
      plaidRemoved++;
    } catch (e) {
      plaidFailed++;
      console.error(`[AccountDeletion] plaid itemRemove failed (tenant ${tenantId}):`, e instanceof Error ? e.message : e);
    }
  }
  const subId = await deps.getStripeSubscriptionId(tenantId);
  if (subId) {
    try {
      await deps.cancelStripeSubscription(subId);
    } catch (e) {
      console.error(`[AccountDeletion] stripe cancel failed (tenant ${tenantId}):`, e instanceof Error ? e.message : e);
    }
  }
  for (const workosId of await deps.listWorkosUserIds(tenantId)) {
    try {
      await deps.deleteWorkosUser(workosId);
    } catch (e) {
      console.error(`[AccountDeletion] workos deleteUser failed (${workosId}):`, e instanceof Error ? e.message : e);
    }
  }
  await deps.deleteTenantRow(tenantId);
  return { plaidRemoved, plaidFailed };
}
