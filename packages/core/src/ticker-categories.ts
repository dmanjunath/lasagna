export type AssetClass =
  | 'US Stocks'
  | 'International Stocks'
  | 'Bonds'
  | 'REITs'
  | 'Cash'
  | 'Other';

export type Category = string;

// The full set of asset classes, in taxonomy order. Anything the AI classifier
// returns must match one of these exactly (see coerceAssetClass) or fall back
// to 'Other'.
export const ASSET_CLASSES: readonly AssetClass[] = [
  'US Stocks',
  'International Stocks',
  'Bonds',
  'REITs',
  'Cash',
  'Other',
];

// Validate an arbitrary string (e.g. an LLM's output) against the asset-class
// enum. Returns the matching AssetClass or null when it isn't a valid class, so
// callers can substitute a safe fallback instead of storing a garbage value.
export function coerceAssetClass(value: string | null | undefined): AssetClass | null {
  if (!value) return null;
  const trimmed = value.trim();
  return (ASSET_CLASSES as readonly string[]).includes(trimmed)
    ? (trimmed as AssetClass)
    : null;
}

export interface TickerCategory {
  assetClass: AssetClass;
  category: Category;
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

// Ticker → [AssetClass, Category]
const TICKER_MAP: Record<string, [AssetClass, Category]> = {
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
  CASH: ['Cash', 'Savings & Checking'],

  // Cash - Treasuries. These are money-market funds that hold U.S. Treasury
  // bills, so the underlying holding is Treasuries — categorize by what they
  // own, not the "mutual fund" wrapper (e.g. VUSXX is the Vanguard Treasury
  // Money Market Fund, not a generic equity mutual fund).
  VUSXX: ['Cash', 'Treasuries'],
  FDLXX: ['Cash', 'Treasuries'],
  SNSXX: ['Cash', 'Treasuries'],
  SNOXX: ['Cash', 'Treasuries'],
  TTTXX: ['Cash', 'Treasuries'],

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
    const [assetClass, category] = mapping;
    return {
      assetClass,
      category,
      color: ASSET_CLASS_COLORS[assetClass],
    };
  }

  return {
    assetClass: 'Other',
    category: 'Unknown',
    color: ASSET_CLASS_COLORS['Other'],
  };
}

// Foreign exchange suffixes on a ticker (e.g. RY.TO, HSBA.L, 0700.HK) signal a
// non-US listing, so route the holding to International Stocks instead of US.
// A plain US-listed ticker has no dotted exchange suffix (share-class suffixes
// like BRK.B are already resolved by the hardcoded map above).
const FOREIGN_EXCHANGE_SUFFIXES = new Set([
  'TO', 'V', 'CN', 'NE', // Canada
  'L', // London
  'HK', // Hong Kong
  'T', 'JP', // Japan / Tokyo
  'AX', // Australia
  'SS', 'SZ', // Shanghai / Shenzhen
  'DE', 'F', 'BE', // Germany
  'PA', // Paris
  'AS', // Amsterdam
  'MI', // Milan
  'MC', // Madrid
  'SW', // Switzerland
  'ST', // Stockholm
  'HE', // Helsinki
  'CO', // Copenhagen
  'OL', // Oslo
  'BR', // Brussels
  'LS', // Lisbon
  'VI', // Vienna
  'IR', // Ireland
  'NS', 'BO', // India
  'KS', 'KQ', // Korea
  'TW', 'TWO', // Taiwan
  'SI', // Singapore
  'SA', // Brazil
  'MX', // Mexico
  'JO', // Johannesburg
]);

function looksInternational(upperTicker: string): boolean {
  const dot = upperTicker.lastIndexOf('.');
  if (dot === -1) return false;
  return FOREIGN_EXCHANGE_SUFFIXES.has(upperTicker.slice(dot + 1));
}

// An asset-class classification looked up for a symbol we don't hardcode —
// e.g. resolved by the post-sync AI classifier and cached globally. Passed in
// so this pure function stays free of any DB dependency.
export interface CachedClassification {
  assetClass: AssetClass;
  category: Category;
}

// Classify a holding not present in TICKER_MAP. Resolution order:
//   1. the hardcoded TICKER_MAP (always authoritative),
//   2. a cached classification (e.g. from the AI classifier),
//   3. the Plaid security type,
//   4. genuinely unclassifiable → "Other".
// Recognizable equities/funds land in a real asset class instead of "Other";
// only genuinely unclassifiable instruments (options, unknown/private) stay
// in "Other".
export function getTickerCategoryWithFallback(
  ticker: string,
  securityType?: string,
  cached?: CachedClassification
): TickerCategory {
  const upperTicker = ticker.toUpperCase();
  const mapping = TICKER_MAP[upperTicker];

  if (mapping) {
    const [assetClass, category] = mapping;
    return {
      assetClass,
      category,
      color: ASSET_CLASS_COLORS[assetClass],
    };
  }

  const make = (assetClass: AssetClass, category: Category): TickerCategory => ({
    assetClass,
    category,
    color: ASSET_CLASS_COLORS[assetClass],
  });

  // A cached AI classification outranks the coarse security-type fallback, but
  // never overrides the hardcoded map above. Only trust classifications that
  // land in a real asset class — a cached "Other" adds nothing over the
  // type-based fallback and can hide a better security-type match.
  if (cached && cached.assetClass !== 'Other') {
    return make(cached.assetClass, cached.category);
  }

  // Normalize Plaid security types (equity, etf, mutual fund, fixed income,
  // cash, derivative, cryptocurrency, other, …) — spaces/dashes vary by feed.
  const type = (securityType || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();

  switch (type) {
    case 'equity':
      return looksInternational(upperTicker)
        ? make('International Stocks', 'Individual Stocks')
        : make('US Stocks', 'Individual Stocks');
    case 'etf':
      return looksInternational(upperTicker)
        ? make('International Stocks', 'ETFs')
        : make('US Stocks', 'ETFs');
    case 'mutual fund':
    case 'mutualfund':
      return make('US Stocks', 'Mutual Funds');
    case 'fixed income':
    case 'fixedincome':
      return make('Bonds', 'Bond Funds');
    case 'cash':
      return make('Cash', 'Cash');
    case 'cryptocurrency':
    case 'crypto':
      return make('Other', 'Crypto');
  }

  // Options, derivatives, private/unknown securities, or a missing type remain
  // genuinely unclassifiable.
  return {
    assetClass: 'Other',
    category: securityType || 'Unknown',
    color: ASSET_CLASS_COLORS['Other'],
  };
}
