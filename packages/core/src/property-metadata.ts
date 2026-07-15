// Typed shape of `accounts.metadata` for real_estate accounts. Mirrors
// liability-metadata.ts: lenient parse, null for legacy/malformed blobs.
export interface PropertyMetadata {
  address?: string;
  yearBuilt?: number;
  squareFeet?: number;
  /** Rental economics — only prompted for subtype "rental", valid on any property. */
  monthlyRent?: number;
  annualInsurance?: number;
  annualMaintenance?: number;
}

const STRING_KEYS = ["address"] as const;
const NUMBER_KEYS = [
  "yearBuilt",
  "squareFeet",
  "monthlyRent",
  "annualInsurance",
  "annualMaintenance",
] as const;

export function parsePropertyMetadata(raw: string | null): PropertyMetadata | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const out: PropertyMetadata = {};
  for (const k of STRING_KEYS) {
    if (typeof obj[k] === "string") out[k] = obj[k] as string;
  }
  for (const k of NUMBER_KEYS) {
    if (typeof obj[k] === "number" && Number.isFinite(obj[k])) out[k] = obj[k] as number;
  }
  return out;
}
