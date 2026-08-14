/**
 * Backfill Plaid webhook wiring for items linked before webhooks existed.
 *
 * For every active, non-manual plaid_items row:
 *   1. /item/get   → store Plaid's item_id (webhooks are keyed by it)
 *   2. /item/webhook/update → point the item at PLAID_WEBHOOK_URL
 *
 * Both endpoints are free (Item endpoints are not billed products), so this is
 * safe to re-run. Idempotent: rows that already match are skipped.
 *
 * Usage:
 *   DATABASE_URL=... PLAID_WEBHOOK_URL=https://api.example.com/api/plaid/webhook \
 *     npx tsx packages/api/scripts/backfill-plaid-webhooks.ts
 *   ... --dry-run
 */

import { parseArgs } from "node:util";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required, e.g. DATABASE_URL=postgresql://lasagna:lasagna@localhost:5432/lasagna");
  process.exit(1);
}

import { createDb, plaidItems, decrypt, eq } from "@lasagna/core";
import { plaidClient } from "../src/lib/plaid.js";
import { env } from "../src/lib/env.js";

const { values: args } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false } },
});
const dryRun = args["dry-run"] ?? false;

const webhookUrl = env.PLAID_WEBHOOK_URL;
if (!webhookUrl) {
  console.error("PLAID_WEBHOOK_URL is required, e.g. https://api.example.com/api/plaid/webhook");
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL);

async function main() {
  const items = await db.query.plaidItems.findMany();
  const linked = items.filter(
    (i) => i.status === "active" && !i.accessToken.startsWith("manual-"),
  );
  console.log(`${linked.length} linked item(s) to check${dryRun ? " (dry run)" : ""}`);

  let idsWritten = 0;
  let hooksSet = 0;
  let failed = 0;

  for (const item of linked) {
    try {
      const accessToken = await decrypt(item.accessToken, env.ENCRYPTION_KEY);
      const { data } = await plaidClient.itemGet({ access_token: accessToken });

      const label = item.institutionName ?? item.id;

      if (item.plaidItemId !== data.item.item_id) {
        console.log(`  ${label}: item_id → ${data.item.item_id}`);
        if (!dryRun) {
          await db
            .update(plaidItems)
            .set({ plaidItemId: data.item.item_id })
            .where(eq(plaidItems.id, item.id));
        }
        idsWritten++;
      }

      if (data.item.webhook !== webhookUrl) {
        console.log(`  ${label}: webhook ${data.item.webhook ?? "(none)"} → ${webhookUrl}`);
        if (!dryRun) {
          await plaidClient.itemWebhookUpdate({
            access_token: accessToken,
            webhook: webhookUrl,
          });
        }
        hooksSet++;
      }
    } catch (e) {
      failed++;
      let detail = e instanceof Error ? e.message : String(e);
      if (e && typeof e === "object" && "response" in e) {
        const err = e as { response?: { data?: { error_code?: string; error_message?: string } } };
        if (err.response?.data?.error_code) {
          detail = `${err.response.data.error_code}: ${err.response.data.error_message}`;
        }
      }
      console.error(`  ${item.institutionName ?? item.id}: ${detail}`);
    }
  }

  console.log(
    `Done. item_id written: ${idsWritten}, webhook set: ${hooksSet}, failed: ${failed}`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
