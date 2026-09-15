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
const plaidItemsFindFirst = vi.fn(async (..._a: unknown[]) => ({ id: "i", tenantId: "t" }) as unknown);
const updateSet = vi.fn();
const updateWhere = vi.fn();
const itemRows = vi.fn(async () => [{ id: "item-1" }, { id: "item-2" }] as unknown[]);

vi.mock("../../lib/db.js", () => ({
  db: {
    query: {
      users: { findFirst: () => gateUser() },
      tenants: { findFirst: (...a: unknown[]) => tenantsFindFirst(...a) },
      plaidItems: { findFirst: (...a: unknown[]) => plaidItemsFindFirst(...a) },
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
const syncItem = vi.fn(async () => {});
const tenantDisabled = vi.fn(async () => false);
vi.mock("../../lib/sync.js", () => ({ syncAllForTenant, syncItem }));
vi.mock("../../lib/auth/workos.js", () => ({
  deleteWorkosUser: vi.fn(), sendPasswordReset: vi.fn(), friendlyError: (_e: unknown, m: string) => m,
}));
vi.mock("../../lib/billing.js", () => ({
  resolveTenantPlan: vi.fn(async () => "free"),
  classifyPlanSource: vi.fn(() => "free"),
  isTenantDisabled: (...a: unknown[]) => tenantDisabled(...(a as [])),
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
const ITEM_A = "44444444-4444-4444-4444-444444444444";

const post = (session: SessionPayload, id: string) =>
  appWithSession(session).request(`/api/admin/tenants/${id}/resync`, { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  gateUser.mockResolvedValue({ isAdmin: true, isDemo: false });
  tenantsFindFirst.mockResolvedValue({ id: TENANT_A });
  plaidItemsFindFirst.mockResolvedValue({ id: ITEM_A, tenantId: TENANT_A });
  itemRows.mockResolvedValue([{ id: "item-1" }, { id: "item-2" }]);
  tenantDisabled.mockResolvedValue(false);
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

const postItem = (session: SessionPayload, id: string) =>
  appWithSession(session).request(`/api/admin/items/${id}/resync`, { method: "POST" });

// The item is the narrowest a replay can be: Plaid's cursor belongs to the
// access token, so one card cannot be replayed without its siblings. What this
// MUST not do is widen back out to the whole household.
describe("POST /api/admin/items/:itemId/resync", () => {
  it("clears the cursor for that one connection and replays only it", async () => {
    const res = await postItem(admin, ITEM_A);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, itemId: ITEM_A, tenantId: TENANT_A });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plaidItems.id" }),
      { transactionCursor: null },
    );
    // Scoped by item id, NOT by tenant — the whole point of this route.
    expect(updateWhere).toHaveBeenCalledWith(["eq", "plaidItems.id", ITEM_A]);
    expect(syncItem).toHaveBeenCalledWith(ITEM_A);
    expect(syncAllForTenant).not.toHaveBeenCalled();
  });

  it("rejects a non-admin before touching anything", async () => {
    gateUser.mockResolvedValue({ isAdmin: false, isDemo: false });
    const res = await postItem(nonAdmin, ITEM_A);

    expect(res.status).toBe(403);
    expect(updateSet).not.toHaveBeenCalled();
    expect(syncItem).not.toHaveBeenCalled();
  });

  it("404s an unknown connection without replaying", async () => {
    plaidItemsFindFirst.mockResolvedValue(undefined);
    const res = await postItem(admin, ITEM_A);

    expect(res.status).toBe(404);
    expect(updateSet).not.toHaveBeenCalled();
    expect(syncItem).not.toHaveBeenCalled();
  });

  it("404s a malformed id before it reaches the uuid cast", async () => {
    const res = await postItem(admin, "not-a-uuid");

    expect(res.status).toBe(404);
    expect(plaidItemsFindFirst).not.toHaveBeenCalled();
    expect(syncItem).not.toHaveBeenCalled();
  });
});

// A paused tenant returns from syncItem before it reaches Plaid. Clearing the
// cursor and reporting success would tell an admin a repair ran when none did,
// and would leave the cursor null for whenever the account is resumed.
describe("resync refuses a paused tenant", () => {
  it("tenant route: 403s and writes nothing", async () => {
    tenantDisabled.mockResolvedValue(true);
    const res = await post(admin, TENANT_A);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "account_paused" });
    expect(updateSet).not.toHaveBeenCalled();
    expect(syncAllForTenant).not.toHaveBeenCalled();
  });

  it("item route: 403s and writes nothing", async () => {
    tenantDisabled.mockResolvedValue(true);
    const res = await postItem(admin, ITEM_A);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "account_paused" });
    expect(updateSet).not.toHaveBeenCalled();
    expect(syncItem).not.toHaveBeenCalled();
  });
});
