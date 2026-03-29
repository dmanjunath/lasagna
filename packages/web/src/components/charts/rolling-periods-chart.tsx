import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { colors } from '../../styles/theme';

interface BacktestPeriod {
  startYear: number;
  endBalance: number;
  status: 'success' | 'close' | 'failed';
}

interface RollingPeriodsChartProps {
  data: BacktestPeriod[];
  height?: number;
  initialBalance?: number;
}

const STATUS_COLORS = {
  success: '#4ade80',
  close: '#f59e0b',
  failed: '#ef4444',
};

export function RollingPeriodsChart({
  data,
  height = 200,
  initialBalance,
}: RollingPeriodsChartProps) {
  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis
            dataKey="startYear"
            stroke={colors.text.muted}
            fontSize={10}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
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
            formatter={(value) => `$${(value as number).toLocaleString()}`}
          />
          {initialBalance && (
            <ReferenceLine
              y={initialBalance}
              stroke={colors.text.muted}
              strokeDasharray="3 3"
            />
          )}
          <Bar dataKey="endBalance" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
