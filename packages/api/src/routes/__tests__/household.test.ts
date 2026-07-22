import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ── Core mock: identity-ish query builders so `where` args are inspectable ──
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  isNull: (...args: unknown[]) => ["isNull", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  users: { email: "users.email", id: "users.id", tenantId: "users.tenantId" },
  tenants: { id: "tenants.id", name: "tenants.name" },
  invites: {
    id: "invites.id",
    tenantId: "invites.tenantId",
    email: "invites.email",
    role: "invites.role",
    token: "invites.token",
    expiresAt: "invites.expiresAt",
    acceptedAt: "invites.acceptedAt",
    revokedAt: "invites.revokedAt",
    invitedByUserId: "invites.invitedByUserId",
    createdAt: "invites.createdAt",
  },
}));

// ── DB mock: overridable per-test via these handles ──
const usersFindFirst = vi.fn(async (..._a: unknown[]) => undefined as unknown);
const invitesFindFirst = vi.fn(async (..._a: unknown[]) => undefined as unknown);
const tenantsFindFirst = vi.fn(async (..._a: unknown[]) => ({ id: "tenant-1", name: "The Smiths" }) as unknown);
const inviteInsertValues = vi.fn();
const inviteUpdateSet = vi.fn();
const inviteUpdateWhere = vi.fn();
const selectWhere = vi.fn(async (..._a: unknown[]) => [] as unknown[]);

vi.mock("../../lib/db.js", () => ({
  db: {
    query: {
      users: { findFirst: (...a: unknown[]) => usersFindFirst(...a) },
      invites: { findFirst: (...a: unknown[]) => invitesFindFirst(...a) },
      tenants: { findFirst: (...a: unknown[]) => tenantsFindFirst(...a) },
    },
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        inviteInsertValues(vals);
        return { returning: async () => [{ id: "invite-new", ...vals }] };
      },
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        inviteUpdateSet(vals);
        return { where: (w: unknown) => { inviteUpdateWhere(w); return Promise.resolve(undefined); } };
      },
    }),
    select: () => ({
      from: () => ({
        where: (...a: unknown[]) => ({ orderBy: () => selectWhere(...a) }),
      }),
    }),
  },
}));

const sendInviteEmail = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../../lib/auth/invite-email.js", () => ({
  sendInviteEmail: (...a: unknown[]) => sendInviteEmail(...a),
}));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { householdRoutes } from "../household.js";

// Builds an app that injects a chosen session (bypassing the real guard) for
// the authed owner/member endpoints.
function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("/api/household/*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/api/household", householdRoutes);
  return app;
}

const owner: SessionPayload = { userId: "owner-1", tenantId: "tenant-1", role: "owner", isDemo: false, isAdmin: false };
const member: SessionPayload = { userId: "member-1", tenantId: "tenant-1", role: "member", isDemo: false, isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  usersFindFirst.mockResolvedValue(undefined);
  invitesFindFirst.mockResolvedValue(undefined);
  tenantsFindFirst.mockResolvedValue({ id: "tenant-1", name: "The Smiths" });
  selectWhere.mockResolvedValue([]);
});

describe("POST /api/household/invites", () => {
  it("owner creates an invite → 200, calls sendInviteEmail, returns pending invite without leaking token", async () => {
    const app = appWithSession(owner);
    const res = await app.request("/api/household/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "partner@user.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invite).toMatchObject({ email: "partner@user.com", role: "member" });
    expect(body.invite.token).toBeUndefined();
    expect(inviteInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", email: "partner@user.com" }),
    );
    expect(sendInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "partner@user.com" }),
    );
  });

  it("member gets 403", async () => {
    const app = appWithSession(member);
    const res = await app.request("/api/household/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "partner@user.com" }),
    });
    expect(res.status).toBe(403);
    expect(inviteInsertValues).not.toHaveBeenCalled();
    expect(sendInviteEmail).not.toHaveBeenCalled();
  });

  it("inviting an email that already has an account → 409", async () => {
    usersFindFirst.mockResolvedValue({ id: "existing-user" });
    const app = appWithSession(owner);
    const res = await app.request("/api/household/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "taken@user.com" }),
    });
    expect(res.status).toBe(409);
    expect(inviteInsertValues).not.toHaveBeenCalled();
  });

  it("rejects an invalid email → 400", async () => {
    const app = appWithSession(owner);
    const res = await app.request("/api/household/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/household/invites", () => {
  it("owner lists pending invites for the tenant", async () => {
    selectWhere.mockResolvedValue([
      { id: "i1", email: "a@b.com", role: "member", expiresAt: new Date() },
    ]);
    const app = appWithSession(owner);
    const res = await app.request("/api/household/invites");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0]).toMatchObject({ id: "i1", email: "a@b.com" });
  });

  it("member gets 403", async () => {
    const app = appWithSession(member);
    const res = await app.request("/api/household/invites");
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/household/invites/:id", () => {
  it("owner revokes → sets revokedAt", async () => {
    const app = appWithSession(owner);
    const res = await app.request("/api/household/invites/invite-9", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(inviteUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });

  it("member gets 403", async () => {
    const app = appWithSession(member);
    const res = await app.request("/api/household/invites/invite-9", { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(inviteUpdateSet).not.toHaveBeenCalled();
  });
});

describe("GET /api/household/invite/:token (public validate)", () => {
  it("returns ok status + household/inviter for a valid pending token", async () => {
    const future = new Date(Date.now() + 60_000);
    invitesFindFirst.mockResolvedValue({
      id: "i1", tenantId: "tenant-1", email: "p@u.com", role: "member",
      token: "tok-good", expiresAt: future, acceptedAt: null, revokedAt: null,
      invitedByUserId: "owner-1",
    });
    tenantsFindFirst.mockResolvedValue({ name: "The Smiths" });
    usersFindFirst.mockResolvedValue({ name: "Owner O" });
    const app = appWithSession(owner);
    const res = await app.request("/api/household/invite/tok-good");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", householdName: "The Smiths", inviterName: "Owner O" });
  });

  it("returns not_found for an unknown token", async () => {
    invitesFindFirst.mockResolvedValue(undefined);
    const app = appWithSession(owner);
    const res = await app.request("/api/household/invite/nope");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "not_found" });
  });
});
