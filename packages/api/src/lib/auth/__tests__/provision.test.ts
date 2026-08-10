import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn();
const userProfileInsertValues = vi.fn();
const inviteUpdateSet = vi.fn();

vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  isNull: (...args: unknown[]) => ["isNull", ...args],
  users: { workosUserId: "users.workosUserId", email: "users.email", id: "users.id" },
  tenants: { id: "tenants.id" },
  invites: { email: "invites.email", acceptedAt: "invites.acceptedAt", revokedAt: "invites.revokedAt", id: "invites.id" },
  userProfiles: { tenantId: "userProfiles.tenantId", userId: "userProfiles.userId" },
  seedTaxonomyForTenant: vi.fn(),
}));

const invitesFindFirst = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db.js", () => {
  const insert = (table: Record<string, string>) => ({
    values: (vals: Record<string, unknown>) => {
      if (table === undefined) throw new Error("no table");
      // tenants insert returns a tenant row
      const isTenant = "name" in vals && !("email" in vals);
      if (isTenant) return { returning: () => [{ id: "tenant-1" }] };
      // userProfiles insert has userId but no email
      const isUserProfile = "userId" in vals && !("email" in vals);
      if (isUserProfile) {
        userProfileInsertValues(vals);
        return { returning: () => [{ id: "user-profile-1", ...vals }] };
      }
      // users insert records the values
      insertValues(vals);
      return { returning: () => [{ id: "user-1", ...vals }] };
    },
  });
  const update = () => ({
    set: (vals: Record<string, unknown>) => {
      inviteUpdateSet(vals);
      return { where: () => Promise.resolve(undefined) };
    },
  });
  // The join branch wraps its writes in db.transaction; the tx exposes the same
  // insert/update the mock already models.
  const tx = { insert, update };
  return {
    db: {
      query: {
        users: { findFirst: vi.fn().mockResolvedValue(undefined) },
        tenants: { findFirst: vi.fn() },
        invites: { findFirst: (...args: unknown[]) => invitesFindFirst(...args) },
      },
      insert,
      update,
      transaction: async (cb: (tx: unknown) => unknown) => cb(tx),
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  invitesFindFirst.mockResolvedValue(undefined);
  delete process.env.MULTI_TENANT;
});

describe("provisionUser", () => {
  it("does not grant admin on signup with the default (multi-tenant) config", async () => {
    const { provisionUser } = await import("../provision.js");
    const { user, isNew } = await provisionUser({ email: "new@user.com", name: "New User" });
    expect(isNew).toBe(true);
    expect(user.isAdmin).toBe(false);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: false }));
  });

  it("create branch: new tenant, owner role, profile stage", async () => {
    const { provisionUser } = await import("../provision.js");
    const { isNew } = await provisionUser({ email: "solo@user.com", name: "Solo" });
    expect(isNew).toBe(true);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ role: "owner", onboardingStage: "profile", isAdmin: false }),
    );
    // no personal profile row is created in the create branch
    expect(userProfileInsertValues).not.toHaveBeenCalled();
  });

  it("join branch: valid pending invite makes the user a household member", async () => {
    const future = new Date(Date.now() + 60_000);
    invitesFindFirst.mockResolvedValue({
      id: "invite-1",
      tenantId: "tenant-inviter",
      email: "partner@user.com",
      role: "member",
      expiresAt: future,
      acceptedAt: null,
      revokedAt: null,
    });
    const { provisionUser } = await import("../provision.js");
    const { user, isNew } = await provisionUser({ email: "partner@user.com", name: "Partner" });

    expect(isNew).toBe(true);
    // user inserted into the invite's tenant with the invite's role + income stage
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-inviter",
        role: "member",
        onboardingStage: "income",
        isAdmin: false,
      }),
    );
    expect(user.tenantId).toBe("tenant-inviter");
    // a userProfiles row is created for the new user in the invite's tenant
    expect(userProfileInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-inviter", userId: "user-1" }),
    );
    // the invite is marked accepted by the new user
    expect(inviteUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedByUserId: "user-1" }),
    );
    expect(inviteUpdateSet.mock.calls[0][0]).toHaveProperty("acceptedAt");
    // the tenant is NOT newly created (no "name"-only insert), taxonomy not seeded
    const coreMock = await import("@lasagna/core");
    expect(coreMock.seedTaxonomyForTenant).not.toHaveBeenCalled();
  });

  it("join branch: matches a lowercased pending invite for a mixed-case input email", async () => {
    const future = new Date(Date.now() + 60_000);
    invitesFindFirst.mockResolvedValue({
      id: "invite-1",
      tenantId: "tenant-inviter",
      email: "partner@user.com",
      role: "member",
      expiresAt: future,
      acceptedAt: null,
      revokedAt: null,
    });
    const { provisionUser } = await import("../provision.js");
    const { user, isNew } = await provisionUser({ email: "Partner@User.com", name: "Partner" });

    // the invite lookup normalizes the email to lowercase to match how invites are stored
    const lookupWhere = invitesFindFirst.mock.calls[0][0].where;
    expect(JSON.stringify(lookupWhere)).toContain("partner@user.com");
    expect(JSON.stringify(lookupWhere)).not.toContain("Partner@User.com");

    // joins the invite's tenant as a member on the income stage, invite marked accepted
    expect(isNew).toBe(true);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-inviter",
        role: "member",
        onboardingStage: "income",
        isAdmin: false,
      }),
    );
    expect(user.tenantId).toBe("tenant-inviter");
    expect(userProfileInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-inviter", userId: "user-1" }),
    );
    expect(inviteUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedByUserId: "user-1" }),
    );
    expect(inviteUpdateSet.mock.calls[0][0]).toHaveProperty("acceptedAt");
  });

  it("ignores an expired invite and falls through to create-new-tenant", async () => {
    const past = new Date(Date.now() - 60_000);
    invitesFindFirst.mockResolvedValue({
      id: "invite-old",
      tenantId: "tenant-inviter",
      email: "late@user.com",
      role: "member",
      expiresAt: past,
      acceptedAt: null,
      revokedAt: null,
    });
    const { provisionUser } = await import("../provision.js");
    const { isNew } = await provisionUser({ email: "late@user.com", name: "Late" });

    expect(isNew).toBe(true);
    // create branch: owner + profile stage, brand-new tenant
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ role: "owner", onboardingStage: "profile" }),
    );
    expect(userProfileInsertValues).not.toHaveBeenCalled();
    expect(inviteUpdateSet).not.toHaveBeenCalled();
    const coreMock = await import("@lasagna/core");
    expect(coreMock.seedTaxonomyForTenant).toHaveBeenCalled();
  });

  it("makes new users internal admins when MULTI_TENANT=false", async () => {
    process.env.MULTI_TENANT = "false";
    const { provisionUser } = await import("../provision.js");
    const { user, isNew } = await provisionUser({ email: "internal@user.com", name: "Internal User" });
    expect(isNew).toBe(true);
    expect(user.isAdmin).toBe(true);
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
  });
});
