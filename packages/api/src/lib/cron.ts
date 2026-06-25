import cron from "node-cron";
import { db } from "./db.js";
import { eq, plaidItems, tenants, type Plan } from "@lasagna/core";
import { syncItem } from "./sync.js";
import { generateInsights } from "./insights-engine.js";
import { resolveTenantPlan } from "./billing.js";

export function startCronJobs() {
  // Plaid sync twice daily: 1pm ET (17:00 UTC) and 7pm ET (23:00 UTC)
  // proOnly=false → every active item (covers free's 1×/day morning run)
  // proOnly=true  → only pro tenants' items (pro's 2nd daily run)
  const syncAll = async (proOnly = false) => {
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
      const results = await Promise.allSettled(toSync.map((item) => syncItem(item.id)));
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      console.log(`[Cron] Sync complete: ${succeeded} succeeded, ${failed} failed`);
    } catch (err) {
      console.error("[Cron] Sync error:", err);
    }
  };

  cron.schedule("0 17 * * *", () => syncAll(false)); // 1pm ET — all tenants
  cron.schedule("0 23 * * *", () => syncAll(true)); // 7pm ET — pro only

  // Daily insights generation at 5pm UTC / 1pm ET (after first sync)
  cron.schedule("30 17 * * *", async () => {
    console.log("[Cron] Starting daily insights generation...");
    try {
      const allTenants = await db.select({ id: tenants.id }).from(tenants);
      console.log(`[Cron] Generating insights for ${allTenants.length} tenants`);

      const results = await Promise.allSettled(
        allTenants.map(({ id }) => generateInsights(id))
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      console.log(`[Cron] Insights generation complete: ${succeeded} succeeded, ${failed} failed`);
    } catch (err) {
      console.error("[Cron] Insights generation error:", err);
    }
  });

  console.log("[Cron] Plaid sync scheduled for 1:00 PM ET (17:00 UTC) and 7:00 PM ET (23:00 UTC)");
  console.log("[Cron] Daily insights scheduled for 1:30 PM ET (17:30 UTC)");
}
