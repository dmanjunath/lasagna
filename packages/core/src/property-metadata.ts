// Async value-estimate job tracked on a property account. Kicked off when the
// address is set; the poll endpoint advances it to "ready" once a value lands.
export interface PropertyValueEstimate {
  /** Provider snapshot id to poll (e.g. "sd_..."). */
  snapshotId: string;
  status: "pending" | "ready" | "failed";
  /** ISO timestamp the job was requested. */
  requestedAt: string;
  /**
   * The user entered their own value alongside the address, so the estimate is
   * informational only — it must never overwrite the balance they typed.
   */
  advisory?: boolean;
  /**
   * The user chose "My own value" as the source of truth: their number is a
   * persisted override. Like `advisory`, the estimate must never overwrite the
   * displayed value — but this one survives across syncs and re-polls until they
   * explicitly switch back to the market estimate.
   */
  override?: boolean;
}

// Typed shape of `accounts.metadata` for real_estate accounts. Mirrors
// liability-metadata.ts: lenient parse, null for legacy/malformed blobs.
export interface PropertyMetadata {
  address?: string;
  /** Google Places identity + geocode for the address, set on autocomplete select. */
  placeId?: string;
  lat?: number;
  lng?: number;
  /** Rental economics — only prompted for subtype "rental", valid on any property. */
  monthlyRent?: number;
  annualInsurance?: number;
  annualMaintenance?: number;
  /** Async address-based value estimate, present once a fetch has been kicked off. */
  valueEstimate?: PropertyValueEstimate;
}

const STRING_KEYS = ["address", "placeId"] as const;
const NUMBER_KEYS = [
  "lat",
  "lng",
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
  const ve = obj["valueEstimate"];
  if (ve && typeof ve === "object" && !Array.isArray(ve)) {
    const v = ve as Record<string, unknown>;
    if (
      typeof v.snapshotId === "string" &&
      (v.status === "pending" || v.status === "ready" || v.status === "failed") &&
      typeof v.requestedAt === "string"
    ) {
      out.valueEstimate = {
        snapshotId: v.snapshotId,
        status: v.status,
        requestedAt: v.requestedAt,
        ...(v.advisory === true ? { advisory: true } : {}),
        ...(v.override === true ? { override: true } : {}),
      };
    }
  }
  return out;
}
