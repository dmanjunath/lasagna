/**
 * Move every tenant's "Savings & Investment" category from the Financial
 * (expense) group to the Transfers group, so money moved into their own savings
 * or brokerage stops counting as spending on existing tenants too. New tenants
 * are seeded that way already (DEFAULT_TAXONOMY).
 *
 * Touches only the category's group. No transaction is rewritten. A category the
 * user moved to another group themselves is left where they put it. Idempotent.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx packages/api/scripts/backfill-savings-as-transfer.ts --dry-run
 *   DATABASE_URL=... npx tsx packages/api/scripts/backfill-savings-as-transfer.ts
 *   ... --tenant 00000000-0000-0000-0000-000000000000   (one tenant only)
 */

import { parseArgs } from "node:util";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required, e.g. DATABASE_URL=postgresql://lasagna:lasagna@localhost:5439/lasagna");
  process.exit(1);
}

import { createDb, reclassifySavingsAsTransfer } from "@lasagna/core";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    tenant: { type: "string" },
  },
});

const db = createDb(process.env.DATABASE_URL);
const dryRun = args["dry-run"] ?? false;
const moved = await reclassifySavingsAsTransfer(db, { tenantId: args.tenant, dryRun });
console.log(`${moved.length} tenant(s) ${dryRun ? "would be reclassified (dry run)" : "reclassified"}`);
process.exit(0);
