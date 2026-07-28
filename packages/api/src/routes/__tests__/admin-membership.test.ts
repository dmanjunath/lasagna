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
  // Used by the DELETE last-user guard, the move-tenant ownerless check, and the
  // move-tenant chat-thread lookup — all return an array; the count shape covers
  // the guard and the thread lookup treats a rowless result as "no threads".
  const select = () => ({
    from: () => ({ where: async () => [{ count: await tenantUserCount() }] }),
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
});

describe("POST /api/admin/users/:userId/move-tenant", () => {
  it("admin moves a user to an existing tenant → 200, updates tenantId", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: "old-tenant", isAdmin: false });
    tenantsFindFirst.mockResolvedValue({ id: TENANT_A, name: "Other" });
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/move-tenant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: TENANT_A }),
    });
    expect(res.status).toBe(200);
    expect(userUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_A }));
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

  it("refuses to promote a second owner while one exists → 409, no update", async () => {
    // The owner-count select returns a pre-existing owner (id ≠ target).
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, role: "member", isAdmin: false });
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "owner" }),
    });
    expect(res.status).toBe(409);
    expect(userUpdateSet).not.toHaveBeenCalled();
  });

  it("refuses to demote the only owner → 409, no update", async () => {
    targetUserFindFirst.mockResolvedValue({ id: USER_A, tenantId: TENANT_A, role: "owner", isAdmin: false });
    const app = appWithSession(admin);
    const res = await app.request(`/api/admin/users/${USER_A}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "member" }),
    });
    expect(res.status).toBe(409);
    expect(userUpdateSet).not.toHaveBeenCalled();
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
