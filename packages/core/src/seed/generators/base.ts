import type { Database } from "../../db.js";
import { tenants, users, plaidItems, financialProfiles } from "../../schema.js";
import { hashPassword } from "../utils.js";
import type { ProfileConfig } from "../types.js";

export interface BaseEntities {
  tenant: typeof tenants.$inferSelect;
  user: typeof users.$inferSelect;
  plaidItem: typeof plaidItems.$inferSelect;
}

export async function createBaseEntities(
  db: Database,
  timestamp: number,
  presetName?: string,
  profileConfig?: ProfileConfig,
): Promise<BaseEntities> {
  const suffix = presetName ? `-${presetName}` : "";
  // Use a friendly name for demo purposes
  const DEMO_NAMES: Record<string, string> = {
    negative: "Jordan", "100k": "Alex", "750k": "Sam", "1.8M": "Taylor",
    "4M": "Morgan", "7M": "Casey", "12M": "Riley", "25M": "Quinn", "75M": "Blake",
  };
  const tenantName = presetName && DEMO_NAMES[presetName] ? DEMO_NAMES[presetName] : `User ${timestamp}`;
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

  // Create financial profile if config provided
  if (profileConfig) {
    const dob = profileConfig.age
      ? new Date(new Date().getFullYear() - profileConfig.age, 0, 15)
      : undefined;

    await db.insert(financialProfiles).values({
      tenantId: tenant.id,
      dateOfBirth: dob,
      annualIncome: profileConfig.annualIncome ? String(profileConfig.annualIncome) : undefined,
      filingStatus: profileConfig.filingStatus,
      stateOfResidence: profileConfig.stateOfResidence,
      riskTolerance: profileConfig.riskTolerance,
      retirementAge: profileConfig.retirementAge,
      employerMatch: profileConfig.employerMatch ? String(profileConfig.employerMatch) : undefined,
    });
  }

  return { tenant, user, plaidItem };
}
