import { useState, useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { cn } from '../../../lib/utils.js';

interface QuantileData {
  year: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

interface QuantileChartProps {
  title: string;
  data: QuantileData[];
  retirementYear?: number;
  initialPortfolio?: number;
  showAllQuantiles?: boolean;
}

const formatCurrency = (value: number) => {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  if (value < 0) return `-$${Math.abs(value / 1000).toFixed(0)}K`;
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
  label,
}: {
  active?: boolean;
  payload?: any[];
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;

  // Find the data point
  const dataPoint = payload[0]?.payload;
  if (!dataPoint) return null;

  return (
    <div className="bg-[#0c0a09]/95 border border-[#3f3f46] rounded-xl p-4 shadow-2xl min-w-[200px]">
      <div className="text-text font-semibold mb-3 pb-2 border-b border-[#27272a]">
        Year {label}
      </div>
      <div className="space-y-2 text-[13px]">
        <div className="flex justify-between">
          <span className="text-text-secondary">95th Percentile (Best)</span>
          <span className="text-green-400 font-medium tabular-nums">{formatFullCurrency(dataPoint.p95)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-secondary">75th Percentile</span>
          <span className="text-text font-medium tabular-nums">{formatFullCurrency(dataPoint.p75)}</span>
        </div>
        <div className="flex justify-between bg-accent/10 -mx-2 px-2 py-1 rounded">
          <span className="text-accent font-medium">Median</span>
          <span className="text-accent font-semibold tabular-nums">{formatFullCurrency(dataPoint.p50)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-secondary">25th Percentile</span>
          <span className="text-text font-medium tabular-nums">{formatFullCurrency(dataPoint.p25)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-secondary">5th Percentile (Worst)</span>
          <span className="text-red-400 font-medium tabular-nums">{formatFullCurrency(dataPoint.p5)}</span>
        </div>
      </div>
    </div>
  );
}

export function QuantileChart({
  title,
  data,
  retirementYear,
  initialPortfolio,
  showAllQuantiles = false,
}: QuantileChartProps) {
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);

  const { finalStats, yearsShown } = useMemo(() => {
    if (!data || data.length === 0) return { finalStats: null, yearsShown: 0 };

    const finalYear = data[data.length - 1];
    return {
      finalStats: {
        p5: finalYear.p5,
        p25: finalYear.p25,
        p50: finalYear.p50,
        p75: finalYear.p75,
        p95: finalYear.p95,
      },
      yearsShown: data.length,
    };
  }, [data]);

  if (!finalStats) {
    return <div className="text-text-secondary p-4">No projection data available</div>;
  }

  return (
    <div className="bg-surface/50 backdrop-blur-sm border border-border/50 rounded-2xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-border/50">
        <div>
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <p className="text-sm text-text-secondary mt-1">
            Portfolio value range over {yearsShown} years
          </p>
        </div>
      </div>

      {/* Final year stats */}
      <div className="grid grid-cols-5 gap-4 p-5 border-b border-border/50 bg-[#0f0f11]">
        <div className="text-center">
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Worst 5%</div>
          <div className={cn(
            "text-sm font-semibold tabular-nums",
            finalStats.p5 <= 0 ? "text-red-400" : "text-text"
          )}>
            {formatCurrency(finalStats.p5)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">25th %ile</div>
          <div className="text-sm font-semibold text-text tabular-nums">{formatCurrency(finalStats.p25)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-accent uppercase tracking-wide mb-1">Median</div>
          <div className="text-lg font-bold text-accent tabular-nums">{formatCurrency(finalStats.p50)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">75th %ile</div>
          <div className="text-sm font-semibold text-text tabular-nums">{formatCurrency(finalStats.p75)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Best 5%</div>
          <div className="text-sm font-semibold text-green-400 tabular-nums">{formatCurrency(finalStats.p95)}</div>
        </div>
      </div>

      {/* Fan chart */}
      <div className="p-5">
        <div className="h-[300px] w-full">
          <ResponsiveContainer>
            <AreaChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              onMouseMove={(state: any) => {
                if (state?.activePayload?.[0]) {
                  setHoveredYear(state.activePayload[0].payload.year);
                }
              }}
              onMouseLeave={() => setHoveredYear(null)}
            >
              <defs>
                {/* Outer band (5-95) gradient */}
                <linearGradient id="gradient-outer" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                </linearGradient>
                {/* Middle band (25-75) gradient */}
                <linearGradient id="gradient-middle" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.15} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#27272a"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey="year"
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
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />

              {/* Reference lines */}
              {retirementYear && (
                <ReferenceLine
                  x={retirementYear}
                  stroke="#f97316"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ value: 'Retire', position: 'top', fill: '#f97316', fontSize: 11 }}
                />
              )}
              <ReferenceLine y={0} stroke="#ef4444" strokeWidth={1} />

              {/* 5-95 percentile band (outer) */}
              <Area
                type="monotone"
                dataKey="p95"
                stroke="none"
                fill="url(#gradient-outer)"
                stackId="band-outer-top"
              />
              <Area
                type="monotone"
                dataKey="p5"
                stroke="none"
                fill="transparent"
                stackId="band-outer-bottom"
              />

              {/* 25-75 percentile band (middle) */}
              <Area
                type="monotone"
                dataKey="p75"
                stroke="none"
                fill="url(#gradient-middle)"
              />
              <Area
                type="monotone"
                dataKey="p25"
                stroke="none"
                fill="#0f0f11"
              />

              {/* Median line */}
              <Area
                type="monotone"
                dataKey="p50"
                stroke="#6366f1"
                strokeWidth={2.5}
                fill="none"
                dot={false}
              />

              {/* Outer bounds as thin lines */}
              <Area
                type="monotone"
                dataKey="p5"
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="4 4"
                fill="none"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="p95"
                stroke="#22c55e"
                strokeWidth={1}
                strokeDasharray="4 4"
                fill="none"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 bg-[#6366f1]" />
            <span>Median (50th)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 bg-[#6366f1]/20 rounded-sm" />
            <span>25th-75th</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 bg-[#6366f1]/10 rounded-sm" />
            <span>5th-95th</span>
          </div>
        </div>
      </div>
    </div>
  );
}
