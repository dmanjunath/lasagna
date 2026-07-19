// Async real-estate value estimation. The provider works in two steps: POST a
// trigger for an address which returns a snapshot id, then GET that snapshot on
// a poll — 202 while the job runs, 200 with a JSON array once a value lands.
// All provider coordinates (base URL, dataset id, bearer key) come from env so
// nothing vendor-specific is baked into the repo.

function config(): { url: string; key: string; dataset: string } {
  const url = process.env.REAL_ESTATE_VALUES_API_URL;
  const key = process.env.REAL_ESTATE_VALUES_API_KEY;
  const dataset = process.env.REAL_ESTATE_VALUES_DATASET_ID;
  if (!url) throw new Error("REAL_ESTATE_VALUES_API_URL is not set");
  if (!key) throw new Error("REAL_ESTATE_VALUES_API_KEY is not set");
  if (!dataset) throw new Error("REAL_ESTATE_VALUES_DATASET_ID is not set");
  return { url, key, dataset };
}

export interface TriggerResult {
  snapshotId: string;
}

export type PollResult =
  | { status: "pending" }
  | { status: "ready"; value: number; currency: string }
  // `kind` distinguishes a definitive "no home value for this address" (it may
  // be commercial or unlisted — not worth retrying) from a transient error.
  | { status: "failed"; reason: string; kind: "no_home_value" | "transient" };

// Residential home types the value provider returns for a home. Anything else
// (or a missing type) means we can't treat it as a valuable residence.
const RESIDENTIAL_HOME_TYPES = new Set([
  "SINGLE_FAMILY",
  "CONDO",
  "TOWNHOUSE",
  "MANUFACTURED",
  "MULTI_FAMILY",
  "APARTMENT",
  "LOT",
]);

// Kick off a valuation job for an address. Returns the snapshot id to poll.
export async function requestRealEstateValue(address: string): Promise<TriggerResult> {
  const { url, key, dataset } = config();

  const triggerUrl =
    `${url}/trigger?dataset_id=${encodeURIComponent(dataset)}` +
    `&type=discover_new&discover_by=input_filters&notify=false&include_errors=true`;

  const res = await fetch(triggerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [{ location: address }], limit_per_input: 1 }),
  });

  if (!res.ok) {
    throw new Error(`Value estimate trigger failed (${res.status})`);
  }

  const data = (await res.json()) as { snapshot_id?: unknown };
  if (typeof data.snapshot_id !== "string" || !data.snapshot_id) {
    throw new Error("Value estimate trigger returned no snapshot id");
  }
  return { snapshotId: data.snapshot_id };
}

// One poll of a running snapshot. 202 → still running; 200 + array → parse the
// estimate. Reads the estimate field (NOT the listing price) and the currency.
export async function pollRealEstateValue(snapshotId: string): Promise<PollResult> {
  const { url, key } = config();

  const res = await fetch(
    `${url}/snapshot/${encodeURIComponent(snapshotId)}?format=json`,
    { headers: { Authorization: `Bearer ${key}` } },
  );

  if (res.status === 202) {
    return { status: "pending" };
  }
  if (!res.ok) {
    // An HTTP error is transient (server/provider hiccup) — worth retrying,
    // distinct from a definitive "no home value for this address".
    return { status: "failed", reason: `snapshot poll failed (${res.status})`, kind: "transient" };
  }

  const body = (await res.json()) as unknown;
  return parseSnapshot(body);
}

// Extracted so it can be unit-tested against fixtures without a live fetch.
export function parseSnapshot(body: unknown): PollResult {
  // A ready snapshot is a JSON array of records; take the first. An empty array
  // means the address didn't resolve to a valued home (commercial or unlisted).
  if (!Array.isArray(body) || body.length === 0) {
    return { status: "failed", reason: "no home value for this address", kind: "no_home_value" };
  }
  const record = body[0] as Record<string, unknown>;

  // Guard against commercial listings that slipped past the address-picker
  // check: a valuable home carries a residential homeType. An absent homeType
  // is tolerated (some records omit it) — the estimate check below still gates.
  const homeType = typeof record["homeType"] === "string" ? (record["homeType"] as string) : null;
  if (homeType !== null && !RESIDENTIAL_HOME_TYPES.has(homeType.toUpperCase())) {
    return { status: "failed", reason: "no home value for this address", kind: "no_home_value" };
  }

  // Generic estimate field — the provider's model-estimated value (distinct
  // from any listing price, which we deliberately ignore).
  const raw = record["zestimate"];
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    return { status: "failed", reason: "no home value for this address", kind: "no_home_value" };
  }

  const currency = typeof record.currency === "string" ? record.currency : "USD";
  return { status: "ready", value, currency };
}
