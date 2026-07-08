/**
 * Remap auto-categorised transactions using stored Plaid category fields.
 *
 * For every row where category_source='auto' AND plaid_category_primary IS NOT NULL,
 * recompute the category via mapCategory + tenant taxonomy and update only when
 * the resolved categoryId differs from the current one.
 *
 * Usage:
 *   npx tsx packages/api/scripts/remap-from-plaid.ts
 *   npx tsx packages/api/scripts/remap-from-plaid.ts --tenant=<uuid>
 *   npx tsx packages/api/scripts/remap-from-plaid.ts --dry-run
 *   npx tsx packages/api/scripts/remap-from-plaid.ts --tenant=<uuid> --dry-run
 */

import { parseArgs } from "node:util";

// No dotenv — pass DATABASE_URL explicitly (dotenv isn't resolvable from the
// host root under pnpm strict deps, and the .env URL points at the docker-
// internal `db` host anyway).
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required, e.g. DATABASE_URL=postgresql://lasagna:lasagna@localhost:5432/lasagna");
  process.exit(1);
}

import { createDb, transactions, tenants, eq, and, sql } from "@lasagna/core";
import { mapCategory } from "../src/lib/transaction-sync.js";
import { loadTaxonomy, resolveCategoryId } from "../src/lib/taxonomy.js";

const { values: args } = parseArgs({
  options: {
    tenant: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: false,
});

const dryRun = args["dry-run"] ?? false;
const tenantFilter = args["tenant"] as string | undefined;

const db = createDb(process.env.DATABASE_URL!);

async function remapTenant(tenantId: string): Promise<void> {
  const taxonomy = await loadTaxonomy(tenantId);

  // Fetch all auto-categorised rows that have stored Plaid category data
  const rows = await db
    .select({
      id: transactions.id,
      categoryId: transactions.categoryId,
      plaidCategoryPrimary: transactions.plaidCategoryPrimary,
      plaidCategoryDetailed: transactions.plaidCategoryDetailed,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        eq(transactions.categorySource, "auto"),
        sql`${transactions.plaidCategoryPrimary} IS NOT NULL`,
      ),
    );

  if (rows.length === 0) {
    console.log(`  Tenant ${tenantId}: 0 eligible rows — skipping`);
    return;
  }

  // Tally: from-category-name → to-category-name → count
  const moveCounts = new Map<string, Map<string, number>>();
  const updates: Array<{ id: string; newCategoryId: string }> = [];

  for (const row of rows) {
    const newKey = mapCategory({
      primary: row.plaidCategoryPrimary ?? undefined,
      detailed: row.plaidCategoryDetailed ?? undefined,
    });
    const newId = resolveCategoryId(taxonomy, newKey);
    if (!newId || newId === row.categoryId) continue;

    const fromName = taxonomy.find((c) => c.id === row.categoryId)?.systemKey ?? row.categoryId;
    const toName = taxonomy.find((c) => c.id === newId)?.systemKey ?? newId;

    if (!moveCounts.has(fromName)) moveCounts.set(fromName, new Map());
    const inner = moveCounts.get(fromName)!;
    inner.set(toName, (inner.get(toName) ?? 0) + 1);

    updates.push({ id: row.id, newCategoryId: newId });
  }

  // Print per-category migration counts
  if (moveCounts.size === 0) {
    console.log(`  Tenant ${tenantId}: ${rows.length} rows checked, 0 would change`);
    return;
  }

  for (const [from, tos] of moveCounts) {
    for (const [to, count] of tos) {
      console.log(`  ${from} → ${to}: ${count}`);
    }
  }
  console.log(`  Total: ${updates.length} of ${rows.length} rows would change`);

  if (dryRun) {
    console.log("  [dry-run] No writes performed.");
    return;
  }

  // Apply updates one by one (batches of 100 to keep statements manageable)
  const BATCH = 100;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    for (const { id, newCategoryId } of batch) {
      await db
        .update(transactions)
        .set({ categoryId: newCategoryId })
        .where(eq(transactions.id, id));
    }
  }
  console.log(`  Updated ${updates.length} rows.`);
}

async function main() {
  console.log(`remap-from-plaid ${dryRun ? "(dry-run)" : "(live)"}`);

  if (tenantFilter) {
    console.log(`\nTenant ${tenantFilter}:`);
    await remapTenant(tenantFilter);
  } else {
    const allTenants = await db.select({ id: tenants.id }).from(tenants);
    for (const { id } of allTenants) {
      console.log(`\nTenant ${id}:`);
      await remapTenant(id);
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
