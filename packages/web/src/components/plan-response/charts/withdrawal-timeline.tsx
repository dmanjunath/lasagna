import { useState, useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { cn } from '../../../lib/utils.js';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../../lib/hide-amounts.js';

interface WithdrawalData {
  year: number;
  age?: number;
  withdrawal: number;
  portfolioValue: number;
  socialSecurity?: number;
  pension?: number;
  otherIncome?: number;
  totalIncome?: number;
  inflationAdjusted?: number;
}

interface WithdrawalTimelineProps {
  title: string;
  data: WithdrawalData[];
  targetWithdrawal?: number;
  retirementAge?: number;
  showSources?: boolean;
}

const formatCurrency = (value: number): string => {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  if (value < 0) return `\u2212${formatCurrency(-value)}`;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatFullCurrency = (value: number) => {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value).replace(/^-/, '\u2212');
};

// Custom tooltip
function CustomTooltip({
  active,
  payload,
  showSources,
}: {
  active?: boolean;
  payload?: any[];
  showSources?: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const dataPoint = payload[0]?.payload;
  if (!dataPoint) return null;

  // Every row is an income-source label plus a dollar figure, so with amounts
  // hidden the body collapses to a column of identical masks. The age or year
  // is the only line left that says anything.
  if (isAmountsHidden()) {
    return (
      <div className="bg-panel-raised border border-line rounded-ui-lg p-4 shadow-ui-md">
        <div className="text-content font-semibold">
          {dataPoint.age ? `Age ${dataPoint.age}` : `Year ${dataPoint.year}`}
        </div>
      </div>
    );
  }

  const totalIncome = dataPoint.totalIncome || (
    dataPoint.withdrawal +
    (dataPoint.socialSecurity || 0) +
    (dataPoint.pension || 0) +
    (dataPoint.otherIncome || 0)
  );

  return (
    <div className="bg-panel-raised border border-line rounded-ui-lg p-4 shadow-ui-md min-w-[220px]">
      <div className="text-content font-semibold mb-3 pb-2 border-b border-line">
        {dataPoint.age ? `Age ${dataPoint.age}` : `Year ${dataPoint.year}`}
      </div>

      <div className="space-y-2 text-[13px]">
        {/* Income sources */}
        <div className="flex justify-between">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-viz-2" />
            <span className="text-content-secondary">Portfolio Withdrawal</span>
          </span>
          <span className="text-content font-medium tabular-nums">{formatFullCurrency(dataPoint.withdrawal)}</span>
        </div>

        {showSources && dataPoint.socialSecurity > 0 && (
          <div className="flex justify-between">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-viz-1" />
              <span className="text-content-secondary">Social Security</span>
            </span>
            <span className="text-content font-medium tabular-nums">{formatFullCurrency(dataPoint.socialSecurity)}</span>
          </div>
        )}

        {showSources && dataPoint.pension > 0 && (
          <div className="flex justify-between">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-viz-3" />
              <span className="text-content-secondary">Pension</span>
            </span>
            <span className="text-content font-medium tabular-nums">{formatFullCurrency(dataPoint.pension)}</span>
          </div>
        )}

        {showSources && dataPoint.otherIncome > 0 && (
          <div className="flex justify-between">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-[var(--ui-viz-8)]" />
              <span className="text-content-secondary">Other Income</span>
            </span>
            <span className="text-content font-medium tabular-nums">{formatFullCurrency(dataPoint.otherIncome)}</span>
          </div>
        )}

        {/* Total */}
        <div className="flex justify-between pt-2 mt-2 border-t border-line">
          <span className="text-[rgb(var(--ui-brand-ink))] font-medium">Total Annual Income</span>
          <span className="text-[rgb(var(--ui-brand-ink))] font-semibold tabular-nums">{formatFullCurrency(totalIncome)}</span>
        </div>

        {/* Portfolio value */}
        <div className="flex justify-between pt-2 mt-2 border-t border-line">
          <span className="text-content-secondary">Remaining Portfolio</span>
          <span className="text-content font-medium tabular-nums">{formatFullCurrency(dataPoint.portfolioValue)}</span>
        </div>
      </div>
    </div>
  );
}

export function WithdrawalTimeline({
  title,
  data,
  targetWithdrawal,
  retirementAge,
  showSources = true,
}: WithdrawalTimelineProps) {
  const [view, setView] = useState<'withdrawal' | 'portfolio'>('withdrawal');
  const hideAmounts = isAmountsHidden();

  const { stats, hasMultipleSources } = useMemo(() => {
    if (!data || data.length === 0) return { stats: null, hasMultipleSources: false };

    const totalWithdrawals = data.reduce((sum, d) => sum + d.withdrawal, 0);
    const avgWithdrawal = totalWithdrawals / data.length;
    const maxWithdrawal = Math.max(...data.map(d => d.withdrawal));
    const minWithdrawal = Math.min(...data.map(d => d.withdrawal));
    const finalPortfolio = data[data.length - 1]?.portfolioValue || 0;

    const hasMultipleSources = data.some(d =>
      (d.socialSecurity && d.socialSecurity > 0) ||
      (d.pension && d.pension > 0) ||
      (d.otherIncome && d.otherIncome > 0)
    );

    return {
      stats: {
        avgWithdrawal,
        maxWithdrawal,
        minWithdrawal,
        totalWithdrawals,
        finalPortfolio,
        years: data.length,
      },
      hasMultipleSources,
    };
  }, [data]);

  if (!stats) {
    return <div className="text-content-secondary p-4">No withdrawal data available</div>;
  }

  return (
    <div className="bg-panel border border-line rounded-ui-xl shadow-ui-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-line">
        <div>
          <h3 className="text-base font-semibold text-content">{title}</h3>
          <p className="text-sm text-content-secondary mt-1">
            {stats.years}-year withdrawal plan
          </p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setView('withdrawal')}
            className={cn(
              'px-3 py-1 rounded-lg text-[12px] font-medium transition-all',
              view === 'withdrawal'
                ? 'bg-brand text-brand-fg'
                : 'bg-panel text-content-secondary hover:bg-canvas-sunken'
            )}
          >
            Withdrawals
          </button>
          <button
            onClick={() => setView('portfolio')}
            className={cn(
              'px-3 py-1 rounded-lg text-[12px] font-medium transition-all',
              view === 'portfolio'
                ? 'bg-brand text-brand-fg'
                : 'bg-panel text-content-secondary hover:bg-canvas-sunken'
            )}
          >
            Portfolio
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 p-5 border-b border-line bg-panel-inset">
        <div>
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">Avg Annual</div>
          <div className="text-sm font-semibold text-[rgb(var(--ui-brand-ink))] tabular-nums">{formatCurrency(stats.avgWithdrawal)}</div>
        </div>
        <div>
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">Minimum</div>
          <div className="text-sm font-semibold text-content tabular-nums">{formatCurrency(stats.minWithdrawal)}</div>
        </div>
        <div>
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">Maximum</div>
          <div className="text-sm font-semibold text-content tabular-nums">{formatCurrency(stats.maxWithdrawal)}</div>
        </div>
        <div>
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">End Portfolio</div>
          <div className={cn(
            "text-sm font-semibold tabular-nums",
            stats.finalPortfolio > 0 || hideAmounts ? "text-positive" : "text-negative"
          )}>
            {formatCurrency(stats.finalPortfolio)}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="p-5">
        <div className="h-[280px] w-full">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="withdrawal-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--ui-viz-2)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="portfolio-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ui-viz-1)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--ui-viz-1)" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--ui-line)"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey={data[0]?.age ? 'age' : 'year'}
                stroke="rgb(var(--ui-content-muted))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dy={8}
              />
              {/* Money tick labels are removed while amounts are hidden, and
                  the 60px they reserved with them. The bars are unchanged: the
                  domain is fit to the data. */}
              <YAxis
                stroke="rgb(var(--ui-content-muted))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatCurrency}
                dx={-8}
                width={60}
                hide={hideAmounts}
              />
              <Tooltip content={<CustomTooltip showSources={hasMultipleSources && showSources} />} />

              {/* Target withdrawal reference */}
              {targetWithdrawal && view === 'withdrawal' && (
                <ReferenceLine
                  y={targetWithdrawal}
                  stroke="var(--ui-viz-3)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ value: 'Target', position: 'right', fill: 'var(--ui-viz-3)', fontSize: 11 }}
                />
              )}

              {/* Zero line for portfolio */}
              {view === 'portfolio' && (
                <ReferenceLine y={0} stroke="rgb(var(--ui-negative))" strokeWidth={1} />
              )}

              {view === 'withdrawal' ? (
                <>
                  {/* Stacked income sources */}
                  {hasMultipleSources && showSources && (
                    <>
                      <Bar dataKey="otherIncome" stackId="income" fill="var(--ui-viz-8)" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="pension" stackId="income" fill="var(--ui-viz-3)" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="socialSecurity" stackId="income" fill="var(--ui-viz-1)" radius={[0, 0, 0, 0]} />
                    </>
                  )}
                  <Bar
                    dataKey="withdrawal"
                    stackId={hasMultipleSources && showSources ? "income" : undefined}
                    fill="var(--ui-viz-2)"
                    radius={hasMultipleSources ? [4, 4, 0, 0] : [4, 4, 4, 4]}
                  />
                </>
              ) : (
                <Area
                  type="monotone"
                  dataKey="portfolioValue"
                  stroke="var(--ui-viz-1)"
                  strokeWidth={2}
                  fill="url(#portfolio-gradient)"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        {view === 'withdrawal' && hasMultipleSources && showSources && (
          <div className="flex items-center justify-center gap-4 mt-4 text-xs text-content-secondary">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-viz-2" />
              <span>Portfolio</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-viz-1" />
              <span>Social Security</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-viz-3" />
              <span>Pension</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[var(--ui-viz-8)]" />
              <span>Other</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
