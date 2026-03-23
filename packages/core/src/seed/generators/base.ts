import type { Database } from "../../db.js";
import { tenants, users, plaidItems } from "../../schema.js";
import { hashPassword } from "../utils.js";

export interface BaseEntities {
  tenant: typeof tenants.$inferSelect;
  user: typeof users.$inferSelect;
  plaidItem: typeof plaidItems.$inferSelect;
}

export async function createBaseEntities(
  db: Database,
  timestamp: number,
  presetName?: string,
): Promise<BaseEntities> {
  const suffix = presetName ? `-${presetName}` : "";
  const tenantName = `Seed ${timestamp}${suffix}`;
  const userEmail = `seed-${timestamp}${suffix}@lasagna.local`;
  const userPassword = "password123";

  // Create tenant
  const [tenant] = await db
    .insert(tenants)
    .values({ name: tenantName })
    .returning();

  // Create user
  const passwordHash = await hashPassword(userPassword);
  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: userEmail,
      passwordHash,
      role: "owner",
    })
    .returning();

  // Create plaid item for manual accounts
  const [plaidItem] = await db
    .insert(plaidItems)
    .values({
      tenantId: tenant.id,
      accessToken: `manual-${timestamp}`,
      institutionId: "manual",
      institutionName: "Manual Entry",
      status: "active",
      lastSyncedAt: new Date(),
    })
    .returning();

  return { tenant, user, plaidItem };
}
