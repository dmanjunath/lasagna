import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Building2, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { formatMoney, cn } from '../lib/utils';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { useLocation } from 'wouter';
import { PageActions } from '../components/common/page-actions';
import { Button, Surface, SegmentedControl, EmptyState, Skeleton } from '../components/uikit';
import { faviconUrl, tickerToIssuer } from '../components/ds/institutions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GroupBy = 'assetClass' | 'category' | 'holding' | 'account';

interface AssetClass {
  name: string;
  value: number;
  percentage: number;
  color: string;
  categories: Category[];
}

interface Category {
  name: string;
  value: number;
  percentage: number;
  holdings: Holding[];
}

interface Holding {
  ticker: string;
  name: string;
  shares: number;
  value: number;
  costBasis: number | null;
  account: string;
}

// ---------------------------------------------------------------------------
// Asset-class colour mapping — Bright --ui-viz palette
// ---------------------------------------------------------------------------

// Coral (viz-4) reads as "loss/debt", so it sits last and is skipped for
// equity/asset buckets — asset classes draw from the calmer viz slots.
const FALLBACK_COLORS = [
  'var(--ui-viz-2)', 'var(--ui-viz-1)', 'var(--ui-viz-3)',
  'var(--ui-viz-5)', 'var(--ui-viz-6)', 'var(--ui-viz-7)',
  'var(--ui-viz-4)',
];

const ASSET_CLASS_COLORS: Record<string, string> = {
  'US Equity':            'var(--ui-viz-2)',
  'Intl Equity':         'var(--ui-viz-5)',
  'International Equity': 'var(--ui-viz-5)',
  'Bonds':               'var(--ui-viz-6)',
  'Fixed Income':        'var(--ui-viz-6)',
  'REITs':               'var(--ui-viz-3)',
  'Real Estate':         'var(--ui-viz-3)',
  'Alt':                 'var(--ui-viz-7)',
  'Alternative':         'var(--ui-viz-7)',
  'Commodity':           'var(--ui-viz-7)',
  'Cash':                'var(--ui-viz-1)',
  'Cash & Equivalents':  'var(--ui-viz-1)',
};

function colorForAssetClass(name: string, index: number): string {
  return ASSET_CLASS_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/** Pick a human-readable label for a holding. The backend sometimes stores
 *  the literal string "UNKNOWN" in the `ticker` field for items it couldn't
 *  match to a market symbol — fall through to the holding name (e.g.
 *  "Vanguard 500 Index Portfolio") rather than render "UNKNOWN". */
function holdingLabel(h: { ticker?: string; name?: string }): string {
  const t = (h.ticker ?? '').trim();
  if (t && t.toUpperCase() !== 'UNKNOWN') return t;
  return (h.name ?? '').trim() || 'Holding';
}

// Strip trailing account-id suffixes like "-242726519-01" and collapse comma-
// joined dupes ("Suhana - 529, Dheeraj - 242726519-01") to just the first.
function cleanAccountLabel(raw: string): string {
  if (!raw) return raw;
  const first = raw.split(',')[0].trim();
  return first.replace(/[\s-]*\d{5,}(?:[-_]\d+)*$/, '').trim() || first;
}

// Abbreviate verbose asset-class labels for the composition bar.
function abbreviateClassLabel(name: string): string {
  return name
    .replace(/^INTERNATIONAL\s+STOCKS$/i, "INT'L STOCKS")
    .replace(/^INTERNATIONAL\s+/i, "INT'L ");
}

// Sentence-case group-by labels — shared by the segmented control + breadcrumb.
function labelFor(g: GroupBy): string {
  return g === 'assetClass' ? 'Asset class'
    : g === 'category' ? 'Category'
    : g === 'holding' ? 'Holdings'
    : 'Account';
}

// ---------------------------------------------------------------------------
// SVG Donut chart — native SVG, no external lib
// ---------------------------------------------------------------------------

interface DonutSlice { name: string; value: number; pct: number; color: string }

function PortfolioDonut({
  slices,
  total,
  onSliceClick,
}: {
  slices: DonutSlice[];
  total: number;
  onSliceClick?: (name: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const r = 78;
  const R = 116;
  const cx = 140;
  const cy = 140;

  let a0 = -Math.PI / 2;
  const paths: { d: string; color: string; name: string; pct: number; value: number }[] = [];

  for (const s of slices) {
    if (s.pct <= 0) continue;
    const angle = (s.pct / 100) * 2 * Math.PI;
    const a1 = a0 + angle;
    const large = angle > Math.PI ? 1 : 0;

    const x1o = cx + R * Math.cos(a0);
    const y1o = cy + R * Math.sin(a0);
    const x2o = cx + R * Math.cos(a1);
    const y2o = cy + R * Math.sin(a1);

    const x1i = cx + r * Math.cos(a1);
    const y1i = cy + r * Math.sin(a1);
    const x2i = cx + r * Math.cos(a0);
    const y2i = cy + r * Math.sin(a0);

    const d = [
      `M ${x1o} ${y1o}`,
      `A ${R} ${R} 0 ${large} 1 ${x2o} ${y2o}`,
      `L ${x1i} ${y1i}`,
      `A ${r} ${r} 0 ${large} 0 ${x2i} ${y2i}`,
      'Z',
    ].join(' ');

    paths.push({ d, color: s.color, name: s.name, pct: s.pct, value: s.value });
    a0 = a1;
  }

  const hp = hovered !== null ? paths[hovered] : null;
  const editorial = "'Bricolage Grotesque', system-ui, sans-serif";
  const body = "'Plus Jakarta Sans', system-ui, sans-serif";

  return (
    <svg width={280} height={280} viewBox="0 0 280 280" style={{ flexShrink: 0, cursor: 'pointer' }}>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.color}
          stroke="rgb(var(--ui-panel))"
          strokeWidth={2}
          opacity={hovered === null ? 1 : hovered === i ? 1 : 0.42}
          style={{ transition: 'opacity 0.15s' }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          onTouchStart={() => setHovered(hovered === i ? null : i)}
          onClick={() => onSliceClick?.(p.name)}
        />
      ))}
      {/* Center text — shows hover info or total */}
      {hp ? (
        <>
          <text x={cx} y={cy - 18} textAnchor="middle" style={{ fontFamily: body, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', fill: 'rgb(var(--ui-content-muted))' }}>
            {hp.name}
          </text>
          <text x={cx} y={cy + 6} textAnchor="middle" style={{ fontFamily: editorial, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', fontSize: 24, fill: 'rgb(var(--ui-content))' }}>
            {formatMoney(hp.value, true)}
          </text>
          <text x={cx} y={cy + 24} textAnchor="middle" style={{ fontFamily: body, fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fill: hp.color }}>
            {hp.pct.toFixed(1)}%
          </text>
        </>
      ) : (
        <>
          <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontFamily: editorial, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em', fontSize: 28, fill: 'rgb(var(--ui-content))' }}>
            {formatMoney(total, true)}
          </text>
          <text x={cx} y={cy + 18} textAnchor="middle" style={{ fontFamily: body, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', fill: 'rgb(var(--ui-content-muted))' }}>
            Total
          </text>
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Composition bar — stacked ribbon of asset-class buckets + legend
// ---------------------------------------------------------------------------

interface CompSegment { label: string; value: number; color: string }

function CompositionBar({ segments, total }: { segments: CompSegment[]; total: number }) {
  const sum = total || segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <Surface pad="md">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-canvas-sunken">
        {segments.map((seg, i) => {
          const pct = (seg.value / sum) * 100;
          if (pct <= 0) return null;
          return (
            <span
              key={`${seg.label}-${i}`}
              title={`${seg.label} · ${pct.toFixed(1)}%`}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${pct}%`, background: seg.color, boxShadow: 'inset 0 0 0 0.5px rgba(255,255,255,0.15)' }}
            />
          );
        })}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {segments.map((seg, i) => {
          const pct = (seg.value / sum) * 100;
          return (
            <div key={`${seg.label}-legend-${i}`} className="flex items-center gap-2.5 min-w-0">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: seg.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-content" title={seg.label}>
                {seg.label}
              </span>
              <span className="shrink-0 text-[12.5px] font-semibold text-content-muted ui-tnum">
                {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Ticker / issuer icon
// ---------------------------------------------------------------------------

function TickerIcon({ ticker }: { ticker: string }) {
  const url = faviconUrl(tickerToIssuer(ticker), 64);
  const mono = ticker.slice(0, 2).toUpperCase();
  const [err, setErr] = useState(false);
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-ui-md border border-line bg-canvas-sunken text-[11px] font-bold text-content-secondary">
      {url && !err ? (
        <img src={url} alt="" className="h-5 w-5 rounded-[5px]" onError={() => setErr(true)} />
      ) : (
        mono
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account filter dropdown
// ---------------------------------------------------------------------------

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  depository: 'Bank',
  investment: 'Investment',
  brokerage: 'Brokerage',
  credit: 'Credit',
  loan: 'Loan',
  real_estate: 'Real Estate',
  alternative: 'Alternative',
  other: 'Other',
};

function AccountFilterDropdown({
  accounts,
  activeAccounts,
  accountTypeMap,
  onToggle,
  onSelectAll,
}: {
  accounts: string[];
  activeAccounts: Set<string> | null;
  accountTypeMap: Map<string, string>;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const allActive = activeAccounts === null;
  const activeCount = allActive ? accounts.length : activeAccounts.size;
  const displayLabel = allActive ? 'All accounts' : `${activeCount} account${activeCount === 1 ? '' : 's'}`;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="ui-focus inline-flex items-center gap-1.5 rounded-ui-md border border-line bg-canvas-sunken px-3 py-1.5 text-[13px] font-semibold text-content transition-colors hover:border-line-strong"
      >
        {displayLabel}
        <ChevronDown size={14} className={cn('text-content-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="animate-scale-in absolute left-0 top-[calc(100%+6px)] z-30 max-h-[320px] w-[240px] origin-top-left overflow-y-auto rounded-ui-md border border-line-strong bg-panel-raised p-1.5 shadow-ui-lg">
          <button
            type="button"
            onClick={() => { onSelectAll(); setOpen(false); }}
            className="ui-focus flex w-full items-center gap-2.5 rounded-ui-sm px-2.5 py-2 text-left text-[13px] font-semibold text-content transition-colors hover:bg-canvas-sunken"
          >
            <FilterCheck checked={allActive} />
            <span>All accounts</span>
          </button>
          <div className="my-1 h-px bg-line" />
          {accounts.map(name => {
            const checked = activeAccounts === null || activeAccounts.has(name);
            const type = accountTypeMap.get(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => onToggle(name)}
                className="ui-focus flex w-full items-center gap-2.5 rounded-ui-sm px-2.5 py-2 text-left text-[13px] font-medium text-content-secondary transition-colors hover:bg-canvas-sunken"
              >
                <FilterCheck checked={checked} />
                <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                {type && (
                  <span className="shrink-0 rounded-full bg-canvas-sunken px-1.5 py-0.5 text-[10px] font-semibold text-content-muted ui-tnum">
                    {ACCOUNT_TYPE_LABELS[type] ?? type}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterCheck({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
        checked ? 'border-transparent bg-brand text-brand-fg' : 'border-line-strong bg-transparent',
      )}
    >
      {checked && <Check size={11} strokeWidth={3} />}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Holdings table row
// ---------------------------------------------------------------------------

interface HoldingRow {
  ticker: string;
  totalShares: number;
  totalValue: number;
  percentage: number;
  color: string;
  holdings: Holding[];
  accountLabel: string;
  assetClass: string;
  category: string;
  historicalReturn: number | null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PortfolioComposition() {
  const [, setLocation] = useLocation();
  const { setPageContext } = usePageContext();

  // ── API state (preserved from original) ──
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [blendedReturn, setBlendedReturn] = useState<number | null>(null);
  const [exposures, setExposures] = useState<Array<{
    name: string; assetClass: string; value: number; percentage: number; historicalReturn: number;
    holdings: Array<{ ticker: string; name: string; value: number; account: string; shares: number }>;
  }>>([]);
  const [accountAllocation, setAccountAllocation] = useState<Array<{
    name: string; value: number; percentage: number; color: string;
  }>>([]);
  const [accountTotal, setAccountTotal] = useState(0);
  const [accountTypeMap, setAccountTypeMap] = useState<Map<string, string>>(new Map());

  // ── UI state ──
  const [groupBy, setGroupBy] = useState<GroupBy>('assetClass');
  const [drillLevel1, setDrillLevel1] = useState<string | null>(null);
  // Account filter: set of account names to SHOW (null = show all)
  const [activeAccounts, setActiveAccounts] = useState<Set<string> | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching (preserved from original)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [compData, expData, balanceData] = await Promise.all([
          api.getPortfolioComposition(),
          api.getPortfolioExposure().catch(() => null),
          api.getBalances().catch(() => ({ balances: [] })),
        ]);

        setTotalValue(compData.totalValue);
        setAssetClasses(compData.assetClasses);

        if (expData) {
          setBlendedReturn(expData.blendedReturn);
          setExposures(expData.exposures);
        }

        // Build account name → type map
        const typeMap = new Map<string, string>();
        for (const b of balanceData.balances) {
          if (b.name && b.type) typeMap.set(b.name, b.type);
        }
        setAccountTypeMap(typeMap);

        // Build account-level allocation as fallback
        if (compData.assetClasses.length === 0 && balanceData.balances.length > 0) {
          const ACCT_COLORS: Record<string, string> = {
            depository: 'var(--ui-viz-1)',
            investment: 'var(--ui-viz-2)',
            credit: 'var(--ui-viz-4)',
            loan: 'var(--ui-viz-6)',
            real_estate: 'var(--ui-viz-3)',
            alternative: 'var(--ui-viz-5)',
          };
          // Exclude liabilities — a mortgage/credit balance is debt, not an
          // asset, so it must not appear as a slice of "Asset allocation".
          const LIABILITY_TYPES = new Set(['loan', 'credit']);
          const accts = balanceData.balances
            .filter((b) => !LIABILITY_TYPES.has(b.type))
            .map((b) => ({ name: b.name, value: Math.abs(parseFloat(b.balance || '0')), type: b.type }))
            .filter((a) => a.value > 0)
            .sort((a, b) => b.value - a.value);
          const total = accts.reduce((s, a) => s + a.value, 0);
          setAccountTotal(total);
          setAccountAllocation(accts.map((a) => ({
            name: a.name,
            value: a.value,
            percentage: total > 0 ? (a.value / total) * 100 : 0,
            color: ACCT_COLORS[a.type] || 'var(--ui-viz-7)',
          })));
        }
      } catch (error) {
        console.error('Failed to fetch portfolio composition:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Page context (preserved from original)
  useEffect(() => {
    if (!loading && assetClasses.length > 0) {
      setPageContext({
        pageId: 'portfolio-composition',
        pageTitle: 'Portfolio Composition',
        description: 'Portfolio allocation across asset classes and individual holdings.',
      });
    }
  }, [loading, setPageContext]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  // All unique account names across all holdings
  const allAccounts = useMemo(() => {
    const names = new Set<string>();
    for (const ac of assetClasses) {
      for (const sc of ac.categories ?? []) {
        for (const h of sc.holdings) {
          names.add(h.account);
        }
      }
    }
    return Array.from(names).sort();
  }, [assetClasses]);

  // Filter asset classes by active accounts
  const filteredAssetClasses = useMemo(() => {
    if (!activeAccounts) return assetClasses;
    return assetClasses.map(ac => ({
      ...ac,
      categories: (ac.categories ?? []).map(sc => ({
        ...sc,
        holdings: sc.holdings.filter(h => activeAccounts.has(h.account)),
      })).filter(sc => sc.holdings.length > 0),
    })).filter(ac => (ac.categories ?? []).length > 0);
  }, [assetClasses, activeAccounts]);

  const filteredTotal = useMemo(
    () => filteredAssetClasses.reduce((s, ac) => s + ac.value, 0) || totalValue,
    [filteredAssetClasses, totalValue],
  );

  // Holdings grouped by ticker
  const holdingsByTicker = useMemo<HoldingRow[]>(() => {
    const tickerMap = new Map<string, { holdings: Holding[]; totalValue: number; totalShares: number; assetClass: string; category: string }>();
    for (const ac of filteredAssetClasses) {
      for (const sc of ac.categories ?? []) {
        for (const h of sc.holdings) {
          const existing = tickerMap.get(h.ticker);
          if (existing) {
            existing.holdings.push(h);
            existing.totalValue += h.value;
            existing.totalShares += h.shares;
          } else {
            tickerMap.set(h.ticker, {
              holdings: [h],
              totalValue: h.value,
              totalShares: h.shares,
              assetClass: ac.name,
              category: sc.name,
            });
          }
        }
      }
    }
    return Array.from(tickerMap.entries())
      .map(([ticker, data], i) => {
        const exp = exposures.find(e => e.holdings.some(h => h.ticker === ticker));
        const isCash = data.assetClass.toLowerCase().includes('cash');
        return {
          ticker,
          totalShares: data.totalShares,
          totalValue: data.totalValue,
          assetClass: data.assetClass,
          category: data.category,
          holdings: data.holdings,
          color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
          percentage: filteredTotal > 0 ? (data.totalValue / filteredTotal) * 100 : 0,
          accountLabel: data.holdings.length > 1 ? `${data.holdings.length} accounts` : (data.holdings[0]?.account ?? '—'),
          historicalReturn: exp && !isCash ? exp.historicalReturn : null,
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [filteredAssetClasses, filteredTotal, exposures]);

  // All sub-categories flat list
  const allCategories = useMemo(() => {
    const result: { name: string; value: number; percentage: number; color: string; holdings: Holding[] }[] = [];
    let ci = 0;
    for (const ac of filteredAssetClasses) {
      for (const sc of ac.categories ?? []) {
        result.push({
          name: sc.name,
          value: sc.value,
          percentage: filteredTotal > 0 ? (sc.value / filteredTotal) * 100 : 0,
          color: FALLBACK_COLORS[ci % FALLBACK_COLORS.length],
          holdings: sc.holdings,
        });
        ci++;
      }
    }
    return result.sort((a, b) => b.value - a.value);
  }, [filteredAssetClasses, filteredTotal]);

  // Chart slices for current groupBy / drill state
  const chartSlices = useMemo((): DonutSlice[] => {
    if (groupBy === 'assetClass') {
      if (drillLevel1) {
        const ac = filteredAssetClasses.find(a => a.name === drillLevel1);
        const acTotal = ac?.value || 0;
        const holdings: Holding[] = (ac?.categories ?? []).flatMap(sc => sc.holdings);
        return holdings
          .map((h, i) => ({
            name: h.ticker,
            value: h.value,
            pct: acTotal > 0 ? (h.value / acTotal) * 100 : 0,
            color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
          }))
          .sort((a, b) => b.value - a.value);
      }
      // Mirror the ribbon's behaviour: when the backend returned a class
      // literally named "Other", expand it into its constituent holdings
      // so the donut + legend never show the word "Other".
      return filteredAssetClasses.flatMap<DonutSlice>((ac, i) => {
        if (/^other$/i.test(ac.name.trim())) {
          const holdings = (ac.categories ?? [])
            .flatMap((sc) => sc.holdings)
            .filter((h) => h.value > 0)
            .sort((a, b) => b.value - a.value);
          if (holdings.length > 0) {
            return holdings.map((h, j) => ({
              name: holdingLabel(h),
              value: h.value,
              pct: filteredTotal > 0 ? (h.value / filteredTotal) * 100 : 0,
              color: FALLBACK_COLORS[(i + j) % FALLBACK_COLORS.length],
            }));
          }
        }
        return [{
          name: ac.name,
          value: ac.value,
          pct: ac.percentage,
          color: colorForAssetClass(ac.name, i),
        }];
      });
    }

    if (groupBy === 'category') {
      if (drillLevel1) {
        const sc = allCategories.find(s => s.name === drillLevel1);
        const scTotal = sc?.holdings.reduce((s, h) => s + h.value, 0) || 0;
        return (sc?.holdings ?? []).map((h, i) => ({
          name: h.ticker,
          value: h.value,
          pct: scTotal > 0 ? (h.value / scTotal) * 100 : 0,
          color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        }));
      }
      return allCategories.map(sc => ({
        name: sc.name,
        value: sc.value,
        pct: sc.percentage,
        color: sc.color,
      }));
    }

    if (groupBy === 'holding') {
      if (drillLevel1) {
        const tg = holdingsByTicker.find(t => t.ticker === drillLevel1);
        return (tg?.holdings ?? []).map((h, i) => ({
          name: h.account,
          value: h.value,
          pct: tg!.totalValue > 0 ? (h.value / tg!.totalValue) * 100 : 0,
          color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        }));
      }
      return holdingsByTicker.map(t => ({
        name: t.ticker,
        value: t.totalValue,
        pct: t.percentage,
        color: t.color,
      }));
    }

    // account grouping
    const acctMap = new Map<string, number>();
    for (const ac of filteredAssetClasses) {
      for (const sc of ac.categories ?? []) {
        for (const h of sc.holdings) {
          acctMap.set(h.account, (acctMap.get(h.account) ?? 0) + h.value);
        }
      }
    }
    return Array.from(acctMap.entries())
      .map(([name, value], i) => ({
        name,
        value,
        pct: filteredTotal > 0 ? (value / filteredTotal) * 100 : 0,
        color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      }))
      .sort((a, b) => b.value - a.value);
  }, [groupBy, drillLevel1, filteredAssetClasses, allCategories, holdingsByTicker, filteredTotal]);

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  const toggleAccount = (name: string) => {
    setActiveAccounts(prev => {
      if (prev === null) {
        const next = new Set(allAccounts.filter(a => a !== name));
        return next.size === allAccounts.length ? null : next;
      }
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        if (next.size === 0) return new Set(allAccounts);
      } else {
        next.add(name);
        if (next.size === allAccounts.length) return null;
      }
      return next;
    });
  };

  const selectAllAccounts = () => setActiveAccounts(null);

  const handleSliceClick = (name: string) => {
    if (!drillLevel1) setDrillLevel1(name);
  };

  const handleGroupByChange = (g: GroupBy) => {
    setGroupBy(g);
    setDrillLevel1(null);
  };

  // Count positions & accounts
  const positionCount = holdingsByTicker.length;
  const accountCount = allAccounts.length;

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="mx-auto max-w-[1040px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-24 sm:pb-28 text-content">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-3 h-4 w-64" />
        <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
          <Skeleton className="h-3 w-full rounded-full" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-ui-lg border border-line bg-panel shadow-ui-sm p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-3 h-7 w-24" />
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
          <div className="flex justify-center"><Skeleton className="h-[240px] w-[240px] rounded-full" /></div>
        </div>
        <div className="mt-8 rounded-ui-xl border border-line bg-panel shadow-ui-sm">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-3.5 border-t border-line px-5 py-3.5 first:border-t-0">
              <Skeleton className="h-9 w-9 rounded-ui-md" />
              <div className="flex-1"><Skeleton className="h-3.5 w-24" /><Skeleton className="mt-2 h-3 w-40" /></div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty — no holdings, but accounts exist → account-level fallback
  // ---------------------------------------------------------------------------

  if (assetClasses.length === 0 && accountAllocation.length > 0) {
    const acctSlices: DonutSlice[] = accountAllocation.map(a => ({
      name: a.name, value: a.value, pct: a.percentage, color: a.color,
    }));

    return (
      <div className="mx-auto max-w-[1040px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-24 sm:pb-28 text-content">
        <PageHead
          subtitle={`${formatMoney(accountTotal, true)} · ${accountAllocation.length} account${accountAllocation.length === 1 ? '' : 's'} · no holdings yet`}
        />

        <section className="mt-7 space-y-4">
          <h2 className="text-[18px] font-semibold text-content">Asset allocation</h2>
          <Surface pad="lg">
            <AllocationGrid>
              <PortfolioDonut slices={acctSlices} total={accountTotal} />
              <div className="grid grid-cols-1 gap-2.5 min-w-0 sm:grid-cols-2 md:grid-cols-1">
                {accountAllocation.map(acct => (
                  <LegendRow key={acct.name} color={acct.color} name={acct.name} pct={acct.percentage} value={acct.value} />
                ))}
              </div>
            </AllocationGrid>
          </Surface>
        </section>

        <div className="mt-8">
          <EmptyState
            icon={<Building2 size={24} />}
            title="Link an investment account"
            description="Connect a brokerage via Plaid to see individual holdings and ticker-level analysis."
            action={
              <Button leadingIcon={<Plus size={16} />} onClick={() => setLocation('/accounts')}>
                Link investment account
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty — no accounts at all
  // ---------------------------------------------------------------------------

  if (assetClasses.length === 0) {
    return (
      <div className="mx-auto max-w-[1040px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-24 sm:pb-28 text-content">
        <PageHead subtitle="No accounts linked" />
        <div className="mt-8">
          <EmptyState
            icon={<Building2 size={24} />}
            title="No holdings found"
            description="Connect your investment accounts to see your portfolio composition and asset allocation."
            action={
              <Button leadingIcon={<Plus size={16} />} onClick={() => setLocation('/accounts')}>
                Link account
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render — full holdings view
  // ---------------------------------------------------------------------------

  // ── Composition bar: enumerate every asset class. If the backend returned a
  // class literally named "Other", drill in and replace it with its constituent
  // holdings so the bar never shows the word "Other".
  const ribbonSegments: CompSegment[] = [...filteredAssetClasses]
    .sort((a, b) => b.value - a.value)
    .flatMap<CompSegment>((ac, i) => {
      if (/^other$/i.test(ac.name.trim())) {
        const holdings = (ac.categories ?? [])
          .flatMap((sc) => sc.holdings)
          .filter((h) => h.value > 0)
          .sort((a, b) => b.value - a.value);
        if (holdings.length > 0) {
          return holdings.map((h, j) => ({
            label: holdingLabel(h),
            value: h.value,
            color: FALLBACK_COLORS[(i + j) % FALLBACK_COLORS.length],
          }));
        }
      }
      return [{
        label: abbreviateClassLabel(ac.name),
        value: ac.value,
        color: colorForAssetClass(ac.name, i),
      }];
    });

  const biggestHolding = holdingsByTicker[0];

  const subtitle = (
    <>
      {formatMoney(filteredTotal, true)} · {positionCount} position{positionCount !== 1 ? 's' : ''} · {accountCount} account{accountCount !== 1 ? 's' : ''}
      {blendedReturn !== null && (
        <>
          {'  ·  '}
          <span className={cn('font-semibold', blendedReturn >= 0 ? 'text-positive' : 'text-negative')}>
            {blendedReturn >= 0 ? '+' : '−'}{Math.abs(blendedReturn).toFixed(1)}% blended return
          </span>
        </>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-[1040px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-24 sm:pb-28 text-content">
      <PageHead subtitle={subtitle} />

      {/* Composition bar */}
      {ribbonSegments.length > 0 && (
        <div className="mt-6">
          <CompositionBar segments={ribbonSegments} total={filteredTotal} />
        </div>
      )}

      {/* KPI strip */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total value" value={formatMoney(filteredTotal, true)} />
        <KpiCard
          label="Blended return"
          value={blendedReturn !== null ? `${blendedReturn >= 0 ? '+' : '−'}${Math.abs(blendedReturn).toFixed(1)}%` : '—'}
          valueClass={blendedReturn !== null ? (blendedReturn >= 0 ? 'text-positive' : 'text-negative') : undefined}
          sub={blendedReturn !== null ? 'per year' : 'unavailable'}
        />
        <KpiCard label="Positions" value={String(positionCount)} sub={`${accountCount} account${accountCount === 1 ? '' : 's'}`} />
        {biggestHolding && (
          <KpiCard
            label="Largest holding"
            value={biggestHolding.ticker}
            sub={`${biggestHolding.percentage.toFixed(1)}% · ${formatMoney(biggestHolding.totalValue, true)}`}
          />
        )}
      </div>

      {/* ── Insights (preserved) ── */}
      <div className="mt-10">
        <PageActions types="portfolio" />
      </div>

      {/* ── Asset allocation chart ── */}
      <section className="mt-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold text-content">Asset allocation</h2>
            {drillLevel1 && (
              <div className="mt-1 flex items-center gap-1.5 text-[13px]">
                <button
                  type="button"
                  onClick={() => setDrillLevel1(null)}
                  className="ui-focus rounded-ui-sm font-semibold text-content-muted underline underline-offset-2 hover:text-brand"
                >
                  {labelFor(groupBy)}
                </button>
                <ChevronRight size={13} className="text-content-faint" />
                <span className="font-semibold text-content">{drillLevel1}</span>
              </div>
            )}
          </div>
          <SegmentedControl
            aria-label="Group allocation by"
            value={groupBy}
            onChange={(g) => handleGroupByChange(g as GroupBy)}
            size="sm"
            options={[
              { value: 'assetClass', label: 'Class' },
              { value: 'category', label: 'Category' },
              { value: 'holding', label: 'Holding' },
              { value: 'account', label: 'Account' },
            ]}
          />
        </div>

        {/* Account filter row */}
        {allAccounts.length > 1 && (
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-muted">Account</span>
            <AccountFilterDropdown
              accounts={allAccounts}
              activeAccounts={activeAccounts}
              accountTypeMap={accountTypeMap}
              onToggle={toggleAccount}
              onSelectAll={selectAllAccounts}
            />
          </div>
        )}

        <Surface pad="lg" className="mt-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${groupBy}-${drillLevel1}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <AllocationGrid>
                <PortfolioDonut
                  slices={chartSlices}
                  total={drillLevel1
                    ? chartSlices.reduce((s, sl) => s + sl.value, 0)
                    : filteredTotal}
                  onSliceClick={handleSliceClick}
                />
                <div className="grid grid-cols-1 gap-1.5 min-w-0 sm:grid-cols-2 md:grid-cols-1">
                  {chartSlices.slice(0, 10).map(sl => {
                    const isActive = drillLevel1 === sl.name;
                    return (
                      <button
                        key={sl.name}
                        type="button"
                        onClick={() => handleSliceClick(sl.name)}
                        className={cn(
                          'ui-focus flex min-h-touch items-center gap-2.5 rounded-ui-sm px-2 py-1.5 text-left transition-colors hover:bg-brand-softer',
                          isActive && 'bg-brand-soft',
                        )}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: sl.color }} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-content" title={sl.name}>{sl.name}</div>
                          <div className="text-[12px] font-medium text-content-muted ui-tnum">
                            {sl.pct.toFixed(1)}% · {formatMoney(sl.value, true)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </AllocationGrid>
            </motion.div>
          </AnimatePresence>
        </Surface>
      </section>

      {/* ── Holdings ── */}
      <section className="mt-10">
        <div className="flex items-end justify-between gap-4 pb-1">
          <h2 className="text-[18px] font-semibold text-content">Holdings</h2>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-muted">
            {holdingsByTicker.length} position{holdingsByTicker.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="mt-3 rounded-ui-xl border border-line bg-panel shadow-ui-sm">
          {holdingsByTicker.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-content-muted">
              No holdings match the current filter.
            </div>
          ) : (
            holdingsByTicker.map((h) => {
              const isOther = /^other$/i.test(h.assetClass.trim());
              const classLabel = isOther && h.category ? h.category : h.assetClass;
              const account = cleanAccountLabel(h.accountLabel);
              const meta = `${classLabel}${account ? ` · ${account}` : ''}`;
              return (
                <div key={h.ticker} className="flex items-center gap-3.5 border-t border-line px-4 py-3 first:border-t-0 last:rounded-b-ui-xl sm:px-5">
                  <TickerIcon ticker={h.ticker} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14.5px] font-bold leading-tight ui-tnum" title={h.ticker}>{h.ticker}</div>
                    <div className="mt-0.5 truncate text-[12.5px] text-content-muted" title={meta}>{meta}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-editorial text-[15px] font-extrabold tracking-[-0.015em] ui-tnum">
                      {formatMoney(h.totalValue, true)}
                    </div>
                    <div className="mt-0.5 text-[12px] font-medium text-content-muted ui-tnum">
                      {h.percentage.toFixed(1)}%
                      {h.historicalReturn !== null && (
                        <>
                          {'  ·  '}
                          <span className={cn('font-semibold', h.historicalReturn >= 0 ? 'text-positive' : 'text-negative')}>
                            {h.historicalReturn >= 0 ? '+' : '−'}{Math.abs(h.historicalReturn).toFixed(1)}%
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function PageHead({ subtitle }: { subtitle: React.ReactNode }) {
  return (
    <header className="animate-fade-in">
      <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
        Portfolio
      </h1>
      <p className="mt-1.5 text-[14px] font-medium text-content-muted ui-tnum">{subtitle}</p>
    </header>
  );
}

function KpiCard({
  label, value, sub, valueClass,
}: {
  label: string; value: string; sub?: string; valueClass?: string;
}) {
  return (
    <div className="rounded-ui-lg border border-line bg-panel shadow-ui-sm p-4">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">{label}</div>
      <div className={cn('mt-1.5 font-editorial text-[22px] font-extrabold leading-none tracking-[-0.02em] ui-tnum', valueClass)}>
        {value}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] font-medium text-content-muted ui-tnum">{sub}</div>}
    </div>
  );
}

function AllocationGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[280px_minmax(0,1fr)] md:gap-10">
      <div className="flex min-w-0 justify-center">{Array.isArray(children) ? children[0] : children}</div>
      {Array.isArray(children) && children[1]}
    </div>
  );
}

function LegendRow({
  color, name, pct, value,
}: {
  color: string; name: string; pct: number; value: number;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-content" title={name}>{name}</div>
        <div className="text-[12px] font-medium text-content-muted ui-tnum">
          {pct.toFixed(1)}% · {formatMoney(value, true)}
        </div>
      </div>
    </div>
  );
}
