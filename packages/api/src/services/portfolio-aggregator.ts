import { getTickerCategoryWithFallback, ASSET_CLASS_COLORS, type AssetClass } from "@lasagna/core";

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

export interface Category {
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
  categories: Category[];
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

  // Group by asset class -> category -> holdings
  const assetClassMap = new Map<string, Map<string, Holding[]>>();

  for (const holding of holdings) {
    const tickerCat = getTickerCategoryWithFallback(holding.ticker, holding.securityType);

    if (!assetClassMap.has(tickerCat.assetClass)) {
      assetClassMap.set(tickerCat.assetClass, new Map());
    }

    const categoryMap = assetClassMap.get(tickerCat.assetClass)!;
    if (!categoryMap.has(tickerCat.category)) {
      categoryMap.set(tickerCat.category, []);
    }

    categoryMap.get(tickerCat.category)!.push({
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

  for (const [assetClassName, categoryMap] of assetClassMap) {
    const categories: Category[] = [];
    let assetClassValue = 0;

    for (const [categoryName, holdingsList] of categoryMap) {
      const categoryValue = holdingsList.reduce((sum, h) => sum + h.value, 0);
      assetClassValue += categoryValue;

      categories.push({
        name: categoryName,
        value: categoryValue,
        percentage: (categoryValue / totalValue) * 100,
        holdings: holdingsList.sort((a, b) => b.value - a.value),
      });
    }

    assetClasses.push({
      name: assetClassName,
      value: assetClassValue,
      percentage: (assetClassValue / totalValue) * 100,
      color: ASSET_CLASS_COLORS[assetClassName as AssetClass] || ASSET_CLASS_COLORS['Other'],
      categories: categories.sort((a, b) => b.value - a.value),
    });
  }

  // Sort asset classes by value descending
  assetClasses.sort((a, b) => b.value - a.value);

  return { totalValue, assetClasses };
}

export interface SymbolAccount {
  account: string;
  shares: number;
  value: number;
  percentage: number;
}

export interface SymbolAccountBreakdown {
  symbol: string;
  totalValue: number;
  accounts: SymbolAccount[];
}

/**
 * Group every holding of `symbol` by account — which account(s) hold it, and
 * how much (shares + value) in each. A symbol appears at most once per account
 * from real holdings, but synthetic cash / assumed-split rows can repeat a
 * ticker within one account, so values are summed per account. Per-account
 * values reconcile exactly to `totalValue` (the symbol's chart total).
 */
export function symbolAccountBreakdown(holdings: HoldingInput[], symbol: string): SymbolAccountBreakdown {
  const matches = holdings.filter((h) => h.ticker === symbol);
  const total = matches.reduce((s, h) => s + h.value, 0);

  const byAccount = new Map<string, SymbolAccount>();
  for (const h of matches) {
    const existing = byAccount.get(h.account);
    if (existing) {
      existing.shares += h.shares;
      existing.value += h.value;
    } else {
      byAccount.set(h.account, { account: h.account, shares: h.shares, value: h.value, percentage: 0 });
    }
  }

  const accounts = Array.from(byAccount.values())
    .map((a) => ({ ...a, percentage: total > 0 ? (a.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return { symbol, totalValue: total, accounts };
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
