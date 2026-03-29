import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { colors } from '../../styles/theme';

interface StackedBarDataPoint {
  name: string;
  value: number;
  color: string;
}

interface StackedBarChartProps {
  data: StackedBarDataPoint[];
  height?: number;
  onClick?: (name: string) => void;
}

export function StackedBarChart({
  data,
  height = 60,
  onClick,
}: StackedBarChartProps) {
  // Transform to single stacked bar format
  const totalValue = data.reduce((sum, d) => sum + d.value, 0);
  const chartData = [
    data.reduce((acc, d, i) => {
      acc[`segment${i}`] = d.value;
      return acc;
    }, {} as Record<string, number>),
  ];

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide domain={[0, totalValue]} />
          <YAxis type="category" hide />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value, name) => {
              const idx = parseInt(String(name).replace('segment', ''));
              const item = data[idx];
              return [`$${Number(value).toLocaleString()} (${((Number(value) / totalValue) * 100).toFixed(1)}%)`, item?.name || ''];
            }}
          />
          {data.map((item, index) => (
            <Bar
              key={index}
              dataKey={`segment${index}`}
              stackId="stack"
              fill={item.color}
              radius={index === 0 ? [8, 0, 0, 8] : index === data.length - 1 ? [0, 8, 8, 0] : 0}
              onClick={() => onClick?.(item.name)}
              style={{ cursor: onClick ? 'pointer' : 'default' }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
