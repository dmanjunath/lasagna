import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// `/sync/resync` only ever replays the CALLER's own tenant, so support could not
// repair someone else's ledger. This covers the admin equivalent: it must clear
// the cursors for the NAMED tenant and nobody else, then kick off the replay.

vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  ne: (...args: unknown[]) => ["ne", ...args],
  sql: (...args: unknown[]) => ["sql", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  inArray: (...args: unknown[]) => ["inArray", ...args],
  users: { id: "users.id", isAdmin: "users.isAdmin" },
  tenants: { id: "tenants.id" },
  accounts: {},
  activityEvents: {},
  plaidItems: { id: "plaidItems.id", tenantId: "plaidItems.tenantId", transactionCursor: "plaidItems.transactionCursor" },
  balanceSnapshots: {},
  userProfiles: {},
  chatThreads: {},
  messages: {},
  financialProfiles: {},
}));

const gateUser = vi.fn(async () => ({ isAdmin: true, isDemo: false }) as unknown);
const tenantsFindFirst = vi.fn(async (..._a: unknown[]) => ({ id: "t" }) as unknown);
const updateSet = vi.fn();
const updateWhere = vi.fn();
const itemRows = vi.fn(async () => [{ id: "item-1" }, { id: "item-2" }] as unknown[]);

vi.mock("../../lib/db.js", () => ({
  db: {
    query: {
      users: { findFirst: () => gateUser() },
      tenants: { findFirst: (...a: unknown[]) => tenantsFindFirst(...a) },
    },
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => {
        updateSet(table, vals);
        return { where: (w: unknown) => { updateWhere(w); return { returning: async () => await itemRows() }; } };
      },
    }),
    select: () => ({ from: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => undefined }),
  },
}));

const syncAllForTenant = vi.fn(async () => {});
vi.mock("../../lib/sync.js", () => ({ syncAllForTenant }));
vi.mock("../../lib/auth/workos.js", () => ({
  deleteWorkosUser: vi.fn(), sendPasswordReset: vi.fn(), friendlyError: (_e: unknown, m: string) => m,
}));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { adminRoutes } from "../admin.js";

function appWithSession(session: SessionPayload) {
  const app = new Hono<AuthEnv>();
  app.use("/api/admin/*", async (c, next) => { c.set("session", session); await next(); });
  app.route("/api/admin", adminRoutes);
  return app;
}

const admin: SessionPayload = { userId: "admin-1", tenantId: "tenant-admin", role: "owner", isDemo: false, isAdmin: true };
const nonAdmin: SessionPayload = { userId: "user-1", tenantId: "tenant-1", role: "owner", isDemo: false, isAdmin: false };
const TENANT_A = "11111111-1111-1111-1111-111111111111";

const post = (session: SessionPayload, id: string) =>
  appWithSession(session).request(`/api/admin/tenants/${id}/resync`, { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  gateUser.mockResolvedValue({ isAdmin: true, isDemo: false });
  tenantsFindFirst.mockResolvedValue({ id: TENANT_A });
  itemRows.mockResolvedValue([{ id: "item-1" }, { id: "item-2" }]);
});

describe("POST /api/admin/tenants/:tenantId/resync", () => {
  it("clears the cursors for that tenant only, then replays it", async () => {
    const res = await post(admin, TENANT_A);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tenantId: TENANT_A, itemsReset: 2 });
    // Nulling the cursor is what makes Plaid re-deliver the whole history.
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "plaidItems.tenantId" }),
      { transactionCursor: null },
    );
    // Scoped by tenant: an unscoped where would replay every tenant at once.
    expect(updateWhere).toHaveBeenCalledWith(["eq", "plaidItems.tenantId", TENANT_A]);
    expect(syncAllForTenant).toHaveBeenCalledWith(TENANT_A);
  });

  it("rejects a non-admin before touching anything", async () => {
    gateUser.mockResolvedValue({ isAdmin: false, isDemo: false });
    const res = await post(nonAdmin, TENANT_A);

    expect(res.status).toBe(403);
    expect(updateSet).not.toHaveBeenCalled();
    expect(syncAllForTenant).not.toHaveBeenCalled();
  });

  it("404s an unknown tenant without replaying", async () => {
    tenantsFindFirst.mockResolvedValue(undefined);
    const res = await post(admin, TENANT_A);

    expect(res.status).toBe(404);
    expect(updateSet).not.toHaveBeenCalled();
    expect(syncAllForTenant).not.toHaveBeenCalled();
  });

  it("404s a malformed id before it reaches the uuid cast", async () => {
    const res = await post(admin, "not-a-uuid");

    expect(res.status).toBe(404);
    expect(tenantsFindFirst).not.toHaveBeenCalled();
    expect(syncAllForTenant).not.toHaveBeenCalled();
  });
});
