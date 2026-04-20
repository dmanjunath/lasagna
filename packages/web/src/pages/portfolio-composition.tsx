import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Building2 } from 'lucide-react';
import { formatMoney } from '../lib/utils';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { useLocation } from 'wouter';
import { PageActions } from '../components/common/page-actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChartType = 'donut' | 'bar' | 'treemap';
type GroupBy = 'assetClass' | 'subCategory' | 'holding' | 'account';

interface AssetClass {
  name: string;
  value: number;
  percentage: number;
  color: string;
  subCategories: SubCategory[];
}

interface SubCategory {
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

const ASSET_CLASS_COLORS: Record<string, string> = {
  'US Equity':         'var(--lf-sauce)',
  'Intl Equity':       'var(--lf-cheese)',
  'International Equity': 'var(--lf-cheese)',
  'Bonds':             'var(--lf-basil)',
  'Fixed Income':      'var(--lf-basil)',
  'REITs':             'var(--lf-noodle)',
  'Real Estate':       'var(--lf-noodle)',
  'Alt':               'var(--lf-crust)',
  'Alternative':       'var(--lf-crust)',
  'Commodity':         'var(--lf-crust)',
  'Cash':              '#8B7E6F',
  'Cash & Equivalents':'#8B7E6F',
};

const FALLBACK_COLORS = [
  'var(--lf-sauce)', 'var(--lf-cheese)', 'var(--lf-basil)',
  'var(--lf-noodle)', 'var(--lf-crust)', '#8B7E6F',
  'var(--lf-burgundy)', 'var(--lf-muted)',
];

function colorForAssetClass(name: string, index: number): string {
  return ASSET_CLASS_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
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
          <text x={cx} y={cy - 18} textAnchor="middle" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: '0.08em', fill: 'var(--lf-muted)' }}>
            {hp.name.toUpperCase()}
          </text>
          <text x={cx} y={cy + 4} textAnchor="middle" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 19, fill: 'var(--lf-ink)' }}>
            {formatMoney(hp.value, true)}
          </text>
          <text x={cx} y={cy + 20} textAnchor="middle" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fill: hp.color }}>
            {hp.pct.toFixed(1)}%
          </text>
        </>
      ) : (
        <>
          <text x={cx} y={cy - 8} textAnchor="middle" style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fill: 'var(--lf-ink)' }}>
            {formatMoney(total, true)}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.1em', fill: 'var(--lf-muted)' }}>
            TOTAL
          </text>
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SVG Stacked bar
// ---------------------------------------------------------------------------

function PortfolioBar({
  slices,
  onSliceClick,
}: {
  slices: DonutSlice[];
  onSliceClick?: (name: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const W = 640;
  const H = 56;
  const R = 10;

  let xPos = 0;
  const rects: { x: number; w: number; color: string; name: string; pct: number; value: number }[] = [];
  for (const s of slices) {
    if (s.pct <= 0) continue;
    const w = (s.pct / 100) * W;
    rects.push({ x: xPos, w, color: s.color, name: s.name, pct: s.pct, value: s.value });
    xPos += w;
  }

  const hr = hovered !== null ? rects[hovered] : null;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H + (hr ? 32 : 0)}`}
      style={{ borderRadius: R, overflow: 'visible', display: 'block' }}
    >
      {rects.map((rect, i) => (
        <rect
          key={i}
          x={rect.x}
          y={0}
          width={rect.w}
          height={H}
          fill={rect.color}
          opacity={hovered === null ? 0.9 : hovered === i ? 1 : 0.5}
          style={{ cursor: onSliceClick ? 'pointer' : 'default', transition: 'opacity 0.15s' }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          onTouchStart={() => setHovered(hovered === i ? null : i)}
          onClick={() => onSliceClick?.(rect.name)}
        />
      ))}
      {hr && (
        <g>
          <rect x={Math.min(hr.x + hr.w / 2 - 60, W - 130)} y={H + 6} width={128} height={22} rx={5} fill="var(--lf-ink)" />
          <text
            x={Math.min(hr.x + hr.w / 2 - 60, W - 130) + 8}
            y={H + 21}
            fontFamily="'JetBrains Mono', monospace"
            fontSize="10"
            fill="var(--lf-paper)"
          >
            {hr.name} · {hr.pct.toFixed(1)}% · {formatMoney(hr.value, true)}
          </text>
        </g>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

interface TreeNode { name: string; value: number; pct: number; color: string }

function layoutTreemap(
  nodes: TreeNode[],
  x: number,
  y: number,
  w: number,
  h: number,
): Array<TreeNode & { x: number; y: number; w: number; h: number }> {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ ...nodes[0], x, y, w, h }];

  const sorted = [...nodes].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, n) => s + n.value, 0);

  const splitAt = Math.ceil(sorted.length / 2);
  const group1 = sorted.slice(0, splitAt);
  const group2 = sorted.slice(splitAt);

  const g1Sum = group1.reduce((s, n) => s + n.value, 0);
  const g1Ratio = total > 0 ? g1Sum / total : 0.5;

  const gap = 3;

  if (w >= h) {
    const w1 = Math.max(0, w * g1Ratio - gap / 2);
    const w2 = Math.max(0, w - w1 - gap);
    return [
      ...layoutTreemap(group1, x, y, w1, h),
      ...layoutTreemap(group2, x + w1 + gap, y, w2, h),
    ];
  } else {
    const h1 = Math.max(0, h * g1Ratio - gap / 2);
    const h2 = Math.max(0, h - h1 - gap);
    return [
      ...layoutTreemap(group1, x, y, w, h1),
      ...layoutTreemap(group2, x, y + h1 + gap, w, h2),
    ];
  }
}

function PortfolioTreemap({
  slices,
  onSliceClick,
}: {
  slices: DonutSlice[];
  onSliceClick?: (name: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const W = 640;
  const H = 360;
  const cells = layoutTreemap(slices, 0, 0, W, H);
  const hc = hovered !== null ? cells[hovered] : null;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block' }}
    >
      {cells.map((cell, i) => {
        const isHov = hovered === i;
        return (
          <g key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onTouchStart={() => setHovered(hovered === i ? null : i)}
            onClick={() => onSliceClick?.(cell.name)}
            style={{ cursor: onSliceClick ? 'pointer' : 'default' }}
          >
            <rect
              x={cell.x}
              y={cell.y}
              width={cell.w}
              height={cell.h}
              rx={6}
              fill={cell.color}
              opacity={hovered === null ? 0.88 : isHov ? 1 : 0.55}
              style={{ transition: 'opacity 0.15s' }}
            />
            {cell.w > 70 && cell.h > 36 && (
              <>
                <text
                  x={cell.x + 10}
                  y={cell.y + 22}
                  style={{
                    fontFamily: "'Geist', system-ui, sans-serif",
                    fontSize: Math.min(13, cell.w / 6),
                    fontWeight: 600,
                    fill: 'rgba(251,246,236,0.95)',
                    pointerEvents: 'none',
                  }}
                >
                  {cell.name.length > 14 ? cell.name.slice(0, 13) + '…' : cell.name}
                </text>
                {cell.h > 52 && (
                  <text
                    x={cell.x + 10}
                    y={cell.y + 38}
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: Math.min(11, cell.w / 7),
                      fill: 'rgba(251,246,236,0.7)',
                      pointerEvents: 'none',
                    }}
                  >
                    {cell.pct.toFixed(1)}%
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}
      {/* Hover tooltip for small cells or additional detail */}
      {hc !== null && (
        <g style={{ pointerEvents: 'none' }}>
          <rect
            x={Math.min(hc.x + 4, W - 180)}
            y={Math.max(hc.y + 4, 0)}
            width={174}
            height={42}
            rx={6}
            fill="var(--lf-ink)"
            opacity={0.95}
          />
          <text
            x={Math.min(hc.x + 12, W - 172)}
            y={Math.max(hc.y + 20, 16)}
            fontFamily="'Geist', system-ui, sans-serif"
            fontSize="11"
            fontWeight="600"
            fill="var(--lf-paper)"
          >
            {hc.name}
          </text>
          <text
            x={Math.min(hc.x + 12, W - 172)}
            y={Math.max(hc.y + 35, 31)}
            fontFamily="'JetBrains Mono', monospace"
            fontSize="10"
            fill="var(--lf-cheese)"
          >
            {formatMoney(hc.value, true)} · {hc.pct.toFixed(1)}%
          </text>
        </g>
      )}
    </svg>
  );
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: 'var(--lf-paper)',
  border: '1px solid var(--lf-rule)',
  borderRadius: 14,
};

const darkCard: React.CSSProperties = {
  background: 'var(--lf-ink)',
  color: 'var(--lf-paper)',
  borderRadius: 14,
};

const pill = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '5px 14px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  border: active ? '1px solid var(--lf-ink)' : '1px solid var(--lf-rule)',
  background: active ? 'var(--lf-ink)' : 'transparent',
  color: active ? 'var(--lf-paper)' : 'var(--lf-muted)',
  transition: 'all 0.15s',
});

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
  }>>([]);
  const [accountAllocation, setAccountAllocation] = useState<Array<{
    name: string; value: number; percentage: number; color: string;
  }>>([]);
  const [accountTotal, setAccountTotal] = useState(0);
  const [filingStatus, setFilingStatus] = useState<string | null>(null);

  // ── UI state ──
  const [chartType, setChartType] = useState<ChartType>('donut');
  const [groupBy, setGroupBy] = useState<GroupBy>('assetClass');
  const [drillLevel1, setDrillLevel1] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  // Account filter pills: set of account names to SHOW (null = show all)
  const [activeAccounts, setActiveAccounts] = useState<Set<string> | null>(null);


  // ---------------------------------------------------------------------------
  // Data fetching (preserved from original)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [compData, expData, balanceData, profileData] = await Promise.all([
          api.getPortfolioComposition(),
          api.getPortfolioExposure().catch(() => null),
          api.getBalances().catch(() => ({ balances: [] })),
          api.getFinancialProfile().catch(() => ({ financialProfile: null })),
        ]);

        if (profileData.financialProfile?.filingStatus) {
          setFilingStatus(profileData.financialProfile.filingStatus);
        }
        setTotalValue(compData.totalValue);
        setAssetClasses(compData.assetClasses);

        if (compData.assetClasses.length > 0) {
          setExpandedRows({ [compData.assetClasses[0].name]: true });
        }

        if (expData) {
          setBlendedReturn(expData.blendedReturn);
          setExposures(expData.exposures);
        }

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
          const accts = balanceData.balances
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
        description: 'Shows portfolio allocation across asset classes, sub-categories, and individual holdings.',
        data: {
          totalValue,
          blendedHistoricalReturn: blendedReturn,
          filingStatus,
          assetClasses: assetClasses.map(ac => ({
            name: ac.name,
            value: ac.value,
            percentage: ac.percentage,
            subCategories: ac.subCategories.map(sc => ({
              name: sc.name,
              value: sc.value,
              percentage: sc.percentage,
            })),
          })),
        },
      });
    }
  }, [loading, totalValue, assetClasses, filingStatus, setPageContext, blendedReturn]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  // All unique account names across all holdings
  const allAccounts = useMemo(() => {
    const names = new Set<string>();
    for (const ac of assetClasses) {
      for (const sc of ac.subCategories) {
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
      subCategories: ac.subCategories.map(sc => ({
        ...sc,
        holdings: sc.holdings.filter(h => activeAccounts.has(h.account)),
      })).filter(sc => sc.holdings.length > 0),
    })).filter(ac => ac.subCategories.length > 0);
  }, [assetClasses, activeAccounts]);

  const filteredTotal = useMemo(
    () => filteredAssetClasses.reduce((s, ac) => s + ac.value, 0) || totalValue,
    [filteredAssetClasses, totalValue],
  );

  // Holdings grouped by ticker
  const holdingsByTicker = useMemo(() => {
    const tickerMap = new Map<string, { holdings: Holding[]; totalValue: number; totalShares: number; assetClass: string; subCategory: string }>();
    let idx = 0;
    for (const ac of filteredAssetClasses) {
      for (const sc of ac.subCategories) {
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
              subCategory: sc.name,
            });
            idx++;
          }
        }
      }
    }
    return Array.from(tickerMap.entries())
      .map(([ticker, data], i) => ({
        ticker,
        ...data,
        color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        percentage: filteredTotal > 0 ? (data.totalValue / filteredTotal) * 100 : 0,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [filteredAssetClasses, filteredTotal]);

  // All sub-categories flat list
  const allSubCategories = useMemo(() => {
    const result: { name: string; value: number; percentage: number; color: string; holdings: Holding[] }[] = [];
    let ci = 0;
    for (const ac of filteredAssetClasses) {
      for (const sc of ac.subCategories) {
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
        const holdings: Holding[] = ac?.subCategories.flatMap(sc => sc.holdings) ?? [];
        return holdings
          .map((h, i) => ({
            name: h.ticker,
            value: h.value,
            pct: acTotal > 0 ? (h.value / acTotal) * 100 : 0,
            color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
          }))
          .sort((a, b) => b.value - a.value);
      }
      return filteredAssetClasses.map((ac, i) => ({
        name: ac.name,
        value: ac.value,
        pct: ac.percentage,
        color: colorForAssetClass(ac.name, i),
      }));
    }

    if (groupBy === 'subCategory') {
      if (drillLevel1) {
        const sc = allSubCategories.find(s => s.name === drillLevel1);
        const scTotal = sc?.holdings.reduce((s, h) => s + h.value, 0) || 0;
        return (sc?.holdings ?? []).map((h, i) => ({
          name: h.ticker,
          value: h.value,
          pct: scTotal > 0 ? (h.value / scTotal) * 100 : 0,
          color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
        }));
      }
      return allSubCategories.map(sc => ({
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
      for (const sc of ac.subCategories) {
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
  }, [groupBy, drillLevel1, filteredAssetClasses, allSubCategories, holdingsByTicker, filteredTotal]);

  // Portfolio beta — DATA-NEEDED: no beta field from API
  // DATA-NEEDED: portfolioBeta from getPortfolioExposure or separate endpoint
  const portfolioBeta: number = 0;

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  const toggleAccount = (name: string) => {
    setActiveAccounts(prev => {
      if (prev === null) {
        // Start filtering: exclude this one
        const next = new Set(allAccounts.filter(a => a !== name));
        return next.size === allAccounts.length ? null : next;
      }
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
        if (next.size === 0) return new Set(allAccounts); // re-enable all
      } else {
        next.add(name);
        if (next.size === allAccounts.length) return null; // back to "all"
      }
      return next;
    });
  };

  const isAccountActive = (name: string) => activeAccounts === null || activeAccounts.has(name);

  const handleSliceClick = (name: string) => {
    if (!drillLevel1) setDrillLevel1(name);
  };

  const toggleRow = (key: string) =>
    setExpandedRows(prev => ({ ...prev, [key]: !prev[key] }));

  const handleGroupByChange = (g: GroupBy) => {
    setGroupBy(g);
    setDrillLevel1(null);
  };

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    const root =
      groupBy === 'assetClass' ? 'Asset Class'
      : groupBy === 'subCategory' ? 'Sub-Category'
      : groupBy === 'holding' ? 'Holdings'
      : 'Account';
    return drillLevel1 ? [root, drillLevel1] : [root];
  }, [groupBy, drillLevel1]);

  // Count positions & accounts
  const positionCount = holdingsByTicker.length;
  const accountCount = allAccounts.length;

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="lf-mark" style={{ margin: '0 auto 16px' }}>
            <span /><span /><span />
          </div>
          <p className="lf-eyebrow">Loading portfolio…</p>
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
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          style={{ ...darkCard, padding: '32px 36px', marginBottom: 20 }}
        >
          <p className="lf-eyebrow" style={{ color: 'var(--lf-cheese)', marginBottom: 8 }}>
            Portfolio · {accountAllocation.length} accounts
          </p>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 38, lineHeight: 1.1, marginBottom: 4 }}>
            Every holding, <em>classified.</em>
          </div>
          <p style={{ color: 'var(--lf-muted)', fontSize: 14, marginTop: 8 }}>
            No individual holdings found — showing account-level balances.
          </p>
        </motion.div>

        {/* Donut + list */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          style={{ ...card, padding: 28, marginBottom: 20 }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 32 }}>
            <PortfolioDonut slices={acctSlices} total={accountTotal} />
            <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {accountAllocation.map(acct => (
                <div key={acct.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: acct.color, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--lf-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acct.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {acct.percentage.toFixed(1)}% · {formatMoney(acct.value, true)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          style={{ ...card, padding: 24, textAlign: 'center' }}
        >
          <p style={{ color: 'var(--lf-muted)', fontSize: 14, marginBottom: 16 }}>
            Link investment accounts via Plaid to see individual holdings and ticker-level analysis.
          </p>
          <button className="lf-btn lf-btn-primary" onClick={() => setLocation('/accounts')}>
            <Plus size={14} />
            Link Investment Account
          </button>
        </motion.div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty — no accounts at all
  // ---------------------------------------------------------------------------

  if (assetClasses.length === 0) {
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          style={{ ...card, padding: 48, textAlign: 'center', maxWidth: 520, margin: '0 auto' }}
        >
          <Building2 size={48} style={{ color: 'var(--lf-muted)', margin: '0 auto 20px' }} />
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 28, marginBottom: 12 }}>
            No holdings found
          </div>
          <p style={{ color: 'var(--lf-muted)', fontSize: 14, marginBottom: 24 }}>
            Connect your investment accounts to see your portfolio composition and asset allocation.
          </p>
          <button className="lf-btn lf-btn-primary" onClick={() => setLocation('/accounts')}>
            <Plus size={14} />
            Link Account
          </button>
        </motion.div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render — full holdings view
  // ---------------------------------------------------------------------------

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(16px, 4vw, 32px)', paddingBottom: 'clamp(80px, 12vw, 48px)' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Page Header ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <p className="lf-eyebrow" style={{ marginBottom: 6 }}>
            Portfolio · {positionCount} position{positionCount !== 1 ? 's' : ''} across {accountCount} account{accountCount !== 1 ? 's' : ''}
          </p>
          <h1 style={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 'clamp(32px, 5vw, 48px)',
            fontWeight: 400,
            lineHeight: 1.1,
            color: 'var(--lf-ink)',
            margin: 0,
          }}>
            Every holding, <em>classified.</em>
          </h1>
        </motion.div>

        {/* ── Hero dark card: totals ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 }}
          style={{ ...darkCard, padding: '28px 32px' }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' }}>
            {/* Total value */}
            <div style={{ flex: '1 1 180px' }}>
              <p style={{ color: 'var(--lf-muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                Total Portfolio Value
              </p>
              <div style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 'clamp(36px, 5vw, 52px)',
                fontWeight: 400,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {formatMoney(filteredTotal)}
              </div>
            </div>

            {/* Blended return */}
            <div style={{ flex: '0 0 auto', minWidth: 120 }}>
              <p style={{ color: 'var(--lf-muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                Blended Hist. Return
              </p>
              <div style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 32,
                color: blendedReturn !== null ? 'var(--lf-cheese)' : 'var(--lf-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {blendedReturn !== null ? `${blendedReturn.toFixed(1)}%` : '—'}
              </div>
              <p style={{ fontSize: 11, color: 'var(--lf-muted)', marginTop: 2 }}>per year</p>
            </div>

            {/* Portfolio beta */}
            <div style={{ flex: '0 0 auto', minWidth: 100 }}>
              <p style={{ color: 'var(--lf-muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                Beta (vs S&amp;P)
              </p>
              {/* DATA-NEEDED: portfolio beta from API */}
              <div style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 32,
                color: portfolioBeta === 0 ? 'var(--lf-muted)' : 'var(--lf-paper)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {portfolioBeta === 0 ? '—' : portfolioBeta.toFixed(2)}
              </div>
              <p style={{ fontSize: 11, color: 'var(--lf-muted)', marginTop: 2 }}>market sensitivity</p>
            </div>
          </div>
        </motion.div>

        {/* ── Account filter pills ── */}
        {allAccounts.length > 1 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
          >
            <span style={{ fontSize: 11, color: 'var(--lf-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginRight: 4 }}>
              Accounts
            </span>
            {allAccounts.map(name => (
              <button
                key={name}
                onClick={() => toggleAccount(name)}
                style={pill(isAccountActive(name))}
              >
                {name}
              </button>
            ))}
          </motion.div>
        )}

        {/* ── Chart card ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
          style={{ ...card, padding: 28 }}
        >
          {/* Controls row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 20 }}>
            {/* Group by pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['assetClass', 'subCategory', 'holding', 'account'] as GroupBy[]).map(g => {
                const labels: Record<GroupBy, string> = {
                  assetClass: 'Asset Class',
                  subCategory: 'Sub-Category',
                  holding: 'Holdings',
                  account: 'Account',
                };
                return (
                  <button
                    key={g}
                    onClick={() => handleGroupByChange(g)}
                    style={pill(groupBy === g)}
                  >
                    {labels[g]}
                  </button>
                );
              })}
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Chart type */}
            <div style={{ display: 'flex', gap: 6 }}>
              {(['donut', 'bar', 'treemap'] as ChartType[]).map(ct => {
                const icons: Record<ChartType, string> = { donut: 'Donut', bar: 'Bar', treemap: 'Map' };
                return (
                  <button
                    key={ct}
                    onClick={() => setChartType(ct)}
                    style={pill(chartType === ct)}
                  >
                    {icons[ct]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Breadcrumb */}
          {breadcrumbs.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, fontSize: 13 }}>
              <button
                onClick={() => setDrillLevel1(null)}
                style={{ color: 'var(--lf-sauce)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500 }}
              >
                {breadcrumbs[0]}
              </button>
              <span style={{ color: 'var(--lf-muted)' }}>›</span>
              <span style={{ color: 'var(--lf-ink)', fontWeight: 600 }}>{breadcrumbs[1]}</span>
            </div>
          )}

          {/* Chart */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`${groupBy}-${drillLevel1}-${chartType}`}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.18 }}
            >
              {chartType === 'donut' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'center' }}>
                  <PortfolioDonut
                    slices={chartSlices}
                    total={drillLevel1
                      ? chartSlices.reduce((s, sl) => s + sl.value, 0)
                      : filteredTotal}
                    onSliceClick={handleSliceClick}
                  />
                  <div style={{ flex: 1, minWidth: 200, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                    {chartSlices.slice(0, 10).map(sl => (
                      <button
                        key={sl.name}
                        onClick={() => handleSliceClick(sl.name)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--lf-cream)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: sl.color, flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--lf-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sl.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums' }}>
                            {sl.pct.toFixed(1)}% · {formatMoney(sl.value, true)}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chartType === 'bar' && (
                <div>
                  <PortfolioBar slices={chartSlices} onSliceClick={handleSliceClick} />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px', marginTop: 16 }}>
                    {chartSlices.map(sl => (
                      <button
                        key={sl.name}
                        onClick={() => handleSliceClick(sl.name)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--lf-ink)', padding: 0 }}
                      >
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: sl.color, flexShrink: 0 }} />
                        {sl.name}
                        <span style={{ color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums' }}>{sl.pct.toFixed(1)}%</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chartType === 'treemap' && (
                <PortfolioTreemap slices={chartSlices} onSliceClick={handleSliceClick} />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>


        {/* ── Page Actions (insights) ── */}
        <PageActions types="portfolio" />

        {/* ── Holdings table ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
          style={{ ...card, overflow: 'hidden' }}
        >
          <div style={{ padding: '20px 24px 0', borderBottom: '1px solid var(--lf-rule)' }}>
            <p className="lf-eyebrow" style={{ marginBottom: 12 }}>Holdings</p>
          </div>

          <div style={{ overflowX: 'auto' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '80px 1fr 120px 140px 100px 60px 90px',
            minWidth: 680,
            columnGap: 12,
            padding: '10px 24px',
            background: 'var(--lf-cream)',
            borderBottom: '1px solid var(--lf-rule)',
          }}>
            {['Ticker', 'Name', 'Class', 'Sub-cat', 'Value', '%', 'Hist. Ret.'].map(h => (
              <div key={h} style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--lf-muted)' }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {holdingsByTicker.map((t, i) => {
            // Find asset class + sub-category for this ticker
            let acName = '—';
            let scName = '—';
            let histReturn: number | null = null;
            for (const ac of filteredAssetClasses) {
              for (const sc of ac.subCategories) {
                if (sc.holdings.some(h => h.ticker === t.ticker)) {
                  acName = ac.name;
                  scName = sc.name;
                }
              }
            }
            // Try to find hist return from exposures
            const exp = exposures.find(e => e.name === t.ticker || e.name === t.ticker);
            if (exp) histReturn = exp.historicalReturn;
            // DATA-NEEDED: 1M sparkline per ticker from price history endpoint

            return (
              <div
                key={t.ticker}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 1fr 120px 140px 100px 80px 110px',
                  minWidth: 640,
                  gap: 0,
                  padding: '12px 24px',
                  borderBottom: i < holdingsByTicker.length - 1 ? '1px solid var(--lf-rule)' : 'none',
                  background: i % 2 === 0 ? 'transparent' : 'var(--lf-cream-deep)',
                  alignItems: 'center',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--lf-cream)')}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--lf-cream-deep)')}
              >
                {/* Ticker */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, color: 'var(--lf-ink)' }}>
                    {t.ticker}
                  </span>
                </div>

                {/* Name — use account as fallback since Holding has no name field */}
                <div style={{ fontSize: 13, color: 'var(--lf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {t.holdings.length > 1 ? `${t.holdings.length} accounts` : t.holdings[0]?.account ?? '—'}
                </div>

                {/* Asset class */}
                <div style={{ fontSize: 12, color: colorForAssetClass(acName, i), fontWeight: 500 }}>
                  {acName}
                </div>

                {/* Sub-category */}
                <div style={{ fontSize: 12, color: 'var(--lf-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {scName}
                </div>

                {/* Value */}
                <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)', fontWeight: 500 }}>
                  {formatMoney(t.totalValue, true)}
                </div>

                {/* % */}
                <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-muted)' }}>
                  {t.percentage.toFixed(1)}%
                </div>

                {/* Hist return */}
                <div style={{
                  fontSize: 13,
                  fontVariantNumeric: 'tabular-nums',
                  color: histReturn !== null
                    ? histReturn >= 0 ? 'var(--lf-pos)' : 'var(--lf-neg)'
                    : 'var(--lf-muted)',
                  fontWeight: histReturn !== null ? 600 : 400,
                }}>
                  {histReturn !== null ? `${histReturn.toFixed(1)}%` : '—'}
                  {/* DATA-NEEDED: 1M sparkline per ticker */}
                </div>
              </div>
            );
          })}
          </div>
        </motion.div>

        {/* ── Breakdown accordion (grouped by current groupBy) ── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        >
          <p className="lf-eyebrow" style={{ marginBottom: 12 }}>
            {groupBy === 'assetClass' ? 'Asset Classes'
              : groupBy === 'subCategory' ? 'Sub-Categories'
              : groupBy === 'holding' ? 'By Ticker'
              : 'By Account'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Asset Class view */}
            {groupBy === 'assetClass' && filteredAssetClasses.map((ac, i) => (
              <motion.div
                key={ac.name}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}
                style={{ ...card, overflow: 'hidden' }}
              >
                <button
                  onClick={() => toggleRow(ac.name)}
                  style={{ width: '100%', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--lf-cream)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: colorForAssetClass(ac.name, i), flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: 'var(--lf-ink)', fontSize: 15 }}>{ac.name}</span>
                    <span style={{ fontSize: 11, background: 'var(--lf-cream)', border: '1px solid var(--lf-rule)', borderRadius: 999, padding: '2px 8px', color: 'var(--lf-muted)' }}>
                      {ac.subCategories.length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)' }}>
                        {formatMoney(ac.value)}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--lf-muted)', marginLeft: 8 }}>
                        {ac.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <span style={{ color: 'var(--lf-muted)', fontSize: 16, transform: expandedRows[ac.name] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      ▾
                    </span>
                  </div>
                </button>

                <AnimatePresence>
                  {expandedRows[ac.name] && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                      style={{ borderTop: '1px solid var(--lf-rule)', background: 'var(--lf-cream)', overflow: 'hidden' }}
                    >
                      {ac.subCategories.map((sc, j) => (
                        <div key={sc.name} style={{ padding: '12px 20px 0 36px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--lf-ink)' }}>{sc.name}</span>
                            <span style={{ fontSize: 13, color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums' }}>
                              {formatMoney(sc.value)} · {sc.percentage.toFixed(1)}%
                            </span>
                          </div>
                          {sc.holdings.map(h => (
                            <div
                              key={`${h.ticker}-${h.account}`}
                              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, marginBottom: 4, background: 'var(--lf-paper)' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: 'var(--lf-ink)', minWidth: 48 }}>
                                  {h.ticker}
                                </span>
                                <span style={{ fontSize: 12, color: 'var(--lf-muted)' }}>{h.account}</span>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)', fontWeight: 500 }}>
                                  {formatMoney(h.value)}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums' }}>
                                  {h.shares.toFixed(2)} sh
                                </div>
                              </div>
                            </div>
                          ))}
                          {j < ac.subCategories.length - 1 && (
                            <div style={{ height: 1, background: 'var(--lf-rule)', margin: '12px 0' }} />
                          )}
                        </div>
                      ))}
                      <div style={{ height: 12 }} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}

            {/* Sub-Category view */}
            {groupBy === 'subCategory' && allSubCategories.map((sc, i) => (
              <motion.div
                key={sc.name}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}
                style={{ ...card, overflow: 'hidden' }}
              >
                <button
                  onClick={() => toggleRow(sc.name)}
                  style={{ width: '100%', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--lf-cream)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: sc.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, color: 'var(--lf-ink)', fontSize: 15 }}>{sc.name}</span>
                    <span style={{ fontSize: 11, background: 'var(--lf-cream)', border: '1px solid var(--lf-rule)', borderRadius: 999, padding: '2px 8px', color: 'var(--lf-muted)' }}>
                      {sc.holdings.length}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)' }}>
                        {formatMoney(sc.value)}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--lf-muted)', marginLeft: 8 }}>
                        {sc.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <span style={{ color: 'var(--lf-muted)', fontSize: 16, transform: expandedRows[sc.name] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      ▾
                    </span>
                  </div>
                </button>

                <AnimatePresence>
                  {expandedRows[sc.name] && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                      style={{ borderTop: '1px solid var(--lf-rule)', background: 'var(--lf-cream)', overflow: 'hidden', padding: '12px 20px' }}
                    >
                      {sc.holdings.map(h => (
                        <div
                          key={`${h.ticker}-${h.account}`}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, marginBottom: 4, background: 'var(--lf-paper)' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: 'var(--lf-ink)', minWidth: 48 }}>
                              {h.ticker}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--lf-muted)' }}>{h.account}</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)', fontWeight: 500 }}>
                              {formatMoney(h.value)}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums' }}>
                              {h.shares.toFixed(2)} sh
                            </div>
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}

            {/* Holdings (ticker) view */}
            {groupBy === 'holding' && holdingsByTicker.map((t, i) => (
              <motion.div
                key={t.ticker}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 * Math.min(i, 15) }}
                style={{ ...card, overflow: 'hidden' }}
              >
                <button
                  onClick={() => t.holdings.length > 1 && toggleRow(`holding-${t.ticker}`)}
                  style={{ width: '100%', padding: '14px 20px', background: 'none', border: 'none', cursor: t.holdings.length > 1 ? 'pointer' : 'default', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                  onMouseEnter={e => { if (t.holdings.length > 1) e.currentTarget.style.background = 'var(--lf-cream)'; }}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700, color: 'var(--lf-ink)' }}>
                        {t.ticker}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--lf-muted)', marginTop: 1 }}>
                        {t.totalShares.toFixed(2)} sh
                        {t.holdings.length > 1 && ` · ${t.holdings.length} accounts`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 20, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)' }}>
                        {formatMoney(t.totalValue)}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--lf-muted)', marginLeft: 8 }}>
                        {t.percentage.toFixed(1)}%
                      </span>
                    </div>
                    {t.holdings.length > 1 && (
                      <span style={{ color: 'var(--lf-muted)', fontSize: 16, transform: expandedRows[`holding-${t.ticker}`] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                        ▾
                      </span>
                    )}
                  </div>
                </button>

                {t.holdings.length > 1 && (
                  <AnimatePresence>
                    {expandedRows[`holding-${t.ticker}`] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                        style={{ borderTop: '1px solid var(--lf-rule)', background: 'var(--lf-cream)', overflow: 'hidden', padding: '12px 20px' }}
                      >
                        {t.holdings.sort((a, b) => b.value - a.value).map(h => (
                          <div
                            key={`${h.ticker}-${h.account}`}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, marginBottom: 4, background: 'var(--lf-paper)' }}
                          >
                            <span style={{ fontSize: 13, color: 'var(--lf-ink)' }}>{h.account}</span>
                            <div style={{ display: 'flex', gap: 24, textAlign: 'right' }}>
                              <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)', fontWeight: 500 }}>
                                {formatMoney(h.value)}
                              </span>
                              <span style={{ fontSize: 12, color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 80 }}>
                                {h.shares.toFixed(2)} sh
                              </span>
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </motion.div>
            ))}

            {/* Account view */}
            {groupBy === 'account' && (() => {
              const acctMap = new Map<string, { value: number; holdings: Holding[] }>();
              for (const ac of filteredAssetClasses) {
                for (const sc of ac.subCategories) {
                  for (const h of sc.holdings) {
                    const existing = acctMap.get(h.account);
                    if (existing) {
                      existing.value += h.value;
                      existing.holdings.push(h);
                    } else {
                      acctMap.set(h.account, { value: h.value, holdings: [h] });
                    }
                  }
                }
              }
              const accts = Array.from(acctMap.entries())
                .map(([name, data], i) => ({
                  name,
                  ...data,
                  pct: filteredTotal > 0 ? (data.value / filteredTotal) * 100 : 0,
                  color: FALLBACK_COLORS[i % FALLBACK_COLORS.length],
                }))
                .sort((a, b) => b.value - a.value);

              return accts.map((acct, i) => (
                <motion.div
                  key={acct.name}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}
                  style={{ ...card, overflow: 'hidden' }}
                >
                  <button
                    onClick={() => toggleRow(`acct-${acct.name}`)}
                    style={{ width: '100%', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--lf-cream)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: acct.color, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: 'var(--lf-ink)', fontSize: 15 }}>{acct.name}</span>
                      <span style={{ fontSize: 11, background: 'var(--lf-cream)', border: '1px solid var(--lf-rule)', borderRadius: 999, padding: '2px 8px', color: 'var(--lf-muted)' }}>
                        {acct.holdings.length}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)' }}>
                          {formatMoney(acct.value)}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--lf-muted)', marginLeft: 8 }}>
                          {acct.pct.toFixed(1)}%
                        </span>
                      </div>
                      <span style={{ color: 'var(--lf-muted)', fontSize: 16, transform: expandedRows[`acct-${acct.name}`] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                        ▾
                      </span>
                    </div>
                  </button>

                  <AnimatePresence>
                    {expandedRows[`acct-${acct.name}`] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                        style={{ borderTop: '1px solid var(--lf-rule)', background: 'var(--lf-cream)', overflow: 'hidden', padding: '12px 20px' }}
                      >
                        {acct.holdings.sort((a, b) => b.value - a.value).map(h => (
                          <div
                            key={`${h.ticker}-${h.account}`}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, marginBottom: 4, background: 'var(--lf-paper)' }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, color: 'var(--lf-ink)', minWidth: 48 }}>
                                {h.ticker}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 24, textAlign: 'right' }}>
                              <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--lf-ink)', fontWeight: 500 }}>
                                {formatMoney(h.value)}
                              </span>
                              <span style={{ fontSize: 12, color: 'var(--lf-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 80 }}>
                                {h.shares.toFixed(2)} sh
                              </span>
                            </div>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ));
            })()}
          </div>
        </motion.div>

      </div>
    </div>
  );
}
