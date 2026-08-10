import { describe, it, expect, vi, beforeEach } from "vitest";

const um = {
  createUser: vi.fn(),
  authenticateWithPassword: vi.fn(),
  authenticateWithCode: vi.fn(),
  authenticateWithMagicAuth: vi.fn(),
  getAuthorizationUrl: vi.fn(() => "https://api.workos.com/authz?x=1"),
  createMagicAuth: vi.fn(),
  createPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  updateUser: vi.fn(),
  listUsers: vi.fn(),
};
vi.mock("../mode.js", () => ({
  authMode: () => "workos",
  getWorkos: () => ({ userManagement: um }),
}));

const WU = { id: "user_1", email: "a@b.com", firstName: "Ada", lastName: "Lovelace", emailVerified: true };

beforeEach(() => { vi.clearAllMocks(); });

describe("workos wrapper", () => {
  it("login returns normalized identity, joining name", async () => {
    um.authenticateWithPassword.mockResolvedValue({ user: WU });
    const { login } = await import("../workos.js");
    const r = await login({ email: "a@b.com", password: "pw" });
    expect(r).toEqual({ status: "ok", identity: { workosUserId: "user_1", email: "a@b.com", name: "Ada Lovelace" } });
  });

  it("login maps email_verification_required to needs_verification via Magic Auth", async () => {
    um.authenticateWithPassword.mockRejectedValue({ code: "email_verification_required" });
    const { login } = await import("../workos.js");
    const r = await login({ email: "a@b.com", password: "pw" });
    expect(r).toEqual({ status: "needs_verification", email: "a@b.com" });
    expect(um.createMagicAuth).toHaveBeenCalledWith({ email: "a@b.com" });
  });

  it("signUp creates user + sends a Magic Auth code", async () => {
    um.createUser.mockResolvedValue({ ...WU, emailVerified: false });
    const { signUp } = await import("../workos.js");
    const r = await signUp({ email: "a@b.com", password: "pw", name: "Ada Lovelace" });
    expect(um.createUser).toHaveBeenCalledWith({ email: "a@b.com", password: "pw", firstName: "Ada", lastName: "Lovelace" });
    expect(um.createMagicAuth).toHaveBeenCalledWith({ email: "a@b.com" });
    expect(r).toEqual({ status: "needs_verification", email: "a@b.com" });
  });

  it("signUp works without a password (passwordless)", async () => {
    um.createUser.mockResolvedValue({ ...WU, emailVerified: false });
    const { signUp } = await import("../workos.js");
    await signUp({ email: "a@b.com", name: "Ada Lovelace" });
    expect(um.createUser).toHaveBeenCalledWith({ email: "a@b.com", firstName: "Ada", lastName: "Lovelace" });
    expect(um.createMagicAuth).toHaveBeenCalledWith({ email: "a@b.com" });
  });

  it("signUp resends a Magic Auth code when the user already exists", async () => {
    um.createUser.mockRejectedValue(new Error("exists"));
    um.listUsers.mockResolvedValue({ data: [{ id: "user_1", email: "a@b.com" }] });
    const { signUp } = await import("../workos.js");
    const r = await signUp({ email: "a@b.com", password: "pw" });
    expect(um.createMagicAuth).toHaveBeenCalledWith({ email: "a@b.com" });
    expect(r).toEqual({ status: "needs_verification", email: "a@b.com" });
  });

  it("authenticateWithMagicAuth returns a normalized identity", async () => {
    um.authenticateWithMagicAuth.mockResolvedValue({ user: WU });
    const { authenticateWithMagicAuth } = await import("../workos.js");
    const r = await authenticateWithMagicAuth({ email: "a@b.com", code: "123456" });
    expect(um.authenticateWithMagicAuth).toHaveBeenCalledWith(expect.objectContaining({ email: "a@b.com", code: "123456" }));
    expect(r).toEqual({ workosUserId: "user_1", email: "a@b.com", name: "Ada Lovelace" });
  });

  it("hasWorkosUser reflects listUsers presence", async () => {
    const { hasWorkosUser } = await import("../workos.js");
    um.listUsers.mockResolvedValue({ data: [{ id: "user_1" }] });
    expect(await hasWorkosUser("a@b.com")).toBe(true);
    um.listUsers.mockResolvedValue({ data: [] });
    expect(await hasWorkosUser("x@y.com")).toBe(false);
  });

  it("setPassword calls updateUser", async () => {
    const { setPassword } = await import("../workos.js");
    await setPassword({ workosUserId: "user_1", password: "newpass12" });
    expect(um.updateUser).toHaveBeenCalledWith({ userId: "user_1", password: "newpass12" });
  });

  it("googleAuthUrl passes provider + redirect + state", async () => {
    const { googleAuthUrl } = await import("../workos.js");
    googleAuthUrl({ state: "st", redirectUri: "http://x/cb" });
    expect(um.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "GoogleOAuth", state: "st", redirectUri: "http://x/cb" }),
    );
  });

  it("handleCallback returns identity from code", async () => {
    um.authenticateWithCode.mockResolvedValue({ user: WU });
    const { handleCallback } = await import("../workos.js");
    expect(await handleCallback({ code: "c" })).toEqual({ workosUserId: "user_1", email: "a@b.com", name: "Ada Lovelace" });
  });
});
