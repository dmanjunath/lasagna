import { Hono } from "hono";
import { eq, users, tenants } from "@lasagna/core";
import { db } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { resolveTenantPlan } from "../lib/billing.js";
import { type AuthEnv } from "../middleware/auth.js";
import {
  readHouseholdProfile,
  readUserPersonalProfile,
  resolveProfile,
  upsertSplitProfile,
} from "../lib/profile-resolver.js";

export const settingsRoutes = new Hono<AuthEnv>();

// Get profile
settingsRoutes.get("/profile", async (c) => {
  const session = c.get("session");

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, session.tenantId),
  });

  return c.json({
    profile: {
      email: user.email,
      name: tenant?.name || null,
      plan: await resolveTenantPlan(session.tenantId),
      createdAt: user.createdAt,
    },
  });
});

// Update profile (name)
settingsRoutes.patch("/profile", async (c) => {
  const session = c.get("session");
  const { name } = await c.req.json<{ name?: string }>();

  if (name !== undefined) {
    if (!name.trim()) {
      return c.json({ error: "Name cannot be empty" }, 400);
    }
    await db
      .update(tenants)
      .set({ name: name.trim() })
      .where(eq(tenants.id, session.tenantId));
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, session.tenantId),
  });

  return c.json({
    profile: {
      name: tenant?.name || null,
      plan: await resolveTenantPlan(session.tenantId),
    },
  });
});

// Change password
settingsRoutes.post("/change-password", async (c) => {
  const session = c.get("session");
  const { currentPassword, newPassword } = await c.req.json<{
    currentPassword: string;
    newPassword: string;
  }>();

  if (!currentPassword || !newPassword) {
    return c.json({ error: "Both current and new password are required" }, 400);
  }

  if (newPassword.length < 6) {
    return c.json({ error: "New password must be at least 6 characters" }, 400);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  if (!user.passwordHash) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    return c.json({ error: "Current password is incorrect" }, 401);
  }

  const newHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, session.userId));

  return c.json({ ok: true });
});

// Get financial profile — household fields (tenant) merged with THIS user's
// personal fields (userProfiles). Returns null only when the household row is
// absent AND this user has no personal profile yet.
settingsRoutes.get("/financial-profile", async (c) => {
  const session = c.get("session");

  const [household, personal] = await Promise.all([
    readHouseholdProfile(session.tenantId),
    readUserPersonalProfile(session.tenantId, session.userId),
  ]);

  if (!household && !personal) {
    return c.json({ financialProfile: null });
  }

  return c.json({
    financialProfile: resolveProfile(household ?? null, personal ?? null),
  });
});

// All household members' personal profiles (shared "you vs your partner" view).
settingsRoutes.get("/household-profiles", async (c) => {
  const session = c.get("session");

  const [household, members] = await Promise.all([
    readHouseholdProfile(session.tenantId),
    db.query.users.findMany({
      where: eq(users.tenantId, session.tenantId),
      columns: { id: true, name: true, email: true },
    }),
  ]);

  const memberProfiles = await Promise.all(
    members.map(async (u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      isYou: u.id === session.userId,
      profile: resolveProfile(
        household ?? null,
        (await readUserPersonalProfile(session.tenantId, u.id)) ?? null,
      ),
    })),
  );

  return c.json({ members: memberProfiles });
});

// Create or update financial profile — household fields write to the tenant
// `financialProfiles` row; personal fields write to THIS user's `userProfiles`.
settingsRoutes.patch("/financial-profile", async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    dateOfBirth?: string | null;
    annualIncome?: number | null;
    filingStatus?: string | null;
    stateOfResidence?: string | null;
    employmentType?: string | null;
    riskTolerance?: string | null;
    retirementAge?: number | null;
    employerMatchPercent?: number | null;
    dependentCount?: number | null;
    hasHDHP?: boolean | null;
    isPSLFEligible?: boolean | null;
  }>();

  await upsertSplitProfile(session.tenantId, session.userId, body);

  return c.json({ ok: true });
});
