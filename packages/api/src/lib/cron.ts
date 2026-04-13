import cron from "node-cron";
import { db } from "./db.js";
import { eq, plaidItems } from "@lasagna/core";
import { syncItem } from "./sync.js";

export function startCronJobs() {
  // Daily sync at 6am UTC
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

  console.log("[Cron] Daily sync scheduled for 6:00 AM UTC");
}
