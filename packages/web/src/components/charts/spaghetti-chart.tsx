import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { colors } from '../../styles/theme';

interface SpaghettiChartProps {
  paths: number[][];
  years?: number;
  height?: number;
}

function formatValue(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  if (value < 0) {
    return `-$${Math.abs(value).toFixed(0)}`;
  }
  return `$${value.toFixed(0)}`;
}

export function SpaghettiChart({ paths, years, height = 300 }: SpaghettiChartProps) {
  if (!paths || paths.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-text-muted">
        No simulation paths available
      </div>
    );
  }

  // Determine actual number of years from the longest path
  const maxPathLength = Math.max(...paths.map(p => p.length));
  const numYears = years ?? maxPathLength;

  // Transform paths into chart data
  const chartData = Array.from({ length: numYears }, (_, yearIndex) => {
    const dataPoint: Record<string, number | undefined> = { year: yearIndex };
    paths.forEach((path, pathIndex) => {
      if (yearIndex < path.length) {
        dataPoint[`path${pathIndex}`] = path[yearIndex];
      }
    });
    return dataPoint;
  });

  // Determine success/failure for each path (last value > 0 = success)
  const pathColors = paths.map((path) => {
    const finalValue = path[path.length - 1];
    return finalValue > 0 ? '#4ade80' : '#ef4444'; // green for success, red for failure
  });

  // Calculate Y-axis domain
  const allValues = paths.flatMap(p => p);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const padding = (maxVal - minVal) * 0.1;

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
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
            domain={[Math.min(0, minVal - padding), maxVal + padding]}
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
            formatter={(value: number) => [formatValue(value), 'Portfolio Value']}
          />
          {/* Reference line at $0 */}
          <ReferenceLine y={0} stroke={colors.border.DEFAULT} strokeDasharray="3 3" />
          {paths.map((_, index) => (
            <Line
              key={index}
              type="monotone"
              dataKey={`path${index}`}
              stroke={pathColors[index]}
              strokeWidth={1.5}
              strokeOpacity={0.6}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
