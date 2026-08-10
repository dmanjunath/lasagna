import { describe, it, expect, beforeAll } from "vitest";

let session: typeof import("../session.js");

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-encryption-key-0123456789ab";
  session = await import("../session.js");
});

const payload = { userId: "u1", tenantId: "t1", role: "owner", isDemo: false, isAdmin: false };

describe("session token iat", () => {
  it("embeds iat at issue time and returns it on verify", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await session.createSessionToken(payload);
    const v = await session.verifySessionToken(token);
    expect(v).not.toBeNull();
    expect(v!.iat).toBeGreaterThanOrEqual(before);
    expect(v!.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it("treats legacy tokens without iat as iat 0", async () => {
    // Same HMAC scheme as createSessionToken, but no iat claim.
    const data = JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 });
    const key = await globalThis.crypto.subtle.importKey(
      "raw", new TextEncoder().encode(process.env.ENCRYPTION_KEY!),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
    const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
    const v = await session.verifySessionToken(`${btoa(data)}.${hex}`);
    expect(v).not.toBeNull();
    expect(v!.iat).toBe(0);
  });
});
