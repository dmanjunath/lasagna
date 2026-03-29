import { getTickerCategory, ASSET_CLASS_COLORS, type AssetClass } from "@lasagna/core";

export interface HoldingInput {
  ticker: string;
  value: number;
  shares: number;
  name: string;
  account: string;
  costBasis: number | null;
  securityType?: string;
}

export interface Holding {
  ticker: string;
  name: string;
  shares: number;
  value: number;
  costBasis: number | null;
  account: string;
}

export interface SubCategory {
  name: string;
  value: number;
  percentage: number;
  holdings: Holding[];
}

export interface AssetClassGroup {
  name: string;
  value: number;
  percentage: number;
  color: string;
  subCategories: SubCategory[];
}

export interface PortfolioComposition {
  totalValue: number;
  assetClasses: AssetClassGroup[];
}

export function aggregatePortfolio(holdings: HoldingInput[]): PortfolioComposition {
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  if (totalValue === 0) {
    return { totalValue: 0, assetClasses: [] };
  }

  // Group by asset class -> sub-category -> holdings
  const assetClassMap = new Map<string, Map<string, Holding[]>>();

  for (const holding of holdings) {
    const category = getTickerCategory(holding.ticker);

    if (!assetClassMap.has(category.assetClass)) {
      assetClassMap.set(category.assetClass, new Map());
    }

    const subCategoryMap = assetClassMap.get(category.assetClass)!;
    if (!subCategoryMap.has(category.subCategory)) {
      subCategoryMap.set(category.subCategory, []);
    }

    subCategoryMap.get(category.subCategory)!.push({
      ticker: holding.ticker,
      name: holding.name,
      shares: holding.shares,
      value: holding.value,
      costBasis: holding.costBasis,
      account: holding.account,
    });
  }

  // Build structured result
  const assetClasses: AssetClassGroup[] = [];

  for (const [assetClassName, subCategoryMap] of assetClassMap) {
    const subCategories: SubCategory[] = [];
    let assetClassValue = 0;

    for (const [subCategoryName, holdingsList] of subCategoryMap) {
      const subCategoryValue = holdingsList.reduce((sum, h) => sum + h.value, 0);
      assetClassValue += subCategoryValue;

      subCategories.push({
        name: subCategoryName,
        value: subCategoryValue,
        percentage: (subCategoryValue / totalValue) * 100,
        holdings: holdingsList.sort((a, b) => b.value - a.value),
      });
    }

    assetClasses.push({
      name: assetClassName,
      value: assetClassValue,
      percentage: (assetClassValue / totalValue) * 100,
      color: ASSET_CLASS_COLORS[assetClassName as AssetClass] || ASSET_CLASS_COLORS['Other'],
      subCategories: subCategories.sort((a, b) => b.value - a.value),
    });
  }

  // Sort asset classes by value descending
  assetClasses.sort((a, b) => b.value - a.value);

  return { totalValue, assetClasses };
}

/**
 * Extract allocation percentages for simulation
 */
export function extractAllocation(composition: PortfolioComposition): {
  usStocks: number;
  intlStocks: number;
  bonds: number;
  reits: number;
  cash: number;
} {
  const findPercentage = (name: string) => {
    const assetClass = composition.assetClasses.find(a => a.name === name);
    return assetClass ? assetClass.percentage / 100 : 0;
  };

  return {
    usStocks: findPercentage('US Stocks'),
    intlStocks: findPercentage('International Stocks'),
    bonds: findPercentage('Bonds'),
    reits: findPercentage('REITs'),
    cash: findPercentage('Cash'),
  };
}
