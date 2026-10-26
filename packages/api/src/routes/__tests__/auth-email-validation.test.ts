import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// session.ts reads this at import time.
process.env.ENCRYPTION_KEY ??= "test-encryption-key-0123456789ab";

// Every malformed address must be turned away before anything is looked up,
// created or emailed, so the db and WorkOS mocks only exist to prove that.
const usersFindFirst = vi.fn(async (..._a: unknown[]) => undefined as unknown);
vi.mock("../../lib/db.js", () => ({
  db: { query: { users: { findFirst: (...a: unknown[]) => usersFindFirst(...a) } } },
}));

vi.mock("../../lib/auth/mode.js", () => ({ authMode: () => "workos" }));

const workos = vi.hoisted(() => ({
  signUp: vi.fn(),
  login: vi.fn(),
  sendMagicAuth: vi.fn(),
  hasWorkosUser: vi.fn(async () => true),
  authenticateWithMagicAuth: vi.fn(),
  sendPasswordReset: vi.fn(),
  friendlyError: vi.fn(),
}));
vi.mock("../../lib/auth/workos.js", () => workos);

const local = vi.hoisted(() => ({ localSignUp: vi.fn(), localLogin: vi.fn() }));
vi.mock("../../lib/auth/local.js", () => local);

import { authRoutes } from "../auth.js";

const app = new Hono().route("/api/auth", authRoutes);
const post = (path: string, body: Record<string, unknown>) =>
  app.request(`/api/auth${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

function expectNothingTouched() {
  expect(usersFindFirst).not.toHaveBeenCalled();
  for (const fn of [...Object.values(workos), ...Object.values(local)]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

describe("auth routes reject a malformed email with 400", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["/signup", { email: "abc", password: "a-long-password" }],
    ["/login", { email: "abc", password: "a-long-password" }],
    ["/login/start", { email: "abc" }],
    ["/login/code", { email: "bob@example", code: "123456" }],
    ["/verify-email", { email: "bob @example.com", code: "123456" }],
  ];

  it.each(cases)("POST %s", async (path, body) => {
    const res = await post(path, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid email address" });
    expectNothingTouched();
  });
});

describe("no-enumeration routes stay 200 but send nothing for a malformed email", () => {
  it.each([["/login/send-code"], ["/forgot-password"]])("POST %s", async (path) => {
    const res = await post(path, { email: "abc" });
    expect(res.status).toBe(200);
    expectNothingTouched();
  });
});

describe("a well-formed email still gets through", () => {
  it("POST /forgot-password sends the reset", async () => {
    const res = await post("/forgot-password", { email: "  Bob@Example.com " });
    expect(res.status).toBe(200);
    expect(workos.sendPasswordReset).toHaveBeenCalledWith({ email: "bob@example.com" });
  });
});
