import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
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

export function FanChart({
  data,
  height = 300,
  color = colors.accent.DEFAULT,
}: FanChartProps) {
  // Transform data to show areas
  const chartData = data.map((d) => ({
    year: d.year,
    // Outer band (5th-95th)
    outerLow: d.p5,
    outerHigh: d.p95 - d.p5,
    // Inner band (25th-75th)
    innerLow: d.p25,
    innerHigh: d.p75 - d.p25,
    // Median
    median: d.p50,
  }));

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <defs>
            <linearGradient id="outerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.1} />
              <stop offset="100%" stopColor={color} stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="innerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0.25} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="year"
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
          />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value) => [`$${Number(value).toLocaleString()}`, '']}
          />
          {/* 5th-95th percentile band */}
          <Area
            type="monotone"
            dataKey="outerHigh"
            stackId="outer"
            stroke="none"
            fill="url(#outerGradient)"
          />
          {/* 25th-75th percentile band */}
          <Area
            type="monotone"
            dataKey="innerHigh"
            stackId="inner"
            stroke="none"
            fill="url(#innerGradient)"
          />
          {/* Median line */}
          <Line
            type="monotone"
            dataKey="median"
            stroke={color}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
