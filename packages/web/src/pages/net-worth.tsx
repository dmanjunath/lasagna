import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Plus, RefreshCw, Loader2, AlertCircle, ChevronRight,
} from 'lucide-react';
import { formatMoney } from '../lib/utils';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { DonutChart } from '../components/charts/pie-chart';
import {
  Page,
  PageHeader,
  Section,
  Card,
  Pill,
  Button,
  EmptyState,
  DataTable,
  Eyebrow,
  CompositionRibbon,
  StatStrip,
  Lede,
} from '../components/ds';
import type { DataTableColumn } from '../components/ds/DataTable';
import type { CompositionSegment } from '../components/ds/CompositionRibbon';

type GroupingLevel = 'assetClass' | 'category' | 'holding';

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

// Plaid Link types
interface PlaidLinkFactory {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: PlaidMetadata) => void;
    onExit: () => void;
  }) => { open: () => void };
}

interface PlaidMetadata {
  institution?: {
    institution_id: string;
    name: string;
  };
}

// Color palette — LasagnaFi brand-aligned earthy tones.
// Recharts writes these straight into SVG `fill=`, where CSS variables don't
// resolve — use hex tokens that mirror the CSS variables in index.css.
const COLORS = [
  '#C9543A', // --lf-sauce
  '#E6B85C', // --lf-cheese
  '#5A6B3F', // --lf-basil
  '#E8C789', // --lf-noodle
  '#8B4A2B', // --lf-crust
  '#6B2420', // --lf-burgundy
  '#A68965',
  '#7A5C3F',
  '#8B7E6F', // --lf-muted
  '#3A322C', // --lf-ink-soft
];

const GROUPING_LABELS: Record<GroupingLevel, string> = {
  assetClass: 'Asset Class',
  category: 'Category',
  holding: 'Holdings',
};

type BreakdownRow = { name: string; value: number; percentage: number; color: string };

export function NetWorth() {
  const { setPageContext } = usePageContext();
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [groupingLevel, setGroupingLevel] = useState<GroupingLevel>('assetClass');
  const [drillLevel1, setDrillLevel1] = useState<string | null>(null);

  // Plaid / account management state
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      const data = await api.getPortfolioComposition();
      setTotalValue(data.totalValue);
      setAssetClasses(data.assetClasses);
    } catch (err) {
      console.error('Failed to fetch portfolio composition:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Set page context for floating chat
  useEffect(() => {
    if (!loading && assetClasses.length > 0) {
      setPageContext({
        pageId: 'accounts',
        pageTitle: 'Accounts',
        description: 'Account balances grouped by asset class.',
      });
    }
  }, [loading, setPageContext]);

  // ── Plaid Link ──
  const handleLink = async () => {
    setLinking(true);
    setError('');
    try {
      const [{ linkToken }] = await Promise.all([
        api.createLinkToken(),
        (await import("../lib/load-plaid.js")).loadPlaidSdk(),
      ]);
      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setError('Failed to load Plaid. Please refresh and try again.');
        setLinking(false);
        return;
      }
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken: string, metadata: PlaidMetadata) => {
          try {
            await api.exchangeToken({
              publicToken,
              institutionId: metadata.institution?.institution_id,
              institutionName: metadata.institution?.name,
            });
            fetchData();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to link account');
          } finally {
            setLinking(false);
          }
        },
        onExit: () => setLinking(false),
      });
      handler.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start linking');
      setLinking(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    setError('');
    try {
      await api.triggerSync();
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync accounts');
    } finally {
      setSyncing(false);
    }
  };

  // ── Derived data ──
  const accountCount = useMemo(() => {
    const set = new Set<string>();
    for (const ac of assetClasses) {
      for (const sc of ac.categories) {
        for (const h of sc.holdings) set.add(h.account);
      }
    }
    return set.size;
  }, [assetClasses]);

  const holdingsByTicker = useMemo(() => {
    const tickerMap = new Map<string, { holdings: Holding[]; totalValue: number; totalShares: number }>();
    for (const ac of assetClasses) {
      for (const sc of ac.categories) {
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
            });
          }
        }
      }
    }
    return Array.from(tickerMap.entries())
      .map(([ticker, data], i) => ({
        ticker,
        ...data,
        color: COLORS[i % COLORS.length],
        percentage: totalValue > 0 ? (data.totalValue / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [assetClasses, totalValue]);

  const allCategories = useMemo(() => {
    const result: { name: string; value: number; percentage: number; color: string; holdings: Holding[] }[] = [];
    let colorIndex = 0;
    for (const ac of assetClasses) {
      for (const sc of ac.categories) {
        result.push({
          name: sc.name,
          value: sc.value,
          percentage: totalValue > 0 ? (sc.value / totalValue) * 100 : 0,
          color: COLORS[colorIndex % COLORS.length],
          holdings: sc.holdings,
        });
        colorIndex++;
      }
    }
    return result.sort((a, b) => b.value - a.value);
  }, [assetClasses, totalValue]);

  // ── Chart drill-down state machine ──
  const getCurrentData = (): BreakdownRow[] => {
    if (groupingLevel === 'assetClass') {
      if (drillLevel1) {
        const assetClass = assetClasses.find(ac => ac.name === drillLevel1);
        const allHoldings: BreakdownRow[] = [];
        const acTotal = assetClass?.value || 0;
        let colorIndex = 0;
        for (const sc of assetClass?.categories || []) {
          for (const h of sc.holdings) {
            allHoldings.push({
              name: h.ticker,
              value: h.value,
              percentage: acTotal > 0 ? (h.value / acTotal) * 100 : 0,
              color: COLORS[colorIndex % COLORS.length],
            });
            colorIndex++;
          }
        }
        return allHoldings.sort((a, b) => b.value - a.value);
      }
      return assetClasses.map(ac => ({
        name: ac.name,
        value: ac.value,
        percentage: ac.percentage,
        color: ac.color,
      }));
    }

    if (groupingLevel === 'category') {
      if (drillLevel1) {
        const cat = allCategories.find(sc => sc.name === drillLevel1);
        const subTotal = cat?.holdings.reduce((sum, h) => sum + h.value, 0) || 0;
        return cat?.holdings.map((h, i) => ({
          name: h.ticker,
          value: h.value,
          percentage: subTotal > 0 ? (h.value / subTotal) * 100 : 0,
          color: COLORS[i % COLORS.length],
        })) || [];
      }
      return allCategories.map(sc => ({
        name: sc.name,
        value: sc.value,
        percentage: sc.percentage,
        color: sc.color,
      }));
    }

    if (groupingLevel === 'holding') {
      if (drillLevel1) {
        const tickerGroup = holdingsByTicker.find(t => t.ticker === drillLevel1);
        return tickerGroup?.holdings.map((h, i) => ({
          name: h.account,
          value: h.value,
          percentage: tickerGroup.totalValue > 0 ? (h.value / tickerGroup.totalValue) * 100 : 0,
          color: COLORS[i % COLORS.length],
        })) || [];
      }
      return holdingsByTicker.map(t => ({
        name: t.ticker,
        value: t.totalValue,
        percentage: t.percentage,
        color: t.color,
      }));
    }

    return [];
  };

  const handleSliceClick = (name: string) => {
    if (!drillLevel1) setDrillLevel1(name);
  };

  // ── Loading state ──
  if (loading) return null;

  // ── Empty state — no accounts linked ──
  if (assetClasses.length === 0) {
    return (
      <Page>
        <PageHeader
          title="Net Worth"
          lede="Where your money lives, grouped by type."
        />
        {error && (
          <Section>
            <Card variant="ghost">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertCircle size={16} className="ds-neg" />
                <span className="ds-body ds-neg">{error}</span>
              </div>
            </Card>
          </Section>
        )}
        <Section>
          <EmptyState
            icon={<Building2 size={32} />}
            title="Link your first account"
            body="Connect your bank and investment accounts to see your portfolio composition and asset allocation."
            cta={
              import.meta.env.VITE_DEMO_MODE !== "true" ? (
                <Button variant="ink" onClick={handleLink} disabled={linking} icon={linking ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
                  {linking ? 'Linking…' : 'Link your first account'}
                </Button>
              ) : null
            }
          />
        </Section>
      </Page>
    );
  }

  // ── Main view ──
  const chartData = getCurrentData();
  const currentTotal = drillLevel1
    ? chartData.reduce((s, d) => s + d.value, 0)
    : totalValue;

  // Donut: DonutChart expects { name, value, percentage, color }
  const donutData = chartData.slice(0, 10).map(d => ({
    name: d.name,
    value: d.value,
    percentage: d.percentage,
    color: d.color,
  }));

  // Breakdown table columns
  const breakdownColumns: DataTableColumn<BreakdownRow>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
        </div>
      ),
    },
    { key: 'pct', header: '%', num: true, muted: true, cell: (r) => <span className="ds-num">{r.percentage.toFixed(1)}%</span> },
    { key: 'value', header: 'Value', num: true, cell: (r) => <span className="ds-num">{formatMoney(r.value)}</span> },
  ];

  // ── Composition ribbon segments: top 5 asset classes + "Other" ──
  const sortedClasses = [...assetClasses].sort((a, b) => b.value - a.value);
  const topClasses = sortedClasses.slice(0, 5);
  const restClasses = sortedClasses.slice(5);
  const restSum = restClasses.reduce((s, c) => s + c.value, 0);
  const ribbonSegments: CompositionSegment[] = [
    ...topClasses.map((ac, i) => ({
      label: ac.name,
      value: ac.value,
      color: COLORS[i % COLORS.length],
    })),
    ...(restSum > 0
      ? [{ label: 'Other', value: restSum, color: COLORS[5 % COLORS.length] }]
      : []),
  ];

  const biggest = sortedClasses[0];
  const biggestPct = totalValue > 0 ? (biggest.value / totalValue) * 100 : 0;
  const cashClass = assetClasses.find((ac) => ac.name.toLowerCase().includes('cash'));

  return (
    <Page>
      <PageHeader
        title="Net Worth"
        eyebrow={`${assetClasses.length} asset ${assetClasses.length === 1 ? 'class' : 'classes'}`}
        actions={
          import.meta.env.VITE_DEMO_MODE !== "true" ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleSyncAll} disabled={syncing} icon={syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}>
                {syncing ? 'Syncing…' : 'Sync all'}
              </Button>
              <Button variant="ink" size="sm" onClick={handleLink} disabled={linking} icon={linking ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}>
                {linking ? 'Linking…' : 'Add account'}
              </Button>
            </>
          ) : null
        }
      />

      {/* Editorial lede */}
      <div style={{ marginBottom: 40 }}>
        <Lede>
          Your portfolio is worth <Lede.Num highlight>{formatMoney(totalValue)}</Lede.Num> —{' '}
          <Lede.Num>{assetClasses.length}</Lede.Num> asset {assetClasses.length === 1 ? 'class' : 'classes'} across{' '}
          <Lede.Num>{accountCount}</Lede.Num> account{accountCount === 1 ? '' : 's'}.
          {biggest && (
            <>
              {' '}Most of it sits in <Lede.Num>{biggest.name}</Lede.Num>.
            </>
          )}
        </Lede>
      </div>

      {/* Error banner */}
      {error && (
        <Section>
          <Card variant="ghost">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertCircle size={16} className="ds-neg" />
              <span className="ds-body ds-neg">{error}</span>
            </div>
          </Card>
        </Section>
      )}

      {/* Composition ribbon — top 5 asset classes + Other */}
      {ribbonSegments.length > 0 && (
        <Section>
          <CompositionRibbon
            leadLabel="Portfolio"
            leadValue={formatMoney(totalValue)}
            leadDelta={`${accountCount} account${accountCount === 1 ? '' : 's'}`}
            segments={ribbonSegments}
          />
        </Section>
      )}

      {/* Stat strip */}
      <StatStrip
        className="ds-nw-stats"
        items={[
          { label: 'Total', value: formatMoney(totalValue) },
          ...(biggest
            ? [{
                label: 'Biggest class',
                value: biggest.name,
                sub: `${biggestPct.toFixed(0)}% · ${formatMoney(biggest.value)}`,
              }]
            : []),
          {
            label: 'Positions',
            value: String(holdingsByTicker.length),
            sub: `${holdingsByTicker.length === 1 ? 'holding' : 'holdings'} tracked`,
          },
          ...(cashClass
            ? [{
                label: 'Cash',
                value: formatMoney(cashClass.value),
                sub: `${totalValue > 0 ? ((cashClass.value / totalValue) * 100).toFixed(0) : 0}% of portfolio`,
              }]
            : []),
        ]}
      />

      {/* ── By (current grouping) — chart + breakdown ── */}
      <Section
        title={`${GROUPING_LABELS[groupingLevel]} breakdown`}
        eyebrow={
          drillLevel1 ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => setDrillLevel1(null)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--lf-sauce)', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}
              >
                {GROUPING_LABELS[groupingLevel]}
              </button>
              <ChevronRight size={11} />
              <span style={{ color: 'var(--lf-ink)' }}>{drillLevel1}</span>
            </span>
          ) : 'Total portfolio'
        }
        actions={
          <div style={{ display: 'inline-flex', gap: 6 }}>
            {(['assetClass', 'category', 'holding'] as GroupingLevel[]).map((g) => (
              <button
                key={g}
                onClick={() => { setGroupingLevel(g); setDrillLevel1(null); }}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <Pill tone={groupingLevel === g ? 'ink' : 'ghost'}>{GROUPING_LABELS[g]}</Pill>
              </button>
            ))}
          </div>
        }
      >
        <Card>
          <AnimatePresence mode="wait">
            <motion.div
              key={`${groupingLevel}-${drillLevel1}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <div className="ds-nw-grid">
                {/* Donut + central total */}
                <div className="ds-nw-grid__chart">
                  <DonutChart data={donutData} size={260} />
                  <div style={{ marginTop: 20, textAlign: 'center' }}>
                    <Eyebrow>{drillLevel1 ? drillLevel1 : 'Total portfolio'}</Eyebrow>
                    <div className="ds-display ds-num" style={{ marginTop: 8 }}>{formatMoney(currentTotal)}</div>
                  </div>
                </div>
                {/* Breakdown table */}
                <div className="ds-nw-grid__table">
                  <DataTable
                    columns={breakdownColumns}
                    rows={chartData}
                    rowKey={(r) => r.name}
                    hover
                    onRowClick={!drillLevel1 ? (r) => handleSliceClick(r.name) : undefined}
                  />
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </Card>
      </Section>

      {/* ── Full breakdown ── */}
      <Section title="Breakdown" eyebrow={`${chartData.length} row${chartData.length === 1 ? '' : 's'}`}>
        <Card flush>
          <DataTable
            columns={breakdownColumns}
            rows={chartData}
            rowKey={(r) => `bk-${r.name}`}
            hover
            onRowClick={!drillLevel1 ? (r) => handleSliceClick(r.name) : undefined}
          />
        </Card>
      </Section>

      <style>{`
        .ds-nw-stats { margin: 32px 0 56px; }
        .ds-nw-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 32px;
          align-items: center;
        }
        .ds-nw-grid__chart {
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 0;
        }
        .ds-nw-grid__table { min-width: 0; overflow-x: auto; }
        @media (min-width: 820px) {
          .ds-nw-grid {
            grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
            gap: 40px;
          }
        }
      `}</style>
    </Page>
  );
}
