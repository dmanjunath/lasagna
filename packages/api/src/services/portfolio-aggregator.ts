import { getTickerCategoryWithFallback, ASSET_CLASS_COLORS, type AssetClass, type CachedClassification } from "@lasagna/core";
import { MARKET_MODEL, ASSET_CLASSES, type AssetAllocation } from "./market-assumptions.js";

export interface HoldingInput {
  ticker: string;
  value: number;
  shares: number;
  name: string;
  account: string;
  costBasis: number | null;
  securityType?: string;
  // AI-derived classification from the global cache, used when the ticker
  // isn't in the hardcoded map. Lets a looked-up security land in a real asset
  // class instead of "Other".
  classified?: CachedClassification;
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
    const tickerCat = getTickerCategoryWithFallback(holding.ticker, holding.securityType, holding.classified);

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

/**
 * Historical average annual returns (percent) by holding category. Finer-grained
 * than the 5-bucket MARKET_MODEL — this is what lets a Nasdaq-heavy US-stock
 * sleeve read higher than a plain total-market one. Single source of truth for
 * both the /portfolio/exposure endpoint and the sim's holdings-derived returns.
 */
export const CATEGORY_RETURNS: Record<string, number> = {
  "S&P 500": 10.2,
  "Total Market": 10.0,
  "Total World": 9.5,
  Growth: 11.5,
  Nasdaq: 12.0,
  Value: 9.5,
  "Small Cap": 10.5,
  "Mid Cap": 10.0,
  Dividend: 9.0,
  Developed: 7.5,
  Emerging: 8.0,
  "Total International": 7.5,
  "Total Bond": 5.0,
  Corporate: 5.5,
  Government: 4.5,
  TIPS: 4.0,
  Municipal: 4.0,
  "US REITs": 9.5,
  "International REITs": 7.0,
  "Money Market": 2.0,
  Treasuries: 2.5, // treasury money-market funds (VUSXX etc.) — cash-like, T-bill yield
  "Short-Term": 2.5,
  "Savings & Checking": 1.5,
  "Large Cap": 10.5,
  Unknown: 7.0,
};

const DEFAULT_CATEGORY_RETURN = 7.0;

// Composition asset-class names → the 5 sim buckets.
const CLASS_NAME_TO_KEY: Record<string, keyof AssetAllocation> = {
  "US Stocks": "usStocks",
  "International Stocks": "intlStocks",
  Bonds: "bonds",
  REITs: "reits",
  Cash: "cash",
};

/**
 * Per-bucket expected returns (decimals) derived from the user's ACTUAL holdings:
 * within each of the 5 sim buckets, the value-weighted average of its holdings'
 * category returns. Buckets with no holdings fall back to the flat MARKET_MODEL
 * mean. Blending these by allocation reproduces the /portfolio/exposure endpoint's
 * headline return, so the displayed figure and the Monte Carlo agree.
 */
export function extractClassReturns(composition: PortfolioComposition): AssetAllocation {
  const out = {} as AssetAllocation;
  for (const cls of ASSET_CLASSES) out[cls] = MARKET_MODEL[cls].mean;

  for (const ac of composition.assetClasses) {
    const key = CLASS_NAME_TO_KEY[ac.name];
    if (!key || ac.value <= 0) continue;
    const weighted = ac.categories.reduce(
      (sum, cat) => sum + cat.value * (CATEGORY_RETURNS[cat.name] ?? DEFAULT_CATEGORY_RETURN),
      0,
    );
    out[key] = weighted / ac.value / 100; // percent → decimal
  }

  return out;
}
