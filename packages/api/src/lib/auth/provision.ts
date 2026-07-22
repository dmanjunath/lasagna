import { eq, and, isNull, users, tenants, invites, userProfiles, seedTaxonomyForTenant } from "@lasagna/core";
import { db } from "../db.js";

export interface ProvisionInput {
  email: string;
  name: string | null;
  workosUserId?: string;
  passwordHash?: string;
  acceptedTerms?: boolean;
  hasPassword?: boolean;
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

  // Pending, unexpired, unrevoked invite for this email → JOIN that tenant
  // instead of creating a brand-new one. Expiry is enforced here (the partial
  // unique index can't reference now()).
  const invite = await db.query.invites.findFirst({
    where: and(eq(invites.email, input.email), isNull(invites.acceptedAt), isNull(invites.revokedAt)),
  });
  if (invite && invite.expiresAt > new Date()) {
    const [created] = await db.insert(users).values({
      tenantId: invite.tenantId,
      email: input.email,
      name: input.name,
      passwordHash: input.passwordHash ?? null,
      workosUserId: input.workosUserId ?? null,
      role: invite.role,
      isAdmin: false,
      onboardingStage: "income",
      acceptedTermsAt: input.acceptedTerms ? new Date() : null,
      hasPassword: input.hasPassword ?? false,
    }).returning();
    await db.insert(userProfiles).values({ tenantId: invite.tenantId, userId: created.id });
    await db.update(invites)
      .set({ acceptedAt: new Date(), acceptedByUserId: created.id })
      .where(eq(invites.id, invite.id));
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, invite.tenantId) });
    return { user: created, tenant, isNew: true };
  }

  const [tenant] = await db.insert(tenants).values({ name: input.name || input.email.split("@")[0] }).returning();
  await seedTaxonomyForTenant(db, tenant.id);
  const [created] = await db.insert(users).values({
    tenantId: tenant.id,
    email: input.email,
    name: input.name,
    passwordHash: input.passwordHash ?? null,
    workosUserId: input.workosUserId ?? null,
    role: "owner",
    isAdmin: false,
    onboardingStage: "profile",
    acceptedTermsAt: input.acceptedTerms ? new Date() : null,
    hasPassword: input.hasPassword ?? false,
  }).returning();
  return { user: created, tenant, isNew: true };
}
