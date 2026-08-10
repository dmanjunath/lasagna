import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ── Core mock: identity-ish query builders so `where`/`set` args are inspectable ──
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  ne: (...args: unknown[]) => ["ne", ...args],
  sql: (...args: unknown[]) => ["sql", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  inArray: (...args: unknown[]) => ["inArray", ...args],
  users: {
    table: "users.table",
    id: "users.id",
    tenantId: "users.tenantId",
    email: "users.email",
    name: "users.name",
    role: "users.role",
    isAdmin: "users.isAdmin",
    workosUserId: "users.workosUserId",
  },
  tenants: { id: "tenants.id", name: "tenants.name" },
  accounts: { tenantId: "accounts.tenantId" },
  activityEvents: {},
  plaidItems: {},
  balanceSnapshots: {},
  userProfiles: { userId: "userProfiles.userId", tenantId: "userProfiles.tenantId" },
  chatThreads: { id: "chatThreads.id", userId: "chatThreads.userId", tenantId: "chatThreads.tenantId" },
  messages: { threadId: "messages.threadId", tenantId: "messages.tenantId" },
}));

// ── DB mock: overridable per-test via these handles ──
// The admin gate calls users.findFirst({ columns: { isAdmin, isDemo } }); the
// handlers call users.findFirst for the TARGET user (no isAdmin column). We
// route by inspecting the `columns` arg so the two can be stubbed independently.
const gateUser = vi.fn(async () => ({ isAdmin: true, isDemo: false }) as unknown);
const targetUserFindFirst = vi.fn(async (..._a: unknown[]) => undefined as unknown);
const tenantsFindFirst = vi.fn(async (..._a: unknown[]) => ({ id: "tenant-2", name: "Other" }) as unknown);
const userUpdateSet = vi.fn();
const userUpdateWhere = vi.fn();
const userDeleteWhere = vi.fn(async (..._a: unknown[]) => undefined as unknown);
// Count of users remaining in a tenant, for the last-user guard.
const tenantUserCount = vi.fn(async () => 2);
// Rows returned by the row-shaped db.select() calls: the change-role
// owner-count query (`{ id }`), the move-tenant ownerless-source check
// (`{ role }`), and the move-tenant chat-thread lookup (`{ id }`). Set per test.
const ownerRows = vi.fn(async () => [] as unknown[]);

function usersFindFirst(arg: { columns?: Record<string, boolean> }) {
  if (arg?.columns?.isAdmin) return gateUser();
  return targetUserFindFirst(arg);
}

vi.mock("../../lib/db.js", () => {
  const update = () => ({
    set: (vals: Record<string, unknown>) => {
      userUpdateSet(vals);
      return {
        where: (w: unknown) => {
          userUpdateWhere(w);
          return { returning: async () => [{ id: "target-1", ...vals }] };
        },
      };
    },
  });
  const del = () => ({ where: (...a: unknown[]) => userDeleteWhere(...a) });
  // The DELETE last-user guard selects `{ count }`; the change-role owner-count,
  // the move-tenant ownerless check, and the chat-thread lookup select rows.
  // Dispatch on the selected columns so each can be controlled independently.
  const select = (cols?: Record<string, unknown>) => ({
    from: () => ({
      where: async () => (cols && "count" in cols ? [{ count: await tenantUserCount() }] : await ownerRows()),
    }),
  });
  return {
    db: {
      query: {
        users: { findFirst: (a: { columns?: Record<string, boolean> }) => usersFindFirst(a) },
        tenants: { findFirst: (...a: unknown[]) => tenantsFindFirst(...a) },
      },
      update,
      delete: del,
      select,
      // move-tenant re-scopes the user's rows atomically; the tx exposes the
      // same builders the mock already models.
      transaction: async (cb: (tx: unknown) => unknown) => cb({ update, select, delete: del }),
    },
  };
});

vi.mock("../../lib/auth/workos.js", () => ({
  deleteWorkosUser: vi.fn(async () => {}),
  sendPasswordReset: vi.fn(),
  friendlyError: (_e: unknown, m: string) => m,
}));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { adminRoutes } from "../admin.js";

// Mounts the REAL adminRoutes (so the isAdmin gate runs) with an injected session.
function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("/api/admin/*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/api/admin", adminRoutes);
  return app;
}

const admin: SessionPayload = { userId: "admin-1", tenantId: "tenant-admin", role: "owner", isDemo: false, isAdmin: true };
const nonAdmin: SessionPayload = { userId: "user-1", tenantId: "tenant-1", role: "owner", isDemo: false, isAdmin: false };

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const USER_A = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  gateUser.mockResolvedValue({ isAdmin: true, isDemo: false });
  targetUserFindFirst.mockResolvedValue(undefined);
  tenantsFindFirst.mockResolvedValue({ id: TENANT_A, name: "Other" });
  userDeleteWhere.mockResolvedValue(undefined);
  tenantUserCount.mockResolvedValue(2);
  ownerRows.mockResolvedValue([]);
});

describe("POST /api/admin/users/:userId/move-tenant", () => {
  it("admin moves a user → 200, re-scopes to the tenant as a member and revokes sessions", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: "old-tenant", role: "member", isAdmin: false });
    tenantsFindFirst.mockResolvedValue({ id: TENANT_A, name: "Other" });
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/move-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_A }),
    });
    expect(res.status).toBe(200);
    // The users row is re-pointed to the destination, normalized to member, and
    // its sessions revoked (so the stale-tenant token can't linger).
    const usersUpdate = userUpdateSet.mock.calls.find((c) => "role" in c[0]);
    expect(usersUpdate?.[0]).toMatchObject({ tenantId: TENANT_A, role: "member" });
    expect(usersUpdate?.[0]).toHaveProperty("sessionsRevokedAt");
    // Per-user data (userProfiles / chatThreads) is re-pointed too.
    expect(userUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_A, planId: null }));
  });

  it("refuses to move a household's only owner while other members remain → 400", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: "old-tenant", role: "owner", isAdmin: false });
    tenantsFindFirst.mockResolvedValue({ id: TENANT_A, name: "Other" });
    // The source tenant's OTHER users — members, no other owner.
    ownerRows.mockResolvedValue([{ role: "member" }]);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/move-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_A }),
    });
    expect(res.status).toBe(400);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("allows moving an owner when the source has another owner → 200", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: "old-tenant", role: "owner", isAdmin: false });
    tenantsFindFirst.mockResolvedValue({ id: TENANT_A, name: "Other" });
    ownerRows.mockResolvedValue([{ role: "owner" }, { role: "member" }]);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/move-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_A }),
    });
    expect(res.status).toBe(200);
  });

  it("moving into a nonexistent tenant → 404, no update", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: "old-tenant", isAdmin: false });
    tenantsFindFirst.mockResolvedValue(undefined);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/move-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_A }),
    });
    expect(res.status).toBe(404);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("unknown user → 404", async () => {
    targetUserFindFirst.mockResolvedValue(undefined);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/move-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_A }),
    });
    expect(res.status).toBe(404);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("non-admin session → 403, no update", async () => {
    gateUser.mockResolvedValue({ isAdmin: false, isDemo: false });
    const app = appWithSession(nonAdmin);
    const res = await app.request(`/api/admin/users/${USER_A}/move-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_A }),
    });
    expect(res.status).toBe(403);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("moving a user already in the target tenant → 400, no update", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, role: "member", isAdmin: false });
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/move-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_A }),
    });
    expect(res.status).toBe(400);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/users/:userId/role", () => {
  it("admin changes a user's role → 200, updates role", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, isAdmin: false });
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(200);
    expect(userUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ role: "member" }));
  });

  it("rejects an invalid role → 400, no update", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, isAdmin: false });
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "superuser" }),
    });
    expect(res.status).toBe(400);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("unknown user → 404", async () => {
    targetUserFindFirst.mockResolvedValue(undefined);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(404);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("non-admin session → 403, no update", async () => {
    gateUser.mockResolvedValue({ isAdmin: false, isDemo: false });
    const app = appWithSession(nonAdmin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(403);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("rejects the reserved 'viewer' role → 400, no update", async () => {
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(400);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("refuses to promote a second owner while a DIFFERENT owner exists → 409, no update", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, role: "member", isAdmin: false });
    // A real pre-existing owner whose id differs from the target.
    ownerRows.mockResolvedValue([{ id: "99999999-9999-9999-9999-999999999999" }]);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    });
    expect(res.status).toBe(409);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("allows promoting a member to owner when the household has no owner → 200", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, role: "member", isAdmin: false });
    ownerRows.mockResolvedValue([]); // no existing owner
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    });
    expect(res.status).toBe(200);
    expect(userUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ role: "owner" }));
  });

  it("refuses to demote the only owner → 409, no update", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, role: "owner", isAdmin: false });
    // The owner list contains only the target — demoting would leave zero owners.
    ownerRows.mockResolvedValue([{ id: USER_A }]);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(409);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("allows demoting an owner when a second owner exists → 200", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, role: "owner", isAdmin: false });
    ownerRows.mockResolvedValue([{ id: USER_A }, { id: "99999999-9999-9999-9999-999999999999" }]);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(200);
    expect(userUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ role: "member" }));
  });
});

describe("DELETE /api/admin/users/:userId", () => {
  it("admin removes a user → 200, deletes the row", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, isAdmin: false, workosUserId: null });
    tenantUserCount.mockResolvedValue(2);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(userDeleteWhere).toHaveBeenCalledTimes(1);
  });

  it("refuses to delete the last remaining user of a tenant → 400, no delete", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, isAdmin: false, workosUserId: null });
    tenantUserCount.mockResolvedValue(1);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}`, { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(userDeleteWhere).not.toHaveBeenCalled();
  });

  it("refuses to delete an admin user → 400, no delete", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, isAdmin: true, workosUserId: null });
    tenantUserCount.mockResolvedValue(2);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}`, { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(userDeleteWhere).not.toHaveBeenCalled();
  });

  it("unknown user → 404", async () => {
    targetUserFindFirst.mockResolvedValue(undefined);
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(userDeleteWhere).not.toHaveBeenCalled();
  });

  it("non-admin session → 403, no delete", async () => {
    gateUser.mockResolvedValue({ isAdmin: false, isDemo: false });
    const app = appWithSession(nonAdmin);
    const res = await app.request(`/api/admin/users/${USER_A}`, { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(userDeleteWhere).not.toHaveBeenCalled();
  });
});
