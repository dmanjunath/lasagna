import { Hono } from "hono";
import { eq, users, tenants, financialProfiles } from "@lasagna/core";
import { db } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { type AuthEnv } from "../middleware/auth.js";

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
      plan: tenant?.plan || "free",
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
      plan: tenant?.plan || "free",
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

// Get financial profile
settingsRoutes.get("/financial-profile", async (c) => {
  const session = c.get("session");

  const profile = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, session.tenantId),
  });

  if (!profile) {
    return c.json({ financialProfile: null });
  }

  const age = profile.dateOfBirth
    ? Math.floor(
        (Date.now() - new Date(profile.dateOfBirth).getTime()) /
          (365.25 * 24 * 60 * 60 * 1000)
      )
    : null;

  return c.json({
    financialProfile: {
      dateOfBirth: profile.dateOfBirth,
      age,
      annualIncome: profile.annualIncome ? parseFloat(profile.annualIncome) : null,
      filingStatus: profile.filingStatus,
      stateOfResidence: profile.stateOfResidence,
      employmentType: profile.employmentType,
      riskTolerance: profile.riskTolerance,
      retirementAge: profile.retirementAge,
      employerMatchPercent: profile.employerMatch ? parseFloat(profile.employerMatch) : null,
    },
  });
});

// Create or update financial profile
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
  }>();

  const existing = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, session.tenantId),
  });

  const values: Record<string, unknown> = {};
  if (body.dateOfBirth !== undefined)
    values.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth) : null;
  if (body.annualIncome !== undefined)
    values.annualIncome = body.annualIncome?.toString() ?? null;
  if (body.filingStatus !== undefined)
    values.filingStatus = body.filingStatus;
  if (body.stateOfResidence !== undefined)
    values.stateOfResidence = body.stateOfResidence;
  if (body.employmentType !== undefined)
    values.employmentType = body.employmentType;
  if (body.riskTolerance !== undefined)
    values.riskTolerance = body.riskTolerance;
  if (body.retirementAge !== undefined)
    values.retirementAge = body.retirementAge;
  if (body.employerMatchPercent !== undefined)
    values.employerMatch = body.employerMatchPercent?.toString() ?? null;

  if (existing) {
    await db
      .update(financialProfiles)
      .set(values)
      .where(eq(financialProfiles.tenantId, session.tenantId));
  } else {
    await db.insert(financialProfiles).values({
      tenantId: session.tenantId,
      ...values,
    });
  }

  return c.json({ ok: true });
});
