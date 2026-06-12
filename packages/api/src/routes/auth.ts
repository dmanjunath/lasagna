import { Hono, type Context } from "hono";
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
import { generateInsights } from "../lib/insights-engine.js";

export const authRoutes = new Hono<AuthEnv>();

// Browsers (Chrome, Safari) refuse to STORE a `Secure; SameSite=None` cookie that
// arrives over plain HTTP. In local dev the Vite proxy serves over http://localhost,
// so we have to fall back to Lax + non-Secure or the session never sticks. In prod
// (HTTPS origin) we keep None+Secure so it works across subdomains / oauth bounces.
function cookieFlagsFor(c: Context) {
  const origin = c.req.header("origin") || c.req.header("referer") || "";
  const isHttps = origin.startsWith("https://");
  return {
    secure: isHttps,
    sameSite: (isHttps ? "None" : "Lax") as "None" | "Lax",
  };
}

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
      name: name ?? null,
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
    ...cookieFlagsFor(c),
    maxAge: MAX_AGE,
    path: "/",
  });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      onboardingStage: user.onboardingStage,
      isAdmin: user.isAdmin,
    },
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
    ...cookieFlagsFor(c),
    maxAge: MAX_AGE,
    path: "/",
  });

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, user.tenantId),
  });

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      onboardingStage: user.onboardingStage,
      isAdmin: user.isAdmin,
    },
    tenant: tenant
      ? { id: tenant.id, name: tenant.name, plan: tenant.plan }
      : null,
  });
});

// Logout
authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/", ...cookieFlagsFor(c) });
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
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      onboardingStage: user.onboardingStage,
      isAdmin: user.isAdmin,
      notifyDaily: user.notifyDaily,
      notifyBills: user.notifyBills,
      notifyWeeklyEmail: user.notifyWeeklyEmail,
    },
    tenant: tenant
      ? { id: tenant.id, name: tenant.name, plan: tenant.plan }
      : null,
  });
});

// Update profile (name, notification prefs)
authRoutes.patch("/me", requireAuth, async (c) => {
  const session = c.get("session");
  const body = await c.req.json<{
    name?: string | null;
    notifyDaily?: boolean;
    notifyBills?: boolean;
    notifyWeeklyEmail?: boolean;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.notifyDaily !== undefined) updates.notifyDaily = body.notifyDaily;
  if (body.notifyBills !== undefined) updates.notifyBills = body.notifyBills;
  if (body.notifyWeeklyEmail !== undefined) updates.notifyWeeklyEmail = body.notifyWeeklyEmail;

  if (Object.keys(updates).length === 0) {
    const existing = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
    if (!existing) return c.json({ error: "User not found" }, 404);
    return c.json({
      user: {
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role,
        onboardingStage: existing.onboardingStage,
        isAdmin: existing.isAdmin,
        notifyDaily: existing.notifyDaily,
        notifyBills: existing.notifyBills,
        notifyWeeklyEmail: existing.notifyWeeklyEmail,
      },
    });
  }

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.id, session.userId))
    .returning();

  return c.json({
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      onboardingStage: updated.onboardingStage,
      isAdmin: updated.isAdmin,
      notifyDaily: updated.notifyDaily,
      notifyBills: updated.notifyBills,
      notifyWeeklyEmail: updated.notifyWeeklyEmail,
    },
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

  // Snapshot the pre-update stage so we can detect the transition from
  // "in onboarding" → "complete" and trigger first-run insights exactly once.
  const before = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { onboardingStage: true },
  });

  const [updated] = await db
    .update(users)
    .set({ onboardingStage: stage as typeof onboardingStageEnum.enumValues[number] | null })
    .where(eq(users.id, session.userId))
    .returning();

  // Just completed onboarding (any path — quick import or step-by-step).
  // Fire-and-forget so the dashboard redirect isn't blocked by the LLM call.
  if (before?.onboardingStage !== null && updated.onboardingStage === null) {
    void generateInsights(session.tenantId).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Onboarding complete] insights generation failed: ${msg.slice(0, 300)}`);
    });
  }

  return c.json({ onboardingStage: updated.onboardingStage });
});
