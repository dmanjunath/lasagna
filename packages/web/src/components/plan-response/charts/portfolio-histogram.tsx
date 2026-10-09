import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { cn } from '../../../lib/utils.js';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../../lib/hide-amounts.js';

interface PortfolioHistogramProps {
  title: string;
  data: number[]; // Array of end portfolio values from simulations
  bucketCount?: number;
  initialPortfolio?: number;
  successThreshold?: number; // Portfolio value considered "success" (default: 0)
}

// The bucket label doubles as the bar's CATEGORY KEY, so it must stay a real,
// distinct string even while amounts are hidden: masking it would give all
// twenty buckets the same key and collapse them into one bar. The raw form is
// therefore kept separate, and the labels are suppressed at the axis instead.
const formatCurrencyRaw = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  if (value < 0) return `\u2212$${Math.abs(value).toLocaleString()}`;
  return `$${value.toLocaleString()}`;
};

const formatCurrency = (value: number) =>
  isAmountsHidden() ? HIDDEN_AMOUNT : formatCurrencyRaw(value);

const formatFullCurrency = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

// Calculate percentile
function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

export function PortfolioHistogram({
  title,
  data,
  bucketCount = 20,
  initialPortfolio,
  successThreshold = 0,
}: PortfolioHistogramProps) {
  const hideAmounts = isAmountsHidden();
  const { buckets, stats } = useMemo(() => {
    if (!data || data.length === 0) {
      return { buckets: [], stats: null };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min;
    const bucketSize = range / bucketCount;

    // Create buckets
    const bucketData: { range: string; count: number; min: number; max: number; isFailure: boolean }[] = [];
    for (let i = 0; i < bucketCount; i++) {
      const bucketMin = min + i * bucketSize;
      const bucketMax = min + (i + 1) * bucketSize;
      bucketData.push({
        range: formatCurrencyRaw(bucketMin),
        min: bucketMin,
        max: bucketMax,
        count: 0,
        isFailure: bucketMax <= successThreshold,
      });
    }

    // Fill buckets
    for (const value of data) {
      const bucketIdx = Math.min(
        Math.floor((value - min) / bucketSize),
        bucketCount - 1
      );
      bucketData[bucketIdx].count++;
    }

    // Calculate statistics
    const successCount = data.filter(v => v > successThreshold).length;
    const stats = {
      successRate: (successCount / data.length) * 100,
      median: percentile(data, 50),
      p10: percentile(data, 10),
      p25: percentile(data, 25),
      p75: percentile(data, 75),
      p90: percentile(data, 90),
      min: Math.min(...data),
      max: Math.max(...data),
      mean: data.reduce((a, b) => a + b, 0) / data.length,
    };

    return { buckets: bucketData, stats };
  }, [data, bucketCount, successThreshold]);

  if (!stats) {
    return <div className="text-content-secondary p-4">No simulation data available</div>;
  }

  return (
    <div className="bg-panel border border-line rounded-ui-xl shadow-ui-sm overflow-hidden">
      {/* Header with success rate */}
      <div className="flex items-center justify-between p-5 border-b border-line">
        <div>
          <h3 className="text-base font-semibold text-content">{title}</h3>
          <p className="text-sm text-content-secondary mt-1">
            Based on {data.length} historical simulations
          </p>
        </div>
        <div className="text-right">
          <div className={cn(
            "text-3xl font-bold tabular-nums",
            stats.successRate >= 95 ? "text-positive" :
            stats.successRate >= 80 ? "text-caution" :
            "text-negative"
          )}>
            {stats.successRate.toFixed(1)}%
          </div>
          <div className="text-xs text-content-secondary uppercase tracking-wide">
            Success Rate
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 p-5 border-b border-line bg-panel-inset">
        <div>
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">10th Percentile</div>
          <div className="text-sm font-semibold text-content tabular-nums">{formatCurrency(stats.p10)}</div>
        </div>
        <div>
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">Median</div>
          <div className="text-sm font-semibold text-[rgb(var(--ui-brand-ink))] tabular-nums">{formatCurrency(stats.median)}</div>
        </div>
        <div>
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">90th Percentile</div>
          <div className="text-sm font-semibold text-content tabular-nums">{formatCurrency(stats.p90)}</div>
        </div>
        <div>
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">Best Case</div>
          <div className="text-sm font-semibold text-positive tabular-nums">{formatCurrency(stats.max)}</div>
        </div>
      </div>

      {/* Histogram */}
      <div className="p-5">
        <div className="h-[250px] w-full">
          <ResponsiveContainer>
            <BarChart data={buckets} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--ui-line)"
                strokeOpacity={0.5}
                vertical={false}
              />
              {/* This chart's MONEY axis is x (portfolio buckets); y counts
                  simulations and stays. The bucket labels are removed while
                  amounts are hidden, and the height they reserved with them.
                  The bars are unchanged. */}
              <XAxis
                dataKey="range"
                stroke="rgb(var(--ui-content-muted))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                dy={8}
                hide={hideAmounts}
              />
              <YAxis
                stroke="rgb(var(--ui-content-muted))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dx={-8}
                width={40}
                label={{ value: 'Simulations', angle: -90, position: 'insideLeft', fill: 'rgb(var(--ui-content-muted))', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(var(--ui-panel-raised))',
                  border: '1px solid var(--ui-line)',
                  borderRadius: '12px',
                  fontSize: '13px',
                  boxShadow: 'var(--ui-shadow-md)',
                  padding: '12px 16px',
                }}
                separator={hideAmounts ? '' : ' : '}
                formatter={(value: any, name: any, props: any): [string, string] => {
                  const bucket = props.payload;
                  const numValue = Number(value) || 0;
                  const count = `${numValue} simulations (${((numValue / data.length) * 100).toFixed(1)}%)`;
                  // The bucket range is pure money, so hidden it would read
                  // "$••••• - $•••••". The count and its share are the real
                  // content, so that is all that is left.
                  if (hideAmounts) return [count, ''];
                  return [count, `${formatCurrencyRaw(bucket.min)} - ${formatCurrencyRaw(bucket.max)}`];
                }}
                labelFormatter={() => 'Portfolio Range'}
                cursor={{ fill: 'var(--ui-hairline)' }}
              />
              {/* Reference line at $0 or success threshold */}
              {successThreshold !== undefined && (
                <ReferenceLine
                  x={formatCurrencyRaw(successThreshold)}
                  stroke="rgb(var(--ui-negative))"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              )}
              {/* Reference line at initial portfolio */}
              {initialPortfolio && (
                <ReferenceLine
                  x={formatCurrencyRaw(initialPortfolio)}
                  stroke="var(--ui-viz-3)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              )}
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {buckets.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isFailure ? 'rgb(var(--ui-negative))' : 'var(--ui-viz-2)'}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-content-secondary">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-viz-2" />
            <span>Successful ({data.filter(v => v > successThreshold).length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-negative" />
            <span>Failed ({data.filter(v => v <= successThreshold).length})</span>
          </div>
        </div>
      </div>
    </div>
  );
}
