import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "../crypto.js";

// A valid 32-byte hex key for testing
const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("crypto", () => {
  it("encrypts and decrypts a string round-trip", async () => {
    const plaintext = "access-sandbox-abc123";
    const encrypted = await encrypt(plaintext, TEST_KEY);
    const decrypted = await decrypt(encrypted, TEST_KEY);
    assert.equal(decrypted, plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const plaintext = "same-input";
    const a = await encrypt(plaintext, TEST_KEY);
    const b = await encrypt(plaintext, TEST_KEY);
    assert.notEqual(a, b);
  });

  it("handles empty string", async () => {
    const encrypted = await encrypt("", TEST_KEY);
    const decrypted = await decrypt(encrypted, TEST_KEY);
    assert.equal(decrypted, "");
  });

  it("handles unicode", async () => {
    const plaintext = "héllo wörld 🍝";
    const encrypted = await encrypt(plaintext, TEST_KEY);
    const decrypted = await decrypt(encrypted, TEST_KEY);
    assert.equal(decrypted, plaintext);
  });

  it("fails to decrypt with wrong key", async () => {
    const encrypted = await encrypt("secret", TEST_KEY);
    const wrongKey =
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    await assert.rejects(() => decrypt(encrypted, wrongKey));
  });

  it("rejects invalid key length", async () => {
    await assert.rejects(
      () => encrypt("test", "tooshort"),
      /ENCRYPTION_KEY must be a 32-byte hex string/,
    );
  });
});
