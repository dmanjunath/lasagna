/**
 * Builds the "Portfolio Composition" section of a Financial Plan document. Reuses
 * aggregatePortfolio(getHoldingsInput(tenantId)) — the exact same grouping +
 * de-dup the /portfolio page runs on — so the plan's asset-class split and its
 * de-duplicated category lines (IVV + SPY → one "S&P 500") match that surface.
 *
 * Stores only what the plan renders: the total, the top-level asset-type split,
 * and each class's de-duped category lines (name, dollar value, weight). Per-
 * holding rows are intentionally dropped — the plan shows a composition, not a
 * position ledger.
 */

import { aggregatePortfolio } from "./portfolio-aggregator.js";
import { getHoldingsInput } from "../routes/portfolio.js";

export interface PortfolioCategoryLine {
  /** De-duplicated category name, e.g. "S&P 500" (merges IVV + SPY). */
  name: string;
  value: number;
  /** Weight of the whole portfolio, percent. */
  weight: number;
}

export interface PortfolioClassGroup {
  /** Asset-class name, e.g. "US Stocks", "Bonds", "Cash". */
  name: string;
  value: number;
  weight: number;
  categories: PortfolioCategoryLine[];
}

export interface PortfolioSection {
  section: "portfolio";
  totalValue: number;
  classes: PortfolioClassGroup[];
  generatedAt: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildPortfolioSection(tenantId: string): Promise<PortfolioSection> {
  const composition = aggregatePortfolio(await getHoldingsInput(tenantId));

  const classes: PortfolioClassGroup[] = composition.assetClasses.map((ac) => ({
    name: ac.name,
    value: round2(ac.value),
    weight: round2(ac.percentage),
    categories: ac.categories.map((cat) => ({
      name: cat.name,
      value: round2(cat.value),
      weight: round2(cat.percentage),
    })),
  }));

  return {
    section: "portfolio",
    totalValue: round2(composition.totalValue),
    classes,
    generatedAt: new Date().toISOString(),
  };
}
