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
import { resolveTenantPlan } from "../lib/billing.js";
import { createOauthState, statesMatch, OAUTH_STATE_COOKIE } from "../lib/auth/state.js";

export const authRoutes = new Hono<AuthEnv>();

// Browsers (Chrome, Safari) refuse to STORE a `Secure; SameSite=None` cookie that
// arrives over plain HTTP. In local dev the Vite proxy serves over http://localhost,
// so we have to fall back to Lax + non-Secure or the session never sticks. In prod
// (HTTPS origin) we keep None+Secure so it works across subdomains / oauth bounces.
export function cookieFlagsFor(c: Context) {
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
export async function issueSession(
  c: Context,
  u: { id: string; tenantId: string; role: string; isDemo?: boolean; isAdmin?: boolean },
  flags: { secure: boolean; sameSite: "None" | "Lax" } = cookieFlagsFor(c),
): Promise<string> {
  const token = await createSessionToken({ userId: u.id, tenantId: u.tenantId, role: u.role, isDemo: u.isDemo ?? false, isAdmin: u.isAdmin ?? false });
  setCookie(c, COOKIE_NAME, token, { httpOnly: true, ...flags, maxAge: MAX_AGE, path: "/" });
  // Every session issuance is a login (password, Google, verify-email).
  db.update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, u.id))
    .catch((e: unknown) => console.error("lastLoginAt update failed:", e));
  return token;
}

// The Capacitor shell can't rely on the httpOnly cookie (capacitor://localhost
// is cross-origin to the API), so native clients get the token in the login
// response body and send it back as an Authorization: Bearer header.
export function nativeTokenField(c: Context, token: string): { token?: string } {
  return c.req.header("x-lasagna-client") === "native" ? { token } : {};
}
function userPayload(u: any) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, onboardingStage: u.onboardingStage, isAdmin: u.isAdmin, hasAcceptedTerms: u.acceptedTermsAt != null, hasPassword: u.hasPassword, lastLoginAt: u.lastLoginAt };
}

// Sign up — creates a new tenant + user (owner)
authRoutes.post("/signup", async (c) => {
  const { email, password, name, acceptedTos, acceptedPrivacy, acceptedNotRia } = await c.req.json();
  if (!email) return c.json({ error: "Email is required" }, 400);
  if (!acceptedTos || !acceptedPrivacy || !acceptedNotRia)
    return c.json({ error: "You must accept the Terms of Service, Privacy Policy, and RIA acknowledgment" }, 400);

  if (authMode() === "workos") {
    try {
      // Password is optional — passwordless accounts sign in with emailed codes.
      const r = await workos.signUp({ email, password: password || undefined, name });
      return c.json({ needsVerification: true, email: r.email });
    } catch (err) {
      return c.json({ error: workos.friendlyError(err, "Could not create your account. Please check your details and try again.") }, 400);
    }
  }

  // Local mode still requires a password.
  if (!password) return c.json({ error: "Password is required" }, 400);
  const res = await localSignUp({ email, password, name });
  if (res.conflict) return c.json({ error: "Email already registered" }, 409);
  const token = await issueSession(c, res.user);
  return c.json({ user: userPayload(res.user), tenant: res.tenant ? { id: res.tenant.id, name: res.tenant.name, plan: res.tenant.plan } : null, ...nativeTokenField(c, token) });
});

// Login
authRoutes.post("/login", async (c) => {
  const { email, password } = await c.req.json();

  // Local-account bypass — demo and local-only users (a stored password hash
  // and NO WorkOS link) authenticate against the local hash even in workos
  // mode. WorkOS-linked users (workosUserId set) always go through WorkOS.
  const localUser = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (localUser?.passwordHash && !localUser.workosUserId) {
    if (!(await verifyPassword(password, localUser.passwordHash)))
      return c.json({ error: "Invalid email or password" }, 401);
    const token = await issueSession(c, localUser);
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, localUser.tenantId) });
    return c.json({ user: userPayload(localUser), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: await resolveTenantPlan(tenant.id) } : null, ...nativeTokenField(c, token) });
  }

  if (authMode() === "workos") {
    let r;
    try { r = await workos.login({ email, password }); }
    catch { return c.json({ error: "Invalid email or password" }, 401); }
    if (r.status === "needs_verification")
      return c.json({ needsVerification: true, email: r.email });
    const { user, tenant } = await provisionUser(r.identity);
    const token = await issueSession(c, user);
    return c.json({ user: userPayload(user), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: await resolveTenantPlan(tenant.id) } : null, ...nativeTokenField(c, token) });
  }

  const user = await localLogin({ email, password });
  if (!user) return c.json({ error: "Invalid email or password" }, 401);
  const token = await issueSession(c, user);
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
  return c.json({ user: userPayload(user), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: await resolveTenantPlan(tenant.id) } : null, ...nativeTokenField(c, token) });
});

// ── Two-step (email-first) login ──────────────────────────────────────────
// Step 1: decide whether this account uses a password or an emailed code.
authRoutes.post("/login/start", async (c) => {
  const { email } = await c.req.json<{ email?: string }>();
  if (!email) return c.json({ error: "Email is required" }, 400);
  // Local mode → always password.
  if (authMode() !== "workos") return c.json({ step: "password" as const });
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  // Mirror the /login local-account bypass: demo + local-only accounts (local hash,
  // no WorkOS link) authenticate by password. Also any account that has a password.
  if ((user?.passwordHash && !user.workosUserId) || user?.hasPassword)
    return c.json({ step: "password" as const });
  // Passwordless account → send a code. Unknown email → send nothing (no enumeration).
  if (user) { try { await workos.sendMagicAuth({ email }); } catch { /* swallow */ } }
  return c.json({ step: "code" as const });
});

// On-demand Magic Auth send: "Email a code instead" + "Resend". Checks WorkOS (not the
// local table) so it also works during signup (WorkOS user exists, local row does not yet).
authRoutes.post("/login/send-code", async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const { email } = await c.req.json<{ email?: string }>();
  try { if (email && (await workos.hasWorkosUser(email))) await workos.sendMagicAuth({ email }); } catch { /* no enumeration */ }
  return c.json({ ok: true });
});

// Step 2 (code path) for LOGIN — no consent write (returning users).
authRoutes.post("/login/code", async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const { email, code } = await c.req.json<{ email?: string; code?: string }>();
  if (!email || !code) return c.json({ error: "Email and code are required" }, 400);
  let identity;
  try { identity = await workos.authenticateWithMagicAuth({ email, code }); }
  catch { return c.json({ error: "Invalid or expired code" }, 400); }
  const { user, tenant } = await provisionUser(identity);
  const token = await issueSession(c, user);
  return c.json({ user: userPayload(user), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: await resolveTenantPlan(tenant.id) } : null, ...nativeTokenField(c, token) });
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
      hasPassword: user.hasPassword,
      lastLoginAt: user.lastLoginAt,
      notifyDaily: user.notifyDaily,
      notifyBills: user.notifyBills,
      notifyWeeklyEmail: user.notifyWeeklyEmail,
    },
    tenant: tenant
      ? { id: tenant.id, name: tenant.name, plan: await resolveTenantPlan(tenant.id) }
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
        hasPassword: existing.hasPassword,
        lastLoginAt: existing.lastLoginAt,
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
      hasPassword: updated.hasPassword,
      lastLoginAt: updated.lastLoginAt,
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

// Signup email verification — Magic Auth (email-keyed), writes consent + hasPassword.
authRoutes.post("/verify-email", async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const { email, code, setPassword, acceptedTos, acceptedPrivacy, acceptedNotRia } = await c.req.json();
  if (!acceptedTos || !acceptedPrivacy || !acceptedNotRia)
    return c.json({ error: "You must accept all agreements" }, 400);
  let identity;
  try { identity = await workos.authenticateWithMagicAuth({ email, code }); }
  catch { return c.json({ error: "Invalid or expired code" }, 400); }
  const { user, tenant } = await provisionUser({ ...identity, acceptedTerms: true, hasPassword: Boolean(setPassword) });
  const token = await issueSession(c, user);
  return c.json({ user: userPayload(user), tenant: tenant ? { id: tenant.id, name: tenant.name, plan: await resolveTenantPlan(tenant.id) } : null, ...nativeTokenField(c, token) });
});

// Set or change the account password (Settings). WorkOS-only; flips users.hasPassword.
authRoutes.post("/set-password", requireAuth, async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const session = c.get("session");
  const { password } = await c.req.json<{ password?: string }>();
  if (!password || password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user?.workosUserId) return c.json({ error: "No linked account" }, 400);
  try { await workos.setPassword({ workosUserId: user.workosUserId, password }); }
  catch (err) { return c.json({ error: workos.friendlyError(err, "Could not set password.") }, 400); }
  await db.update(users).set({ hasPassword: true }).where(eq(users.id, session.userId));
  return c.json({ ok: true });
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
