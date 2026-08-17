import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Records what happened and in what order — the ordering IS the bug this guards.
const calls: string[] = [];

vi.mock("plaid", () => ({ CountryCode: { Us: "US" }, Products: {} }));

vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  plaidItems: { id: "plaid_items.id", tenantId: "plaid_items.tenant_id" },
  accounts: {},
  balanceSnapshots: {},
  encrypt: vi.fn(),
  decrypt: vi.fn(async (token: string) => `decrypted:${token}`),
}));

const findFirst = vi.fn();
vi.mock("../../lib/db.js", () => ({
  db: {
    query: { plaidItems: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    delete: () => {
      calls.push("db.delete");
      return { where: async () => undefined };
    },
  },
}));

const itemRemove = vi.fn(async (_req: { access_token: string }) => {
  calls.push("plaid.itemRemove");
  return {};
});
vi.mock("../../lib/plaid.js", () => ({
  plaidClient: {
    itemRemove: (req: { access_token: string }) => itemRemove(req),
    linkTokenCreate: vi.fn(),
    itemPublicTokenExchange: vi.fn(),
  },
}));

vi.mock("../../lib/env.js", () => ({ env: { ENCRYPTION_KEY: "k", PLAID_WEBHOOK_URL: "" } }));
vi.mock("../../lib/sync.js", () => ({ syncItem: vi.fn() }));
vi.mock("../../lib/activity.js", () => ({ logPlaidEvent: vi.fn() }));
vi.mock("../../lib/plaid-webhook.js", () => ({ verifyPlaidWebhook: vi.fn(async () => false) }));
vi.mock("../../lib/billing.js", () => ({ resolveTenantPlan: vi.fn(async () => "free") }));
vi.mock("../../lib/account-limits.js", () => ({ recomputeFrozenAccounts: vi.fn() }));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { plaidRoutes } from "../plaid.js";

const session: SessionPayload = {
  userId: "user-1",
  tenantId: "tenant-1",
  role: "owner",
  isDemo: false,
  isAdmin: false,
};

function app() {
  const a = new Hono<AuthEnv>();
  a.use("/api/plaid/*", async (c, next) => {
    c.set("session", session);
    await next();
  });
  a.route("/api/plaid", plaidRoutes);
  return a;
}

const del = () => app().request("/api/plaid/items/item-1", { method: "DELETE" });

/** A Plaid error shaped the way the SDK surfaces them. */
function plaidError(code: string) {
  return Object.assign(new Error(code), { response: { data: { error_code: code } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  findFirst.mockResolvedValue({ id: "item-1", accessToken: "enc-token" });
  itemRemove.mockImplementation(async () => {
    calls.push("plaid.itemRemove");
    return {};
  });
});

describe("DELETE /plaid/items/:id", () => {
  it("removes the Item at Plaid BEFORE deleting the row", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    // Reversing these strands an Item that bills forever and whose access
    // token we just destroyed.
    expect(calls).toEqual(["plaid.itemRemove", "db.delete"]);
    expect(itemRemove).toHaveBeenCalledWith({ access_token: "decrypted:enc-token" });
  });

  it("keeps the row when Plaid removal fails, so it can be retried", async () => {
    itemRemove.mockRejectedValue(plaidError("INTERNAL_SERVER_ERROR"));
    const res = await del();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "plaid_remove_failed" });
    expect(calls).not.toContain("db.delete");
  });

  it("still deletes the row when Plaid says the Item is already gone", async () => {
    itemRemove.mockRejectedValue(plaidError("ITEM_NOT_FOUND"));
    const res = await del();
    expect(res.status).toBe(200);
    expect(calls).toEqual(["db.delete"]);
  });

  it("skips Plaid entirely for manual items", async () => {
    findFirst.mockResolvedValue({ id: "item-1", accessToken: "manual-abc" });
    const res = await del();
    expect(res.status).toBe(200);
    expect(itemRemove).not.toHaveBeenCalled();
    expect(calls).toEqual(["db.delete"]);
  });

  it("404s another tenant's item without touching Plaid", async () => {
    findFirst.mockResolvedValue(undefined);
    const res = await del();
    expect(res.status).toBe(404);
    expect(itemRemove).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
