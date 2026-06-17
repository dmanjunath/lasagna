/**
 * Effective goal progress. A goal with ≥1 assigned account is "auto-tracked":
 * its currentAmount is the live sum of those accounts' effectiveBalance. A goal
 * with no assigned accounts keeps its stored, manually-entered currentAmount.
 */

export interface ResolvedGoalAmount {
  amount: number;
  isAutoTracked: boolean;
}

/** Group goal_accounts rows into goalId → accountId[] (insertion order preserved). */
export function buildGoalAccountMap(
  rows: Array<{ goalId: string; accountId: string }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { goalId, accountId } of rows) {
    const list = map.get(goalId);
    if (list) list.push(accountId);
    else map.set(goalId, [accountId]);
  }
  return map;
}

export function resolveGoalAmount(
  storedAmount: string,
  accountIds: string[] | undefined,
  balanceById: Map<string, number>,
): ResolvedGoalAmount {
  if (!accountIds || accountIds.length === 0) {
    return { amount: parseFloat(storedAmount), isAutoTracked: false };
  }
  const amount = accountIds.reduce(
    (sum, id) => sum + (balanceById.get(id) ?? 0),
    0,
  );
  return { amount, isAutoTracked: true };
}
