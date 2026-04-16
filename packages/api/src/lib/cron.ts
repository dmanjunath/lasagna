import cron from "node-cron";
import { db } from "./db.js";
import { eq, plaidItems, tenants } from "@lasagna/core";
import { syncItem } from "./sync.js";
import { generateInsights } from "./insights-engine.js";

export function startCronJobs() {
  // Daily Plaid sync at 6am UTC
  cron.schedule("0 6 * * *", async () => {
    console.log("[Cron] Starting daily sync for all active Plaid items...");
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
      console.log(`[Cron] Daily sync complete: ${succeeded} succeeded, ${failed} failed`);
    } catch (err) {
      console.error("[Cron] Daily sync error:", err);
    }
  });

  // Daily insights generation at 7am UTC (after sync completes)
  cron.schedule("0 7 * * *", async () => {
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

  console.log("[Cron] Daily sync scheduled for 6:00 AM UTC");
  console.log("[Cron] Daily insights scheduled for 7:00 AM UTC");
}
