import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, BarChart3, Grid3x3, ChevronRight, Building2, Plus, Layers } from 'lucide-react';
import { cn, formatMoney } from '../lib/utils';
import { api } from '../lib/api';
import { usePageContext } from '../lib/page-context';
import { DonutChart } from '../components/charts/pie-chart';
import { StackedBarChart } from '../components/charts/stacked-bar-chart';
import { TreemapChart } from '../components/charts/treemap-chart';
import { Button } from '../components/ui/button';
import { Section } from '../components/common/section';
import { useLocation } from 'wouter';

type ChartType = 'donut' | 'bar' | 'treemap';
type GroupingLevel = 'assetClass' | 'subCategory' | 'holding';

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

// Color palette matching app theme
const COLORS = [
  '#4ade80', '#60a5fa', '#f59e0b', '#ec4899', '#8b5cf6',
  '#14b8a6', '#f43f5e', '#6366f1', '#10b981', '#a855f7',
];

const GROUPING_LABELS: Record<GroupingLevel, string> = {
  assetClass: 'Asset Class',
  subCategory: 'Sub-Category',
  holding: 'Individual Holdings',
};

export default function PortfolioComposition() {
  const [, setLocation] = useLocation();
  const { setPageContext } = usePageContext();
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);
  const [assetClasses, setAssetClasses] = useState<AssetClass[]>([]);
  const [chartType, setChartType] = useState<ChartType>('donut');
  const [groupingLevel, setGroupingLevel] = useState<GroupingLevel>('assetClass');
  // Drill-down state - the selected item at level 1 (asset class, sub-category, or ticker)
  const [drillLevel1, setDrillLevel1] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await api.getPortfolioComposition();
        setTotalValue(data.totalValue);
        setAssetClasses(data.assetClasses);
        // Expand first category by default
        if (data.assetClasses.length > 0) {
          setExpandedCategories({ [data.assetClasses[0].name]: true });
        }
      } catch (error) {
        console.error('Failed to fetch portfolio composition:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Set page context for floating chat
  useEffect(() => {
    if (!loading && assetClasses.length > 0) {
      setPageContext({
        pageId: 'portfolio-composition',
        pageTitle: 'Portfolio Composition',
        description: 'Shows portfolio allocation across asset classes, sub-categories, and individual holdings.',
        data: {
          totalValue,
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
  }, [loading, totalValue, assetClasses, setPageContext]);

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => ({ ...prev, [name]: !prev[name] }));
  };

  // Get all holdings grouped by ticker (for holdings view)
  const holdingsByTicker = useMemo(() => {
    const tickerMap = new Map<string, { holdings: Holding[]; totalValue: number; totalShares: number }>();
    for (const ac of assetClasses) {
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

  // Get all sub-categories with their holdings
  const allSubCategories = useMemo(() => {
    const result: { name: string; value: number; percentage: number; color: string; holdings: Holding[] }[] = [];
    let colorIndex = 0;
    for (const ac of assetClasses) {
      for (const sc of ac.subCategories) {
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

  const getCurrentData = () => {
    // Asset Class view: Asset Class → Ticker
    if (groupingLevel === 'assetClass') {
      if (drillLevel1) {
        // Level 2: Show tickers within asset class
        const assetClass = assetClasses.find(ac => ac.name === drillLevel1);
        const allHoldings: { name: string; value: number; percentage: number; color: string }[] = [];
        const acTotal = assetClass?.value || 0;
        let colorIndex = 0;
        for (const sc of assetClass?.subCategories || []) {
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
      // Level 1: Show asset classes
      return assetClasses.map(ac => ({
        name: ac.name,
        value: ac.value,
        percentage: ac.percentage,
        color: ac.color,
      }));
    }

    // Sub-Category view: Sub-Category → Ticker
    if (groupingLevel === 'subCategory') {
      if (drillLevel1) {
        // Level 2: Show tickers within sub-category
        const subCategory = allSubCategories.find(sc => sc.name === drillLevel1);
        const subTotal = subCategory?.holdings.reduce((sum, h) => sum + h.value, 0) || 0;
        return subCategory?.holdings.map((h, i) => ({
          name: h.ticker,
          value: h.value,
          percentage: subTotal > 0 ? (h.value / subTotal) * 100 : 0,
          color: COLORS[i % COLORS.length]
        })) || [];
      }
      // Level 1: Show sub-categories
      return allSubCategories.map(sc => ({
        name: sc.name,
        value: sc.value,
        percentage: sc.percentage,
        color: sc.color,
      }));
    }

    // Holdings view: Ticker → Account
    if (groupingLevel === 'holding') {
      if (drillLevel1) {
        // Level 2: Show accounts for ticker
        const tickerGroup = holdingsByTicker.find(t => t.ticker === drillLevel1);
        return tickerGroup?.holdings.map((h, i) => ({
          name: h.account,
          value: h.value,
          percentage: tickerGroup.totalValue > 0 ? (h.value / tickerGroup.totalValue) * 100 : 0,
          color: COLORS[i % COLORS.length]
        })) || [];
      }
      // Level 1: Show tickers (grouped)
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
    // All groupings now have 2 levels max
    if (!drillLevel1) {
      setDrillLevel1(name);
    }
    // At level 2, no further drilling (ticker or account is terminal)
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === 0) {
      setDrillLevel1(null);
    }
    // Index 1 is terminal level, no action needed
  };

  // Get breadcrumb labels based on grouping and drill state
  const getBreadcrumbs = () => {
    const rootLabel = groupingLevel === 'assetClass' ? 'Asset Class'
      : groupingLevel === 'subCategory' ? 'Sub-Category'
      : 'Holdings';
    return [
      { label: rootLabel },
      ...(drillLevel1 ? [{ label: drillLevel1 }] : []),
    ];
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted">Loading portfolio...</div>
      </div>
    );
  }

  if (assetClasses.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center text-center"
        >
          <Building2 className="w-16 h-16 text-text-muted mb-6" />
          <h2 className="font-display text-2xl md:text-3xl font-medium mb-3">
            No Holdings Found
          </h2>
          <p className="text-text-muted max-w-md mb-8">
            Connect your investment accounts to see your portfolio composition and asset allocation.
          </p>
          <Button onClick={() => setLocation('/accounts')}>
            <Plus className="w-4 h-4 mr-2" />
            Link Account
          </Button>
        </motion.div>
      </div>
    );
  }

  const chartData = getCurrentData();
  const breadcrumbs = getBreadcrumbs();

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8">
      {/* Header Card with Total Value */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-2xl p-4 md:p-8 mb-6 md:mb-8"
      >
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 gap-4">
          <div>
            <p className="text-text-muted text-sm mb-2">Total Portfolio Value</p>
            <div className="font-display text-4xl md:text-5xl font-semibold tracking-tight tabular-nums">
              {formatMoney(totalValue)}
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
            {/* Grouping Level Selector */}
            <div className="flex items-center gap-2 bg-surface-solid rounded-lg p-1">
              <Layers className="h-4 w-4 text-text-muted ml-2" />
              <select
                value={groupingLevel}
                onChange={(e) => {
                  setGroupingLevel(e.target.value as GroupingLevel);
                  setDrillLevel1(null);
                }}
                className="bg-transparent text-sm font-medium pr-2 py-1.5 focus:outline-none cursor-pointer"
              >
                <option value="assetClass">Asset Class</option>
                <option value="subCategory">Sub-Category</option>
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
              {index > 0 && <ChevronRight className="h-4 w-4 text-text-muted" />}
              <button
                onClick={() => handleBreadcrumbClick(index)}
                className={cn(
                  'transition-colors',
                  index === breadcrumbs.length - 1
                    ? 'text-text font-medium'
                    : 'text-text-muted hover:text-text'
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
                        <div className="text-xs text-text-muted tabular-nums">
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
                      <span className="text-text-muted tabular-nums">{item.percentage.toFixed(1)}%</span>
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
                    <span className="text-sm text-text-muted px-2 py-0.5 rounded-full bg-surface-solid">
                      {assetClass.subCategories.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="font-display text-lg md:text-xl font-semibold tabular-nums">
                        {formatMoney(assetClass.value)}
                      </span>
                      <span className="text-text-muted text-sm ml-2">
                        {assetClass.percentage.toFixed(1)}%
                      </span>
                    </div>
                    <motion.span
                      animate={{ rotate: expandedCategories[assetClass.name] ? 180 : 0 }}
                      className="text-text-muted"
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
                    {assetClass.subCategories.map((subCategory, j) => (
                      <motion.div
                        key={subCategory.name}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: j * 0.03 }}
                        className="px-4 md:px-5 py-3 md:py-4"
                      >
                        <div className="flex items-center justify-between mb-2 pl-4 md:pl-6">
                          <span className="font-medium text-sm">{subCategory.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-sm tabular-nums">{formatMoney(subCategory.value)}</span>
                            <span className="text-xs text-text-muted tabular-nums w-12 text-right">
                              {subCategory.percentage.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        {/* Holdings */}
                        <div className="pl-4 md:pl-6 space-y-1">
                          {subCategory.holdings.map((holding) => (
                            <div
                              key={`${holding.ticker}-${holding.account}`}
                              className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg hover:bg-surface-hover transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-surface-solid flex items-center justify-center text-xs font-medium text-text-muted">
                                  {holding.ticker.slice(0, 3)}
                                </div>
                                <div>
                                  <div className="font-medium text-text-secondary">{holding.ticker}</div>
                                  <div className="text-xs text-text-muted">{holding.account}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="tabular-nums">{formatMoney(holding.value)}</div>
                                <div className="text-xs text-text-muted tabular-nums">
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

          {groupingLevel === 'subCategory' && (() => {
            const subCategories: { name: string; value: number; percentage: number; color: string; holdings: Holding[] }[] = [];
            let colorIndex = 0;
            for (const ac of assetClasses) {
              for (const sc of ac.subCategories) {
                subCategories.push({
                  name: sc.name,
                  value: sc.value,
                  percentage: (sc.value / totalValue) * 100,
                  color: COLORS[colorIndex % COLORS.length],
                  holdings: sc.holdings,
                });
                colorIndex++;
              }
            }
            return subCategories.sort((a, b) => b.value - a.value).map((subCategory, i) => (
              <motion.div
                key={subCategory.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="glass-card rounded-2xl overflow-hidden"
              >
                <button
                  onClick={() => toggleCategory(subCategory.name)}
                  className="w-full p-4 md:p-5 text-left hover:bg-surface-hover transition-all duration-200"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: subCategory.color }}
                      />
                      <span className="font-medium">{subCategory.name}</span>
                      <span className="text-sm text-text-muted px-2 py-0.5 rounded-full bg-surface-solid">
                        {subCategory.holdings.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="font-display text-lg md:text-xl font-semibold tabular-nums">
                          {formatMoney(subCategory.value)}
                        </span>
                        <span className="text-text-muted text-sm ml-2">
                          {subCategory.percentage.toFixed(1)}%
                        </span>
                      </div>
                      <motion.span
                        animate={{ rotate: expandedCategories[subCategory.name] ? 180 : 0 }}
                        className="text-text-muted"
                      >
                        ▾
                      </motion.span>
                    </div>
                  </div>
                </button>

                <AnimatePresence>
                  {expandedCategories[subCategory.name] && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="border-t border-border bg-bg/30 overflow-hidden px-4 md:px-5 py-3 md:py-4"
                    >
                      <div className="space-y-1">
                        {subCategory.holdings.map((holding) => (
                          <div
                            key={`${holding.ticker}-${holding.account}`}
                            className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg hover:bg-surface-hover transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-surface-solid flex items-center justify-center text-xs font-medium text-text-muted">
                                {holding.ticker.slice(0, 3)}
                              </div>
                              <div>
                                <div className="font-medium text-text-secondary">{holding.ticker}</div>
                                <div className="text-xs text-text-muted">{holding.account}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="tabular-nums">{formatMoney(holding.value)}</div>
                              <div className="text-xs text-text-muted tabular-nums">
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
            // Group holdings by ticker
            const tickerMap = new Map<string, { holdings: Holding[]; totalValue: number; totalShares: number }>();
            for (const ac of assetClasses) {
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
                      <div className="w-8 h-8 rounded-lg bg-surface-solid flex items-center justify-center text-xs font-medium text-text-muted">
                        {group.ticker.slice(0, 3)}
                      </div>
                      <div>
                        <div className="font-medium">{group.ticker}</div>
                        <div className="text-xs text-text-muted">
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
                        <span className="text-text-muted text-sm ml-2">
                          {group.percentage.toFixed(1)}%
                        </span>
                      </div>
                      {group.holdings.length > 1 && (
                        <motion.span
                          animate={{ rotate: expandedCategories[`holding-${group.ticker}`] ? 180 : 0 }}
                          className="text-text-muted"
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
                                <div className="text-right text-text-muted w-24">
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
