import { db } from "./db.js";
import { eq, and, asc, inArray, accounts, plaidItems, maxAccounts, type Plan } from "@lasagna/core";

/**
 * Given a tenant's accounts ordered OLDEST-FIRST and the plan's max, return the
 * ids that must be frozen — i.e. everything beyond the oldest `max`. Manual
 * accounts never freeze and don't count toward the limit. Pure.
 */
export function accountIdsToFreeze(
  ordered: { id: string; manual?: boolean }[],
  max: number
): string[] {
  return ordered
    .filter((a) => !a.manual)
    .slice(max)
    .map((a) => a.id);
}

/**
 * Recompute frozen flags for a tenant: the oldest `maxAccounts(plan)` stay
 * active, the rest freeze. Idempotent — safe to call after every sync and on
 * every plan change. Unfreezes everything when the limit grows (upgrade).
 */
export async function recomputeFrozenAccounts(tenantId: string, plan: Plan): Promise<void> {
  const max = maxAccounts(plan);
  // Read + both writes in one transaction so a concurrent recompute (e.g. a
  // webhook plan-change landing mid-sync) can't interleave into inconsistent
  // freeze state. Tiebreak on id so equal createdAt (batch inserts share
  // defaultNow()) still produces a deterministic — hence idempotent — ordering.
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: accounts.id, institutionId: plaidItems.institutionId })
      .from(accounts)
      .innerJoin(plaidItems, eq(accounts.plaidItemId, plaidItems.id))
      .where(eq(accounts.tenantId, tenantId))
      .orderBy(asc(accounts.createdAt), asc(accounts.id));
    const ordered = rows.map((r) => ({ id: r.id, manual: r.institutionId === "manual" }));

    const freezeIds = accountIdsToFreeze(ordered, max);
    const freezeSet = new Set(freezeIds);
    const activeIds = ordered.filter((a) => !freezeSet.has(a.id)).map((a) => a.id);

    // Condition each write on the current flag so unchanged rows aren't
    // rewritten — keeps this a true no-op (and avoids updatedAt churn) when
    // called after every sync with nothing to change.
    if (freezeIds.length > 0) {
      await tx
        .update(accounts)
        .set({ frozen: true })
        .where(and(inArray(accounts.id, freezeIds), eq(accounts.frozen, false)));
    }
    if (activeIds.length > 0) {
      await tx
        .update(accounts)
        .set({ frozen: false })
        .where(and(inArray(accounts.id, activeIds), eq(accounts.frozen, true)));
    }
  });
}
