import { Hono, type Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { eq, users, tenants, onboardingStageEnum } from "@lasagna/core";
import { db } from "../lib/db.js";
import { verifyPassword } from "../lib/password.js";
import {
  createSessionToken,
  COOKIE_NAME,
  MAX_AGE,
} from "../lib/session.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { generateInsights } from "../lib/insights-engine.js";
import { env } from "../lib/env.js";
import { authMode } from "../lib/auth/mode.js";
import * as workos from "../lib/auth/workos.js";
import { localSignUp, localLogin } from "../lib/auth/local.js";
import { provisionUser } from "../lib/auth/provision.js";
import { createOauthState, statesMatch, OAUTH_STATE_COOKIE } from "../lib/auth/state.js";

const DEMO_EMAIL = "demo@lasagnafi.com";

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

// The OAuth callback's Referer is the WorkOS/Google IdP, not our app, so cookieFlagsFor(c)
// would wrongly pick Secure/None on the http://localhost dev callback (browser refuses to
// store it → session silently lost). Derive flags from APP_URL instead for OAuth responses.
function appUrlCookieFlags() {
  const isHttps = env.APP_URL.startsWith("https://");
  return { secure: isHttps, sameSite: (isHttps ? "None" : "Lax") as "None" | "Lax" };
}
async function issueSession(
  c: Context,
  u: { id: string; tenantId: string; role: string; isDemo?: boolean },
  flags: { secure: boolean; sameSite: "None" | "Lax" } = cookieFlagsFor(c),
) {
  const token = await createSessionToken({ userId: u.id, tenantId: u.tenantId, role: u.role, isDemo: u.isDemo ?? false });
  setCookie(c, COOKIE_NAME, token, { httpOnly: true, ...flags, maxAge: MAX_AGE, path: "/" });
}
function userPayload(u: any) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, onboardingStage: u.onboardingStage, isAdmin: u.isAdmin, hasAcceptedTerms: u.acceptedTermsAt != null };
}

// Sign up — creates a new tenant + user (owner)
authRoutes.post("/signup", async (c) => {
  const { email, password, name, acceptedTos, acceptedPrivacy, acceptedNotRia } = await c.req.json();
  if (!email || !password) return c.json({ error: "Email and password are required" }, 400);
  if (!acceptedTos || !acceptedPrivacy || !acceptedNotRia)
    return c.json({ error: "You must accept the Terms of Service, Privacy Policy, and RIA acknowledgment" }, 400);

  if (authMode() === "workos") {
    try {
      const r = await workos.signUp({ email, password, name });
      return c.json({ needsVerification: true, workosUserId: r.workosUserId, email: r.email });
    } catch (err) {
      return c.json({ error: workos.friendlyError(err, "Could not create your account. Please check your details and try again.") }, 400);
    }
  }

  const res = await localSignUp({ email, password, name });
  if (res.conflict) return c.json({ error: "Email already registered" }, 409);
  await issueSession(c, res.user);
  return c.json({ user: userPayload(res.user), tenant: res.tenant ? { id: res.tenant.id, name: res.tenant.name, plan: res.tenant.plan } : null });
});

// Login
authRoutes.post("/login", async (c) => {
  const { email, password } = await c.req.json();

  // Demo bypass — always local, never WorkOS.
  if (email === DEMO_EMAIL) {
    const demo = await db.query.users.findFirst({ where: eq(users.email, DEMO_EMAIL) });
    if (!demo || !demo.passwordHash || !(await verifyPassword(password, demo.passwordHash)))
      return c.json({ error: "Invalid email or password" }, 401);
    await issueSession(c, demo);
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, demo.tenantId) });
    return c.json({ user: userPayload(demo), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: tenant.plan } : null });
  }

  if (authMode() === "workos") {
    let r;
    try { r = await workos.login({ email, password }); }
    catch { return c.json({ error: "Invalid email or password" }, 401); }
    if (r.status === "needs_verification")
      return c.json({ needsVerification: true, workosUserId: r.workosUserId, email: r.email });
    const { user, tenant } = await provisionUser(r.identity);
    await issueSession(c, user);
    return c.json({ user: userPayload(user), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: tenant.plan } : null });
  }

  const user = await localLogin({ email, password });
  if (!user) return c.json({ error: "Invalid email or password" }, 401);
  await issueSession(c, user);
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
  return c.json({ user: userPayload(user), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: tenant.plan } : null });
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
      hasAcceptedTerms: user.acceptedTermsAt != null,
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
        hasAcceptedTerms: existing.acceptedTermsAt != null,
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
      hasAcceptedTerms: updated.acceptedTermsAt != null,
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

authRoutes.post("/verify-email", async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const { workosUserId, code, acceptedTos, acceptedPrivacy, acceptedNotRia } = await c.req.json();
  if (!acceptedTos || !acceptedPrivacy || !acceptedNotRia)
    return c.json({ error: "You must accept all agreements" }, 400);
  let identity;
  try { identity = await workos.verifyEmailCode({ workosUserId, code }); }
  catch { return c.json({ error: "Invalid or expired code" }, 400); }
  const { user, tenant } = await provisionUser({ ...identity, acceptedTerms: true });
  await issueSession(c, user);
  return c.json({ user: userPayload(user), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: tenant.plan } : null });
});

authRoutes.post("/forgot-password", async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const { email } = await c.req.json();
  try { if (email) await workos.sendPasswordReset({ email }); } catch { /* no enumeration */ }
  return c.json({ ok: true });
});

authRoutes.post("/reset-password", async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const { token, newPassword } = await c.req.json();
  if (!token || !newPassword || newPassword.length < 8) return c.json({ error: "Invalid request" }, 400);
  try { await workos.resetPassword({ token, newPassword }); }
  catch (err) { return c.json({ error: workos.friendlyError(err, "Reset link is invalid or expired, or the new password is too weak.") }, 400); }
  return c.json({ ok: true });
});

authRoutes.post("/accept-terms", requireAuth, async (c) => {
  const session = c.get("session");
  await db.update(users).set({ acceptedTermsAt: new Date() }).where(eq(users.id, session.userId));
  return c.json({ ok: true });
});

authRoutes.get("/google/start", (c) => {
  if (authMode() !== "workos") return c.redirect(`${env.APP_URL}/?error=google_unavailable`);
  const state = createOauthState();
  // APP_URL-derived flags: this cookie must survive the round-trip back from the IdP.
  setCookie(c, OAUTH_STATE_COOKIE, state, { httpOnly: true, ...appUrlCookieFlags(), maxAge: 600, path: "/" });
  return c.redirect(workos.googleAuthUrl({ state, redirectUri: env.WORKOS_REDIRECT_URI }));
});

authRoutes.get("/google/callback", async (c) => {
  if (authMode() !== "workos") return c.redirect(`${env.APP_URL}/`);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/", ...appUrlCookieFlags() });
  if (!code || !statesMatch(state, cookieState)) return c.redirect(`${env.APP_URL}/?error=oauth`);

  let identity;
  try { identity = await workos.handleCallback({ code }); }
  catch { return c.redirect(`${env.APP_URL}/?error=oauth`); }

  const { user, isNew } = await provisionUser(identity);
  // Referer here is the IdP, so pass APP_URL-derived flags explicitly.
  await issueSession(c, user, appUrlCookieFlags());
  if (isNew && user.acceptedTermsAt == null) return c.redirect(`${env.APP_URL}/welcome/consent`);
  return c.redirect(`${env.APP_URL}/`);
});
