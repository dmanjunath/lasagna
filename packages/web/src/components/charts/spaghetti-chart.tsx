import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { colors } from '../../styles/theme';

interface SpaghettiChartProps {
  paths: number[][];
  years: number;
  height?: number;
}

export function SpaghettiChart({ paths, years, height = 300 }: SpaghettiChartProps) {
  // Transform paths into chart data
  // Each path is an array of values over years
  const chartData = Array.from({ length: years }, (_, yearIndex) => {
    const dataPoint: Record<string, number> = { year: new Date().getFullYear() + yearIndex };
    paths.forEach((path, pathIndex) => {
      if (path[yearIndex] !== undefined) {
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

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
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
            formatter={(value: any) => [`$${value?.toLocaleString?.() || value}`, 'Value']}
          />
          {paths.map((_, index) => (
            <Line
              key={index}
              type="monotone"
              dataKey={`path${index}`}
              stroke={pathColors[index]}
              strokeWidth={1}
              strokeOpacity={0.4}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
