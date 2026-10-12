import cron from "node-cron";
import { db } from "./db.js";
import { and, eq, gte, sql, accounts, financialProfiles, pageViews, plaidItems, tenants, users, type Plan } from "@lasagna/core";
import { syncItem } from "./sync.js";
import { generateInsights } from "./insights-engine.js";
import { generateSpendCuts } from "./spend-cuts.js";
import { resolveTenantPlan } from "./billing.js";
import { runWithRetry } from "./retry-failed.js";
import { refreshValueEstimates } from "./value-estimate.js";

export interface CronRunResult {
  succeeded: number;
  failed: number;
  recovered: number;
}

// Plaid sync twice daily: 1pm ET (17:00 UTC) and 7pm ET (23:00 UTC)
// proOnly=false → every active item (covers free's 1×/day morning run)
// proOnly=true  → only pro tenants' items (pro's 2nd daily run)
export async function runSyncAll(proOnly = false): Promise<CronRunResult> {
  console.log(`[Cron] Starting sync (${proOnly ? "pro only" : "all tenants"})...`);
  try {
    const items = await db.query.plaidItems.findMany({
      where: eq(plaidItems.status, "active"),
    });

    let toSync = items;
    if (proOnly) {
      const planByTenant = new Map<string, Plan>();
      toSync = [];
      for (const item of items) {
        let plan = planByTenant.get(item.tenantId);
        if (!plan) {
          plan = await resolveTenantPlan(item.tenantId);
          planByTenant.set(item.tenantId, plan);
        }
        if (plan === "pro") toSync.push(item);
      }
    }

    console.log(`[Cron] Syncing ${toSync.length}/${items.length} items`);
    // One transient failure must self-heal within the run: retry rejected
    // items exactly once instead of swallowing them for a whole day.
    const { succeededFirstPass, recoveredOnRetry, stillFailedIds } = await runWithRetry(
      toSync.map((item) => item.id),
      (id) => syncItem(id)
    );
    const succeeded = succeededFirstPass + recoveredOnRetry;
    console.log(
      `[Cron] Sync complete: ${succeeded} succeeded, ${stillFailedIds.length} failed` +
        (recoveredOnRetry > 0 ? ` (${recoveredOnRetry} recovered on retry)` : "")
    );
    if (stillFailedIds.length > 0) {
      console.error(`[Cron] Sync items still failing after retry: ${stillFailedIds.join(", ")}`);
    }
    return { succeeded, failed: stillFailedIds.length, recovered: recoveredOnRetry };
  } catch (err) {
    console.error("[Cron] Sync error:", err);
    return { succeeded: 0, failed: 0, recovered: 0 };
  }
}

// A household is worth generating actions for when there is something to
// analyse AND somebody who will read the result. This query used to be an
// unfiltered `select id from tenants`, so every account ever created, including
// abandoned signups and test-domain tenants that never connected anything,
// bought a full model call every single day.
const INSIGHTS_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

// How often a household's actions are worked out again: every 3 days, or
// daily for one that was here in the last day. Active means a sign-in OR a page
// view: a phone that stays signed in behind Face ID never signs in again, so
// the sign-in alone would read a daily user as idle.
const ACTIONS_EVERY_MS = 3 * 24 * 60 * 60 * 1000;
const ACTIONS_ACTIVE_EVERY_MS = 24 * 60 * 60 * 1000;

function tenantsWorthGenerating(now: Date = new Date()) {
  const activeSince = new Date(now.getTime() - INSIGHTS_IDLE_MS);
  const dueBefore = new Date(now.getTime() - ACTIONS_EVERY_MS).toISOString();
  const activeDueBefore = new Date(now.getTime() - ACTIONS_ACTIVE_EVERY_MS).toISOString();
  const lastRun = sql`coalesce((select ${financialProfiles.lastActionsGeneratedAt} from ${financialProfiles} where ${financialProfiles.tenantId} = ${tenants.id}), 'epoch'::timestamptz)`;
  return db
    .selectDistinct({ id: tenants.id })
    .from(tenants)
    .innerJoin(accounts, eq(accounts.tenantId, tenants.id))
    .innerJoin(users, eq(users.tenantId, tenants.id))
    .where(
      and(
        gte(users.lastLoginAt, activeSince),
        sql`(${lastRun} < ${dueBefore} OR (${lastRun} < ${activeDueBefore} AND (
          ${users.lastLoginAt} >= ${activeDueBefore}
          OR exists (select 1 from ${pageViews} where ${pageViews.tenantId} = ${tenants.id} and ${pageViews.visitedAt} >= ${activeDueBefore})
        )))`,
      ),
    );
}

export async function runDailyInsights(): Promise<CronRunResult> {
  console.log("[Cron] Starting daily insights generation...");
  try {
    const targetTenants = await tenantsWorthGenerating();
    console.log(`[Cron] Generating insights for ${targetTenants.length} tenants`);

    // A transient failure here means a tenant gets no fresh actions for a day.
    // Retry the rejected tenants exactly once so it self-heals within the run.
    const { succeededFirstPass, recoveredOnRetry, stillFailedIds, retrySkipped } =
      await runWithRetry(
        targetTenants.map(({ id }) => id),
        (id) => generateInsights(id)
      );
    // The spend cuts on the same cadence, deterministic and free (no rewrite),
    // so a finding that still holds is found again, and its 30 days extended,
    // as often as the actions beside it.
    for (const { id } of targetTenants) {
      await generateSpendCuts(id).catch((e: unknown) =>
        console.error(`[Cron] Spend cuts refresh failed for ${id}:`, e instanceof Error ? e.message : e),
      );
    }
    const succeeded = succeededFirstPass + recoveredOnRetry;
    console.log(
      `[Cron] Insights generation complete: ${succeeded} succeeded, ${stillFailedIds.length} failed` +
        (recoveredOnRetry > 0 ? ` (${recoveredOnRetry} recovered on retry)` : "")
    );
    if (retrySkipped) {
      console.error(
        `[Cron] Retry pass SKIPPED: ${stillFailedIds.length}/${targetTenants.length} tenants failed the first pass, which reads as a broken dependency rather than flakiness`
      );
    }
    if (stillFailedIds.length > 0) {
      console.error(`[Cron] Insights still failing after retry for tenants: ${stillFailedIds.join(", ")}`);
    }
    return { succeeded, failed: stillFailedIds.length, recovered: recoveredOnRetry };
  } catch (err) {
    console.error("[Cron] Insights generation error:", err);
    return { succeeded: 0, failed: 0, recovered: 0 };
  }
}

/**
 * Rewrites every household's "ways to spend less" findings.
 *
 * Every tenant, not only the recently-active ones the insights job filters to:
 * an idle household costs a handful of queries and generateSpendCuts returns
 * early for one with no accounts.
 *
 * This is one of the two paths that pay to have the wording rewritten, and the
 * only scheduled one. It is a single model call per household that has a
 * finding, once a month, and a household with nothing to suggest never makes
 * one. The read backstop in routes/insights.ts deliberately does not: a page
 * load must not bill a model call.
 */
export async function runMonthlySpendCuts(): Promise<CronRunResult> {
  console.log("[Cron] Starting monthly spend cuts generation...");
  try {
    const targetTenants = await db.select({ id: tenants.id }).from(tenants);
    console.log(`[Cron] Generating spend cuts for ${targetTenants.length} tenants`);

    // A transient failure here means a household reads last month's findings
    // for another month. Retry the rejected tenants exactly once so it
    // self-heals within the run.
    const { succeededFirstPass, recoveredOnRetry, stillFailedIds, retrySkipped } =
      await runWithRetry(
        targetTenants.map(({ id }) => id),
        (id) => generateSpendCuts(id, { polish: true })
      );
    const succeeded = succeededFirstPass + recoveredOnRetry;
    console.log(
      `[Cron] Spend cuts generation complete: ${succeeded} succeeded, ${stillFailedIds.length} failed` +
        (recoveredOnRetry > 0 ? ` (${recoveredOnRetry} recovered on retry)` : "")
    );
    if (retrySkipped) {
      console.error(
        `[Cron] Retry pass SKIPPED: ${stillFailedIds.length}/${targetTenants.length} tenants failed the first pass, which reads as a broken dependency rather than flakiness`
      );
    }
    if (stillFailedIds.length > 0) {
      console.error(
        `[Cron] Spend cuts still failing after retry for tenants: ${stillFailedIds.join(", ")}`
      );
    }
    return { succeeded, failed: stillFailedIds.length, recovered: recoveredOnRetry };
  } catch (err) {
    console.error("[Cron] Spend cuts generation error:", err);
    return { succeeded: 0, failed: 0, recovered: 0 };
  }
}

// Monthly market estimates for properties. One provider request per property,
// so monthly keeps the cost down. Homes valued by the user are skipped.
export async function runMonthlyValueEstimates(): Promise<CronRunResult> {
  console.log("[Cron] Starting monthly property value estimates...");
  try {
    const { requested, ready, failed, pending } = await refreshValueEstimates();
    console.log(
      `[Cron] Property value estimates complete: ${requested} requested, ${ready} ready, ${failed} failed, ${pending} still pending`
    );
    return { succeeded: ready, failed, recovered: 0 };
  } catch (err) {
    console.error("[Cron] Property value estimates error:", err);
    return { succeeded: 0, failed: 0, recovered: 0 };
  }
}

export function startCronJobs() {
  // In prod the daily jobs run via Cloud Scheduler hitting /cron/* (see
  // routes/cron.ts); the in-process scheduler is disabled so they don't run
  // twice. Local dev leaves CRON_EXTERNAL unset and keeps in-process cron.
  if (process.env.CRON_EXTERNAL === "true") {
    console.log("[Cron] External scheduler mode: in-process cron disabled");
    return;
  }

  cron.schedule("0 17 * * *", () => runSyncAll(false)); // 1pm ET — all tenants
  cron.schedule("0 23 * * *", () => runSyncAll(true)); // 7pm ET — pro only

  // Daily insights generation at 5pm UTC / 1pm ET (after first sync)
  cron.schedule("30 17 * * *", () => runDailyInsights());

  // Monthly spend cuts on the 3rd at 18:00 UTC / 2pm ET, after that day's sync.
  // The 3rd rather than the 1st because Plaid needs a couple of days to settle
  // the end of the month, and the findings are computed over complete months.
  cron.schedule("0 18 3 * *", () => runMonthlySpendCuts());

  // Monthly property value estimates on the 1st at 19:00 UTC / 3pm ET.
  cron.schedule("0 19 1 * *", () => runMonthlyValueEstimates());

  console.log("[Cron] Plaid sync scheduled for 1:00 PM ET (17:00 UTC) and 7:00 PM ET (23:00 UTC)");
  console.log("[Cron] Daily insights scheduled for 1:30 PM ET (17:30 UTC)");
  console.log("[Cron] Monthly spend cuts scheduled for the 3rd at 2:00 PM ET (18:00 UTC)");
  console.log("[Cron] Monthly property value estimates scheduled for the 1st at 3:00 PM ET (19:00 UTC)");
}
