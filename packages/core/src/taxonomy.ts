// Default category taxonomy — seeded per tenant, keyed on systemKey.
// The 20 legacy transaction_category enum values map 1:1 (same systemKey).

import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./db.js";
import { categories, categoryGroups } from "./schema.js";

export interface DefaultCategory { systemKey: string; name: string }
export interface DefaultGroup {
  systemKey: string;
  name: string;
  type: "income" | "expense" | "transfer";
  categories: DefaultCategory[];
}

export const DEFAULT_TAXONOMY: DefaultGroup[] = [
  { systemKey: "income", name: "Income", type: "income", categories: [
    { systemKey: "income", name: "Income" },
  ]},
  { systemKey: "auto_transport", name: "Auto & Transport", type: "expense", categories: [
    { systemKey: "transportation", name: "Transportation" },
    { systemKey: "car_payment", name: "Car Payment" },
    { systemKey: "gas", name: "Gas" },
    { systemKey: "parking_tolls", name: "Parking & Tolls" },
    { systemKey: "auto_maintenance", name: "Auto Maintenance" },
  ]},
  { systemKey: "housing", name: "Housing", type: "expense", categories: [
    { systemKey: "housing", name: "Housing" },
    { systemKey: "home_improvement", name: "Home Improvement" },
  ]},
  { systemKey: "bills_utilities", name: "Bills & Utilities", type: "expense", categories: [
    { systemKey: "utilities", name: "Utilities" },
    { systemKey: "internet_phone", name: "Internet & Phone" },
    { systemKey: "insurance", name: "Insurance" },
    { systemKey: "subscriptions", name: "Subscriptions" },
  ]},
  { systemKey: "food_dining", name: "Food & Dining", type: "expense", categories: [
    { systemKey: "groceries", name: "Groceries" },
    { systemKey: "food_dining", name: "Dining Out" },
    { systemKey: "coffee_shops", name: "Coffee Shops" },
  ]},
  { systemKey: "shopping", name: "Shopping", type: "expense", categories: [
    { systemKey: "shopping", name: "Shopping" },
    { systemKey: "clothing", name: "Clothing" },
    { systemKey: "electronics", name: "Electronics" },
  ]},
  { systemKey: "health_wellness", name: "Health & Wellness", type: "expense", categories: [
    { systemKey: "healthcare", name: "Healthcare" },
    { systemKey: "personal_care", name: "Personal Care" },
    { systemKey: "fitness", name: "Fitness" },
  ]},
  { systemKey: "entertainment", name: "Entertainment", type: "expense", categories: [
    { systemKey: "entertainment", name: "Entertainment" },
  ]},
  { systemKey: "travel", name: "Travel", type: "expense", categories: [
    { systemKey: "travel", name: "Travel" },
  ]},
  { systemKey: "education", name: "Education", type: "expense", categories: [
    { systemKey: "education", name: "Education" },
  ]},
  { systemKey: "giving", name: "Giving", type: "expense", categories: [
    { systemKey: "gifts_donations", name: "Gifts & Donations" },
  ]},
  { systemKey: "financial", name: "Financial", type: "expense", categories: [
    { systemKey: "debt_payment", name: "Debt Payment" },
    { systemKey: "taxes", name: "Taxes" },
    { systemKey: "bank_fees", name: "Bank Fees" },
    { systemKey: "software_saas", name: "Software & SaaS" },
  ]},
  // Money moved into the household's own savings or brokerage is saving, not
  // spending, so it sits under a transfer-type group: every spending total
  // classifies by group type and leaves it out. Tenants seeded before this
  // have it under Financial; reclassifySavingsAsTransfer moves it.
  { systemKey: "transfers", name: "Transfers", type: "transfer", categories: [
    { systemKey: "transfer", name: "Transfer" },
    { systemKey: "savings_investment", name: "Savings & Investment" },
  ]},
  { systemKey: "other", name: "Other", type: "expense", categories: [
    { systemKey: "other", name: "Other" },
  ]},
];

// Never disableable; their groups can't be deleted or type-changed.
export const LOCKED_CATEGORY_KEYS = ["transfer", "income", "other"] as const;
export const LOCKED_GROUP_KEYS = ["transfers", "income", "other"] as const;

// Idempotent, keyed on systemKey: inserts only the groups/categories a tenant
// is missing. Safe to call on every tenant creation AND from the backfill.
export async function seedTaxonomyForTenant(db: Database, tenantId: string): Promise<void> {
  const existingGroups = await db
    .select({ id: categoryGroups.id, systemKey: categoryGroups.systemKey })
    .from(categoryGroups)
    .where(eq(categoryGroups.tenantId, tenantId));
  const groupIdByKey = new Map(
    existingGroups.filter((g) => g.systemKey).map((g) => [g.systemKey!, g.id]),
  );
  const existingCats = await db
    .select({ systemKey: categories.systemKey })
    .from(categories)
    .where(eq(categories.tenantId, tenantId));
  const haveCat = new Set(existingCats.map((c) => c.systemKey).filter(Boolean));

  for (let gi = 0; gi < DEFAULT_TAXONOMY.length; gi++) {
    const g = DEFAULT_TAXONOMY[gi];
    let groupId = groupIdByKey.get(g.systemKey);
    if (!groupId) {
      // onConflictDoNothing: concurrent seeding of the same tenant must not
      // 500 on the (tenant_id, system_key) unique constraint — the loser of
      // the race re-selects the winner's row.
      const [row] = await db
        .insert(categoryGroups)
        .values({ tenantId, name: g.name, type: g.type, systemKey: g.systemKey, sortOrder: gi * 10 })
        .onConflictDoNothing()
        .returning();
      if (row) {
        groupId = row.id;
      } else {
        const [existing] = await db
          .select({ id: categoryGroups.id })
          .from(categoryGroups)
          .where(and(eq(categoryGroups.tenantId, tenantId), eq(categoryGroups.systemKey, g.systemKey)));
        groupId = existing.id;
      }
      groupIdByKey.set(g.systemKey, groupId);
    }
    for (let ci = 0; ci < g.categories.length; ci++) {
      const cat = g.categories[ci];
      if (haveCat.has(cat.systemKey)) continue;
      await db.insert(categories).values({
        tenantId, groupId, name: cat.name, systemKey: cat.systemKey, sortOrder: ci * 10,
      }).onConflictDoNothing();
    }
  }
}

/**
 * Backfill for tenants seeded before Savings & Investment moved under Transfers:
 * moves the category from the system Financial group to the tenant's Transfers
 * group. A category the user has since moved to another group is left alone.
 * Idempotent. Returns the tenant ids it moved (or would move, on a dry run).
 */
export async function reclassifySavingsAsTransfer(
  db: Database,
  opts: { tenantId?: string; dryRun?: boolean } = {},
): Promise<string[]> {
  const tenantFilter = opts.tenantId ? sql`and c.tenant_id = ${opts.tenantId}` : sql``;
  const where = sql`
    where c.system_key = 'savings_investment'
      and fg.id = c.group_id and fg.system_key = 'financial'
      and tg.tenant_id = c.tenant_id and tg.system_key = 'transfers'
      ${tenantFilter}`;
  const rows = opts.dryRun
    ? await db.execute(sql`select c.tenant_id from categories c, category_groups fg, category_groups tg ${where}`)
    : await db.execute(
        sql`update categories c set group_id = tg.id from category_groups fg, category_groups tg ${where} returning c.tenant_id`,
      );
  return Array.from(rows as unknown as Array<{ tenant_id: string }>, (r) => r.tenant_id);
}
