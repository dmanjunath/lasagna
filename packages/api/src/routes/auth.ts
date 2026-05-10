import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { eq, users, tenants, onboardingStageEnum } from "@lasagna/core";
import { db } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  createSessionToken,
  COOKIE_NAME,
  MAX_AGE,
} from "../lib/session.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";

export const authRoutes = new Hono<AuthEnv>();

// Sign up — creates a new tenant + user (owner)
authRoutes.post("/signup", async (c) => {
  const { email, password, name, acceptedTos, acceptedPrivacy, acceptedNotRia } = await c.req.json<{
    email: string;
    password: string;
    name?: string;
    acceptedTos?: boolean;
    acceptedPrivacy?: boolean;
    acceptedNotRia?: boolean;
  }>();

  if (!email || !password) {
    return c.json({ error: "Email and password are required" }, 400);
  }

  if (!acceptedTos || !acceptedPrivacy || !acceptedNotRia) {
    return c.json({ error: "You must accept the Terms of Service, Privacy Policy, and RIA acknowledgment" }, 400);
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    return c.json({ error: "Email already registered" }, 409);
  }

  const passwordHash = await hashPassword(password);

  const [tenant] = await db
    .insert(tenants)
    .values({ name: name || email.split("@")[0] })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email,
      passwordHash,
      role: "owner",
      onboardingStage: "profile",
    })
    .returning();

  const token = await createSessionToken({
    userId: user.id,
    tenantId: tenant.id,
    role: user.role,
    isDemo: false,
  });

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    maxAge: MAX_AGE,
    path: "/",
  });

  return c.json({
    user: { id: user.id, email: user.email, role: user.role, onboardingStage: user.onboardingStage },
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan },
  });
});

// Login
authRoutes.post("/login", async (c) => {
  const { email, password } = await c.req.json<{
    email: string;
    password: string;
  }>();

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (!user) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const token = await createSessionToken({
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    isDemo: user.isDemo,
  });

  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    maxAge: MAX_AGE,
    path: "/",
  });

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, user.tenantId),
  });

  return c.json({
    user: { id: user.id, email: user.email, role: user.role, onboardingStage: user.onboardingStage },
    tenant: tenant
      ? { id: tenant.id, name: tenant.name, plan: tenant.plan }
      : null,
  });
});

// Logout
authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/", secure: true, sameSite: "None" });
  return c.json({ ok: true });
});

// Get current user
authRoutes.get("/me", requireAuth, async (c) => {
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
    user: { id: user.id, email: user.email, role: user.role, onboardingStage: user.onboardingStage },
    tenant: tenant
      ? { id: tenant.id, name: tenant.name, plan: tenant.plan }
      : null,
  });
});

// Update onboarding stage
const VALID_STAGES = new Set(onboardingStageEnum.enumValues);

authRoutes.patch("/onboarding-stage", requireAuth, async (c) => {
  const session = c.get("session");
  const { stage } = await c.req.json<{ stage: string | null }>();

  if (stage !== null && !VALID_STAGES.has(stage as typeof onboardingStageEnum.enumValues[number])) {
    return c.json({ error: "Invalid onboarding stage" }, 400);
  }

  const [updated] = await db
    .update(users)
    .set({ onboardingStage: stage as typeof onboardingStageEnum.enumValues[number] | null })
    .where(eq(users.id, session.userId))
    .returning();

  return c.json({ onboardingStage: updated.onboardingStage });
});
