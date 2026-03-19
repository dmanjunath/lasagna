import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PieChart, BarChart3, Grid3x3, ChevronRight, Building2,
  Plus, Layers, RefreshCw, Loader2, AlertCircle,
} from 'lucide-react';
import { cn, formatMoney } from '../lib/utils';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { DonutChart } from '../components/charts/pie-chart';
import { StackedBarChart } from '../components/charts/stacked-bar-chart';
import { TreemapChart } from '../components/charts/treemap-chart';
import { Button } from '../components/ui/button';
import { Section } from '../components/common/section';

type ChartType = 'donut' | 'bar' | 'treemap';
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

// Color palette — LasagnaFi brand-aligned earthy tones
const COLORS = [
  'var(--lf-sauce)',
  'var(--lf-cheese)',
  'var(--lf-basil)',
  'var(--lf-noodle)',
  'var(--lf-crust)',
  'var(--lf-burgundy)',
  '#A68965',
  '#7A5C3F',
  'var(--lf-muted)',
  'var(--lf-ink-soft)',
];

const GROUPING_LABELS: Record<GroupingLevel, string> = {
  assetClass: 'Asset Class',
  category: 'Category',
  holding: 'Individual Holdings',
};

export function NetWorth() {
  const { setPageContext } = usePageContext();
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [chartType, setChartType] = useState<ChartType>('donut');
  const [groupingLevel, setGroupingLevel] = useState<GroupingLevel>('assetClass');
  const [drillLevel1, setDrillLevel1] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  // Plaid / account management state
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const fetchData = async () => {
    try {
      const data = await api.getPortfolioComposition();
      setTotalValue(data.totalValue);
      setAssetClasses(data.assetClasses);
      // Expand ALL categories by default
      const expanded: Record<string, boolean> = {};
      for (const ac of data.assetClasses) {
        expanded[ac.name] = true;
      }
      setExpandedCategories(expanded);
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

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => ({ ...prev, [name]: !prev[name] }));
  };

  // ── Plaid Link ──
  const handleLink = async () => {
    setLinking(true);
    setError('');
    try {
      const { linkToken } = await api.createLinkToken();
      const Plaid = (window as unknown as { Plaid: PlaidLinkFactory }).Plaid;
      if (!Plaid) {
        setError('Plaid Link script not loaded. Add it to index.html.');
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
            // Refresh portfolio data after linking
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
      // Refresh portfolio data after syncing
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync accounts');
    } finally {
      setSyncing(false);
    }
  };

  // ── Derived data for chart views ──
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
        percentage: (data.totalValue / totalValue) * 100,
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
          percentage: (sc.value / totalValue) * 100,
          color: COLORS[colorIndex % COLORS.length],
          holdings: sc.holdings,
        });
        colorIndex++;
      }
    }
    return result.sort((a, b) => b.value - a.value);
  }, [assetClasses, totalValue]);

  // ── Chart drill-down state machine ──
  const getCurrentData = () => {
    if (groupingLevel === 'assetClass') {
      if (drillLevel1) {
        const assetClass = assetClasses.find(ac => ac.name === drillLevel1);
        const allHoldings: { name: string; value: number; percentage: number; color: string }[] = [];
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

  const handleChartClick = (name: string) => {
    if (!drillLevel1) {
      setDrillLevel1(name);
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === 0) {
      setDrillLevel1(null);
    }
  };

  const getBreadcrumbs = () => {
    const rootLabel = groupingLevel === 'assetClass' ? 'Asset Class'
      : groupingLevel === 'category' ? 'Category'
      : 'Holdings';
    return [
      { label: rootLabel },
      ...(drillLevel1 ? [{ label: drillLevel1 }] : []),
    ];
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-secondary">Loading portfolio...</div>
      </div>
    );
  }

  // ── Empty state — no accounts linked ──
  if (assetClasses.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center"
        >
          <Building2 className="w-16 h-16 text-text-secondary mb-6" />
          <h2 className="font-display text-2xl md:text-3xl font-medium mb-3">
            Link Your First Account
          </h2>
          <p className="text-text-secondary max-w-md mb-8">
            Connect your bank and investment accounts to see your portfolio composition and asset allocation.
          </p>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-danger/10 border border-danger/20 flex items-center gap-3 text-danger">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {import.meta.env.VITE_DEMO_MODE !== "true" && (
            <Button onClick={handleLink} disabled={linking}>
              {linking ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Linking...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Link Your First Account
                </span>
              )}
            </Button>
          )}
        </motion.div>
      </div>
    );
  }

  // ── Main view ──
  const chartData = getCurrentData();
  const breadcrumbs = getBreadcrumbs();

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 'clamp(16px, 4vw, 40px)', paddingBottom: 'clamp(80px, 12vw, 48px)', maxWidth: 1100, margin: '0 auto', width: '100%', boxSizing: 'border-box' }} className="scrollbar-thin">
      {/* Error banner */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-xl bg-danger/10 border border-danger/20 flex items-center gap-3 text-danger"
        >
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </motion.div>
      )}

      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, fontWeight: 400, color: 'var(--lf-ink)', margin: 0, lineHeight: 1.1 }}>
          Net Worth
        </h1>
        <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'var(--lf-muted)', marginTop: 6, margin: '6px 0 0' }}>
          {assetClasses.length} asset {assetClasses.length === 1 ? 'class' : 'classes'}
        </p>
      </div>

      {/* Header Card with Total Value + Charts */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-4 md:p-8 mb-6 md:mb-8"
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 gap-4">
          <div>
            <p className="text-text-secondary text-sm mb-2">Total Portfolio Value</p>
            <div className="font-display text-4xl md:text-5xl font-semibold tracking-tight tabular-nums">
              {formatMoney(totalValue)}
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
            {/* Grouping Level Selector */}
            <div className="flex items-center gap-2 bg-surface-solid rounded-lg p-1">
              <Layers className="h-4 w-4 text-text-secondary ml-2" />
              <select
                value={groupingLevel}
                onChange={(e) => {
                  setGroupingLevel(e.target.value as GroupingLevel);
                  setDrillLevel1(null);
                }}
                className="bg-transparent text-sm font-medium pr-2 py-1.5 focus:outline-none cursor-pointer"
              >
                <option value="assetClass">Asset Class</option>
                <option value="category">Category</option>
                <option value="holding">Holdings</option>
              </select>
            </div>
            {/* Chart Type Buttons */}
            <div className="flex items-center gap-1">
              <Button
                variant={chartType === 'donut' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setChartType('donut')}
              >
                <PieChart className="h-4 w-4" />
              </Button>
              <Button
                variant={chartType === 'bar' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setChartType('bar')}
              >
                <BarChart3 className="h-4 w-4" />
              </Button>
              <Button
                variant={chartType === 'treemap' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setChartType('treemap')}
              >
                <Grid3x3 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-6 text-sm">
          {breadcrumbs.map((crumb, index) => (
            <div key={index} className="flex items-center gap-2">
              {index > 0 && <ChevronRight className="h-4 w-4 text-text-secondary" />}
              <button
                onClick={() => handleBreadcrumbClick(index)}
                className={cn(
                  'transition-colors',
                  index === breadcrumbs.length - 1
                    ? 'text-text font-medium'
                    : 'text-text-secondary hover:text-text'
                )}
                disabled={index === breadcrumbs.length - 1}
              >
                {crumb.label}
              </button>
            </div>
          ))}
        </div>

        {/* Chart Display */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${groupingLevel}-${drillLevel1}-${chartType}`}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center"
          >
            {chartType === 'donut' && (
              <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 w-full">
                <DonutChart data={chartData} size={280} />
                <div className="flex-1 grid grid-cols-2 gap-3 md:gap-4 w-full">
                  {chartData.slice(0, 8).map((item) => (
                    <button
                      key={item.name}
                      onClick={() => handleChartClick(item.name)}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-hover transition-colors text-left"
                    >
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: item.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{item.name}</div>
                        <div className="text-xs text-text-secondary tabular-nums">
                          {item.percentage.toFixed(1)}% · {formatMoney(item.value, true)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chartType === 'bar' && (
              <div className="w-full">
                <StackedBarChart
                  data={chartData}
                  height={80}
                  onClick={handleChartClick}
                />
                <div className="flex flex-wrap gap-4 mt-4 justify-center">
                  {chartData.map((item) => (
                    <button
                      key={item.name}
                      onClick={() => handleChartClick(item.name)}
                      className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-text-secondary">{item.name}</span>
                      <span className="text-text-secondary tabular-nums">{item.percentage.toFixed(1)}%</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chartType === 'treemap' && (
              <div className="w-full">
                <TreemapChart
                  data={chartData}
                  height={400}
                  onClick={handleChartClick}
                />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Action Buttons: Add Account + Sync */}
      {import.meta.env.VITE_DEMO_MODE !== "true" && (
        <div className="flex items-center gap-3 mb-6 md:mb-8">
          <Button onClick={handleLink} disabled={linking}>
            {linking ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Linking...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Add Account
              </span>
            )}
          </Button>
          <Button variant="secondary" onClick={handleSyncAll} disabled={syncing}>
            {syncing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Syncing...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Sync All Accounts
              </span>
            )}
          </Button>
        </div>
      )}

      {/* Breakdown Table - responds to grouping level */}
      <Section title={GROUPING_LABELS[groupingLevel]}>
        <div className="space-y-3">
          {groupingLevel === 'assetClass' && assetClasses.map((assetClass, i) => (
            <motion.div
              key={assetClass.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              className="glass-card rounded-2xl overflow-hidden"
            >
              <button
                onClick={() => toggleCategory(assetClass.name)}
                className="w-full p-4 md:p-5 text-left hover:bg-surface-hover transition-all duration-200"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: assetClass.color }}
                    />
                    <span className="font-medium">{assetClass.name}</span>
                    <span className="text-sm text-text-secondary px-2 py-0.5 rounded-full bg-surface-solid">
                      {assetClass.categories.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="font-display text-lg md:text-xl font-semibold tabular-nums">
                        {formatMoney(assetClass.value)}
                      </span>
                      <span className="text-text-secondary text-sm ml-2">
                        {assetClass.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <motion.span
                      animate={{ rotate: expandedCategories[assetClass.name] ? 180 : 0 }}
                      className="text-text-secondary"
                    >
                      ▾
                    </motion.span>
                  </div>
                </div>
              </button>

              <AnimatePresence>
                {expandedCategories[assetClass.name] && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-border bg-bg/30 overflow-hidden"
                  >
                    {assetClass.categories.map((cat, j) => (
                      <motion.div
                        key={cat.name}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: j * 0.03 }}
                        className="px-4 md:px-5 py-3 md:py-4"
                      >
                        <div className="flex items-center justify-between mb-2 pl-4 md:pl-6">
                          <span className="font-medium text-sm">{cat.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-sm tabular-nums">{formatMoney(cat.value)}</span>
                            <span className="text-xs text-text-secondary tabular-nums w-12 text-right">
                              {cat.percentage.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        {/* Holdings */}
                        <div className="pl-4 md:pl-6 space-y-1">
                          {cat.holdings.map((holding) => (
                            <div
                              key={`${holding.ticker}-${holding.account}`}
                              className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg hover:bg-surface-hover transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-surface-solid flex items-center justify-center text-xs font-medium text-text-secondary">
                                  {holding.ticker.slice(0, 3)}
                                </div>
                                <div>
                                  <div className="font-medium text-text-secondary">{holding.ticker}</div>
                                  <div className="text-xs text-text-secondary">{holding.account}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="tabular-nums">{formatMoney(holding.value)}</div>
                                <div className="text-xs text-text-secondary tabular-nums">
                                  {holding.shares.toFixed(2)} shares
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}

          {groupingLevel === 'category' && (() => {
            const categories: { name: string; value: number; percentage: number; color: string; holdings: Holding[] }[] = [];
            let colorIndex = 0;
            for (const ac of assetClasses) {
              for (const sc of ac.categories) {
                categories.push({
                  name: sc.name,
                  value: sc.value,
                  percentage: (sc.value / totalValue) * 100,
                  color: COLORS[colorIndex % COLORS.length],
                  holdings: sc.holdings,
                });
                colorIndex++;
              }
            }
            return categories.sort((a, b) => b.value - a.value).map((cat, i) => (
              <motion.div
                key={cat.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="glass-card rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => toggleCategory(cat.name)}
                  className="w-full p-4 md:p-5 text-left hover:bg-surface-hover transition-all duration-200"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="font-medium">{cat.name}</span>
                      <span className="text-sm text-text-secondary px-2 py-0.5 rounded-full bg-surface-solid">
                        {cat.holdings.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="font-display text-lg md:text-xl font-semibold tabular-nums">
                          {formatMoney(cat.value)}
                        </span>
                        <span className="text-text-secondary text-sm ml-2">
                          {cat.percentage.toFixed(1)}%
                        </span>
                      </div>
                      <motion.span
                        animate={{ rotate: expandedCategories[cat.name] ? 180 : 0 }}
                        className="text-text-secondary"
                      >
                        ▾
                      </motion.span>
                    </div>
                  </div>
                </button>

                <AnimatePresence>
                  {expandedCategories[cat.name] && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-border bg-bg/30 overflow-hidden px-4 md:px-5 py-3 md:py-4"
                    >
                      <div className="space-y-1">
                        {cat.holdings.map((holding) => (
                          <div
                            key={`${holding.ticker}-${holding.account}`}
                            className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg hover:bg-surface-hover transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-surface-solid flex items-center justify-center text-xs font-medium text-text-secondary">
                                {holding.ticker.slice(0, 3)}
                              </div>
                              <div>
                                <div className="font-medium text-text-secondary">{holding.ticker}</div>
                                <div className="text-xs text-text-secondary">{holding.account}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="tabular-nums">{formatMoney(holding.value)}</div>
                              <div className="text-xs text-text-secondary tabular-nums">
                                {holding.shares.toFixed(2)} shares
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ));
          })()}

          {groupingLevel === 'holding' && (() => {
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

            const groupedHoldings = Array.from(tickerMap.entries())
              .map(([ticker, data], i) => ({
                ticker,
                ...data,
                color: COLORS[i % COLORS.length],
                percentage: (data.totalValue / totalValue) * 100,
              }))
              .sort((a, b) => b.totalValue - a.totalValue);

            return groupedHoldings.map((group, i) => (
              <motion.div
                key={group.ticker}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 * Math.min(i, 10) }}
                className="glass-card rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => toggleCategory(`holding-${group.ticker}`)}
                  className="w-full p-4 md:p-5 text-left hover:bg-surface-hover transition-all duration-200"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: group.color }}
                      />
                      <div className="w-8 h-8 rounded-lg bg-surface-solid flex items-center justify-center text-xs font-medium text-text-secondary">
                        {group.ticker.slice(0, 3)}
                      </div>
                      <div>
                        <div className="font-medium">{group.ticker}</div>
                        <div className="text-xs text-text-secondary">
                          {group.totalShares.toFixed(2)} shares
                          {group.holdings.length > 1 && ` · ${group.holdings.length} accounts`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="font-display text-lg md:text-xl font-semibold tabular-nums">
                          {formatMoney(group.totalValue)}
                        </span>
                        <span className="text-text-secondary text-sm ml-2">
                          {group.percentage.toFixed(1)}%
                        </span>
                      </div>
                      {group.holdings.length > 1 && (
                        <motion.span
                          animate={{ rotate: expandedCategories[`holding-${group.ticker}`] ? 180 : 0 }}
                          className="text-text-secondary"
                        >
                          ▾
                        </motion.span>
                      )}
                    </div>
                  </div>
                </button>

                {group.holdings.length > 1 && (
                  <AnimatePresence>
                    {expandedCategories[`holding-${group.ticker}`] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="border-t border-border bg-bg/30 overflow-hidden px-4 md:px-5 py-3 md:py-4"
                      >
                        <div className="space-y-2">
                          {group.holdings.sort((a, b) => b.value - a.value).map((holding) => (
                            <div
                              key={`${holding.ticker}-${holding.account}`}
                              className="flex items-center justify-between text-sm py-2 px-3 rounded-lg hover:bg-surface-hover transition-colors"
                            >
                              <div className="text-text-secondary">{holding.account}</div>
                              <div className="flex items-center gap-6">
                                <div className="text-right">
                                  <div className="tabular-nums">{formatMoney(holding.value)}</div>
                                </div>
                                <div className="text-right text-text-secondary w-24">
                                  <div className="tabular-nums">{holding.shares.toFixed(2)} shares</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}
              </motion.div>
            ));
          })()}
        </div>
      </Section>
    </div>
  );
}
