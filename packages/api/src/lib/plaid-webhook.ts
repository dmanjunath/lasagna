import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { plaidClient } from "./plaid.js";

// Plaid signs every webhook with an ES256 JWT in the `plaid-verification`
// header. The JWT's `request_body_sha256` claim pins the body, so verifying it
// proves both origin and integrity. Docs: plaid.com/docs/api/webhooks/webhook-verification
//
// Written against node:crypto rather than a JWT library — it's ~50 lines and
// avoids adding a dependency for one endpoint.

const MAX_AGE_SECONDS = 5 * 60;

// Verification keys are immutable per kid, so cache them. Plaid rotates by
// issuing a NEW kid, which misses the cache and fetches fresh.
const keyCache = new Map<string, ReturnType<typeof createPublicKey>>();

function b64urlToBuffer(part: string): Buffer {
  return Buffer.from(part, "base64url");
}

async function publicKeyForKid(kid: string) {
  const cached = keyCache.get(kid);
  if (cached) return cached;

  const resp = await plaidClient.webhookVerificationKeyGet({ key_id: kid });
  const jwk = resp.data.key;
  // Only the EC parameters — Plaid's JWK also carries created_at/expired_at,
  // which are not part of the key material.
  const key = createPublicKey({
    key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    format: "jwk",
  });
  keyCache.set(kid, key);
  return key;
}

/**
 * Verify a Plaid webhook. Returns true only if the JWT is well-formed, signed
 * by the key Plaid names, recent, and pinned to exactly this body.
 *
 * @param token   the `plaid-verification` header value
 * @param rawBody the request body as received, byte for byte
 */
export async function verifyPlaidWebhook(
  token: string | undefined,
  rawBody: string,
): Promise<boolean> {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: { alg?: string; kid?: string };
  let payload: { iat?: number; request_body_sha256?: string };
  try {
    header = JSON.parse(b64urlToBuffer(headerPart).toString("utf8"));
    payload = JSON.parse(b64urlToBuffer(payloadPart).toString("utf8"));
  } catch {
    return false;
  }

  // Pin the algorithm. Accepting `alg` from the token itself is the classic
  // JWT confusion bug (e.g. "none", or HS256 signed with the public key).
  if (header.alg !== "ES256" || !header.kid) return false;

  let key;
  try {
    key = await publicKeyForKid(header.kid);
  } catch (e) {
    console.error("[Plaid] verification key fetch failed:", e instanceof Error ? e.message : e);
    return false;
  }

  // ES256 signatures are raw r||s, not the DER encoding node defaults to.
  const signatureOk = verify(
    "sha256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    { key, dsaEncoding: "ieee-p1363" },
    b64urlToBuffer(signaturePart),
  );
  if (!signatureOk) return false;

  // Reject replays of an old, validly-signed webhook.
  if (typeof payload.iat !== "number") return false;
  if (Math.floor(Date.now() / 1000) - payload.iat > MAX_AGE_SECONDS) return false;

  // Bind the signature to this exact body.
  const claimed = payload.request_body_sha256;
  if (typeof claimed !== "string") return false;
  const actual = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(claimed, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
