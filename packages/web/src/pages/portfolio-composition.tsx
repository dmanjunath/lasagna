import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Building2, ChevronRight } from 'lucide-react';
import { formatMoney } from '../lib/utils';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { useLocation } from 'wouter';
import { PageActions } from '../components/common/page-actions';
import {
  Page,
  Section,
  Card,
  Button,
  Pill,
  Eyebrow,
  EmptyState,
  CompositionRibbon,
  StatStrip,
  Favicon,
  SkeletonChart,
  SkeletonRow,
  SkeletonLine,
} from '../components/ds';
import { faviconUrl, tickerToIssuer } from '../components/ds/institutions';
import type { CompositionSegment } from '../components/ds/CompositionRibbon';

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
// Asset class color mapping — LasagnaFi palette
// ---------------------------------------------------------------------------

// Iter 4: sauce-free data palette. Asset-class colors are still mapped
// (so US Equity is always the same hue) but they're drawn from the
// neutral data palette — no more "one orange blob" donuts.
const ASSET_CLASS_COLORS: Record<string, string> = {
  'US Equity':         'var(--lf-data-1)',
  'Intl Equity':       'var(--lf-data-4)',
  'International Equity': 'var(--lf-data-4)',
  'Bonds':             'var(--lf-data-2)',
  'Fixed Income':      'var(--lf-data-2)',
  'REITs':             'var(--lf-data-5)',
  'Real Estate':       'var(--lf-data-5)',
  'Alt':               'var(--lf-data-3)',
  'Alternative':       'var(--lf-data-3)',
  'Commodity':         'var(--lf-data-3)',
  'Cash':              'var(--lf-muted)',
  'Cash & Equivalents':'var(--lf-muted)',
};

const FALLBACK_COLORS = [
  'var(--lf-data-1)', 'var(--lf-data-2)', 'var(--lf-data-3)',
  'var(--lf-data-4)', 'var(--lf-data-5)', 'var(--lf-muted)',
  'var(--lf-ink-soft)', 'var(--lf-crust)',
];

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

// Abbreviate verbose asset-class labels for the composition ribbon.
function abbreviateClassLabel(name: string): string {
  return name
    .replace(/^INTERNATIONAL\s+STOCKS$/i, "INT'L STOCKS")
    .replace(/^INTERNATIONAL\s+/i, "INT'L ");
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

  return (
    <svg width={280} height={280} viewBox="0 0 280 280" style={{ flexShrink: 0, cursor: 'pointer' }}>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.color}
          opacity={hovered === null ? 0.92 : hovered === i ? 1 : 0.5}
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
          <text x={cx} y={cy - 18} textAnchor="middle" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', fill: 'var(--lf-muted)' }}>
            {hp.name}
          </text>
          <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontFamily: "'Geist', system-ui, sans-serif", fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', fontSize: 22, fill: 'var(--lf-ink)' }}>
            {formatMoney(hp.value, true)}
          </text>
          <text x={cx} y={cy + 22} textAnchor="middle" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fill: hp.color }}>
            {hp.pct.toFixed(1)}%
          </text>
        </>
      ) : (
        <>
          <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontFamily: "'Geist', system-ui, sans-serif", fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', fontSize: 26, fill: 'var(--lf-ink)' }}>
            {formatMoney(total, true)}
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', fill: 'var(--lf-muted)' }}>
            Total
          </text>
        </>
      )}
    </svg>
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

function FilterDropdown({
  label: triggerLabel,
  allLabel,
  options,
  activeSet,
  onToggle,
  onSelectAll,
  renderOption,
}: {
  label: string;
  allLabel: string;
  options: string[];
  activeSet: Set<string> | null;
  onToggle: (value: string) => void;
  onSelectAll: () => void;
  renderOption?: (value: string) => React.ReactNode;
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

  const allActive = activeSet === null;
  const activeCount = allActive ? options.length : activeSet.size;
  const displayLabel = allActive ? triggerLabel : `${triggerLabel}: ${activeCount}`;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="ds-btn ds-btn--ghost ds-btn--sm"
        style={{ gap: 6 }}
      >
        {displayLabel}
        <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          background: 'var(--lf-paper)', border: '1px solid var(--lf-rule)',
          borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          zIndex: 50, minWidth: 200, maxHeight: 320, overflowY: 'auto',
          padding: '6px 0',
        }}>
          <button
            onClick={() => { onSelectAll(); setOpen(false); }}
            style={{
              width: '100%', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10,
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
              color: 'var(--lf-ink)', textAlign: 'left',
              fontFamily: 'Geist, system-ui, sans-serif',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--lf-cream)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <Checkbox checked={allActive} />
            <span style={{ fontWeight: 600 }}>{allLabel}</span>
          </button>
          <div style={{ height: 1, background: 'var(--lf-rule)', margin: '4px 0' }} />
          {options.map(value => {
            const checked = activeSet === null || activeSet.has(value);
            return (
              <button
                key={value}
                onClick={() => onToggle(value)}
                style={{
                  width: '100%', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10,
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 13,
                  color: 'var(--lf-ink)', textAlign: 'left',
                  fontFamily: 'Geist, system-ui, sans-serif',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--lf-cream)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <Checkbox checked={checked} />
                {renderOption ? renderOption(value) : (
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  return (
    <FilterDropdown
      label="Accounts"
      allLabel="All accounts"
      options={accounts}
      activeSet={activeAccounts}
      onToggle={onToggle}
      onSelectAll={onSelectAll}
      renderOption={name => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{name}</span>
          {accountTypeMap.has(name) && (
            <span style={{
              fontSize: 11, padding: '1px 6px', borderRadius: 4,
              background: 'var(--lf-cream)', color: 'var(--lf-muted)',
              border: '1px solid var(--lf-rule)', flexShrink: 0,
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {ACCOUNT_TYPE_LABELS[accountTypeMap.get(name)!] ?? accountTypeMap.get(name)}
            </span>
          )}
        </span>
      )}
    />
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span style={{
      width: 16, height: 16, borderRadius: 4, flexShrink: 0,
      border: `2px solid ${checked ? 'var(--lf-sauce)' : 'var(--lf-rule)'}`,
      background: checked ? 'var(--lf-sauce)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.12s',
    }}>
      {checked && (
        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
          <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
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
            depository: 'var(--lf-basil)',
            investment: 'var(--lf-sauce)',
            credit: 'var(--lf-burgundy)',
            loan: 'var(--lf-cheese)',
            real_estate: 'var(--lf-noodle)',
            alternative: 'var(--lf-crust)',
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
            color: ACCT_COLORS[a.type] || 'var(--lf-muted)',
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
    // Iter 7 D: cached shell. Matches the loaded layout — page-bar + donut +
    // 6 holding rows — so first paint reserves space without jolt.
    return (
      <Page>
        <header className="ds-page-bar">
          <div className="ds-page-bar__title-group">
            <h1 className="ds-page-bar__title">Portfolio</h1>
            <SkeletonLine width="180px" height={12} style={{ marginTop: 4 }} />
          </div>
        </header>
        <div style={{ marginBottom: 28 }}>
          <SkeletonChart height={240} />
        </div>
        <Section>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </Section>
      </Page>
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
      <Page>
        <header className="ds-page-bar">
          <div className="ds-page-bar__title-group">
            <h1 className="ds-page-bar__title">Portfolio</h1>
            <span className="ds-page-bar__subtitle">
              {formatMoney(accountTotal, true)} · {accountAllocation.length} account{accountAllocation.length === 1 ? '' : 's'} · no holdings yet
            </span>
          </div>
        </header>
        <div className="ds-page-bar__subtitle-mobile">
          {formatMoney(accountTotal, true)} · {accountAllocation.length} account{accountAllocation.length === 1 ? '' : 's'} · no holdings yet
        </div>

        <Section title="Asset allocation">
          <Card>
            <div className="ds-portfolio-grid">
              <div className="ds-portfolio-grid__chart">
                <PortfolioDonut slices={acctSlices} total={accountTotal} />
              </div>
              <div className="ds-portfolio-grid__legend">
                {accountAllocation.map(acct => (
                  <div key={acct.name} className="ds-portfolio-legend-row">
                    <span className="ds-portfolio-legend-dot" style={{ background: acct.color }} />
                    <div className="ds-portfolio-legend-text">
                      <div className="ds-portfolio-legend-name">{acct.name}</div>
                      <div className="ds-portfolio-legend-meta ds-num">
                        {acct.percentage.toFixed(1)}% · {formatMoney(acct.value, true)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </Section>

        <Section>
          <EmptyState
            icon={<Building2 size={28} />}
            title="Link an investment account"
            body="Connect a brokerage via Plaid to see individual holdings and ticker-level analysis."
            cta={
              <Button variant="ink" icon={<Plus size={14} />} onClick={() => setLocation('/accounts')}>
                Link investment account
              </Button>
            }
          />
        </Section>

        <PortfolioStyles />
      </Page>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty — no accounts at all
  // ---------------------------------------------------------------------------

  if (assetClasses.length === 0) {
    return (
      <Page>
        <header className="ds-page-bar">
          <div className="ds-page-bar__title-group">
            <h1 className="ds-page-bar__title">Portfolio</h1>
            <span className="ds-page-bar__caption">No accounts linked</span>
          </div>
        </header>
        <Section>
          <EmptyState
            icon={<Building2 size={32} />}
            title="No holdings found"
            body="Connect your investment accounts to see your portfolio composition and asset allocation."
            cta={
              <Button variant="ink" icon={<Plus size={14} />} onClick={() => setLocation('/accounts')}>
                Link account
              </Button>
            }
          />
        </Section>
      </Page>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render — full holdings view
  // ---------------------------------------------------------------------------

  // ── Composition ribbon: enumerate every asset class. If the backend
  // returned a class literally named "Other", drill in and replace it with
  // its constituent holdings so the bar never shows the word "Other".
  // CompositionRibbon owns the palette so `color` here is ignored.
  const ribbonSegments: CompositionSegment[] = [...filteredAssetClasses]
    .sort((a, b) => b.value - a.value)
    .flatMap<CompositionSegment>((ac, i) => {
      if (/^other$/i.test(ac.name.trim())) {
        const holdings = (ac.categories ?? [])
          .flatMap((sc) => sc.holdings)
          .filter((h) => h.value > 0)
          .sort((a, b) => b.value - a.value);
        if (holdings.length > 0) {
          return holdings.map((h) => ({
            label: holdingLabel(h),
            value: h.value,
            color: '',
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

  return (
    <Page>
      {/* Iter 8 P1: title-only H1 + subtitle slot. Money never lives in the
          H1, so mobile (<520px) shows only "Portfolio" while desktop and the
          dropped-below mobile sub-row carry the dollar total. */}
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Portfolio</h1>
          <span className="ds-page-bar__subtitle ds-num">
            {formatMoney(filteredTotal, true)} · {positionCount} position{positionCount !== 1 ? 's' : ''} · {accountCount} account{accountCount !== 1 ? 's' : ''}
            {blendedReturn !== null && (
              <>
                {'  ·  '}
                <span className={blendedReturn >= 0 ? 'ds-pos' : 'ds-neg'}>
                  {blendedReturn.toFixed(1)}% blended return
                </span>
              </>
            )}
          </span>
        </div>
      </header>
      <div className="ds-page-bar__subtitle-mobile ds-num">
        {formatMoney(filteredTotal, true)} · {positionCount} position{positionCount !== 1 ? 's' : ''} · {accountCount} account{accountCount !== 1 ? 's' : ''}
        {blendedReturn !== null && (
          <>
            {'  ·  '}
            <span className={blendedReturn >= 0 ? 'ds-pos' : 'ds-neg'}>
              {blendedReturn.toFixed(1)}% blended return
            </span>
          </>
        )}
      </div>

      {/* Composition ribbon */}
      {ribbonSegments.length > 0 && (
        <Section>
          <CompositionRibbon
            leadDelta={`${positionCount} position${positionCount === 1 ? '' : 's'}`}
            segments={ribbonSegments}
            groupBelowPct={2}
          />
        </Section>
      )}

      {/* Stat strip */}
      <StatStrip
        className="ds-portfolio-stats"
        items={[
          { label: 'Total value', value: formatMoney(filteredTotal) },
          {
            label: 'Blended return',
            value: blendedReturn !== null ? `${blendedReturn.toFixed(1)}%` : '—',
            sub: blendedReturn !== null ? 'per year' : 'unavailable',
            tone: blendedReturn !== null && blendedReturn >= 0 ? 'pos' : 'default',
          },
          {
            label: 'Positions',
            value: String(positionCount),
            sub: `${accountCount} account${accountCount === 1 ? '' : 's'}`,
          },
          ...(biggestHolding
            ? [{
                label: 'Largest holding',
                value: biggestHolding.ticker,
                sub: `${biggestHolding.percentage.toFixed(1)}% · ${formatMoney(biggestHolding.totalValue, true)}`,
              }]
            : []),
        ]}
      />

      {/* ── Insights (preserved) ── */}
      <PageActions types="portfolio" />

      {/* ── Asset allocation chart ── */}
      <Section
        title="Asset allocation"
        eyebrow={
          drillLevel1 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => setDrillLevel1(null)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--lf-ink-soft)', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                {labelFor(groupBy)}
              </button>
              <ChevronRight size={11} />
              <span style={{ color: 'var(--lf-ink)' }}>{drillLevel1}</span>
            </span>
          ) : undefined
        }
        actions={
          <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
            {(['assetClass', 'category', 'holding', 'account'] as GroupBy[]).map((g) => (
              <button
                key={g}
                onClick={() => handleGroupByChange(g)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Pill tone={groupBy === g ? 'ink' : 'ghost'}>{labelFor(g)}</Pill>
              </button>
            ))}
          </div>
        }
      >
        {/* Filter row */}
        {allAccounts.length > 1 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <Eyebrow>Account</Eyebrow>
            <AccountFilterDropdown
              accounts={allAccounts}
              activeAccounts={activeAccounts}
              accountTypeMap={accountTypeMap}
              onToggle={toggleAccount}
              onSelectAll={selectAllAccounts}
            />
          </div>
        )}

        <Card>
          <AnimatePresence mode="wait">
            <motion.div
              key={`${groupBy}-${drillLevel1}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <div className="ds-portfolio-grid">
                <div className="ds-portfolio-grid__chart">
                  <PortfolioDonut
                    slices={chartSlices}
                    total={drillLevel1
                      ? chartSlices.reduce((s, sl) => s + sl.value, 0)
                      : filteredTotal}
                    onSliceClick={handleSliceClick}
                  />
                </div>
                <div className="ds-portfolio-grid__legend">
                  {chartSlices.slice(0, 10).map(sl => {
                    const isActive = drillLevel1 === sl.name;
                    return (
                      <button
                        key={sl.name}
                        onClick={() => handleSliceClick(sl.name)}
                        className={`ds-portfolio-legend-row ds-portfolio-legend-btn${isActive ? ' is-active' : ''}`}
                      >
                        <span className="ds-portfolio-legend-dot" style={{ background: sl.color }} />
                        <div className="ds-portfolio-legend-text">
                          <div className="ds-portfolio-legend-name">{sl.name}</div>
                          <div className="ds-portfolio-legend-meta ds-num">
                            {sl.pct.toFixed(1)}% · {formatMoney(sl.value, true)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </Card>
      </Section>

      {/* ── Holdings — HoldingRow primitive built on `.ds-row`.
          Mobile rule (iter 2 P0): value, %, and historical return ALL stay
          visible. Ticker is the primary line, class+account is the eyebrow,
          right-rail shows value + %, with hist.ret as a delta under the value. */}
      <Section
        title="Holdings"
        eyebrow={`${holdingsByTicker.length} position${holdingsByTicker.length === 1 ? '' : 's'}`}
      >
        <Card flush>
          {holdingsByTicker.length === 0 ? (
            <div className="ds-caption" style={{ padding: '32px 16px', textAlign: 'center' }}>
              No holdings match the current filter.
            </div>
          ) : (
            holdingsByTicker.map((h) => {
              const isOther = /^other$/i.test(h.assetClass.trim());
              const classLabel = isOther && h.category ? h.category : h.assetClass;
              const account = cleanAccountLabel(h.accountLabel);
              const meta = `${classLabel}${account ? ` · ${account}` : ''}`;
              const issuerDomain = tickerToIssuer(h.ticker);
              const tickerIcon = faviconUrl(issuerDomain, 64);
              return (
                <div key={h.ticker} className="ds-row ds-row--holding">
                  <Favicon icon={tickerIcon} monogram={h.ticker.slice(0, 2).toUpperCase()} alt={h.ticker} size={28} />
                  <div className="ds-row__main">
                    <div className="ds-row__primary" title={h.ticker}>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>{h.ticker}</span>
                    </div>
                    <div className="ds-row__meta" title={meta}>{meta}</div>
                  </div>
                  <div className="ds-row__right">
                    <span className="ds-row__value ds-num">{formatMoney(h.totalValue, true)}</span>
                    <span className="ds-row__delta ds-num">
                      {h.percentage.toFixed(1)}%
                      {h.historicalReturn !== null && (
                        <>
                          {'  ·  '}
                          <span className={h.historicalReturn >= 0 ? 'ds-pos' : 'ds-neg'}>
                            {h.historicalReturn.toFixed(1)}%
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </Card>
      </Section>

      <PortfolioStyles />
    </Page>
  );
}

// Iter 7 F: sentence-case lowercase so eyebrow ("by asset class") + pill
// chip labels read with the same voice across the page.
function labelFor(g: GroupBy): string {
  return g === 'assetClass' ? 'asset class'
    : g === 'category' ? 'category'
    : g === 'holding' ? 'holdings'
    : 'account';
}

function PortfolioStyles() {
  return (
    <style>{`
      .ds-portfolio-stats { margin: 32px 0 56px; }
      .ds-portfolio-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 32px;
        align-items: center;
      }
      .ds-portfolio-grid__chart {
        display: flex;
        justify-content: center;
        min-width: 0;
      }
      .ds-portfolio-grid__legend {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 10px;
        min-width: 0;
      }
      @media (max-width: 640px) {
        .ds-portfolio-grid__legend {
          grid-template-columns: 1fr;
        }
        /* P2 — composition ribbon legend: 1 column on mobile */
        .ds-comp-ribbon__legend,
        .ds-comp__legend {
          grid-template-columns: 1fr !important;
        }
      }
      .ds-portfolio-legend-btn {
        background: none;
        border: 0;
        padding: 8px 6px;
        margin: -8px -6px;
        cursor: pointer;
        text-align: left;
        width: 100%;
        border-radius: 6px;
        min-height: 44px;
        transition: background 0.12s;
      }
      .ds-portfolio-legend-btn:hover {
        background: var(--lf-cream);
      }
      .ds-portfolio-legend-btn.is-active {
        background: var(--lf-cream);
        outline: 2px solid var(--lf-sauce);
        outline-offset: -2px;
      }
      @media (min-width: 820px) {
        .ds-portfolio-grid {
          grid-template-columns: 280px minmax(0, 1fr);
          gap: 40px;
          align-items: center;
        }
      }
      .ds-portfolio-legend-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .ds-portfolio-legend-dot {
        width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
      }
      .ds-portfolio-legend-text { min-width: 0; flex: 1; }
      .ds-portfolio-legend-name {
        font-family: 'Geist', system-ui, sans-serif;
        font-size: 13px; font-weight: 600;
        color: var(--lf-ink);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .ds-portfolio-legend-meta {
        font-family: 'Geist', system-ui, sans-serif;
        font-size: 12px; color: var(--lf-muted);
      }
    `}</style>
  );
}
