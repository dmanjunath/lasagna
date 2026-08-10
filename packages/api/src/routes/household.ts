import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { and, eq, isNull, desc, invites, users, tenants } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
import { COOKIE_NAME } from "../lib/session.js";
import { removeUserRow } from "../lib/auth/remove-user.js";
import { normalizeEmail } from "../lib/normalize-email.js";
import { cookieFlagsFor } from "./auth.js";
import {
  createInvite,
  resolveInvite,
  type CreateInviteDeps,
  type InviteRow,
} from "../lib/invites.js";
import { sendInviteEmail } from "../lib/auth/invite-email.js";

export const householdRoutes = new Hono<AuthEnv>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The household admin actions (invite/list/revoke) are restricted to the
// tenant's single owner; members/viewers get 403.

// ── Create an invite (owner only) ───────────────────────────────────────────
householdRoutes.post("/invites", async (c) => {
  const session = c.get("session");
  if (session.role !== "owner") return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
  const email = normalizeEmail(body.email);
  if (!EMAIL_RE.test(email)) return c.json({ error: "Invalid email address" }, 400);

  // No silent merge: an email that already has an account can't be invited.
  const existing = await db.query.users.findFirst({ where: eq(users.email, email), columns: { id: true } });
  if (existing) {
    return c.json(
      { error: "That email already has a Lasagna account. Contact support to merge households." },
      409,
    );
  }

  const deps: CreateInviteDeps = {
    findPending: async (tenantId, e) =>
      (await db.query.invites.findFirst({
        where: and(eq(invites.tenantId, tenantId), eq(invites.email, e), isNull(invites.acceptedAt), isNull(invites.revokedAt)),
      })) as InviteRow | undefined,
    revokeInvite: async (id) => {
      await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));
    },
    insertInvite: async (row) => {
      const [created] = await db.insert(invites).values(row).returning();
      return created as InviteRow;
    },
  };

  const invite = await createInvite(deps, {
    tenantId: session.tenantId,
    email,
    role: "member",
    invitedByUserId: session.userId,
  });

  // Best-effort email; the token in the URL is the security primitive. Name the
  // inviter so the email reads "<name> invited you" rather than "Someone".
  const inviter = await db.query.users.findFirst({
    where: eq(users.id, session.userId),
    columns: { name: true },
  });
  await sendInviteEmail({ email, inviterName: inviter?.name ?? null, token: invite.token });

  // Never leak the token in the owner-facing response.
  return c.json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt } });
});

// ── List pending invites (owner only) ───────────────────────────────────────
householdRoutes.get("/invites", async (c) => {
  const session = c.get("session");
  if (session.role !== "owner") return c.json({ error: "Forbidden" }, 403);
  const rows = await db
    .select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt, createdAt: invites.createdAt })
    .from(invites)
    .where(and(eq(invites.tenantId, session.tenantId), isNull(invites.acceptedAt), isNull(invites.revokedAt)))
    .orderBy(desc(invites.createdAt));
  return c.json({ invites: rows });
});

// ── Revoke a pending invite (owner only) ────────────────────────────────────
householdRoutes.delete("/invites/:id", async (c) => {
  const session = c.get("session");
  if (session.role !== "owner") return c.json({ error: "Forbidden" }, 403);
  const id = c.req.param("id");
  await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, id), eq(invites.tenantId, session.tenantId)));
  return c.json({ ok: true });
});

// ── Public token validate / summary for the /accept-invite page ─────────────
// Reachable UNAUTHENTICATED via the startsWith("/api/household/invite/")
// exemption in server.ts's /api/* guard. A bad/stale token returns just the
// resolve status, never the invite itself.
householdRoutes.get("/invite/:token", async (c) => {
  const token = c.req.param("token");
  const invite = (await db.query.invites.findFirst({ where: eq(invites.token, token) })) as
    | (InviteRow & { invitedByUserId: string })
    | undefined;
  const result = resolveInvite(invite);
  if (result.status !== "ok") return c.json({ status: result.status });

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, result.invite.tenantId),
    columns: { name: true },
  });
  const inviter = await db.query.users.findFirst({
    where: eq(users.id, invite!.invitedByUserId),
    columns: { name: true },
  });
  return c.json({
    status: "ok",
    householdName: tenant?.name ?? null,
    inviterName: inviter?.name ?? null,
  });
});

// ── Member management ───────────────────────────────────────────────────────
// Removing a member deletes their `users` row (cascade removes their
// userProfiles + chatThreads/messages) and invalidates their sessions (the auth
// guard's users.findFirst then returns undefined → 401). The household's pooled,
// tenant-scoped financial data is untouched. The OWNER can't be removed or leave
// — they use the account-deletion flow instead. A member can only remove
// themselves (leave), not others.

// ── List members (any member of the household) ──────────────────────────────
householdRoutes.get("/members", async (c) => {
  const session = c.get("session");
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.tenantId, session.tenantId));
  return c.json({ members: rows.map((u) => ({ ...u, isYou: u.id === session.userId })) });
});

// ── Remove a member (owner only; owner can't be removed) ────────────────────
householdRoutes.delete("/members/:userId", async (c) => {
  const session = c.get("session");
  if (session.role !== "owner") return c.json({ error: "Forbidden" }, 403);
  const userId = c.req.param("userId");
  const target = await db.query.users.findFirst({
    where: and(eq(users.id, userId), eq(users.tenantId, session.tenantId)),
    columns: { id: true, role: true, workosUserId: true },
  });
  if (!target) return c.json({ error: "Member not found" }, 404);
  if (target.role === "owner") {
    return c.json({ error: "The owner can't be removed — delete the household instead." }, 400);
  }
  await removeUserRow(session.tenantId, target);
  return c.json({ ok: true });
});

// ── Leave the household (self; owner can't leave) ───────────────────────────
householdRoutes.post("/leave", async (c) => {
  const session = c.get("session");
  if (session.role === "owner") {
    return c.json({ error: "The owner can't leave — delete the household instead." }, 400);
  }
  const self = await db.query.users.findFirst({
    where: and(eq(users.id, session.userId), eq(users.tenantId, session.tenantId)),
    columns: { id: true, workosUserId: true },
  });
  if (!self) return c.json({ error: "Member not found" }, 404);
  await removeUserRow(session.tenantId, self);
  deleteCookie(c, COOKIE_NAME, { path: "/", ...cookieFlagsFor(c) });
  return c.json({ ok: true });
});
