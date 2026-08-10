const ALG = "AES-GCM";
const IV_BYTES = 12;
const TAG_BITS = 128;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function importKey(hexKey: string): Promise<CryptoKey> {
  if (hexKey.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte hex string (64 chars)");
  }
  return globalThis.crypto.subtle.importKey(
    "raw",
    hexToBytes(hexKey).buffer as ArrayBuffer,
    { name: ALG },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a hex string in the format: iv + ciphertext (including auth tag).
 */
export async function encrypt(
  plaintext: string,
  hexKey: string,
): Promise<string> {
  const key = await importKey(hexKey);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuf = await globalThis.crypto.subtle.encrypt(
    { name: ALG, iv, tagLength: TAG_BITS },
    key,
    encoded,
  );

  const combined = new Uint8Array(IV_BYTES + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), IV_BYTES);

  return bytesToHex(combined);
}

/**
 * Decrypt a hex string produced by encrypt() back to plaintext.
 */
export async function decrypt(
  cipherHex: string,
  hexKey: string,
): Promise<string> {
  const key = await importKey(hexKey);
  const combined = hexToBytes(cipherHex);

  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);

  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: ALG, iv, tagLength: TAG_BITS },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plainBuf);
}
