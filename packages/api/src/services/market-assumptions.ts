/**
 * Shared capital-market assumptions for the retirement simulation engine.
 * Single source of truth for per-asset-class mean returns and volatilities.
 */

export interface AssetAllocation {
  usStocks: number;
  intlStocks: number;
  bonds: number;
  reits: number;
  cash: number;
}

export const ASSET_CLASSES = [
  "usStocks",
  "intlStocks",
  "bonds",
  "reits",
  "cash",
] as const satisfies (keyof AssetAllocation)[];

export type AssetClass = (typeof ASSET_CLASSES)[number];

export const MARKET_MODEL = {
  usStocks:   { mean: 0.10, stdDev: 0.18 }, // 10% avg return, 18% volatility
  intlStocks: { mean: 0.08, stdDev: 0.20 }, // 8% avg return, 20% volatility
  bonds:      { mean: 0.05, stdDev: 0.07 }, // 5% avg return, 7% volatility
  reits:      { mean: 0.09, stdDev: 0.22 }, // 9% avg return, 22% volatility
  cash:       { mean: 0.02, stdDev: 0.01 }, // 2% avg return, 1% volatility
  inflation:  { mean: 0.03, stdDev: 0.015 }, // 3% avg inflation, 1.5% volatility
};

/**
 * Allocation-weighted blended expected return.
 * If the weights sum to more than 1 they are normalized by their sum.
 */
export function blendedExpectedReturn(allocation: AssetAllocation): number {
  const sum = ASSET_CLASSES.reduce((acc, cls) => acc + allocation[cls], 0);
  const divisor = sum > 0 ? sum : 1;
  return ASSET_CLASSES.reduce(
    (acc, cls) => acc + (allocation[cls] / divisor) * MARKET_MODEL[cls].mean,
    0
  );
}

/**
 * Allocation-weighted blended volatility (stdDev).
 * NOTE: this is a simplified approximation — the Monte Carlo engine draws
 * per-asset-class returns independently and does not use this value for its
 * stochastic paths. Use this only for summary / UI display purposes.
 */
export function blendedVolatility(allocation: AssetAllocation): number {
  const sum = ASSET_CLASSES.reduce((acc, cls) => acc + allocation[cls], 0);
  const divisor = sum > 0 ? sum : 1;
  return ASSET_CLASSES.reduce(
    (acc, cls) => acc + (allocation[cls] / divisor) * MARKET_MODEL[cls].stdDev,
    0
  );
}
