/**
 * Institution → favicon-friendly domain map.
 *
 * Used by <AccountRow> and <TransactionRow> to render a brand favicon
 * via Google's free favicon service:
 *     https://www.google.com/s2/favicons?domain=<host>&sz=64
 *
 * We don't ship logo SVGs (no logo libs allowed). Google's s2 endpoint
 * resolves a sensible 32-64px icon for almost every US bank, brokerage,
 * and well-known merchant. When no domain is supplied AND we don't
 * recognize the name, the row falls back to a neutral grayscale monogram.
 *
 * Match is case-insensitive substring on either the institution display
 * name OR the merchant string — so "JPMorgan Chase Bank, N.A." resolves
 * to chase.com via the "chase" entry.
 */

type DomainMap = Record<string, string>;

const RAW_INSTITUTION_DOMAINS: DomainMap = {
  // Banks — depository
  chase: 'chase.com',
  'jpmorgan': 'chase.com',
  'bank of america': 'bankofamerica.com',
  bofa: 'bankofamerica.com',
  wells: 'wellsfargo.com',
  citi: 'citi.com',
  citibank: 'citi.com',
  'us bank': 'usbank.com',
  'capital one': 'capitalone.com',
  ally: 'ally.com',
  marcus: 'marcus.com',
  'goldman sachs': 'goldmansachs.com',
  amex: 'americanexpress.com',
  'american express': 'americanexpress.com',
  discover: 'discover.com',
  pnc: 'pnc.com',
  truist: 'truist.com',
  hsbc: 'hsbc.com',
  schwab: 'schwab.com',
  'charles schwab': 'schwab.com',
  'td bank': 'td.com',

  // Brokerages / investment
  vanguard: 'investor.vanguard.com',
  fidelity: 'fidelity.com',
  robinhood: 'robinhood.com',
  etrade: 'etrade.com',
  'e*trade': 'etrade.com',
  webull: 'webull.com',
  'merrill': 'ml.com',
  'merrill lynch': 'ml.com',
  'interactive brokers': 'interactivebrokers.com',
  ibkr: 'interactivebrokers.com',
  betterment: 'betterment.com',
  wealthfront: 'wealthfront.com',
  acorns: 'acorns.com',
  coinbase: 'coinbase.com',
  kraken: 'kraken.com',
  binance: 'binance.com',

  // Neo / fintech
  sofi: 'sofi.com',
  chime: 'chime.com',
  venmo: 'venmo.com',
  paypal: 'paypal.com',
  cashapp: 'cash.app',
  'cash app': 'cash.app',
  apple: 'apple.com',
  'apple card': 'apple.com',
};

const RAW_MERCHANT_DOMAINS: DomainMap = {
  amazon: 'amazon.com',
  walmart: 'walmart.com',
  target: 'target.com',
  costco: 'costco.com',
  'whole foods': 'wholefoodsmarket.com',
  'trader joe': 'traderjoes.com',
  safeway: 'safeway.com',
  kroger: 'kroger.com',
  starbucks: 'starbucks.com',
  uber: 'uber.com',
  lyft: 'lyft.com',
  doordash: 'doordash.com',
  grubhub: 'grubhub.com',
  netflix: 'netflix.com',
  spotify: 'spotify.com',
  hulu: 'hulu.com',
  disney: 'disneyplus.com',
  youtube: 'youtube.com',
  apple: 'apple.com',
  'apple.com': 'apple.com',
  google: 'google.com',
  microsoft: 'microsoft.com',
  shell: 'shell.com',
  chevron: 'chevron.com',
  exxon: 'exxon.com',
  costcogas: 'costco.com',
  delta: 'delta.com',
  united: 'united.com',
  southwest: 'southwest.com',
  jetblue: 'jetblue.com',
  airbnb: 'airbnb.com',
  marriott: 'marriott.com',
  hilton: 'hilton.com',
  cvs: 'cvs.com',
  walgreens: 'walgreens.com',
  comcast: 'xfinity.com',
  xfinity: 'xfinity.com',
  verizon: 'verizon.com',
  'at&t': 'att.com',
  att: 'att.com',
  'pg&e': 'pge.com',
  pge: 'pge.com',
};

/**
 * Ticker → issuer domain. Iter 3 covered only ~30% of data rows because
 * /portfolio holdings (VTSAX/VTI/BND/QQQ/...) resolved no favicons. This
 * map covers the top US tickers by AUM across Vanguard, Schwab, iShares,
 * Invesco, SPDR, Fidelity, ARK, JPMorgan. The lookup is EXACT (case-
 * insensitive) — substring would mis-match (e.g. "VTI" matching "VTIAX").
 */
const TICKER_TO_ISSUER: DomainMap = {
  // Vanguard
  vtsax: 'investor.vanguard.com',
  vti: 'investor.vanguard.com',
  voo: 'investor.vanguard.com',
  voog: 'investor.vanguard.com',
  vfiax: 'investor.vanguard.com',
  vwelx: 'investor.vanguard.com',
  vftax: 'investor.vanguard.com',
  bnd: 'investor.vanguard.com',
  bndx: 'investor.vanguard.com',
  vym: 'investor.vanguard.com',
  vig: 'investor.vanguard.com',
  vxus: 'investor.vanguard.com',
  vea: 'investor.vanguard.com',
  vwo: 'investor.vanguard.com',
  vnq: 'investor.vanguard.com',
  vtv: 'investor.vanguard.com',
  vug: 'investor.vanguard.com',
  vbr: 'investor.vanguard.com',
  vot: 'investor.vanguard.com',
  // Iter 5: cover the remaining Vanguard mutual-fund tickers seen in real
  // brokerage exports (admiral, institutional, total-world, intl variants).
  vtiax: 'investor.vanguard.com',
  vtwax: 'investor.vanguard.com',
  vt: 'investor.vanguard.com',
  vmfxx: 'investor.vanguard.com',
  vitnx: 'investor.vanguard.com',
  vtisx: 'investor.vanguard.com',
  vtsmx: 'investor.vanguard.com',
  vtwsx: 'investor.vanguard.com',
  vfwax: 'investor.vanguard.com',
  vbtlx: 'investor.vanguard.com',
  vgslx: 'investor.vanguard.com',

  // Schwab
  schd: 'schwab.com',
  scha: 'schwab.com',
  schb: 'schwab.com',
  schx: 'schwab.com',
  schf: 'schwab.com',
  schg: 'schwab.com',
  schv: 'schwab.com',
  swppx: 'schwab.com',
  swtsx: 'schwab.com',

  // Invesco
  qqq: 'invesco.com',
  qqqm: 'invesco.com',
  rsp: 'invesco.com',
  spdw: 'invesco.com',

  // iShares / BlackRock
  ivv: 'ishares.com',
  iefa: 'ishares.com',
  agg: 'ishares.com',
  iwm: 'ishares.com',
  ijh: 'ishares.com',
  ijr: 'ishares.com',
  iwf: 'ishares.com',
  iwd: 'ishares.com',
  iyr: 'ishares.com',
  tlt: 'ishares.com',
  hyg: 'ishares.com',
  emb: 'ishares.com',

  // State Street / SPDR
  spy: 'ssga.com',
  spyg: 'ssga.com',
  spyv: 'ssga.com',
  spdr: 'ssga.com',
  xlk: 'ssga.com',
  xle: 'ssga.com',
  xlf: 'ssga.com',
  gld: 'ssga.com',

  // Fidelity
  fxaix: 'fidelity.com',
  fzrox: 'fidelity.com',
  fskax: 'fidelity.com',
  ftihx: 'fidelity.com',
  fbgrx: 'fidelity.com',
  fnilx: 'fidelity.com',
  fxnax: 'fidelity.com',
  oneq: 'fidelity.com',
  flch: 'franklintempleton.com',
  fzilx: 'fidelity.com',

  // ARK
  arkk: 'ark-funds.com',
  arkw: 'ark-funds.com',
  arkg: 'ark-funds.com',
  arkf: 'ark-funds.com',
  arkq: 'ark-funds.com',

  // JPMorgan
  jepi: 'jpmorgan.com',
  jepq: 'jpmorgan.com',

  // Crypto / single-name (covered for completeness; brokerage app icon)
  btc: 'coinbase.com',
  eth: 'coinbase.com',

  // Iter 5: top single-name US equities. Iter 4 showed 11/19 monogram
  // fallbacks because the demo + production portfolios are stuffed with
  // individual blue-chips, not just ETFs. Add the mega-caps + popular crypto
  // proxies so favicons resolve for the majority of typical holdings.
  aapl: 'apple.com',
  msft: 'microsoft.com',
  googl: 'abc.xyz',
  goog: 'abc.xyz',
  amzn: 'amazon.com',
  meta: 'meta.com',
  fb: 'meta.com',
  nvda: 'nvidia.com',
  tsla: 'tesla.com',
  brk: 'berkshirehathaway.com',
  'brk.a': 'berkshirehathaway.com',
  'brk.b': 'berkshirehathaway.com',
  brkb: 'berkshirehathaway.com',
  brka: 'berkshirehathaway.com',
  jpm: 'jpmorgan.com',
  bac: 'bankofamerica.com',
  wfc: 'wellsfargo.com',
  gs: 'goldmansachs.com',
  ms: 'morganstanley.com',
  v: 'visa.com',
  ma: 'mastercard.com',
  pypl: 'paypal.com',
  cost: 'costco.com',
  wmt: 'walmart.com',
  hd: 'homedepot.com',
  nke: 'nike.com',
  dis: 'disney.com',
  nflx: 'netflix.com',
  abnb: 'airbnb.com',
  uber: 'uber.com',
  lyft: 'lyft.com',
  sbux: 'starbucks.com',
  pep: 'pepsico.com',
  ko: 'coca-cola.com',
  pg: 'pg.com',
  jnj: 'jnj.com',
  unh: 'unitedhealthgroup.com',
  pfe: 'pfizer.com',
  mrk: 'merck.com',
  abbv: 'abbvie.com',
  xom: 'exxonmobil.com',
  cvx: 'chevron.com',
  cop: 'conocophillips.com',
  amd: 'amd.com',
  intc: 'intel.com',
  orcl: 'oracle.com',
  crm: 'salesforce.com',
  adbe: 'adobe.com',
  csco: 'cisco.com',
  ibm: 'ibm.com',
  pltr: 'palantir.com',
  shop: 'shopify.com',
  coin: 'coinbase.com',
  hood: 'robinhood.com',
  sq: 'block.xyz',
  block: 'block.xyz',
  // Crypto tickers as they appear in demo / Plaid streams
  btcusd: 'coinbase.com',
  ethusd: 'coinbase.com',
  sol: 'solana.com',
  ada: 'cardano.org',
  doge: 'dogecoin.com',
  ltc: 'litecoin.org',
};

/**
 * Look up an issuer domain for a holding ticker. Match is EXACT on the
 * normalized ticker (uppercase trim → lowercase), unlike the institution
 * substring match — partial ticker matches would mis-identify holdings.
 */
export function tickerToIssuer(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  const norm = ticker.trim().toLowerCase();
  if (!norm) return null;
  return TICKER_TO_ISSUER[norm] ?? null;
}

function lookup(map: DomainMap, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (!lower) return null;
  // exact first
  if (map[lower]) return map[lower];
  // substring
  for (const key of Object.keys(map)) {
    if (lower.includes(key)) return map[key];
  }
  return null;
}

export function institutionDomainFor(name: string | null | undefined): string | null {
  return lookup(RAW_INSTITUTION_DOMAINS, name);
}

export function merchantDomainFor(name: string | null | undefined): string | null {
  return lookup(RAW_MERCHANT_DOMAINS, name);
}

/**
 * Build a Google s2 favicon URL. Returns `null` if no domain is resolvable —
 * caller renders a monogram fallback.
 */
export function faviconUrl(domain: string | null | undefined, size: 32 | 64 | 128 = 64): string | null {
  if (!domain) return null;
  const clean = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!clean) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(clean)}&sz=${size}`;
}
