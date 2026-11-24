// The Portfolio page's rules, ported from packages/web/src/pages/portfolio-composition.tsx:
// the allocation by class, category, holding or account (and a drill into one),
// the account filter, the holdings grouped by ticker, and their sort.

export type GroupBy = "assetClass" | "category" | "holding" | "account";

export interface Holding {
  ticker: string;
  name: string;
  shares: number;
  value: number;
  costBasis: number | null;
  account: string;
}

export interface AssetClass {
  name: string;
  value: number;
  percentage: number;
  categories: Array<{ name: string; value: number; percentage: number; holdings: Holding[] }>;
}

export interface Composition {
  totalValue: number;
  assetClasses: AssetClass[];
}

export interface Exposure {
  totalValue: number;
  blendedReturn: number;
  exposures: Array<{ name: string; assetClass: string; value: number; percentage: number; historicalReturn: number; holdings: Array<{ ticker: string; account: string }> }>;
}

export interface SymbolAccounts {
  symbol: string;
  totalValue: number;
  accounts: Array<{ account: string; shares: number; value: number; percentage: number }>;
}

/** One bucket of the allocation, with its chart color's index. */
export interface Slice {
  name: string;
  /** What the row says, when it differs from the key (Cash, Other). */
  label: string;
  value: number;
  pct: number;
  chart: number;
  children?: Array<{ name: string; pct: number }>;
}

export interface HoldingRow {
  ticker: string;
  label: string;
  totalShares: number;
  totalValue: number;
  percentage: number;
  holdings: Holding[];
  accountLabel: string;
  assetClass: string;
  category: string;
  historicalReturn: number | null;
}

// The web's colors, as chart palette indexes (viz-N is chart[N-1]).
const FALLBACK = [1, 0, 2, 4, 5, 6, 3];
const CLASS_COLOR: Record<string, number> = {
  "US Equity": 1,
  "Intl Equity": 4,
  "International Equity": 4,
  Bonds: 5,
  "Fixed Income": 5,
  REITs: 2,
  "Real Estate": 2,
  Alt: 6,
  Alternative: 6,
  Commodity: 6,
  Cash: 0,
  "Cash & Equivalents": 0,
};
export const OTHER = "__other__";
const OTHER_COLOR = 6;

const fallbackColor = (i: number) => FALLBACK[i % FALLBACK.length];
const isCashTicker = (t: string) => t.trim().toUpperCase() === "CASH";

/**
 * A holding's name: its ticker, "Cash" in plain words for the cash rows (audit
 * W-27), and the security's name when the ticker is the API's "UNKNOWN".
 */
export function holdingLabel(h: { ticker?: string; name?: string }): string {
  const t = (h.ticker ?? "").trim();
  if (isCashTicker(t)) return "Cash";
  if (t && t.toUpperCase() !== "UNKNOWN") return t;
  return (h.name ?? "").trim() || "Holding";
}

/**
 * The security's own name for a holding, or null. The API's stand-in rows (an
 * account with no holdings, split 60/40 or held as cash) are named after the
 * account and carry no share count, so only a row with shares names the
 * security. Cash has no security name.
 */
export function securityName(h: Pick<HoldingRow, "ticker" | "label" | "holdings">): string | null {
  if (isCashTicker(h.ticker)) return null;
  const name = h.holdings.find((x) => x.shares > 0 && x.name?.trim())?.name.trim();
  return name && name !== h.label ? name : null;
}

/** Drops a trailing account-number suffix and keeps the first of comma-joined names. */
export function cleanAccountLabel(raw: string): string {
  if (!raw) return raw;
  const first = raw.split(",")[0].trim();
  return first.replace(/[\s-]*\d{5,}(?:[-_]\d+)*$/, "").trim() || first;
}

/** Never "0.0%": a sliver reads "<0.1%". */
export function fmtPct(p: number): string {
  if (p <= 0) return "0%";
  if (p < 0.1) return "<0.1%";
  return `${p.toFixed(1)}%`;
}

/** A share count, terse. */
export function formatShares(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (abs === 0 || Number.isInteger(n)) return String(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** A yearly return, signed with a true minus. */
export function formatReturn(r: number): string {
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}%`;
}

/** Every account that holds something, sorted. */
export function accountsIn(classes: AssetClass[]): string[] {
  const names = new Set<string>();
  for (const ac of classes) for (const sc of ac.categories ?? []) for (const h of sc.holdings) names.add(h.account);
  return [...names].sort();
}

/**
 * The classes with only the chosen accounts' holdings, their values summed
 * from what is left (the web kept the unfiltered totals, so the value and the
 * shares did not move with the filter). `active` null: every account.
 */
export function filterByAccounts(classes: AssetClass[], active: Set<string> | null): AssetClass[] {
  if (!active) return classes;
  const sum = (hs: Holding[]) => hs.reduce((s, h) => s + h.value, 0);
  const kept = classes
    .map((ac) => {
      const categories = (ac.categories ?? [])
        .map((sc) => {
          const holdings = sc.holdings.filter((h) => active.has(h.account));
          return { ...sc, holdings, value: sum(holdings) };
        })
        .filter((sc) => sc.holdings.length > 0);
      return { ...ac, categories, value: categories.reduce((s, sc) => s + sc.value, 0) };
    })
    .filter((ac) => ac.categories.length > 0);
  const total = kept.reduce((s, ac) => s + ac.value, 0);
  return kept.map((ac) => ({ ...ac, percentage: total > 0 ? (ac.value / total) * 100 : 0, categories: ac.categories.map((sc) => ({ ...sc, percentage: total > 0 ? (sc.value / total) * 100 : 0 })) }));
}

/** Flips one account in the filter. Never leaves none chosen, and all chosen is no filter. */
export function toggleAccount(prev: Set<string> | null, name: string, all: string[]): Set<string> | null {
  if (prev === null) {
    const next = new Set(all.filter((a) => a !== name));
    return next.size === all.length ? null : next;
  }
  const next = new Set(prev);
  if (next.has(name)) {
    next.delete(name);
    if (next.size === 0) return new Set(all);
  } else {
    next.add(name);
    if (next.size === all.length) return null;
  }
  return next;
}

export function totalOf(classes: AssetClass[], fallback: number): number {
  return classes.reduce((s, ac) => s + ac.value, 0) || fallback;
}

/** The API's rate for a category with no published past return (routes/portfolio.ts, /exposure). */
const DEFAULT_CATEGORY_RETURN = 7.0;

/**
 * The past yearly return of these holdings, weighted by value the way the API
 * blends the whole portfolio's (/exposure): each category's published rate
 * times its share. Null when there is nothing to weigh or no rates yet.
 */
export function blendedReturnOf(classes: AssetClass[], exposure: Exposure | null): number | null {
  if (!exposure) return null;
  const total = classes.reduce((s, ac) => s + ac.value, 0);
  if (total <= 0) return null;
  const rate = new Map(exposure.exposures.map((e) => [e.name, e.historicalReturn]));
  let weighted = 0;
  for (const ac of classes) for (const sc of ac.categories ?? []) weighted += (sc.value / total) * (rate.get(sc.name) ?? DEFAULT_CATEGORY_RETURN);
  return Math.round(weighted * 100) / 100;
}

/** Holdings grouped by ticker, largest first, with each one's share and its class's past yearly return. */
export function holdingsByTicker(classes: AssetClass[], total: number, exposure: Exposure | null): HoldingRow[] {
  const map = new Map<string, { holdings: Holding[]; value: number; shares: number; assetClass: string; category: string }>();
  for (const ac of classes)
    for (const sc of ac.categories ?? [])
      for (const h of sc.holdings) {
        const cur = map.get(h.ticker);
        if (cur) {
          cur.holdings.push(h);
          cur.value += h.value;
          cur.shares += h.shares;
        } else map.set(h.ticker, { holdings: [h], value: h.value, shares: h.shares, assetClass: ac.name, category: sc.name });
      }
  return [...map.entries()]
    .map(([ticker, d]) => {
      const exp = exposure?.exposures.find((e) => e.holdings.some((h) => h.ticker === ticker));
      const cash = d.assetClass.toLowerCase().includes("cash");
      return {
        ticker,
        label: holdingLabel({ ticker, name: d.holdings[0]?.name }),
        totalShares: d.shares,
        totalValue: d.value,
        percentage: total > 0 ? (d.value / total) * 100 : 0,
        holdings: d.holdings,
        accountLabel: d.holdings.length > 1 ? `${d.holdings.length} accounts` : cleanAccountLabel(d.holdings[0]?.account ?? ""),
        assetClass: d.assetClass,
        category: d.category,
        historicalReturn: exp && !cash ? exp.historicalReturn : null,
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue);
}

/**
 * What a holding has gained or lost against what was paid for it, from cost
 * basis the account actually reports. Null unless every lot behind the row
 * has a real basis: cash, and the estimated rows the API builds for accounts
 * without holdings (no shares, or a basis equal to the balance), never get a
 * gain, since theirs would always read zero. Gains and losses are the only
 * thing on Portfolio that is basil or sauce (owner, 2026-11-23).
 */
export function holdingGain(h: Pick<HoldingRow, "ticker" | "holdings">): { amount: number; pct: number } | null {
  if (h.ticker.trim().toUpperCase() === "CASH" || h.holdings.length === 0) return null;
  let value = 0;
  let basis = 0;
  for (const lot of h.holdings) {
    const real = lot.costBasis !== null && lot.costBasis > 0 && lot.shares > 0 && Math.abs(lot.costBasis - lot.value) >= 0.005;
    if (!real) return null;
    value += lot.value;
    basis += lot.costBasis as number;
  }
  const amount = value - basis;
  return Math.abs(amount) < 1 ? null : { amount, pct: (amount / basis) * 100 };
}

/** A holding row's second line: its class (its category under "Other") and where it is held. */
export function holdingMeta(h: HoldingRow): string {
  const classLabel = /^other$/i.test(h.assetClass.trim()) && h.category ? h.category : h.assetClass;
  return h.accountLabel ? `${classLabel}, ${h.accountLabel}` : classLabel;
}

export type HoldingSort = "value:desc" | "value:asc" | "name:asc" | "return:desc";

export const HOLDING_SORTS: Array<{ value: HoldingSort; label: string }> = [
  { value: "value:desc", label: "Largest" },
  { value: "value:asc", label: "Smallest" },
  { value: "name:asc", label: "A to Z" },
  { value: "return:desc", label: "Return" },
];

/** The holdings in the chosen order. A holding with no return sorts last under return; ties keep the largest first. */
export function sortHoldings(rows: HoldingRow[], sort: HoldingSort): HoldingRow[] {
  const byValue = (a: HoldingRow, b: HoldingRow) => b.totalValue - a.totalValue;
  const out = [...rows];
  switch (sort) {
    case "value:asc":
      return out.sort((a, b) => a.totalValue - b.totalValue);
    case "name:asc":
      return out.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || byValue(a, b));
    case "return:desc":
      return out.sort((a, b) => (b.historicalReturn ?? -Infinity) - (a.historicalReturn ?? -Infinity) || byValue(a, b));
    default:
      return out.sort(byValue);
  }
}

/** The allocation for the grouping, or inside one bucket of it when drilled. */
export function allocationSlices(groupBy: GroupBy, drill: string | null, classes: AssetClass[], total: number, holdings: HoldingRow[]): Slice[] {
  const slice = (name: string, value: number, of: number, chart: number, label?: string): Slice => ({
    name,
    label: label ?? (isCashTicker(name) ? "Cash" : name),
    value,
    pct: of > 0 ? (value / of) * 100 : 0,
    chart,
  });
  const byValue = (a: Slice, b: Slice) => b.value - a.value;
  // One row per ticker: a fund held in two accounts is one position here (the web listed it twice).
  const byTicker = (hs: Holding[], of: number) => {
    const sums = new Map<string, number>();
    for (const h of hs) sums.set(h.ticker, (sums.get(h.ticker) ?? 0) + h.value);
    return [...sums.entries()].sort((a, b) => b[1] - a[1]).map(([name, value], i) => slice(name, value, of, fallbackColor(i)));
  };

  if (groupBy === "assetClass") {
    if (drill) {
      const ac = classes.find((a) => a.name === drill);
      return byTicker((ac?.categories ?? []).flatMap((sc) => sc.holdings), ac?.value || 0);
    }
    // A class literally named "Other" is shown as its holdings, so the legend never says "Other".
    return classes.flatMap((ac, i) => {
      if (/^other$/i.test(ac.name.trim())) {
        const hs = (ac.categories ?? []).flatMap((sc) => sc.holdings).filter((h) => h.value > 0).sort((a, b) => b.value - a.value);
        if (hs.length > 0) return hs.map((h, j) => slice(holdingLabel(h), h.value, total, fallbackColor(i + j)));
      }
      return [{ ...slice(ac.name, ac.value, total, CLASS_COLOR[ac.name] ?? fallbackColor(i)), pct: ac.percentage }];
    });
  }

  const categories = classes.flatMap((ac) => ac.categories ?? []).map((sc, i) => ({ sc, chart: fallbackColor(i) }));
  if (groupBy === "category") {
    if (drill) {
      const sc = categories.find((c) => c.sc.name === drill)?.sc;
      return byTicker(sc?.holdings ?? [], sc?.holdings.reduce((s, h) => s + h.value, 0) || 0);
    }
    return categories.map(({ sc, chart }) => slice(sc.name, sc.value, total, chart)).sort(byValue);
  }

  if (groupBy === "holding") {
    if (drill) {
      const tg = holdings.find((h) => h.ticker === drill);
      return (tg?.holdings ?? []).map((h, i) => slice(h.account, h.value, tg?.totalValue ?? 0, fallbackColor(i), cleanAccountLabel(h.account)));
    }
    return holdings.map((h, i) => ({ ...slice(h.ticker, h.totalValue, total, fallbackColor(i), h.label), pct: h.percentage }));
  }

  // Account: each account's holdings summed, or one account's holdings per ticker.
  const sums = new Map<string, number>();
  for (const ac of classes)
    for (const sc of ac.categories ?? [])
      for (const h of sc.holdings) {
        if (drill && h.account !== drill) continue;
        const key = drill ? h.ticker : h.account;
        sums.set(key, (sums.get(key) ?? 0) + h.value);
      }
  const of = drill ? [...sums.values()].reduce((s, v) => s + v, 0) : total;
  return [...sums.entries()].map(([name, value], i) => slice(name, value, of, fallbackColor(i), drill ? undefined : cleanAccountLabel(name))).sort(byValue);
}

/**
 * Drilling never dead-ends: at the top a tap opens the bucket. Inside one the
 * rows are a level deeper, so a tap moves to that dimension and opens it
 * (class, then a holding, then an account, then a holding).
 */
export function drillFrom(groupBy: GroupBy, drill: string | null, name: string): { groupBy: GroupBy; drill: string } {
  if (!drill) return { groupBy, drill: name };
  return { groupBy: groupBy === "holding" ? "account" : "holding", drill: name };
}

/** Slices under 1.5% fold into one "Other" (only when that removes at least two). */
export function collapseSmall(slices: Slice[], minPct = 1.5): Slice[] {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return slices;
  const big = slices.filter((s) => (s.value / total) * 100 >= minPct);
  const small = slices.filter((s) => (s.value / total) * 100 < minPct);
  if (small.length < 2) return slices;
  const value = small.reduce((s, x) => s + x.value, 0);
  return [
    ...big,
    {
      name: OTHER,
      label: "Other",
      value,
      pct: (value / total) * 100,
      chart: OTHER_COLOR,
      children: small.map((s) => ({ name: s.label, pct: (s.value / total) * 100 })).sort((a, b) => b.pct - a.pct),
    },
  ];
}

export const GROUPS: Array<{ value: GroupBy; label: string; crumb: string }> = [
  { value: "assetClass", label: "Class", crumb: "Asset class" },
  { value: "category", label: "Category", crumb: "Category" },
  { value: "holding", label: "Holding", crumb: "Holdings" },
  { value: "account", label: "Account", crumb: "Account" },
];

/**
 * The account a breakdown row names, by its name: the API labels holdings by
 * account name only. Null when no account, or more than one, has that name.
 */
export function accountIdFor(name: string, accounts: Array<{ id: string; name: string }>): string | null {
  const hits = accounts.filter((a) => a.name === name);
  return hits.length === 1 ? hits[0].id : null;
}
