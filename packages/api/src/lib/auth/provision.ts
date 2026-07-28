import { eq, and, isNull, users, tenants, invites, userProfiles, seedTaxonomyForTenant } from "@lasagna/core";
import { db } from "../db.js";
import { env } from "../env.js";
import { resolveInvite, type InviteRow } from "../invites.js";

export interface ProvisionInput {
  email: string;
  name: string | null;
  workosUserId?: string;
  passwordHash?: string;
  acceptedTerms?: boolean;
  hasPassword?: boolean;
}

export async function provisionUser(input: ProvisionInput) {
  // Normalize once so the existing-user lookup, the invite match, and the
  // stored value all agree on casing (the users.email unique index is
  // case-sensitive; invites are stored lowercased).
  const email = input.email.trim().toLowerCase();
  let user = input.workosUserId
    ? await db.query.users.findFirst({ where: eq(users.workosUserId, input.workosUserId) })
    : undefined;
  if (!user) {
    user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (user && input.workosUserId && !user.workosUserId) {
      [user] = await db.update(users).set({ workosUserId: input.workosUserId }).where(eq(users.id, user.id)).returning();
    }
  }
  if (user) {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
    return { user, tenant, isNew: false };
  }

  // Pending invite for this email → JOIN that tenant instead of creating a
  // brand-new one. Deterministic (oldest pending first) when the same address
  // was invited by more than one household; expiry is enforced by resolveInvite
  // (the partial-unique index can't reference now()).
  const pending = await db.query.invites.findFirst({
    where: and(eq(invites.email, email), isNull(invites.acceptedAt), isNull(invites.revokedAt)),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
  const resolved = resolveInvite(pending as InviteRow | undefined);
  if (resolved.status === "ok") {
    const invite = resolved.invite;
    // Atomic: a mid-sequence failure must not leave the invite still pending
    // (re-consumable) or the new user without a personal-profile row.
    const created = await db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({
        tenantId: invite.tenantId,
        email,
        name: input.name,
        passwordHash: input.passwordHash ?? null,
        workosUserId: input.workosUserId ?? null,
        role: invite.role,
        isAdmin: false,
        onboardingStage: "income",
        acceptedTermsAt: input.acceptedTerms ? new Date() : null,
        hasPassword: input.hasPassword ?? false,
      }).returning();
      await tx.insert(userProfiles).values({ tenantId: invite.tenantId, userId: u.id });
      await tx.update(invites)
        .set({ acceptedAt: new Date(), acceptedByUserId: u.id })
        .where(eq(invites.id, invite.id));
      return u;
    });
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, invite.tenantId) });
    return { user: created, tenant, isNew: true };
  }

  const [tenant] = await db.insert(tenants).values({ name: input.name || email.split("@")[0] }).returning();
  await seedTaxonomyForTenant(db, tenant.id);
  const [created] = await db.insert(users).values({
    tenantId: tenant.id,
    email,
    name: input.name,
    passwordHash: input.passwordHash ?? null,
    workosUserId: input.workosUserId ?? null,
    role: "owner",
    // Multi-tenant (the default) never grants admin on signup. A deliberate
    // MULTI_TENANT=false single-tenant deployment makes every new user internal admin.
    isAdmin: !env.MULTI_TENANT,
    onboardingStage: "profile",
    acceptedTermsAt: input.acceptedTerms ? new Date() : null,
    hasPassword: input.hasPassword ?? false,
  }).returning();
  return { user: created, tenant, isNew: true };
}
