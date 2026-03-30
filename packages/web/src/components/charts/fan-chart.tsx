import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  ReferenceLine,
} from 'recharts';
import { colors } from '../../styles/theme';

interface FanChartData {
  year: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

interface FanChartProps {
  data: FanChartData[];
  height?: number;
  color?: string;
}

function formatValue(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toFixed(0)}`;
}

export function FanChart({
  data,
  height = 300,
  color = colors.accent.DEFAULT,
}: FanChartProps) {
  if (!data || data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-text-muted">
        No data available
      </div>
    );
  }

  // Pass through data with all percentiles for proper rendering
  const chartData = data.map((d) => ({
    year: d.year,
    p5: d.p5,
    p25: d.p25,
    p50: d.p50,
    p75: d.p75,
    p95: d.p95,
  }));

  // Calculate domain for Y axis
  const allValues = data.flatMap(d => [d.p5, d.p25, d.p50, d.p75, d.p95]);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const padding = (maxVal - minVal) * 0.1;

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="outerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.15} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="innerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.15} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="year"
            stroke={colors.text.muted}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `Year ${v}`}
          />
          <YAxis
            stroke={colors.text.muted}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={formatValue}
            domain={[Math.max(0, minVal - padding), maxVal + padding]}
          />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
              fontFamily: 'DM Sans, system-ui, sans-serif',
              fontSize: '12px',
            }}
            labelFormatter={(label) => `Year ${label}`}
            formatter={(value: number, name: string) => {
              const labels: Record<string, string> = {
                p5: '5th percentile',
                p25: '25th percentile',
                p50: 'Median',
                p75: '75th percentile',
                p95: '95th percentile',
              };
              return [formatValue(value), labels[name] || name];
            }}
          />
          {/* Reference line at $0 */}
          <ReferenceLine y={0} stroke={colors.border.DEFAULT} strokeDasharray="3 3" />
          {/* 5th-95th percentile band (outer) */}
          <Area
            type="monotone"
            dataKey="p95"
            stroke="none"
            fill="url(#outerGradient)"
            fillOpacity={1}
          />
          <Area
            type="monotone"
            dataKey="p5"
            stroke="none"
            fill={colors.bg.DEFAULT}
            fillOpacity={1}
          />
          {/* 25th-75th percentile band (inner) */}
          <Area
            type="monotone"
            dataKey="p75"
            stroke="none"
            fill="url(#innerGradient)"
            fillOpacity={1}
          />
          <Area
            type="monotone"
            dataKey="p25"
            stroke="none"
            fill={colors.bg.DEFAULT}
            fillOpacity={1}
          />
          {/* Median line */}
          <Line
            type="monotone"
            dataKey="p50"
            stroke={color}
            strokeWidth={2.5}
            dot={false}
            name="p50"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
