export type AssetClass =
  | 'US Stocks'
  | 'International Stocks'
  | 'Bonds'
  | 'REITs'
  | 'Cash'
  | 'Other';

export type SubCategory = string;

export interface TickerCategory {
  assetClass: AssetClass;
  subCategory: SubCategory;
  color: string;
}

export const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  'US Stocks': '#4ade80',
  'International Stocks': '#60a5fa',
  'Bonds': '#f59e0b',
  'REITs': '#8b5cf6',
  'Cash': '#ec4899',
  'Other': '#a8a29e',
};

// Ticker → [AssetClass, SubCategory]
const TICKER_MAP: Record<string, [AssetClass, SubCategory]> = {
  // US Stocks - Total Market
  VTI: ['US Stocks', 'Total Market'],
  VTSAX: ['US Stocks', 'Total Market'],
  VFTAX: ['US Stocks', 'Total Market'],
  ITOT: ['US Stocks', 'Total Market'],
  SWTSX: ['US Stocks', 'Total Market'],
  FSKAX: ['US Stocks', 'Total Market'],
  FZROX: ['US Stocks', 'Total Market'],
  VTSMX: ['US Stocks', 'Total Market'],

  // US Stocks - Total World (US-heavy global funds)
  VT: ['US Stocks', 'Total World'],
  VTWAX: ['US Stocks', 'Total World'],

  // US Stocks - S&P 500
  VOO: ['US Stocks', 'S&P 500'],
  VFIAX: ['US Stocks', 'S&P 500'],
  SPY: ['US Stocks', 'S&P 500'],
  IVV: ['US Stocks', 'S&P 500'],
  FXAIX: ['US Stocks', 'S&P 500'],
  SWPPX: ['US Stocks', 'S&P 500'],
  VFINX: ['US Stocks', 'S&P 500'],

  // US Stocks - Growth
  VUG: ['US Stocks', 'Growth'],
  VIGAX: ['US Stocks', 'Growth'],
  VOOG: ['US Stocks', 'Growth'],
  IWF: ['US Stocks', 'Growth'],
  SCHG: ['US Stocks', 'Growth'],

  // US Stocks - Nasdaq
  QQQ: ['US Stocks', 'Nasdaq'],
  QQQM: ['US Stocks', 'Nasdaq'],
  ONEQ: ['US Stocks', 'Nasdaq'],
  NASDX: ['US Stocks', 'Nasdaq'],
  FNCMX: ['US Stocks', 'Nasdaq'],

  // US Stocks - Value
  VTV: ['US Stocks', 'Value'],
  VVIAX: ['US Stocks', 'Value'],
  VOOV: ['US Stocks', 'Value'],
  IWD: ['US Stocks', 'Value'],
  SCHV: ['US Stocks', 'Value'],

  // US Stocks - Small Cap
  VB: ['US Stocks', 'Small Cap'],
  VSMAX: ['US Stocks', 'Small Cap'],
  IJR: ['US Stocks', 'Small Cap'],
  SCHA: ['US Stocks', 'Small Cap'],
  VBR: ['US Stocks', 'Small Cap'],
  VISVX: ['US Stocks', 'Small Cap'],

  // US Stocks - Mid Cap
  VO: ['US Stocks', 'Mid Cap'],
  VIMAX: ['US Stocks', 'Mid Cap'],
  IJH: ['US Stocks', 'Mid Cap'],
  SCHM: ['US Stocks', 'Mid Cap'],

  // US Stocks - Individual (Large Cap)
  AAPL: ['US Stocks', 'Large Cap'],
  MSFT: ['US Stocks', 'Large Cap'],
  GOOGL: ['US Stocks', 'Large Cap'],
  GOOG: ['US Stocks', 'Large Cap'],
  AMZN: ['US Stocks', 'Large Cap'],
  NVDA: ['US Stocks', 'Large Cap'],
  META: ['US Stocks', 'Large Cap'],
  TSLA: ['US Stocks', 'Large Cap'],
  'BRK.B': ['US Stocks', 'Large Cap'],
  'BRK.A': ['US Stocks', 'Large Cap'],
  JPM: ['US Stocks', 'Large Cap'],
  JNJ: ['US Stocks', 'Large Cap'],
  V: ['US Stocks', 'Large Cap'],
  PG: ['US Stocks', 'Large Cap'],
  UNH: ['US Stocks', 'Large Cap'],
  HD: ['US Stocks', 'Large Cap'],
  MA: ['US Stocks', 'Large Cap'],
  DIS: ['US Stocks', 'Large Cap'],
  BAC: ['US Stocks', 'Large Cap'],
  XOM: ['US Stocks', 'Large Cap'],
  KO: ['US Stocks', 'Large Cap'],
  PEP: ['US Stocks', 'Large Cap'],
  COST: ['US Stocks', 'Large Cap'],
  ABBV: ['US Stocks', 'Large Cap'],
  MRK: ['US Stocks', 'Large Cap'],
  WMT: ['US Stocks', 'Large Cap'],
  CRM: ['US Stocks', 'Large Cap'],
  AVGO: ['US Stocks', 'Large Cap'],
  LLY: ['US Stocks', 'Large Cap'],
  TMO: ['US Stocks', 'Large Cap'],

  // US Stocks - Dividend
  VYM: ['US Stocks', 'Dividend'],
  VHYAX: ['US Stocks', 'Dividend'],
  SCHD: ['US Stocks', 'Dividend'],
  DVY: ['US Stocks', 'Dividend'],

  // International Stocks - Developed
  VEA: ['International Stocks', 'Developed'],
  EFA: ['International Stocks', 'Developed'],
  IEFA: ['International Stocks', 'Developed'],
  SWISX: ['International Stocks', 'Developed'],

  // International Stocks - Emerging
  VWO: ['International Stocks', 'Emerging'],
  VEMAX: ['International Stocks', 'Emerging'],
  IEMG: ['International Stocks', 'Emerging'],
  EEM: ['International Stocks', 'Emerging'],
  SCHE: ['International Stocks', 'Emerging'],
  FLCH: ['International Stocks', 'Emerging'],
  FXI: ['International Stocks', 'Emerging'],
  MCHI: ['International Stocks', 'Emerging'],
  KWEB: ['International Stocks', 'Emerging'],

  // International Stocks - Total International
  VXUS: ['International Stocks', 'Total International'],
  VTIAX: ['International Stocks', 'Total International'],
  IXUS: ['International Stocks', 'Total International'],
  FZILX: ['International Stocks', 'Total International'],
  VTISX: ['International Stocks', 'Total International'],
  VITNX: ['International Stocks', 'Total International'],
  VTSNX: ['International Stocks', 'Total International'],
  FSPSX: ['International Stocks', 'Total International'],

  // Bonds - Total Bond
  BND: ['Bonds', 'Total Bond'],
  VBTLX: ['Bonds', 'Total Bond'],
  AGG: ['Bonds', 'Total Bond'],
  SCHZ: ['Bonds', 'Total Bond'],
  FXNAX: ['Bonds', 'Total Bond'],

  // Bonds - Corporate
  VCIT: ['Bonds', 'Corporate'],
  LQD: ['Bonds', 'Corporate'],
  VCLT: ['Bonds', 'Corporate'],

  // Bonds - Government
  VGIT: ['Bonds', 'Government'],
  GOVT: ['Bonds', 'Government'],
  IEF: ['Bonds', 'Government'],
  TLT: ['Bonds', 'Government'],
  VGLT: ['Bonds', 'Government'],

  // Bonds - TIPS
  VTIP: ['Bonds', 'TIPS'],
  TIP: ['Bonds', 'TIPS'],
  SCHP: ['Bonds', 'TIPS'],
  VAIPX: ['Bonds', 'TIPS'],

  // Bonds - Municipal
  VTEB: ['Bonds', 'Municipal'],
  MUB: ['Bonds', 'Municipal'],
  VWITX: ['Bonds', 'Municipal'],

  // REITs - US
  VNQ: ['REITs', 'US REITs'],
  VGSLX: ['REITs', 'US REITs'],
  IYR: ['REITs', 'US REITs'],
  SCHH: ['REITs', 'US REITs'],
  FREL: ['REITs', 'US REITs'],

  // REITs - International
  VNQI: ['REITs', 'International REITs'],
  VGRLX: ['REITs', 'International REITs'],

  // Cash - Money Market
  VMFXX: ['Cash', 'Money Market'],
  SPAXX: ['Cash', 'Money Market'],
  FDRXX: ['Cash', 'Money Market'],
  SWVXX: ['Cash', 'Money Market'],
  QAJDS: ['Cash', 'Money Market'],
  SPRXX: ['Cash', 'Money Market'],
  VMMXX: ['Cash', 'Money Market'],

  // Cash - Short Term
  VGSH: ['Cash', 'Short-Term'],
  SHY: ['Cash', 'Short-Term'],
  BIL: ['Cash', 'Short-Term'],
  SGOV: ['Cash', 'Short-Term'],
};

export function getTickerCategory(ticker: string): TickerCategory {
  const upperTicker = ticker.toUpperCase();
  const mapping = TICKER_MAP[upperTicker];

  if (mapping) {
    const [assetClass, subCategory] = mapping;
    return {
      assetClass,
      subCategory,
      color: ASSET_CLASS_COLORS[assetClass],
    };
  }

  return {
    assetClass: 'Other',
    subCategory: 'Unknown',
    color: ASSET_CLASS_COLORS['Other'],
  };
}

export function getTickerCategoryWithFallback(
  ticker: string,
  securityType?: string
): TickerCategory {
  const upperTicker = ticker.toUpperCase();
  const mapping = TICKER_MAP[upperTicker];

  if (mapping) {
    const [assetClass, subCategory] = mapping;
    return {
      assetClass,
      subCategory,
      color: ASSET_CLASS_COLORS[assetClass],
    };
  }

  // Use security type as fallback sub-category
  const subCategory = securityType || 'Unknown';
  return {
    assetClass: 'Other',
    subCategory,
    color: ASSET_CLASS_COLORS['Other'],
  };
}
