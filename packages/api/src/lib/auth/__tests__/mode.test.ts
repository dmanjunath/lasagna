import { describe, it, expect, afterEach, vi } from "vitest";

async function loadMode() {
  vi.resetModules();
  return (await import("../mode.js")).authMode;
}

describe("authMode", () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  it("is 'workos' when both WorkOS vars are set", async () => {
    process.env.WORKOS_API_KEY = "sk_test";
    process.env.WORKOS_CLIENT_ID = "client_x";
    expect((await loadMode())()).toBe("workos");
  });

  it("is 'local' when either var is missing", async () => {
    delete process.env.WORKOS_API_KEY;
    process.env.WORKOS_CLIENT_ID = "client_x";
    expect((await loadMode())()).toBe("local");
  });
});
