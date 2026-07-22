import { describe, it, expect, vi } from "vitest";

import {
  generateInviteToken,
  createInvite,
  resolveInvite,
  INVITE_TTL_MS,
  type CreateInviteDeps,
  type InviteRow,
} from "../invites.js";

function fakeInvite(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: "invite-1",
    tenantId: "tenant-1",
    email: "partner@user.com",
    role: "member",
    token: "tok",
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("generateInviteToken", () => {
  it("returns a 43+ char URL-safe unguessable string", () => {
    const token = generateInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    // base64url charset only: A-Z a-z 0-9 - _
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a different token each call", () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken());
  });
});

describe("createInvite", () => {
  it("revokes a stale pending row before inserting a fresh one", async () => {
    const stale = fakeInvite({ id: "stale-1" });
    const inserted = fakeInvite({ id: "fresh-1" });
    const deps: CreateInviteDeps = {
      findPending: vi.fn(async () => stale),
      revokeInvite: vi.fn(async () => {}),
      insertInvite: vi.fn(async () => inserted),
    };
    const result = await createInvite(deps, {
      tenantId: "tenant-1",
      email: "partner@user.com",
      role: "member",
      invitedByUserId: "owner-1",
    });

    expect(deps.revokeInvite).toHaveBeenCalledWith("stale-1");
    expect(deps.insertInvite).toHaveBeenCalledTimes(1);
    const insertArg = (deps.insertInvite as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(insertArg.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result).toBe(inserted);
  });

  it("inserts directly when no stale pending row exists", async () => {
    const inserted = fakeInvite();
    const deps: CreateInviteDeps = {
      findPending: vi.fn(async () => undefined),
      revokeInvite: vi.fn(async () => {}),
      insertInvite: vi.fn(async () => inserted),
    };
    await createInvite(deps, {
      tenantId: "tenant-1",
      email: "partner@user.com",
      role: "member",
      invitedByUserId: "owner-1",
    });

    expect(deps.revokeInvite).not.toHaveBeenCalled();
    expect(deps.insertInvite).toHaveBeenCalledTimes(1);
  });
});

describe("resolveInvite", () => {
  const now = new Date("2026-07-22T00:00:00.000Z");

  it("returns ok for a pending unexpired row", () => {
    const invite = fakeInvite({ expiresAt: new Date(now.getTime() + 1000) });
    expect(resolveInvite(invite, now)).toEqual({ status: "ok", invite });
  });

  it("returns expired for a past expiresAt", () => {
    const invite = fakeInvite({ expiresAt: new Date(now.getTime() - 1000) });
    expect(resolveInvite(invite, now)).toEqual({ status: "expired" });
  });

  it("returns used when acceptedAt is set", () => {
    const invite = fakeInvite({ acceptedAt: new Date(now.getTime() - 5000) });
    expect(resolveInvite(invite, now)).toEqual({ status: "used" });
  });

  it("returns revoked when revokedAt is set", () => {
    const invite = fakeInvite({ revokedAt: new Date(now.getTime() - 5000) });
    expect(resolveInvite(invite, now)).toEqual({ status: "revoked" });
  });

  it("returns not_found for an unknown token (undefined row)", () => {
    expect(resolveInvite(undefined, now)).toEqual({ status: "not_found" });
  });
});
