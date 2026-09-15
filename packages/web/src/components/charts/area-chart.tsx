import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { colors } from '../../styles/theme';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../lib/hide-amounts';

interface DataPoint {
  [key: string]: string | number;
}

interface AreaChartProps {
  data: DataPoint[];
  xKey: string;
  yKey: string;
  color?: string;
  gradientId?: string;
  formatY?: (value: number) => string;
  formatTooltip?: (value: number) => string;
  height?: number;
}

export function AreaChart({
  data,
  xKey,
  yKey,
  color = colors.accent.DEFAULT,
  gradientId = 'areaGradient',
  formatY = (v) => (isAmountsHidden() ? HIDDEN_AMOUNT : `$${(v / 1000).toFixed(0)}k`),
  formatTooltip = (v) => (isAmountsHidden() ? HIDDEN_AMOUNT : `$${v.toLocaleString()}`),
  height = 256,
}: AreaChartProps) {
  const hideAmounts = isAmountsHidden();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey={xKey}
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          {/* Money tick labels are removed while amounts are hidden, and the
              width they reserved with them. The curve is unchanged: the domain
              is fit to the data. */}
          <YAxis
            stroke={colors.text.muted}
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatY}
            hide={hideAmounts}
          />
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value) => [formatTooltip(Number(value)), '']}
          />
          <Area
            type="monotone"
            dataKey={yKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
          />
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}
