import cron from "node-cron";
import { db } from "./db.js";
import { eq, gte, accounts, plaidItems, tenants, users, type Plan } from "@lasagna/core";
import { syncItem } from "./sync.js";
import { generateInsights } from "./insights-engine.js";
import { generateSpendCuts } from "./spend-cuts.js";
import { resolveTenantPlan } from "./billing.js";
import { runWithRetry } from "./retry-failed.js";

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

function tenantsWorthGenerating() {
  const activeSince = new Date(Date.now() - INSIGHTS_IDLE_MS);
  return db
    .selectDistinct({ id: tenants.id })
    .from(tenants)
    .innerJoin(accounts, eq(accounts.tenantId, tenants.id))
    .innerJoin(users, eq(users.tenantId, tenants.id))
    .where(gte(users.lastLoginAt, activeSince));
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

  console.log("[Cron] Plaid sync scheduled for 1:00 PM ET (17:00 UTC) and 7:00 PM ET (23:00 UTC)");
  console.log("[Cron] Daily insights scheduled for 1:30 PM ET (17:30 UTC)");
  console.log("[Cron] Monthly spend cuts scheduled for the 3rd at 2:00 PM ET (18:00 UTC)");
}
