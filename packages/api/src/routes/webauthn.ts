import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { eq, and, users, tenants, webauthnCredentials } from "@lasagna/core";
import { db } from "../lib/db.js";
import { env } from "../lib/env.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { issueSession, cookieFlagsFor } from "./auth.js";
import { resolveTenantPlan } from "../lib/billing.js";

/**
 * WebAuthn / passkey routes — Face ID / Touch ID sign-in.
 * Mounted at /api/auth/webauthn (see server.ts).
 *
 * The in-flight challenge travels in a short-lived HMAC-signed cookie
 * (same ENCRYPTION_KEY as sessions), so no server-side challenge store
 * is needed.
 */
export const webauthnRoutes = new Hono<AuthEnv>();

const rpID = new URL(env.APP_URL).hostname;
const rpName = "LasagnaFi";
const expectedOrigin = env.APP_URL;

const CHALLENGE_COOKIE = "lasagna_webauthn_challenge";
const CHALLENGE_TTL = 300; // seconds

async function challengeKey() {
  return globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ENCRYPTION_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signChallenge(payload: { challenge: string; userId?: string }): Promise<string> {
  const data = JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL });
  const sig = await globalThis.crypto.subtle.sign("HMAC", await challengeKey(), new TextEncoder().encode(data));
  return `${Buffer.from(data).toString("base64url")}.${Buffer.from(sig).toString("base64url")}`;
}

async function verifyChallenge(token: string): Promise<{ challenge: string; userId?: string } | null> {
  try {
    const [b64Data, b64Sig] = token.split(".");
    if (!b64Data || !b64Sig) return null;
    const data = Buffer.from(b64Data, "base64url").toString();
    const valid = await globalThis.crypto.subtle.verify(
      "HMAC",
      await challengeKey(),
      Buffer.from(b64Sig, "base64url"),
      new TextEncoder().encode(data),
    );
    if (!valid) return null;
    const parsed = JSON.parse(data);
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { challenge: parsed.challenge, userId: parsed.userId };
  } catch {
    return null;
  }
}

// ── Registration (authed) ───────────────────────────────────────────────────

webauthnRoutes.post("/register/options", requireAuth, async (c) => {
  const session = c.get("session");
  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  const existing = await db.query.webauthnCredentials.findMany({
    where: eq(webauthnCredentials.userId, user.id),
  });

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(user.id),
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    attestationType: "none",
    excludeCredentials: existing.map((cred) => ({
      id: cred.id,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  setCookie(c, CHALLENGE_COOKIE, await signChallenge({ challenge: options.challenge, userId: user.id }), {
    httpOnly: true,
    ...cookieFlagsFor(c),
    maxAge: CHALLENGE_TTL,
    path: "/",
  });
  return c.json(options);
});

webauthnRoutes.post("/register/verify", requireAuth, async (c) => {
  const session = c.get("session");
  const { response, deviceName } = await c.req.json();

  const token = getCookie(c, CHALLENGE_COOKIE);
  const stored = token ? await verifyChallenge(token) : null;
  deleteCookie(c, CHALLENGE_COOKIE, { path: "/", ...cookieFlagsFor(c) });
  if (!stored || stored.userId !== session.userId)
    return c.json({ error: "Registration expired — try again" }, 400);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
  } catch (err) {
    console.error("webauthn register verify failed:", err);
    return c.json({ error: "Could not verify this passkey" }, 400);
  }
  if (!verification.verified || !verification.registrationInfo)
    return c.json({ error: "Could not verify this passkey" }, 400);

  const { credential } = verification.registrationInfo;
  await db
    .insert(webauthnCredentials)
    .values({
      id: credential.id,
      userId: session.userId,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
      deviceName: typeof deviceName === "string" && deviceName.trim() ? deviceName.trim().slice(0, 255) : null,
    })
    .onConflictDoNothing();

  return c.json({ ok: true });
});

// ── Authentication (unauthed — this IS the login) ───────────────────────────

webauthnRoutes.post("/login/options", async (c) => {
  // Discoverable credentials: the authenticator offers the matching passkey,
  // so no email/allowCredentials needed up front.
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [],
    userVerification: "preferred",
  });
  setCookie(c, CHALLENGE_COOKIE, await signChallenge({ challenge: options.challenge }), {
    httpOnly: true,
    ...cookieFlagsFor(c),
    maxAge: CHALLENGE_TTL,
    path: "/",
  });
  return c.json(options);
});

webauthnRoutes.post("/login/verify", async (c) => {
  const { response } = await c.req.json();

  const token = getCookie(c, CHALLENGE_COOKIE);
  const stored = token ? await verifyChallenge(token) : null;
  deleteCookie(c, CHALLENGE_COOKIE, { path: "/", ...cookieFlagsFor(c) });
  if (!stored) return c.json({ error: "Sign-in expired — try again" }, 400);

  const credId: string | undefined = response?.id;
  if (!credId) return c.json({ error: "Invalid passkey response" }, 400);

  const cred = await db.query.webauthnCredentials.findFirst({
    where: eq(webauthnCredentials.id, credId),
  });
  if (!cred) return c.json({ error: "Passkey not recognized" }, 401);

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: cred.id,
        publicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
        transports: cred.transports ? JSON.parse(cred.transports) : undefined,
      },
    });
  } catch (err) {
    console.error("webauthn login verify failed:", err);
    return c.json({ error: "Could not verify this passkey" }, 401);
  }
  if (!verification.verified) return c.json({ error: "Could not verify this passkey" }, 401);

  await db
    .update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.id, cred.id));

  const user = await db.query.users.findFirst({ where: eq(users.id, cred.userId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  await issueSession(c, user);
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, user.tenantId) });
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      onboardingStage: user.onboardingStage,
      isAdmin: user.isAdmin,
      hasAcceptedTerms: user.acceptedTermsAt != null,
    },
    tenant: tenant ? { id: tenant.id, name: tenant.name, plan: await resolveTenantPlan(tenant.id) } : null,
  });
});

// ── Credential management (authed, for Settings) ───────────────────────────

webauthnRoutes.get("/credentials", requireAuth, async (c) => {
  const session = c.get("session");
  const creds = await db.query.webauthnCredentials.findMany({
    where: eq(webauthnCredentials.userId, session.userId),
  });
  return c.json({
    credentials: creds.map((cr) => ({
      id: cr.id,
      deviceName: cr.deviceName,
      createdAt: cr.createdAt,
      lastUsedAt: cr.lastUsedAt,
    })),
  });
});

webauthnRoutes.delete("/credentials/:id", requireAuth, async (c) => {
  const session = c.get("session");
  await db
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, c.req.param("id")), eq(webauthnCredentials.userId, session.userId)));
  return c.json({ ok: true });
});
