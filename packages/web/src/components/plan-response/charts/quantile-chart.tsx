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
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../../lib/hide-amounts.js';

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

const formatCurrency = (value: number): string => {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  if (value < 0) return `\u2212${formatCurrency(-value)}`;
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

  // Every row here is a percentile label plus a dollar figure, so with amounts
  // hidden the list collapses to five identical masks. The year alone is the
  // only thing left that carries information, so that is all we render.
  if (isAmountsHidden()) {
    return (
      <div className="bg-panel-raised border border-line rounded-ui-lg p-4 shadow-ui-md">
        <div className="text-content font-semibold">Year {label}</div>
      </div>
    );
  }

  return (
    <div className="bg-panel-raised border border-line rounded-ui-lg p-4 shadow-ui-md min-w-[200px]">
      <div className="text-content font-semibold mb-3 pb-2 border-b border-line">
        Year {label}
      </div>
      <div className="space-y-2 text-[13px]">
        <div className="flex justify-between">
          <span className="text-content-secondary">95th Percentile (Best)</span>
          <span className="text-positive font-medium tabular-nums">{formatFullCurrency(dataPoint.p95)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-secondary">75th Percentile</span>
          <span className="text-content font-medium tabular-nums">{formatFullCurrency(dataPoint.p75)}</span>
        </div>
        <div className="flex justify-between bg-brand-soft -mx-2 px-2 py-1 rounded">
          <span className="text-[rgb(var(--ui-brand-ink))] font-medium">Median</span>
          <span className="text-[rgb(var(--ui-brand-ink))] font-semibold tabular-nums">{formatFullCurrency(dataPoint.p50)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-secondary">25th Percentile</span>
          <span className="text-content font-medium tabular-nums">{formatFullCurrency(dataPoint.p25)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-secondary">5th Percentile (Worst)</span>
          <span className="text-negative font-medium tabular-nums">{formatFullCurrency(dataPoint.p5)}</span>
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
  const hideAmounts = isAmountsHidden();

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
    return <div className="text-content-secondary p-4">No projection data available</div>;
  }

  return (
    <div className="bg-panel border border-line rounded-ui-xl shadow-ui-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-line">
        <div>
          <h3 className="text-base font-semibold text-content">{title}</h3>
          <p className="text-sm text-content-secondary mt-1">
            Portfolio value range over {yearsShown} years
          </p>
        </div>
      </div>

      {/* Final year stats */}
      <div className="grid grid-cols-5 gap-4 p-5 border-b border-line bg-panel-inset">
        <div className="text-center">
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">Worst 5%</div>
          <div className={cn(
            "text-sm font-semibold tabular-nums",
            finalStats.p5 <= 0 && !hideAmounts ? "text-negative" : "text-content"
          )}>
            {formatCurrency(finalStats.p5)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">25th %ile</div>
          <div className="text-sm font-semibold text-content tabular-nums">{formatCurrency(finalStats.p25)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-[rgb(var(--ui-brand-ink))] uppercase tracking-wide mb-1">Median</div>
          <div className="text-lg font-bold text-[rgb(var(--ui-brand-ink))] tabular-nums">{formatCurrency(finalStats.p50)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">75th %ile</div>
          <div className="text-sm font-semibold text-content tabular-nums">{formatCurrency(finalStats.p75)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-content-secondary uppercase tracking-wide mb-1">Best 5%</div>
          <div className="text-sm font-semibold text-positive tabular-nums">{formatCurrency(finalStats.p95)}</div>
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
                  <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="var(--ui-viz-2)" stopOpacity={0.05} />
                </linearGradient>
                {/* Middle band (25-75) gradient */}
                <linearGradient id="gradient-middle" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--ui-viz-2)" stopOpacity={0.15} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--ui-line)"
                strokeOpacity={0.5}
                vertical={false}
              />
              <XAxis
                dataKey="year"
                stroke="rgb(var(--ui-content-muted))"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                dy={8}
              />
              {/* Money tick labels go away entirely while amounts are hidden,
                  and the 60px they reserved with them. The band geometry is
                  untouched: the domain is fit to the data. */}
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
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--ui-viz-2)', strokeWidth: 1, strokeDasharray: '4 4' }} />

              {/* Reference lines */}
              {retirementYear && (
                <ReferenceLine
                  x={retirementYear}
                  stroke="var(--ui-viz-3)"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ value: 'Retire', position: 'top', fill: 'var(--ui-viz-3)', fontSize: 11 }}
                />
              )}
              <ReferenceLine y={0} stroke="rgb(var(--ui-negative))" strokeWidth={1} />

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
                fill="rgb(var(--ui-panel))"
              />

              {/* Median line */}
              <Area
                type="monotone"
                dataKey="p50"
                stroke="var(--ui-viz-2)"
                strokeWidth={2.5}
                fill="none"
                dot={false}
              />

              {/* Outer bounds as thin lines */}
              <Area
                type="monotone"
                dataKey="p5"
                stroke="rgb(var(--ui-negative))"
                strokeWidth={1}
                strokeDasharray="4 4"
                fill="none"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="p95"
                stroke="rgb(var(--ui-positive))"
                strokeWidth={1}
                strokeDasharray="4 4"
                fill="none"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-content-secondary">
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 bg-viz-2" />
            <span>Median (50th)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 bg-viz-2 opacity-20 rounded-sm" />
            <span>25th-75th</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 bg-viz-2 opacity-10 rounded-sm" />
            <span>5th-95th</span>
          </div>
        </div>
      </div>
    </div>
  );
}
