import { db } from "./db.js";
import { eq, and, asc, inArray, accounts, maxAccounts, type Plan } from "@lasagna/core";

/**
 * Given a tenant's accounts ordered OLDEST-FIRST and the plan's max, return the
 * ids that must be frozen — i.e. everything beyond the oldest `max`. Pure.
 */
export function accountIdsToFreeze(ordered: { id: string }[], max: number): string[] {
  return ordered.slice(max).map((a) => a.id);
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
    const ordered = await tx.query.accounts.findMany({
      where: eq(accounts.tenantId, tenantId),
      orderBy: [asc(accounts.createdAt), asc(accounts.id)],
      columns: { id: true },
    });

    const freezeIds = accountIdsToFreeze(ordered, max);
    const activeIds = ordered.slice(0, max).map((a) => a.id);

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
