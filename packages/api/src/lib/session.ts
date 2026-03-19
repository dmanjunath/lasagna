import { env } from "./env.js";

interface SessionPayload {
  userId: string;
  tenantId: string;
  role: string;
}

const COOKIE_NAME = "lasagna_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function getSigningKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(
  payload: SessionPayload,
): Promise<string> {
  const data = JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE,
  });
  const encoded = new TextEncoder().encode(data);
  const key = await getSigningKey();
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoded);
  const b64Data = btoa(data);
  const b64Sig = bytesToHex(new Uint8Array(sig));
  return `${b64Data}.${b64Sig}`;
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const [b64Data, b64Sig] = token.split(".");
    if (!b64Data || !b64Sig) return null;

    const data = atob(b64Data);
    const encoded = new TextEncoder().encode(data);
    const sig = hexToBytes(b64Sig);
    const key = await getSigningKey();
    const valid = await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      sig as BufferSource,
      encoded,
    );
    if (!valid) return null;

    const parsed = JSON.parse(data);
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;

    return {
      userId: parsed.userId,
      tenantId: parsed.tenantId,
      role: parsed.role,
    };
  } catch {
    return null;
  }
}

export { COOKIE_NAME, MAX_AGE, type SessionPayload };
