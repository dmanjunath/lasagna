import { describe, it, expect, vi, beforeAll } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

// Plaid's key endpoint is the only external dependency — serve our own test key.
const webhookVerificationKeyGet = vi.fn();
vi.mock("../plaid.js", () => ({
  plaidClient: {
    webhookVerificationKeyGet: (...args: unknown[]) => webhookVerificationKeyGet(...args),
  },
}));

const { verifyPlaidWebhook } = await import("../plaid-webhook.js");

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Mint a JWT the way Plaid does: ES256, raw r||s signature. */
function mintToken(opts: {
  body: string;
  kid?: string;
  alg?: string;
  iat?: number;
  bodyHash?: string;
}): string {
  const header = b64url(JSON.stringify({ alg: opts.alg ?? "ES256", kid: opts.kid ?? "test-kid" }));
  const payload = b64url(
    JSON.stringify({
      iat: opts.iat ?? Math.floor(Date.now() / 1000),
      request_body_sha256:
        opts.bodyHash ?? createHash("sha256").update(opts.body, "utf8").digest("hex"),
    }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${payload}.${b64url(signature)}`;
}

const BODY = JSON.stringify({
  webhook_type: "TRANSACTIONS",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  item_id: "item-abc",
});

describe("verifyPlaidWebhook", () => {
  beforeAll(() => {
    const jwk = publicKey.export({ format: "jwk" });
    webhookVerificationKeyGet.mockResolvedValue({ data: { key: { ...jwk, use: "sig" } } });
  });

  it("accepts a correctly signed webhook", async () => {
    expect(await verifyPlaidWebhook(mintToken({ body: BODY }), BODY)).toBe(true);
  });

  it("rejects a missing header", async () => {
    expect(await verifyPlaidWebhook(undefined, BODY)).toBe(false);
  });

  it("rejects a malformed token", async () => {
    expect(await verifyPlaidWebhook("not.a-jwt", BODY)).toBe(false);
  });

  it("rejects a tampered body", async () => {
    const token = mintToken({ body: BODY });
    const tampered = JSON.stringify({ ...JSON.parse(BODY), item_id: "item-attacker" });
    expect(await verifyPlaidWebhook(token, tampered)).toBe(false);
  });

  it("rejects a body hash that does not match", async () => {
    const token = mintToken({ body: BODY, bodyHash: "0".repeat(64) });
    expect(await verifyPlaidWebhook(token, BODY)).toBe(false);
  });

  it("rejects alg=none", async () => {
    const header = b64url(JSON.stringify({ alg: "none", kid: "test-kid" }));
    const payload = b64url(
      JSON.stringify({
        iat: Math.floor(Date.now() / 1000),
        request_body_sha256: createHash("sha256").update(BODY, "utf8").digest("hex"),
      }),
    );
    expect(await verifyPlaidWebhook(`${header}.${payload}.`, BODY)).toBe(false);
  });

  it("rejects a replayed webhook older than 5 minutes", async () => {
    const stale = Math.floor(Date.now() / 1000) - 6 * 60;
    expect(await verifyPlaidWebhook(mintToken({ body: BODY, iat: stale }), BODY)).toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const header = b64url(JSON.stringify({ alg: "ES256", kid: "test-kid" }));
    const payload = b64url(
      JSON.stringify({
        iat: Math.floor(Date.now() / 1000),
        request_body_sha256: createHash("sha256").update(BODY, "utf8").digest("hex"),
      }),
    );
    const badSig = sign("sha256", Buffer.from(`${header}.${payload}`), {
      key: other.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    expect(await verifyPlaidWebhook(`${header}.${payload}.${b64url(badSig)}`, BODY)).toBe(false);
  });

  it("caches the verification key per kid", async () => {
    webhookVerificationKeyGet.mockClear();
    await verifyPlaidWebhook(mintToken({ body: BODY, kid: "cache-kid" }), BODY);
    await verifyPlaidWebhook(mintToken({ body: BODY, kid: "cache-kid" }), BODY);
    expect(webhookVerificationKeyGet).toHaveBeenCalledTimes(1);
  });
});
