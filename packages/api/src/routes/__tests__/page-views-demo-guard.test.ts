/**
 * Drives the REAL server.ts against Postgres. Run from the repo root:
 *   DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna \
 *     pnpm -F @lasagna/api test page-views-demo-guard
 *
 * If the DB is unreachable the tests self-skip (they do not fail).
 *
 * All data lives in a throwaway tenant this file creates in beforeAll and
 * deletes in afterAll. It never reads or writes any other tenant's rows.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

// plaid.ts and session.ts read these at import time.
process.env.PLAID_CLIENT_ID ??= "test-plaid-client";
process.env.PLAID_SECRET ??= "test-plaid-secret";
process.env.ENCRYPTION_KEY ??= "test-encryption-key-0123456789ab";

import { eq, tenants, users, pageViews } from "@lasagna/core";
import { db } from "../../lib/db.js";
import { createSessionToken } from "../../lib/session.js";

let app: typeof import("../../server.js").app;
let tenantId: string | null = null;
let userId: string | null = null;
let dbAvailable = false;

beforeAll(async () => {
  ({ app } = await import("../../server.js"));
  try {
    const [t] = await db.insert(tenants).values({ name: "page-views-demo-guard.test" }).returning({ id: tenants.id });
    tenantId = t.id;
    const [u] = await db
      .insert(users)
      .values({ tenantId, email: `page-views-demo-${Date.now()}@example.com` })
      .returning({ id: users.id });
    userId = u.id;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
});

beforeEach(async () => {
  if (dbAvailable) await db.delete(pageViews).where(eq(pageViews.userId, userId!));
});

// Bearer rather than a cookie, so the CSRF guard has nothing to say.
const post = async (isDemo: boolean) => {
  const token = await createSessionToken({
    userId: userId!, tenantId: tenantId!, role: "owner", isDemo, isAdmin: false,
  });
  return app.request("http://localhost/api/page-views", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path: "/money" }),
  });
};

const viewCount = async () =>
  (await db.select().from(pageViews).where(eq(pageViews.userId, userId!))).length;

describe("POST /api/page-views through the real demo guard", () => {
  it("answers a demo session with ok and records nothing", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const res = await post(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await viewCount()).toBe(0);
  });

  it("records a view for a normal session", async () => {
    if (!dbAvailable) {
      console.warn("SKIP: no DB at DATABASE_URL");
      return;
    }
    const res = await post(false);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await viewCount()).toBe(1);
  });
});
