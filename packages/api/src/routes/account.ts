import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { eq, users } from "@lasagna/core";
import { db } from "../lib/db.js";
import { COOKIE_NAME } from "../lib/session.js";
import { type AuthEnv } from "../middleware/auth.js";
import * as workos from "../lib/auth/workos.js";
import { authMode } from "../lib/auth/mode.js";
import { deleteTenantAccount } from "../lib/account-deletion.js";
import { verifyPassword } from "../lib/password.js";
import { cookieFlagsFor } from "./auth.js";

export const accountRouter = new Hono<AuthEnv>();

// Self-serve account deletion (App Store guideline 5.1.1(v)) — a two-step
// flow: re-authenticate, then delete. An account with a password confirms with
// it; a passwordless one gets an emailed Magic Auth code.

// Step 1: send a verification code to the signed-in user's email.
accountRouter.post("/deletion-code", async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const session = c.get("session");
  if (session.isDemo) return c.json({ error: "Demo accounts cannot be deleted" }, 403);
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { email: true },
  });
  if (!user) return c.json({ error: "User not found" }, 404);
  try { await workos.sendMagicAuth({ email: user.email }); }
  catch (err) {
    console.error("[AccountDeletion] sendMagicAuth failed:", workos.friendlyError(err, String(err)));
    return c.json({ error: "Could not send verification code. Please try again." }, 502);
  }
  return c.json({ ok: true });
});

// Step 2: verify the code, then delete the tenant (Plaid → Stripe → WorkOS → row).
accountRouter.delete("/", async (c) => {
  if (authMode() !== "workos") return c.json({ error: "Not supported" }, 501);
  const session = c.get("session");
  if (session.isDemo) return c.json({ error: "Demo accounts cannot be deleted" }, 403);
  if (session.isAdmin) return c.json({ error: "Operator accounts cannot self-delete" }, 403);
  if (session.role !== "owner") return c.json({ error: "Only the account owner can delete the account" }, 403);

  const body = await c.req
    .json<{ code?: string; password?: string }>()
    .catch(() => ({ code: undefined, password: undefined }));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!code && !password) return c.json({ error: "Password or verification code required" }, 400);

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { email: true, passwordHash: true, workosUserId: true },
  });
  if (!user) return c.json({ error: "User not found" }, 404);

  if (password) {
    // Both branches mirror POST /login. A seeded account holds its own hash and
    // WorkOS has never heard of it, so asking WorkOS would reject the only
    // password it has. An unverified WorkOS account resolves to
    // needs_verification rather than throwing, and that is not proof either.
    if (user.passwordHash && !user.workosUserId) {
      if (!(await verifyPassword(password, user.passwordHash)))
        return c.json({ error: "Incorrect password" }, 401);
    } else {
      let r;
      try { r = await workos.login({ email: user.email, password }); }
      catch { return c.json({ error: "Incorrect password" }, 401); }
      if (r.status !== "ok") return c.json({ error: "Incorrect password" }, 401);
    }
  } else {
    try { await workos.authenticateWithMagicAuth({ email: user.email, code }); }
    catch { return c.json({ error: "Invalid or expired code" }, 401); }
  }

  // Deletion cascades from the tenant row, so it would take down every member
  // of a shared household. Refuse until the other members are removed first.
  const tenantUsers = await db.query.users.findMany({
    where: eq(users.tenantId, session.tenantId),
    columns: { id: true, email: true },
  });
  if (tenantUsers.length > 1) {
    const blockingUsers = tenantUsers.filter((u) => u.id !== session.userId).map((u) => u.email);
    return c.json({
      error: "This household has other members. Remove them before deleting the account.",
      blockingUsers,
    }, 409);
  }

  const summary = await deleteTenantAccount(session.tenantId);
  deleteCookie(c, COOKIE_NAME, { path: "/", ...cookieFlagsFor(c) });
  return c.json({ ok: true, ...summary });
});
