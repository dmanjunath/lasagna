import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn();

vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => args,
  users: { workosUserId: "users.workosUserId", email: "users.email", id: "users.id" },
  tenants: { id: "tenants.id" },
  seedTaxonomyForTenant: vi.fn(),
}));

vi.mock("../../db.js", () => ({
  db: {
    query: {
      users: { findFirst: vi.fn().mockResolvedValue(undefined) },
      tenants: { findFirst: vi.fn() },
    },
    insert: (table: { id?: string }) => ({
      values: (vals: Record<string, unknown>) => {
        if (table === undefined) throw new Error("no table");
        // tenants insert returns a tenant row; users insert records the values
        const isTenant = "name" in vals && !("email" in vals);
        if (isTenant) return { returning: () => [{ id: "tenant-1" }] };
        insertValues(vals);
        return { returning: () => [{ id: "user-1", ...vals }] };
      },
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisionUser", () => {
  it("creates a brand-new user with isAdmin false", async () => {
    const { provisionUser } = await import("../provision.js");
    const { user, isNew } = await provisionUser({ email: "new@user.com", name: "New User" });
    expect(isNew).toBe(true);
    expect(user.isAdmin).toBe(false);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: false }));
  });
});
