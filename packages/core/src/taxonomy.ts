// Default category taxonomy — seeded per tenant, keyed on systemKey.
// The 20 legacy transaction_category enum values map 1:1 (same systemKey).

import { and, eq } from "drizzle-orm";
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
    { systemKey: "savings_investment", name: "Savings & Investment" },
    { systemKey: "taxes", name: "Taxes" },
    { systemKey: "bank_fees", name: "Bank Fees" },
    { systemKey: "software_saas", name: "Software & SaaS" },
  ]},
  { systemKey: "transfers", name: "Transfers", type: "transfer", categories: [
    { systemKey: "transfer", name: "Transfer" },
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
