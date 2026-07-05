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

// Sentence-case group-by labels — shared by the segmented control + breadcrumb.
function labelFor(g: GroupBy): string {
  return g === 'assetClass' ? 'Asset class'
    : g === 'category' ? 'Category'
    : g === 'holding' ? 'Holdings'
    : 'Account';
}

// Percent formatter for the breakdown — never renders "0.0%" noise; anything
// below a tenth of a percent reads "<0.1%" so tiny slivers stay honest.
function fmtPct(p: number): string {
  if (p <= 0) return '0%';
  if (p < 0.1) return '<0.1%';
  return `${p.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Allocation slice — one bucket in whatever grouping is active
// ---------------------------------------------------------------------------

interface DonutSlice { name: string; value: number; pct: number; color: string; label?: string; children?: Array<{ name: string; value: number; pct: number }> }

// Synthetic bucket that rolls up sub-threshold slices so the bar doesn't fan
// out into a rainbow of unmappable slivers. Neutral slate so it never competes
// with the real, distinct top segments.
const OTHER_SLICE = '__other__';
const OTHER_COLOR = 'var(--ui-viz-7)';

// Fold every slice under `minPct` of the total into one neutral "Other" segment
// (keeping the small items as children for the tooltip/legend). Only collapses
// when it actually removes clutter (≥2 tiny slices); otherwise passes through.
function collapseSmallSlices(slices: DonutSlice[], minPct = 1.5): DonutSlice[] {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return slices;
  const big: DonutSlice[] = [];
  const small: DonutSlice[] = [];
  for (const s of slices) {
    if ((s.value / total) * 100 >= minPct) big.push(s);
    else small.push(s);
  }
  if (small.length < 2) return slices;
  const otherValue = small.reduce((s, x) => s + x.value, 0);
  big.push({
    name: OTHER_SLICE,
    label: 'Other',
    value: otherValue,
    pct: (otherValue / total) * 100,
    color: OTHER_COLOR,
    children: small
      .map((s) => ({ name: s.name, value: s.value, pct: (s.value / total) * 100 }))
      .sort((a, b) => b.value - a.value),
  });
  return big;
}

// ---------------------------------------------------------------------------
// Full-width allocation bar — the single at-a-glance chart. Segments grow to
// their value, wide ones carry an inline label, and hovering one dims the rest
// and echoes into the breakdown below. Click drills (when not already drilled).
// ---------------------------------------------------------------------------

function AllocationBar({
  slices,
  hovered,
  onHover,
  onSliceClick,
}: {
  slices: DonutSlice[];
  hovered: string | null;
  onHover: (name: string | null) => void;
  onSliceClick?: (name: string) => void;
}) {
  const segs = slices.filter((s) => s.value > 0 && s.pct > 0);
  const sum = segs.reduce((s, x) => s + x.value, 0) || 1;
  if (segs.length === 0) return null;

  return (
    <div
      className="flex h-[56px] gap-[3px] overflow-hidden rounded-[14px]"
      style={{ boxShadow: 'var(--ui-shadow-sm), inset 0 1.5px 0 rgba(255,255,255,0.28)' }}
      role="img"
      aria-label="Allocation breakdown bar"
    >
      {segs.map((s, i) => {
        const pct = (s.value / sum) * 100;
        const wide = pct >= 8;
        const active = hovered === null || hovered === s.name;
        const isOther = s.name === OTHER_SLICE;
        const display = s.label ?? s.name;
        const drillable = !!onSliceClick && !isOther;
        const tip = isOther && s.children?.length
          ? `Other · ${pct.toFixed(1)}% · ${formatMoney(s.value, true)} — ${s.children.map((c) => c.name).join(', ')}`
          : `${display} · ${pct.toFixed(1)}% · ${formatMoney(s.value, true)}`;
        return (
          <button
            key={`${s.name}-${i}`}
            type="button"
            onClick={() => { if (drillable) onSliceClick?.(s.name); }}
            onMouseEnter={() => onHover(s.name)}
            onMouseLeave={() => onHover(null)}
            className="relative flex h-full items-center px-3 transition-opacity duration-150"
            style={{
              flexGrow: s.value,
              minWidth: 5,
              background: s.color,
              backgroundImage:
                'linear-gradient(170deg, rgba(255,255,255,0.30), rgba(255,255,255,0) 52%, rgba(0,0,0,0.10))',
              borderRadius:
                i === 0 ? '11px 4px 4px 11px' : i === segs.length - 1 ? '4px 11px 11px 4px' : '4px',
              opacity: active ? 1 : 0.38,
              cursor: drillable ? 'pointer' : 'default',
            }}
            title={tip}
          >
            {wide && (
              <span
                className="hidden truncate text-[12.5px] font-extrabold text-white sm:block"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.30)' }}
              >
                {display} · {pct.toFixed(0)}%
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Two-column breakdown — the legible legend. Each row spells out swatch · name
// · value · %, side-by-side across two columns on desktop, one on mobile.
// ---------------------------------------------------------------------------

function AllocationBreakdown({
  slices,
  activeName,
  hovered,
  onHover,
  onSliceClick,
}: {
  slices: DonutSlice[];
  activeName: string | null;
  hovered: string | null;
  onHover: (name: string | null) => void;
  onSliceClick: (name: string) => void;
}) {
  const rows = slices.filter((s) => s.value > 0 && s.pct > 0);
  const CAP = 24;
  const shown = rows.slice(0, CAP);
  const rest = rows.length - shown.length;

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 sm:gap-x-10">
        {shown.map((s, i) => {
          const isActive = activeName === s.name;
          const isHover = hovered === s.name;
          const isOther = s.name === OTHER_SLICE;
          const display = s.label ?? s.name;
          return (
            <div
              key={`${s.name}-${i}`}
              className={cn('flex flex-col', isOther && 'sm:col-span-2')}
              onMouseEnter={() => onHover(s.name)}
              onMouseLeave={() => onHover(null)}
            >
              <button
                type="button"
                onClick={() => { if (!isOther) onSliceClick(s.name); }}
                className={cn(
                  'ui-focus flex min-h-touch items-center gap-3 rounded-ui-sm px-2.5 py-2 text-left transition-colors',
                  isOther ? 'cursor-default' : isActive ? 'bg-brand-soft' : isHover ? 'bg-brand-softer' : 'hover:bg-brand-softer',
                )}
              >
                <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: s.color }} aria-hidden />
                <span
                  className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content"
                  title={display}
                >
                  {display}
                </span>
                <span className="shrink-0 whitespace-nowrap text-right ui-tnum">
                  <span className="font-editorial text-[14px] font-extrabold tracking-[-0.01em] text-content">
                    {formatMoney(s.value, true)}
                  </span>
                  <span className="ml-2 text-[12.5px] font-semibold text-content-muted">{fmtPct(s.pct)}</span>
                </span>
              </button>
              {isOther && s.children && s.children.length > 0 && (
                <div className="px-2.5 pb-1 text-[11.5px] leading-relaxed text-content-muted">
                  {s.children.map((c, j) => (
                    <span key={`${c.name}-${j}`}>
                      {c.name} <span className="ui-tnum">{fmtPct(c.pct)}</span>
                      {j < s.children!.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {rest > 0 && (
        <div className="mt-2 px-2.5 text-[12px] font-medium text-content-muted">
          +{rest} smaller {rest === 1 ? 'position' : 'positions'} in the bar
        </div>
      )}
    </div>
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
  // Shared hover — links a bar segment to its breakdown row and back.
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);
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
      <div className="mx-auto max-w-[1180px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-6 sm:pb-28 text-content">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="mt-3 h-4 w-64" />
        {/* Allocation hero */}
        <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-10 w-52" />
              <Skeleton className="mt-3 h-4 w-64" />
            </div>
            <Skeleton className="h-9 w-64 rounded-ui-md" />
          </div>
          <Skeleton className="mt-6 h-[56px] w-full rounded-[14px]" />
          <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-1 sm:grid-cols-2">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-3 w-3 rounded-[4px]" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        </div>
        {/* Holdings — two columns */}
        <div className="mt-10 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-3.5 rounded-ui-lg border border-line bg-panel shadow-ui-sm px-4 py-3">
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
      <div className="mx-auto max-w-[1180px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-6 sm:pb-28 text-content">
        <PageHead
          subtitle={`${formatMoney(accountTotal, true)} · ${accountAllocation.length} account${accountAllocation.length === 1 ? '' : 's'} · no holdings yet`}
        />

        <section className="mt-6">
          <Surface pad="lg" className="relative overflow-hidden">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: 'radial-gradient(90% 80% at 0% 0%, var(--ui-accent-softer), transparent 60%)' }}
            />
            <div className="relative">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-content-muted">Allocation by account</div>
              <div className="mt-2 font-editorial text-[34px] sm:text-[44px] font-extrabold leading-none tracking-[-0.03em] ui-tnum">
                {formatMoney(accountTotal, true)}
              </div>
              <div className="mt-5">
                <AllocationBar slices={acctSlices} hovered={hoveredSlice} onHover={setHoveredSlice} />
              </div>
              <div className="mt-5">
                <AllocationBreakdown
                  slices={acctSlices}
                  activeName={null}
                  hovered={hoveredSlice}
                  onHover={setHoveredSlice}
                  onSliceClick={() => {}}
                />
              </div>
            </div>
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
      <div className="mx-auto max-w-[1180px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-6 sm:pb-28 text-content">
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

  const biggestHolding = holdingsByTicker[0];
  const groupTotal = drillLevel1 ? chartSlices.reduce((s, sl) => s + sl.value, 0) : filteredTotal;
  // Roll sub-threshold slivers into one neutral "Other" so the bar + legend
  // don't fan into an unmappable rainbow.
  const displaySlices = collapseSmallSlices(chartSlices);

  return (
    <div
      className="mx-auto max-w-[1180px] px-[18px] sm:px-12 pt-5 sm:pt-10 pb-6 sm:pb-28 text-content"
      onMouseLeave={() => setHoveredSlice(null)}
    >
      <PageHead subtitle="What you're invested in, and how it's allocated." />

      {/* ════════ ALLOCATION HERO — one full-width chart + a legible breakdown ════════ */}
      <section className="mt-6">
        <Surface pad="lg" className="relative overflow-hidden">
          {/* atmospheric wash — matches the primary-nav hero cards */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 90% at 100% 0%, var(--ui-info-soft), transparent 56%),' +
                'radial-gradient(90% 70% at 0% 4%, var(--ui-accent-softer), transparent 60%)',
            }}
          />
          <div className="relative">
            {/* Header — value + return + stats · group-by control */}
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-content-muted">Portfolio value</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="font-editorial text-[34px] sm:text-[44px] font-extrabold leading-none tracking-[-0.03em] ui-tnum">
                    {formatMoney(filteredTotal, true)}
                  </span>
                  {blendedReturn !== null && (
                    <span
                      className="inline-flex items-center gap-1 h-7 px-3 rounded-full text-[13px] font-bold ui-tnum"
                      style={{
                        background: blendedReturn >= 0 ? 'var(--ui-positive-soft)' : 'var(--ui-negative-soft)',
                        color: blendedReturn >= 0 ? 'rgb(var(--ui-positive))' : 'rgb(var(--ui-negative))',
                      }}
                    >
                      {blendedReturn >= 0 ? '+' : '−'}{Math.abs(blendedReturn).toFixed(1)}%
                      <span className="font-semibold opacity-70">/ yr</span>
                    </span>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-content-muted ui-tnum">
                  <span><span className="font-bold text-content">{positionCount}</span> position{positionCount === 1 ? '' : 's'}</span>
                  <span className="text-content-faint">·</span>
                  <span><span className="font-bold text-content">{accountCount}</span> account{accountCount === 1 ? '' : 's'}</span>
                  {biggestHolding && (
                    <>
                      <span className="text-content-faint">·</span>
                      <span>Largest <span className="font-bold text-content">{biggestHolding.ticker}</span> {biggestHolding.percentage.toFixed(1)}%</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-start gap-2 lg:items-end">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">Group by</span>
                <SegmentedControl
                  aria-label="Group allocation by"
                  value={groupBy}
                  onChange={(g) => handleGroupByChange(g as GroupBy)}
                  size="sm"
                  tone="brand"
                  options={[
                    { value: 'assetClass', label: 'Class' },
                    { value: 'category', label: 'Category' },
                    { value: 'holding', label: 'Holding' },
                    { value: 'account', label: 'Account' },
                  ]}
                />
              </div>
            </div>

            {/* Filter + drill breadcrumb */}
            {(allAccounts.length > 1 || drillLevel1) && (
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
                {allAccounts.length > 1 && (
                  <div className="flex items-center gap-2.5">
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
                {drillLevel1 && (
                  <div className="flex items-center gap-1.5 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setDrillLevel1(null)}
                      className="ui-focus rounded-ui-sm font-semibold text-content-muted underline underline-offset-2 hover:text-brand"
                    >
                      {labelFor(groupBy)}
                    </button>
                    <ChevronRight size={13} className="text-content-faint" />
                    <span className="font-bold text-content">{drillLevel1}</span>
                    <span className="ml-1 font-semibold text-content-muted ui-tnum">{formatMoney(groupTotal, true)}</span>
                  </div>
                )}
              </div>
            )}

            {/* The one chart + its two-column breakdown */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`${groupBy}-${drillLevel1}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <div className="mt-5">
                  <AllocationBar
                    slices={displaySlices}
                    hovered={hoveredSlice}
                    onHover={setHoveredSlice}
                    onSliceClick={handleSliceClick}
                  />
                </div>
                <div className="mt-5">
                  <AllocationBreakdown
                    slices={displaySlices}
                    activeName={drillLevel1}
                    hovered={hoveredSlice}
                    onHover={setHoveredSlice}
                    onSliceClick={handleSliceClick}
                  />
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </Surface>
      </section>

      {/* ── Insights (preserved) ── */}
      <div className="mt-8">
        <PageActions types="portfolio" />
      </div>

      {/* ── Holdings — the position ledger, two columns on desktop ── */}
      <section className="mt-10">
        <div className="flex items-end justify-between gap-4 pb-1">
          <h2 className="font-editorial text-[19px] sm:text-[20px] font-bold tracking-[-0.02em] text-content">Holdings</h2>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-muted">
            {holdingsByTicker.length} position{holdingsByTicker.length === 1 ? '' : 's'}
          </span>
        </div>
        {holdingsByTicker.length === 0 ? (
          <div className="mt-3 rounded-ui-xl border border-line bg-panel px-4 py-8 text-center text-[13px] text-content-muted shadow-ui-sm">
            No holdings match the current filter.
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {holdingsByTicker.map((h) => {
              const isOther = /^other$/i.test(h.assetClass.trim());
              const classLabel = isOther && h.category ? h.category : h.assetClass;
              const account = cleanAccountLabel(h.accountLabel);
              const meta = `${classLabel}${account ? ` · ${account}` : ''}`;
              return (
                <div
                  key={h.ticker}
                  className="flex items-center gap-3.5 rounded-ui-lg border border-line bg-panel px-4 py-3 shadow-ui-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-ui-md sm:px-5"
                >
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
            })}
          </div>
        )}
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

