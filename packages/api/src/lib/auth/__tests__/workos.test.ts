import { describe, it, expect, vi, beforeEach } from "vitest";

const um = {
  createUser: vi.fn(),
  authenticateWithPassword: vi.fn(),
  authenticateWithCode: vi.fn(),
  getAuthorizationUrl: vi.fn(() => "https://api.workos.com/authz?x=1"),
  sendVerificationEmail: vi.fn(),
  verifyEmail: vi.fn(),
  createPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
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

  it("login maps email_verification_required to needs_verification (+resends)", async () => {
    um.authenticateWithPassword.mockRejectedValue({ code: "email_verification_required" });
    um.listUsers.mockResolvedValue({ data: [{ id: "user_1", email: "a@b.com" }] });
    const { login } = await import("../workos.js");
    const r = await login({ email: "a@b.com", password: "pw" });
    expect(r).toEqual({ status: "needs_verification", workosUserId: "user_1", email: "a@b.com" });
    expect(um.sendVerificationEmail).toHaveBeenCalledWith({ userId: "user_1" });
  });

  it("signUp creates user (returned directly) + sends verification email", async () => {
    um.createUser.mockResolvedValue({ ...WU, emailVerified: false });
    const { signUp } = await import("../workos.js");
    const r = await signUp({ email: "a@b.com", password: "pw", name: "Ada Lovelace" });
    expect(um.createUser).toHaveBeenCalledWith({ email: "a@b.com", password: "pw", firstName: "Ada", lastName: "Lovelace" });
    expect(um.sendVerificationEmail).toHaveBeenCalledWith({ userId: "user_1" });
    expect(r).toEqual({ status: "needs_verification", workosUserId: "user_1", email: "a@b.com" });
  });

  it("verifyEmailCode returns identity", async () => {
    um.verifyEmail.mockResolvedValue({ user: WU });
    const { verifyEmailCode } = await import("../workos.js");
    const r = await verifyEmailCode({ workosUserId: "user_1", code: "123456" });
    expect(um.verifyEmail).toHaveBeenCalledWith({ userId: "user_1", code: "123456" });
    expect(r).toEqual({ workosUserId: "user_1", email: "a@b.com", name: "Ada Lovelace" });
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
