// A spending category whose refunds exceeded its spending over the window is
// money back: it counts negative toward Spent (owner decision 2026-11-24) and
// always lists after the categories that cost money, whatever the sort.

/** The category's net as Spent counts it: negative for money back. */
export function signedTotal(c: { total: number; moneyBack?: boolean }): number {
  return c.moneyBack ? -c.total : c.total;
}

/** Spending rows ranked by `sort`, money back (a negative total) last, largest back first. */
export function rankWithMoneyBackLast<T extends { label: string; total: number }>(
  rows: readonly T[],
  sort: { key: 'label' | 'amount'; dir: 'asc' | 'desc' },
): T[] {
  const cost = rows.filter((r) => r.total >= 0).sort((a, b) => {
    const cmp = sort.key === 'label' ? a.label.localeCompare(b.label) : a.total - b.total;
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const back = rows.filter((r) => r.total < 0).sort((a, b) => a.total - b.total);
  return [...cost, ...back];
}
