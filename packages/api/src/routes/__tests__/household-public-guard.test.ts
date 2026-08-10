import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// Plaid client is built at module top-level in plaid.ts and reads these
// required env vars; set them so the REAL server.ts can be imported here.
process.env.PLAID_CLIENT_ID ??= "test-plaid-client";
process.env.PLAID_SECRET ??= "test-plaid-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-0123456789ab";

// Use the REAL @lasagna/core (pure schema + query helpers, no DB connection at
// import) so server.ts's many transitive core imports resolve; only db.js and
// the email transport are mocked so the household route runs without a live DB.
const invitesFindFirst = vi.fn(async (..._a: unknown[]) => undefined as unknown);

vi.mock("../../lib/db.js", () => ({
  db: {
    query: {
      users: { findFirst: vi.fn(async () => undefined) },
      invites: { findFirst: (...a: unknown[]) => invitesFindFirst(...a) },
      tenants: { findFirst: vi.fn(async () => ({ id: "tenant-1", name: "The Smiths" })) },
    },
  },
}));

vi.mock("../../lib/auth/invite-email.js", () => ({
  sendInviteEmail: vi.fn(async () => {}),
}));

let app: typeof import("../../server.js").app;

beforeAll(async () => {
  ({ app } = await import("../../server.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  invitesFindFirst.mockResolvedValue(undefined);
});

describe("public token-validate endpoint through the REAL /api/* guard", () => {
  it("returns 200 with NO session cookie for a valid pending token", async () => {
    const future = new Date(Date.now() + 60_000);
    invitesFindFirst.mockResolvedValue({
      id: "i1", tenantId: "tenant-1", email: "p@u.com", role: "member",
      token: "tok-good", expiresAt: future, acceptedAt: null, revokedAt: null,
      invitedByUser: { name: "Owner O" }, tenant: { name: "The Smiths" },
    });
    // No Cookie / Authorization header at all → proves the prefix exemption.
    const res = await app.request("/api/household/invite/tok-good");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });

  it("returns not_found (still 200) for an unknown token while unauthenticated", async () => {
    invitesFindFirst.mockResolvedValue(undefined);
    const res = await app.request("/api/household/invite/unknown-token");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "not_found" });
  });

  it("returns expired (still 200) for a past-expiresAt token while unauthenticated", async () => {
    const past = new Date(Date.now() - 60_000);
    invitesFindFirst.mockResolvedValue({
      id: "i2", tenantId: "tenant-1", email: "p@u.com", role: "member",
      token: "tok-old", expiresAt: past, acceptedAt: null, revokedAt: null,
      invitedByUser: { name: "Owner O" }, tenant: { name: "The Smiths" },
    });
    const res = await app.request("/api/household/invite/tok-old");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "expired" });
  });

  it("still guards the AUTHED endpoints: no cookie → 401 on GET /api/household/invites", async () => {
    const res = await app.request("/api/household/invites");
    expect(res.status).toBe(401);
  });
});
