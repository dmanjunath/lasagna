// Per-tenant taxonomy loading + pure category resolution used by every write
// path (sync, matcher, PATCH, rules, recurring) and reads.

import { and, eq, categories, categoryGroups } from "@lasagna/core";
import { db } from "./db.js";

export interface TenantCategory {
  id: string;
  systemKey: string | null;
  disabledAt: Date | null;
  groupId: string;
  groupType: "income" | "expense" | "transfer";
  name: string;
}

export async function loadTaxonomy(tenantId: string): Promise<TenantCategory[]> {
  return db
    .select({
      id: categories.id,
      systemKey: categories.systemKey,
      disabledAt: categories.disabledAt,
      groupId: categories.groupId,
      groupType: categoryGroups.type,
      name: categories.name,
    })
    .from(categories)
    .innerJoin(
      categoryGroups,
      // tenantId on the join too: defense-in-depth so a cross-tenant groupId
      // (should be impossible once move-category CRUD validates) never leaks.
      and(eq(categories.groupId, categoryGroups.id), eq(categoryGroups.tenantId, tenantId)),
    )
    .where(eq(categories.tenantId, tenantId));
}

// systemKey → tenant category id; disabled or missing target falls back to
// Other (the user's disable rule). Null only for an unseeded tenant.
export function resolveCategoryId(tax: TenantCategory[], systemKey: string): string | null {
  const hit = tax.find((c) => c.systemKey === systemKey);
  if (hit && !hit.disabledAt) return hit.id;
  return tax.find((c) => c.systemKey === "other")?.id ?? null;
}

// Rule-target/category id → id, falling back to Other when disabled/missing.
export function activeCategoryId(tax: TenantCategory[], categoryId: string | null | undefined): string | null {
  const hit = categoryId ? tax.find((c) => c.id === categoryId) : undefined;
  if (hit && !hit.disabledAt) return hit.id;
  return tax.find((c) => c.systemKey === "other")?.id ?? null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
