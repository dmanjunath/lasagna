import cron from "node-cron";
import { db } from "./db.js";
import { eq, plaidItems, tenants } from "@lasagna/core";
import { syncItem } from "./sync.js";
import { generateInsights } from "./insights-engine.js";

export function startCronJobs() {
  // Plaid sync twice daily: 1pm ET (17:00 UTC) and 7pm ET (23:00 UTC)
  const syncAll = async () => {
    console.log("[Cron] Starting sync for all active Plaid items...");
    try {
      const items = await db.query.plaidItems.findMany({
        where: eq(plaidItems.status, "active"),
      });
      console.log(`[Cron] Found ${items.length} active items to sync`);

      const results = await Promise.allSettled(
        items.map((item) => syncItem(item.id))
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      console.log(`[Cron] Sync complete: ${succeeded} succeeded, ${failed} failed`);
    } catch (err) {
      console.error("[Cron] Sync error:", err);
    }
  };

  cron.schedule("0 17 * * *", syncAll); // 1pm ET
  cron.schedule("0 23 * * *", syncAll); // 7pm ET

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
