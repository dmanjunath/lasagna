import type { Database } from "../../db.js";
import { tenants, users, plaidItems, financialProfiles, userProfiles } from "../../schema.js";
import { seedTaxonomyForTenant } from "../../taxonomy.js";
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

  await seedTaxonomyForTenant(db, tenant.id);

  // Create user
  const passwordHash = await hashPassword(userPassword);
  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: userEmail,
      passwordHash,
      role: "owner",
      acceptedTermsAt: new Date(),
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

  // Create the profile if config provided. It lives in two tables, and the split
  // is the one profile-resolver.ts defines: the household row carries what the
  // tenant shares, the per-user row carries "your income vs your partner's".
  //
  // Writing the personal fields onto the household row instead leaves the app
  // reading nulls — no age, no income, no retirement age, no employer match. A
  // seeded account then reports zero income, which sends the financial level,
  // the retirement projection, the tax surfaces and the generated actions down
  // their "we don't know anything about you" paths.
  if (profileConfig) {
    const dob = profileConfig.age
      ? new Date(new Date().getFullYear() - profileConfig.age, 0, 15)
      : undefined;

    await db.insert(financialProfiles).values({
      tenantId: tenant.id,
      filingStatus: profileConfig.filingStatus,
      stateOfResidence: profileConfig.stateOfResidence,
    });

    await db.insert(userProfiles).values({
      tenantId: tenant.id,
      userId: user.id,
      dateOfBirth: dob,
      annualIncome: profileConfig.annualIncome ? String(profileConfig.annualIncome) : undefined,
      riskTolerance: profileConfig.riskTolerance,
      retirementAge: profileConfig.retirementAge,
      employerMatch: profileConfig.employerMatch ? String(profileConfig.employerMatch) : undefined,
    });
  }

  return { tenant, user, plaidItem };
}
