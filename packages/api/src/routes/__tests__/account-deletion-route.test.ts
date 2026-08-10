import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Identity-ish query helpers so `where` args stay inspectable, DB-free.
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  users: { id: "users.id", tenantId: "users.tenantId", email: "users.email" },
}));

// The signed-in user's email lookup, and the tenant-members lookup for the
// multi-user guard. Route by the `columns` arg so each is stubbed separately.
const selfFindFirst = vi.fn(async () => ({ email: "owner@example.com" }) as unknown);
const tenantUsersFindMany = vi.fn(async () => [{ id: "user-1", email: "owner@example.com" }] as unknown);

vi.mock("../../lib/db.js", () => ({
  db: {
    query: {
      users: {
        findFirst: () => selfFindFirst(),
        findMany: () => tenantUsersFindMany(),
      },
    },
  },
}));

vi.mock("../../lib/auth/mode.js", () => ({ authMode: () => "workos" }));
vi.mock("../../lib/auth/workos.js", () => ({
  authenticateWithMagicAuth: vi.fn(async () => ({})),
  sendMagicAuth: vi.fn(async () => {}),
  friendlyError: (_e: unknown, m: string) => m,
}));
vi.mock("../auth.js", () => ({ cookieFlagsFor: () => ({ secure: false, sameSite: "Lax" }) }));

// The tenant-delete dependency — the thing the guard must NOT call for a
// multi-user tenant, and MUST call for a single-user one.
const deleteTenantAccount = vi.fn(async (_tenantId: string) => ({ plaidRemoved: 0, plaidFailed: 0 }));
vi.mock("../../lib/account-deletion.js", () => ({
  deleteTenantAccount: (tenantId: string) => deleteTenantAccount(tenantId),
}));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { accountRouter } from "../account.js";

function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("/api/account/*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  app.route("/api/account", accountRouter);
  return app;
}

const owner: SessionPayload = { userId: "user-1", tenantId: "tenant-1", role: "owner", isDemo: false, isAdmin: false };

function del(app: Hono<AuthEnv>) {
  return app.request("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "123456" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  selfFindFirst.mockResolvedValue({ email: "owner@example.com" });
  tenantUsersFindMany.mockResolvedValue([{ id: "user-1", email: "owner@example.com" }]);
});

describe("DELETE /api/account multi-user guard", () => {
  it("single-user tenant → proceeds and deletes the tenant", async () => {
    const res = await del(appWithSession(owner));
    expect(res.status).toBe(200);
    expect(deleteTenantAccount).toHaveBeenCalledWith("tenant-1");
  });

  it("multi-user tenant → 409 with the blocking emails, does NOT delete the tenant", async () => {
    tenantUsersFindMany.mockResolvedValue([
      { id: "user-1", email: "owner@example.com" },
      { id: "user-2", email: "partner@example.com" },
    ]);
    const res = await del(appWithSession(owner));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; blockingUsers: string[] };
    expect(body.blockingUsers).toEqual(["partner@example.com"]);
    expect(body.error).toBeTruthy();
    expect(deleteTenantAccount).not.toHaveBeenCalled();
  });
});
