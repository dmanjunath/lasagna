import { Hono } from "hono";
import { and, eq, isNull, desc, invites, users, tenants } from "@lasagna/core";
import { db } from "../lib/db.js";
import { type AuthEnv } from "../middleware/auth.js";
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
  const email = (body.email ?? "").trim().toLowerCase();
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

  // Best-effort email; the token in the URL is the security primitive.
  await sendInviteEmail({ email, inviterName: null, token: invite.token });

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
