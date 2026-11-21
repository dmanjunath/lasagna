import { db } from "./db.js";
import { and, asc, eq, sql, financialProfiles } from "@lasagna/core";
import { generateInsights } from "./insights-engine.js";
import { generateSpendCuts } from "./spend-cuts.js";

/**
 * The read backstop, moved off the read.
 *
 * GET /api/insights used to regenerate a stale household itself. That made a
 * reader wait on a model call, and once the call was moved out of band it ran
 * as fire-and-forget work after the response. Cloud Run allocates CPU to this
 * service only while a request is in flight, so work left running after the
 * response is throttled and may never finish.
 *
 * So the read only RECORDS that a refresh is wanted, in one idempotent
 * statement, and the scheduled insights run (a Cloud Scheduler request, which
 * keeps its CPU for as long as it runs) claims and does it. A household whose
 * owner never signs in again, a phone behind Face ID, is still refreshed: the
 * request bypasses the cron's activity filter, because a read IS the person
 * being here.
 */

// An attempt older than this is stale. It doubles as the COOLDOWN between two
// attempts, because generateInsights stamps its marker whether it succeeded or
// not. The marker used to be written only on success, so a household whose
// generation kept failing was stale on every read and every read paid for a
// model call: one household ran 303 calls for $23.78 in 15 hours that way.
// A day, because a read IS the person being here: an active household's
// actions are worked out daily, an idle one's every 3 days (lib/cron.ts).
export const ACTIONS_STALE_MS = 24 * 60 * 60 * 1000;
// A SECOND marker, never the one above: that one gates a paid model call, this
// one a free deterministic recompute, and sharing one is what once made a free
// regeneration close the paid refresh throttle. Daily, like the actions beside
// it: each run that finds a cut still holds extends its 30 days, so a monthly
// cadence would let a still-true cut expire in a 31-day month.
export const SPEND_CUTS_STALE_MS = 24 * 60 * 60 * 1000;

// The slack on every check the scheduled run makes. A household is stamped
// when its generation finishes, a minute or more after the 17:30 run starts,
// so the next day's run finds it a little UNDER a day old. A 24-hour due check
// then skips it, and a daily household is refreshed every 2 days. So the run
// treats anything older than 20 hours as due.
export const DUE_SLACK_MS = 4 * 60 * 60 * 1000;

// The claim's re-check, with the same slack. It must never be longer than the
// read's window above: a read asks only once a marker is past that window, and
// the marker only gets older until something regenerates it. So a claim that
// finds a marker fresh means something DID regenerate it, and clearing that
// request without a run is right. A claim window longer than the read's would
// clear a request the read had just made, for a marker that was "fresh" by
// minutes, and nothing would run.
const ACTIONS_CLAIM_STALE_MS = ACTIONS_STALE_MS - DUE_SLACK_MS;
const SPEND_CUTS_CLAIM_STALE_MS = SPEND_CUTS_STALE_MS - DUE_SLACK_MS;

// How many households are refreshed at once, as in lib/retry-failed.ts.
const REFRESH_CONCURRENCY = 4;

export function isStale(last: Date | string | null | undefined, staleMs: number, now: Date): boolean {
  return !last || now.getTime() - new Date(last).getTime() > staleMs;
}

/**
 * Ask for a refresh. One statement and no transaction: two reads arriving at
 * once both write the same thing, and the earliest request time is kept.
 */
export async function requestActionsRefresh(tenantId: string): Promise<void> {
  await db
    .insert(financialProfiles)
    .values({ tenantId, actionsRefreshRequestedAt: new Date() })
    .onConflictDoUpdate({
      target: financialProfiles.tenantId,
      set: {
        actionsRefreshRequestedAt: sql`coalesce(${financialProfiles.actionsRefreshRequestedAt}, now())`,
      },
    });
}

/**
 * Take a waiting refresh, or answer null because there is none (or another
 * runner took it first).
 *
 * The transaction holds the row lock for one read and one write and nothing
 * else. It clears the request and stamps the marker of each producer it is
 * about to run, BEFORE the work, so a second runner and any read in the next
 * minute both see a claimed household. The generators run after it commits.
 */
export async function claimActionsRefresh(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ actions: boolean; spendCuts: boolean } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        lastActionsGeneratedAt: financialProfiles.lastActionsGeneratedAt,
        lastSpendCutsGeneratedAt: financialProfiles.lastSpendCutsGeneratedAt,
      })
      .from(financialProfiles)
      .where(
        and(
          eq(financialProfiles.tenantId, tenantId),
          sql`${financialProfiles.actionsRefreshRequestedAt} is not null`,
        ),
      )
      .for("update");
    if (!row) return null;

    // Re-checked under the lock: the scheduled run may have refreshed this
    // household on its own cadence since the request was made.
    const actions = isStale(row.lastActionsGeneratedAt, ACTIONS_CLAIM_STALE_MS, now);
    const spendCuts = isStale(row.lastSpendCutsGeneratedAt, SPEND_CUTS_CLAIM_STALE_MS, now);
    await tx
      .update(financialProfiles)
      .set({
        actionsRefreshRequestedAt: null,
        ...(actions ? { lastActionsGeneratedAt: now } : {}),
        ...(spendCuts ? { lastSpendCutsGeneratedAt: now } : {}),
      })
      .where(eq(financialProfiles.tenantId, tenantId));
    return { actions, spendCuts };
  });
}

/**
 * Claim one household's waiting refresh and run it, outside the claim's
 * transaction. Answers null when there was nothing to claim, else whether every
 * step it ran succeeded. Each step fails alone: a failed actions run must not
 * skip the spend cuts the same claim already stamped as done.
 */
export async function refreshTenant(tenantId: string): Promise<boolean | null> {
  const claim = await claimActionsRefresh(tenantId);
  if (!claim) return null;
  let ok = true;
  const attempt = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (e) {
      ok = false;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Insights] Requested ${what} refresh failed for ${tenantId}: ${msg.slice(0, 300)}`);
    }
  };
  if (claim.actions) await attempt("actions", () => generateInsights(tenantId));
  // Without polish, so this never bills a model call.
  if (claim.spendCuts) await attempt("spend cuts", () => generateSpendCuts(tenantId));
  return ok;
}

/**
 * Run every waiting refresh, oldest request first. Called by the scheduled
 * insights run, after its own cadence pass, so a household that pass already
 * refreshed is claimed, found fresh, and costs nothing.
 *
 * No new household is claimed at or after `stopAt` (epoch ms). The run is one
 * Cloud Scheduler request with a deadline, and a run past it is retried while
 * the first is still going. A request left unclaimed stays queued for the next
 * run.
 *
 * No retry: the claim consumed the request and stamped the marker, and a
 * failed attempt is the cooldown working. The next cadence run picks it up.
 */
export async function runRequestedRefreshes(
  stopAt: number = Infinity,
): Promise<{ succeeded: number; failed: number; deferred: number }> {
  const waiting = await db
    .select({ tenantId: financialProfiles.tenantId })
    .from(financialProfiles)
    .where(sql`${financialProfiles.actionsRefreshRequestedAt} is not null`)
    .orderBy(asc(financialProfiles.actionsRefreshRequestedAt));
  return refreshTenants(waiting.map((w) => w.tenantId), stopAt);
}

/**
 * Refresh these households, at most REFRESH_CONCURRENCY at a time, and claim
 * none at or after `stopAt`. Two overlapping runs may both reach a household:
 * the claim lets one of them through.
 */
export async function refreshTenants(
  tenantIds: string[],
  stopAt: number,
): Promise<{ succeeded: number; failed: number; deferred: number }> {
  let succeeded = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < tenantIds.length && Date.now() < stopAt) {
      const tenantId = tenantIds[next++];
      try {
        const ok = await refreshTenant(tenantId);
        if (ok === true) succeeded++;
        else if (ok === false) failed++;
      } catch (e) {
        // The claim itself failed. The request is still there for the next run.
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[Insights] Requested refresh claim failed for ${tenantId}: ${msg.slice(0, 300)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, tenantIds.length) }, worker));
  const deferred = tenantIds.length - next;
  if (tenantIds.length > 0) {
    console.log(
      `[Insights] Requested refreshes: ${succeeded} succeeded, ${failed} failed of ${tenantIds.length}` +
        (deferred > 0 ? `, ${deferred} left queued for the next run` : ""),
    );
  }
  return { succeeded, failed, deferred };
}
