import { and, eq, accounts, balanceSnapshots, parsePropertyMetadata, type PropertyMetadata } from "@lasagna/core";
import { db } from "./db.js";
import { requestRealEstateValue, pollRealEstateValue } from "../services/fetchRealEstateValues.js";

// Merge helper: parse the account's existing metadata blob, apply the change,
// and persist. Keeps unknown keys intact (same merge-only contract as the
// property-details endpoint).
async function mergeMetadata(
  accountId: string,
  currentMetadata: string | null,
  patch: Record<string, unknown>,
): Promise<void> {
  let existing: Record<string, unknown> = {};
  if (currentMetadata) {
    try {
      const p = JSON.parse(currentMetadata);
      if (p && typeof p === "object" && !Array.isArray(p)) existing = p;
    } catch {
      // malformed — start fresh
    }
  }
  const metadata = { ...existing, ...patch };
  await db
    .update(accounts)
    .set({ metadata: JSON.stringify(metadata) })
    .where(eq(accounts.id, accountId));
}

// Trigger an async value estimate for a property account's address and record
// the pending job in metadata.valueEstimate. Best-effort: if the provider is
// unconfigured or the trigger fails, we swallow the error so account creation /
// address edits never block on it. Returns whether a job was started.
export async function kickOffValueEstimate(
  accountId: string,
  currentMetadata: string | null,
  address: string,
  // The user typed their own value alongside the address on create — the
  // estimate is informational (advisory) and must never overwrite it.
  // `override` is the durable version chosen from the detail page's value-source
  // control; both skip the snapshot in advanceValueEstimate.
  opts: { advisory?: boolean; override?: boolean } = {},
): Promise<boolean> {
  const trimmed = address.trim();
  if (!trimmed) return false;
  try {
    const { snapshotId } = await requestRealEstateValue(trimmed);
    await mergeMetadata(accountId, currentMetadata, {
      valueEstimate: {
        snapshotId,
        status: "pending",
        requestedAt: new Date().toISOString(),
        ...(opts.advisory ? { advisory: true } : {}),
        ...(opts.override ? { override: true } : {}),
      },
    });
    return true;
  } catch {
    return false;
  }
}

// Poll the stored snapshot for a property account and, when a value has landed,
// record it exactly once: a balance_snapshots row (source "estimate") plus a
// metadata flip to status "ready". Idempotent — a ready estimate is never
// re-recorded. Returns the status to hand back to the client.
export async function advanceValueEstimate(
  account: { id: string; tenantId: string; metadata: string | null },
  poll: (
    snapshotId: string,
  ) => Promise<
    | { status: "pending" }
    | { status: "ready"; value: number; currency: string }
    | { status: "failed"; reason: string; kind?: "no_home_value" | "transient" }
  >,
): Promise<{
  status: "pending" | "ready" | "failed";
  value?: number;
  // "no_home_value" surfaces the distinct "couldn't find a home value (may be
  // commercial or unlisted)" message; absent for transient/other failures.
  reason?: "no_home_value";
}> {
  const meta = parsePropertyMetadata(account.metadata);
  const est = meta?.valueEstimate;
  if (!est) return { status: "failed" };

  // Already recorded — don't poll or double-insert. An advisory/override estimate
  // never wrote a snapshot (the latest one is the user's typed value), so don't
  // report that figure as the estimate.
  if (est.status === "ready") {
    if (est.advisory || est.override) return { status: "ready" };
    const latest = await db.query.balanceSnapshots.findFirst({
      where: eq(balanceSnapshots.accountId, account.id),
      orderBy: (b, { desc }) => [desc(b.snapshotAt)],
    });
    const value = latest?.balance != null ? parseFloat(latest.balance) : undefined;
    return { status: "ready", value };
  }
  if (est.status === "failed") return { status: "failed" };

  const result = await poll(est.snapshotId);
  if (result.status === "pending") return { status: "pending" };

  if (result.status === "failed") {
    await mergeMetadata(account.id, account.metadata, {
      valueEstimate: { ...est, status: "failed" },
    });
    return result.kind === "no_home_value"
      ? { status: "failed", reason: "no_home_value" }
      : { status: "failed" };
  }

  // Advisory / override — the user's own value is the source of truth, so flip
  // the job to ready but never write a snapshot; the estimate is informational
  // only and must never overwrite the value they entered.
  if (est.advisory || est.override) {
    await mergeMetadata(account.id, account.metadata, {
      valueEstimate: { ...est, status: "ready" },
    });
    return { status: "ready", value: result.value };
  }

  // Ready — record the value the same way a manual value update does (new
  // balance snapshot), tagged with source "estimate", then flip metadata.
  await db.insert(balanceSnapshots).values({
    accountId: account.id,
    tenantId: account.tenantId,
    balance: String(result.value),
    isoCurrencyCode: result.currency,
    source: "estimate",
    snapshotAt: new Date(),
  });
  await mergeMetadata(account.id, account.metadata, {
    valueEstimate: { ...est, status: "ready" },
  });
  return { status: "ready", value: result.value };
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Under a month, so an estimate requested on one monthly run is due again on
// the next one.
const REFRESH_AFTER_MS = 25 * DAY_MS;

// Whether the monthly run should request a new estimate for this property. Only
// properties valued by the market estimate: a user's own value (override) or a
// value typed on create (advisory) is never replaced, so re-estimating it buys
// nothing. An address with no job at all means the first trigger failed.
export function isEstimateDue(meta: PropertyMetadata | null, now: Date): boolean {
  if (!meta?.address?.trim()) return false;
  const est = meta.valueEstimate;
  if (!est) return true;
  if (est.override || est.advisory) return false;
  const requestedAt = Date.parse(est.requestedAt);
  return !Number.isFinite(requestedAt) || now.getTime() - requestedAt >= REFRESH_AFTER_MS;
}

// Monthly refresh: request a new estimate for every due property, then poll the
// pending jobs until they land or the deadline passes. A job still pending at
// the deadline is not lost: the account page polls it, and the next run picks
// it up first. Re-running is safe: a job requested in this run is not due again.
export async function refreshValueEstimates(
  opts: { pollIntervalMs?: number; deadlineMs?: number } = {},
): Promise<{ requested: number; ready: number; failed: number; pending: number }> {
  const pollIntervalMs = opts.pollIntervalMs ?? 30_000;
  const deadline = Date.now() + (opts.deadlineMs ?? 10 * 60_000);

  const properties = await db.query.accounts.findMany({
    where: and(eq(accounts.type, "real_estate"), eq(accounts.frozen, false)),
  });

  let requested = 0;
  let failed = 0;
  const now = new Date();
  for (const p of properties) {
    const meta = parsePropertyMetadata(p.metadata);
    if (!isEstimateDue(meta, now)) continue;
    if (await kickOffValueEstimate(p.id, p.metadata, meta!.address!)) requested++;
    else failed++;
  }

  // Every pending job, not only this run's: one left pending last month lands here.
  let pendingIds = properties.map((p) => p.id);
  let ready = 0;
  for (;;) {
    const stillPending: string[] = [];
    for (const id of pendingIds) {
      const acct = await db.query.accounts.findFirst({ where: eq(accounts.id, id) });
      if (!acct) continue;
      if (parsePropertyMetadata(acct.metadata)?.valueEstimate?.status !== "pending") continue;
      // A network error on one poll must not end the run. Treat it as still running.
      const result = await advanceValueEstimate(
        { id: acct.id, tenantId: acct.tenantId, metadata: acct.metadata },
        pollRealEstateValue,
      ).catch(() => ({ status: "pending" as const }));
      if (result.status === "ready") ready++;
      else if (result.status === "failed") failed++;
      else stillPending.push(id);
    }
    pendingIds = stillPending;
    if (pendingIds.length === 0 || Date.now() + pollIntervalMs > deadline) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return { requested, ready, failed, pending: pendingIds.length };
}
