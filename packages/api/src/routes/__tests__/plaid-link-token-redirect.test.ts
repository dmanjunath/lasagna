import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("plaid", () => ({ CountryCode: { Us: "US" }, Products: { Transactions: "transactions", Investments: "investments", Liabilities: "liabilities" } }));
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
vi.mock("../../lib/db.js", () => ({
  db: { query: { plaidItems: { findFirst: vi.fn(async () => ({ accessToken: "enc" })) } } },
}));

const linkTokenCreate = vi.fn(async (_req: Record<string, unknown>) => ({ data: { link_token: "link-sandbox-token" } }));
vi.mock("../../lib/plaid.js", () => ({
  plaidClient: { linkTokenCreate: (req: Record<string, unknown>) => linkTokenCreate(req), itemRemove: vi.fn(), itemPublicTokenExchange: vi.fn() },
}));
vi.mock("../../lib/env.js", () => ({
  env: { ENCRYPTION_KEY: "k", PLAID_WEBHOOK_URL: "", PLAID_REDIRECT_URI: "https://app.example.com/plaid-oauth" },
}));
vi.mock("../../lib/sync.js", () => ({ syncItem: vi.fn() }));
vi.mock("../../lib/activity.js", () => ({ logPlaidEvent: vi.fn() }));
vi.mock("../../lib/plaid-webhook.js", () => ({ verifyPlaidWebhook: vi.fn(async () => false) }));
vi.mock("../../lib/billing.js", () => ({ resolveTenantPlan: vi.fn(async () => "free") }));
vi.mock("../../lib/account-limits.js", () => ({ recomputeFrozenAccounts: vi.fn() }));

import type { AuthEnv } from "../../middleware/auth.js";
import { plaidRoutes } from "../plaid.js";

function app() {
  const a = new Hono<AuthEnv>();
  a.use("*", async (c, next) => {
    c.set("session", { userId: "user-1", tenantId: "tenant-1", role: "owner", isDemo: false, isAdmin: false });
    await next();
  });
  a.route("/", plaidRoutes);
  return a;
}

const lastRequest = () => linkTokenCreate.mock.calls.at(-1)![0];

describe("Plaid link token redirect_uri", () => {
  beforeEach(() => linkTokenCreate.mockClear());

  it("sends the OAuth redirect URI on link tokens the iOS app requests", async () => {
    await app().request("/link-token", { method: "POST", headers: { "x-lasagna-client": "native" } });
    expect(lastRequest().redirect_uri).toBe("https://app.example.com/plaid-oauth");
  });

  it("leaves it off web link tokens, where Link handles OAuth in its popup", async () => {
    await app().request("/link-token", { method: "POST" });
    expect(lastRequest()).not.toHaveProperty("redirect_uri");
  });

  it("sends it on update-mode tokens from the iOS app too", async () => {
    await app().request("/link-token/update", {
      method: "POST",
      headers: { "x-lasagna-client": "native", "content-type": "application/json" },
      body: JSON.stringify({ itemId: "item-1" }),
    });
    expect(lastRequest().redirect_uri).toBe("https://app.example.com/plaid-oauth");
  });
});
