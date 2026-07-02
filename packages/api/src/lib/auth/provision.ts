import { eq, users, tenants } from "@lasagna/core";
import { db } from "../db.js";
import { env } from "../env.js";

export interface ProvisionInput {
  email: string;
  name: string | null;
  workosUserId?: string;
  passwordHash?: string;
  acceptedTerms?: boolean;
}

export async function provisionUser(input: ProvisionInput) {
  let user = input.workosUserId
    ? await db.query.users.findFirst({ where: eq(users.workosUserId, input.workosUserId) })
    : undefined;
  if (!user) {
    user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (user && input.workosUserId && !user.workosUserId) {
      [user] = await db.update(users).set({ workosUserId: input.workosUserId }).where(eq(users.id, user.id)).returning();
    }
  }
  if (user) {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
    return { user, tenant, isNew: false };
  }

  const [tenant] = await db.insert(tenants).values({ name: input.name || input.email.split("@")[0] }).returning();
  const [created] = await db.insert(users).values({
    tenantId: tenant.id,
    email: input.email,
    name: input.name,
    passwordHash: input.passwordHash ?? null,
    workosUserId: input.workosUserId ?? null,
    role: "owner",
    isAdmin: !env.MULTI_TENANT,
    onboardingStage: "profile",
    acceptedTermsAt: input.acceptedTerms ? new Date() : null,
  }).returning();
  return { user: created, tenant, isNew: true };
}
