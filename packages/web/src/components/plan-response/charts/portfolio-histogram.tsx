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

interface PortfolioHistogramProps {
  title: string;
  data: number[]; // Array of end portfolio values from simulations
  bucketCount?: number;
  initialPortfolio?: number;
  successThreshold?: number; // Portfolio value considered "success" (default: 0)
}

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  if (value < 0) return `-$${Math.abs(value).toLocaleString()}`;
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
        range: formatCurrency(bucketMin),
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
    return <div className="text-text-muted p-4">No simulation data available</div>;
  }

  return (
    <div className="bg-surface/50 backdrop-blur-sm border border-border/50 rounded-2xl shadow-lg overflow-hidden">
      {/* Header with success rate */}
      <div className="flex items-center justify-between p-5 border-b border-border/50">
        <div>
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <p className="text-sm text-text-muted mt-1">
            Based on {data.length} historical simulations
          </p>
        </div>
        <div className="text-right">
          <div className={cn(
            "text-3xl font-bold tabular-nums",
            stats.successRate >= 95 ? "text-green-400" :
            stats.successRate >= 80 ? "text-yellow-400" :
            "text-red-400"
          )}>
            {stats.successRate.toFixed(1)}%
          </div>
          <div className="text-xs text-text-muted uppercase tracking-wide">
            Success Rate
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 p-5 border-b border-border/50 bg-[#0f0f11]">
        <div>
          <div className="text-xs text-text-muted uppercase tracking-wide mb-1">10th Percentile</div>
          <div className="text-sm font-semibold text-text tabular-nums">{formatCurrency(stats.p10)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Median</div>
          <div className="text-sm font-semibold text-accent tabular-nums">{formatCurrency(stats.median)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted uppercase tracking-wide mb-1">90th Percentile</div>
          <div className="text-sm font-semibold text-text tabular-nums">{formatCurrency(stats.p90)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted uppercase tracking-wide mb-1">Best Case</div>
          <div className="text-sm font-semibold text-green-400 tabular-nums">{formatCurrency(stats.max)}</div>
        </div>
      </div>

      {/* Histogram */}
      <div className="p-5">
        <div className="h-[250px] w-full">
          <ResponsiveContainer>
            <BarChart data={buckets} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#27272a"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey="range"
                stroke="#57534e"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                dy={8}
              />
              <YAxis
                stroke="#57534e"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dx={-8}
                width={40}
                label={{ value: 'Simulations', angle: -90, position: 'insideLeft', fill: '#57534e', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(12, 10, 9, 0.95)',
                  border: '1px solid #3f3f46',
                  borderRadius: '12px',
                  fontSize: '13px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                  padding: '12px 16px',
                }}
                formatter={(value: any, name: any, props: any): [string, string] => {
                  const bucket = props.payload;
                  const numValue = Number(value) || 0;
                  return [
                    `${numValue} simulations (${((numValue / data.length) * 100).toFixed(1)}%)`,
                    `${formatCurrency(bucket.min)} - ${formatCurrency(bucket.max)}`
                  ];
                }}
                labelFormatter={() => 'Portfolio Range'}
                cursor={{ fill: 'rgba(255,255,255,0.03)' }}
              />
              {/* Reference line at $0 or success threshold */}
              {successThreshold !== undefined && (
                <ReferenceLine
                  x={formatCurrency(successThreshold)}
                  stroke="#ef4444"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              )}
              {/* Reference line at initial portfolio */}
              {initialPortfolio && (
                <ReferenceLine
                  x={formatCurrency(initialPortfolio)}
                  stroke="#f97316"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                />
              )}
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {buckets.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.isFailure ? '#ef4444' : '#6366f1'}
                    fillOpacity={0.8}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-text-muted">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-[#6366f1]" />
            <span>Successful ({data.filter(v => v > successThreshold).length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-[#ef4444]" />
            <span>Failed ({data.filter(v => v <= successThreshold).length})</span>
          </div>
        </div>
      </div>
    </div>
  );
}
