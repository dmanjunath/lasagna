import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";

// DB-free: every case here is rejected before the route touches the database, so
// any db call at all is the bug.
vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  desc: (...args: unknown[]) => ["desc", ...args],
  accounts: { id: "accounts.id", tenantId: "accounts.tenantId" },
  accountTypeEnum: {
    enumValues: ["depository", "investment", "credit", "loan", "real_estate", "alternative"],
  },
  balanceSnapshots: {},
  plaidItems: { tenantId: "plaidItems.tenantId", institutionId: "plaidItems.institutionId" },
}));

vi.mock("../../lib/db.js", () => {
  const boom = () => {
    throw new Error("the route reached the database");
  };
  return {
    db: {
      query: { plaidItems: { findFirst: boom }, accounts: { findFirst: boom } },
      insert: boom,
      update: boom,
    },
  };
});
vi.mock("../../lib/account-links.js", () => ({ validatePropertyLink: () => null }));
vi.mock("../../lib/value-estimate.js", () => ({ kickOffValueEstimate: vi.fn() }));

import type { AuthEnv } from "../../middleware/auth.js";
import type { SessionPayload } from "../../lib/session.js";
import { manualAccountRoutes } from "../manual-accounts.js";

function app() {
  const a = new Hono<AuthEnv>();
  a.use("*", async (c, next) => {
    c.set("session", { tenantId: "tenant-1", userId: "user-1" } as unknown as SessionPayload);
    await next();
  });
  a.route("/api/manual-accounts", manualAccountRoutes);
  return a;
}

const post = (body: unknown) =>
  app().request("/api/manual-accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /manual-accounts name validation", () => {
  it("rejects a name longer than the column with a 400, not a 500", async () => {
    const res = await post({ name: "a".repeat(256), type: "depository" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^name must /);
  });

  it("accepts a name right at the column length", async () => {
    // Past validation it reaches the mocked db, which throws and Hono turns into
    // a 500. Not being the 400 is the assertion.
    expect((await post({ name: "a".repeat(255), type: "depository" })).status).toBe(500);
  });

  it("rejects a non-string name", async () => {
    const res = await post({ name: { first: "Nope" }, type: "depository" });
    expect(res.status).toBe(400);
  });
});
