import { db } from "./db.js";
import { eq, and, asc, inArray, accounts, plaidItems, maxInstitutions, type Plan } from "@lasagna/core";

/**
 * One account, tagged with the institution slot the limit counts it against.
 * `institutionKey` groups two items at the same bank (the re-link case) into one
 * slot; a null institution_id can't be proven to be the same bank as another
 * null, so each such item keys by its own id.
 */
export interface InstitutionSlot {
  id: string;
  manual: boolean;
  institutionKey: string;
}

/**
 * Every account the tenant holds, oldest-first, tagged with its institution
 * slot. The inner join is the definition of an occupied slot: an institution
 * that holds no accounts yet (an item that errored before its first account
 * pull) produces no rows, so it neither shows in the meter nor freezes anything.
 * Pass the transaction when reading inside one.
 */
export async function loadInstitutionSlots(
  tenantId: string,
  executor: Pick<typeof db, "select"> = db,
): Promise<InstitutionSlot[]> {
  // Tiebreak on id so equal createdAt (batch inserts share defaultNow()) still
  // produces a deterministic — hence idempotent — ordering.
  const rows = await executor
    .select({
      id: accounts.id,
      itemId: plaidItems.id,
      institutionId: plaidItems.institutionId,
    })
    .from(accounts)
    .innerJoin(plaidItems, eq(accounts.plaidItemId, plaidItems.id))
    .where(eq(accounts.tenantId, tenantId))
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
  return rows.map((r) => ({
    id: r.id,
    manual: r.institutionId === "manual",
    institutionKey: r.institutionId ?? `item:${r.itemId}`,
  }));
}

/**
 * The institution slots a tenant occupies: institutions holding at least one
 * account, excluding manual, deduped by institution key. The meter and the
 * freeze recompute both count this way off the same rows, so they cannot
 * disagree about whether a tenant is over the limit.
 */
export function countInstitutions(slots: InstitutionSlot[]): number {
  const keys = new Set<string>();
  for (const slot of slots) if (!slot.manual) keys.add(slot.institutionKey);
  return keys.size;
}

/**
 * Given a tenant's accounts ordered OLDEST-FIRST and the plan's max number of
 * institutions, return the ids that must be frozen. The limit counts distinct
 * institutions, not accounts: every account at an institution already inside
 * the limit stays active, and everything at an institution beyond it freezes.
 * Institutions rank by their oldest account. Manual accounts never freeze and
 * never consume a slot. Pure.
 */
export function accountIdsToFreeze(
  ordered: { id: string; manual?: boolean; institutionKey: string }[],
  max: number
): string[] {
  const keep = new Set<string>();
  const freeze: string[] = [];
  for (const a of ordered) {
    if (a.manual) continue;
    if (!keep.has(a.institutionKey) && keep.size >= max) {
      freeze.push(a.id);
      continue;
    }
    keep.add(a.institutionKey);
  }
  return freeze;
}

/**
 * Recompute frozen flags for a tenant: accounts at the oldest
 * `maxInstitutions(plan)` institutions stay active, the rest freeze.
 * Idempotent — safe to call after every sync and on every plan change.
 * Unfreezes everything when the limit grows (upgrade).
 */
export async function recomputeFrozenAccounts(tenantId: string, plan: Plan): Promise<void> {
  const max = maxInstitutions(plan);
  // Read + both writes in one transaction so a concurrent recompute (e.g. a
  // webhook plan-change landing mid-sync) can't interleave into inconsistent
  // freeze state.
  await db.transaction(async (tx) => {
    // Same rows the meter counts, so what the meter reports and what freezes
    // are one definition.
    const ordered = await loadInstitutionSlots(tenantId, tx);

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
