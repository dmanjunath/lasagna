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

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatFullCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
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

  const totalIncome = dataPoint.totalIncome || (
    dataPoint.withdrawal +
    (dataPoint.socialSecurity || 0) +
    (dataPoint.pension || 0) +
    (dataPoint.otherIncome || 0)
  );

  return (
    <div className="bg-[#0c0a09]/95 border border-[#3f3f46] rounded-xl p-4 shadow-2xl min-w-[220px]">
      <div className="text-text font-semibold mb-3 pb-2 border-b border-[#27272a]">
        {dataPoint.age ? `Age ${dataPoint.age}` : `Year ${dataPoint.year}`}
      </div>

      <div className="space-y-2 text-[13px]">
        {/* Income sources */}
        <div className="flex justify-between">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-sm bg-[#6366f1]" />
            <span className="text-text-secondary">Portfolio Withdrawal</span>
          </span>
          <span className="text-text font-medium tabular-nums">{formatFullCurrency(dataPoint.withdrawal)}</span>
        </div>

        {showSources && dataPoint.socialSecurity > 0 && (
          <div className="flex justify-between">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-[#22c55e]" />
              <span className="text-text-secondary">Social Security</span>
            </span>
            <span className="text-text font-medium tabular-nums">{formatFullCurrency(dataPoint.socialSecurity)}</span>
          </div>
        )}

        {showSources && dataPoint.pension > 0 && (
          <div className="flex justify-between">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-[#f97316]" />
              <span className="text-text-secondary">Pension</span>
            </span>
            <span className="text-text font-medium tabular-nums">{formatFullCurrency(dataPoint.pension)}</span>
          </div>
        )}

        {showSources && dataPoint.otherIncome > 0 && (
          <div className="flex justify-between">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-sm bg-[#a855f7]" />
              <span className="text-text-secondary">Other Income</span>
            </span>
            <span className="text-text font-medium tabular-nums">{formatFullCurrency(dataPoint.otherIncome)}</span>
          </div>
        )}

        {/* Total */}
        <div className="flex justify-between pt-2 mt-2 border-t border-[#27272a]">
          <span className="text-accent font-medium">Total Annual Income</span>
          <span className="text-accent font-semibold tabular-nums">{formatFullCurrency(totalIncome)}</span>
        </div>

        {/* Portfolio value */}
        <div className="flex justify-between pt-2 mt-2 border-t border-[#27272a]">
          <span className="text-text-secondary">Remaining Portfolio</span>
          <span className="text-text font-medium tabular-nums">{formatFullCurrency(dataPoint.portfolioValue)}</span>
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
    return <div className="text-text-secondary p-4">No withdrawal data available</div>;
  }

  return (
    <div className="bg-surface/50 backdrop-blur-sm border border-border/50 rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-border/50">
        <div>
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <p className="text-sm text-text-secondary mt-1">
            {stats.years}-year withdrawal plan
          </p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setView('withdrawal')}
            className={cn(
              'px-3 py-1 rounded-lg text-[12px] font-medium transition-all',
              view === 'withdrawal'
                ? 'bg-accent text-white'
                : 'bg-surface text-text-secondary hover:bg-surface-elevated'
            )}
          >
            Withdrawals
          </button>
          <button
            onClick={() => setView('portfolio')}
            className={cn(
              'px-3 py-1 rounded-lg text-[12px] font-medium transition-all',
              view === 'portfolio'
                ? 'bg-accent text-white'
                : 'bg-surface text-text-secondary hover:bg-surface-elevated'
            )}
          >
            Portfolio
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 p-5 border-b border-border/50 bg-[#0f0f11]">
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Avg Annual</div>
          <div className="text-sm font-semibold text-accent tabular-nums">{formatCurrency(stats.avgWithdrawal)}</div>
        </div>
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Minimum</div>
          <div className="text-sm font-semibold text-text tabular-nums">{formatCurrency(stats.minWithdrawal)}</div>
        </div>
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Maximum</div>
          <div className="text-sm font-semibold text-text tabular-nums">{formatCurrency(stats.maxWithdrawal)}</div>
        </div>
        <div>
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">End Portfolio</div>
          <div className={cn(
            "text-sm font-semibold tabular-nums",
            stats.finalPortfolio > 0 ? "text-green-400" : "text-red-400"
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
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="portfolio-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#27272a"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey={data[0]?.age ? 'age' : 'year'}
                stroke="#57534e"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dy={8}
              />
              <YAxis
                stroke="#57534e"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatCurrency}
                dx={-8}
                width={60}
              />
              <Tooltip content={<CustomTooltip showSources={hasMultipleSources && showSources} />} />

              {/* Target withdrawal reference */}
              {targetWithdrawal && view === 'withdrawal' && (
                <ReferenceLine
                  y={targetWithdrawal}
                  stroke="#f97316"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ value: 'Target', position: 'right', fill: '#f97316', fontSize: 11 }}
                />
              )}

              {/* Zero line for portfolio */}
              {view === 'portfolio' && (
                <ReferenceLine y={0} stroke="#ef4444" strokeWidth={1} />
              )}

              {view === 'withdrawal' ? (
                <>
                  {/* Stacked income sources */}
                  {hasMultipleSources && showSources && (
                    <>
                      <Bar dataKey="otherIncome" stackId="income" fill="#a855f7" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="pension" stackId="income" fill="#f97316" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="socialSecurity" stackId="income" fill="#22c55e" radius={[0, 0, 0, 0]} />
                    </>
                  )}
                  <Bar
                    dataKey="withdrawal"
                    stackId={hasMultipleSources && showSources ? "income" : undefined}
                    fill="#6366f1"
                    radius={hasMultipleSources ? [4, 4, 0, 0] : [4, 4, 4, 4]}
                  />
                </>
              ) : (
                <Area
                  type="monotone"
                  dataKey="portfolioValue"
                  stroke="#22c55e"
                  strokeWidth={2}
                  fill="url(#portfolio-gradient)"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        {view === 'withdrawal' && hasMultipleSources && showSources && (
          <div className="flex items-center justify-center gap-4 mt-4 text-xs text-text-secondary">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[#6366f1]" />
              <span>Portfolio</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[#22c55e]" />
              <span>Social Security</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[#f97316]" />
              <span>Pension</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[#a855f7]" />
              <span>Other</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
