/**
 * "44% stocks, 20% bonds, 36% cash" for an allocation keyed like the API's
 * (usStocks, intlStocks, reits, bonds, cash). Stocks include REITs. Cash is its
 * own share, never folded into bonds. Whole percents that add up to 100.
 * Null when there is nothing to split.
 */
export function allocationSplitLabel(alloc: Record<string, number> | null | undefined): string | null {
  if (!alloc) return null;
  const parts = [
    (alloc.usStocks ?? 0) + (alloc.intlStocks ?? 0) + (alloc.reits ?? 0),
    alloc.bonds ?? 0,
    alloc.cash ?? 0,
  ];
  const total = parts.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  // Largest remainder, so the three always sum to exactly 100.
  const raw = parts.map((v) => (v / total) * 100);
  const pct = raw.map(Math.floor);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  const missing = 100 - pct.reduce((s, v) => s + v, 0);
  for (let k = 0; k < missing; k++) pct[order[k][1]] += 1;
  const [stocks, bonds, cash] = pct;
  return cash > 0
    ? `${stocks}% stocks, ${bonds}% bonds, ${cash}% cash`
    : `${stocks}% stocks, ${bonds}% bonds`;
}
