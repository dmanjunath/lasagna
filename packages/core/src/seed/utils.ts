// Password hashing using PBKDF2
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    key,
    KEY_LENGTH * 8,
  );
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(derived))}`;
}

/**
 * Parse amount strings like "50k", "1.5M", "100000"
 */
export function parseAmount(value: string | number): number {
  if (typeof value === "number") return value;

  const cleaned = value.trim().toLowerCase();
  const match = cleaned.match(/^([\d.]+)(k|m)?$/);

  if (!match) {
    throw new Error(`Invalid amount format: ${value}`);
  }

  const num = parseFloat(match[1]);
  const suffix = match[2];

  if (suffix === "k") return num * 1_000;
  if (suffix === "m") return num * 1_000_000;
  return num;
}

/**
 * Parse loan value with optional interest rate: "50k@5.9" or "50k"
 */
export function parseLoanValue(
  value: string | number,
): { amount: number; rate?: number } {
  if (typeof value === "number") return { amount: value };

  const parts = value.split("@");
  const amount = parseAmount(parts[0]);
  const rate = parts[1] ? parseFloat(parts[1]) : undefined;

  return { amount, rate };
}

/**
 * Parse key:value pairs from CLI flag
 * e.g., "cash:50k,brokerage:1.5M" -> { cash: "50k", brokerage: "1.5M" }
 */
export function parseKeyValuePairs(input: string): Record<string, string> {
  const result: Record<string, string> = {};

  if (!input) return result;

  const pairs = input.split(",");
  for (const pair of pairs) {
    const [key, value] = pair.split(":");
    if (key && value) {
      result[key.trim()] = value.trim();
    }
  }

  return result;
}

/**
 * Apply random variance to a value (default ±5%)
 */
export function randomVariance(value: number, percent: number = 5): number {
  const factor = 1 + (Math.random() * 2 - 1) * (percent / 100);
  return Math.round(value * factor * 100) / 100;
}
