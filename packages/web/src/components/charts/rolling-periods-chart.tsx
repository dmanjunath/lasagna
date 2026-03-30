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
  yearsLasted: number;
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

const STATUS_LABELS = {
  success: 'Succeeded',
  close: 'Close call',
  failed: 'Ran out of money',
};

function formatValue(v: number): string {
  if (v === 0) return '$0';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

export function RollingPeriodsChart({
  data,
  height = 280,
  initialBalance,
}: RollingPeriodsChartProps) {
  // Determine the target years (from the longest period)
  const maxYears = Math.max(...data.map((d) => d.yearsLasted), 1);

  return (
    <div>
      {/* Description */}
      <p className="text-xs text-text-muted mb-4">
        Each bar represents a historical period starting in that year. Bar height shows how many years the portfolio lasted.
        Green bars survived the full period. Red bars ran out early.
      </p>

      <div style={{ height, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barCategoryGap="12%">
            <XAxis
              dataKey="startYear"
              stroke={colors.text.muted}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke={colors.text.muted}
              fontSize={11}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Years lasted', angle: -90, position: 'insideLeft', fill: colors.text.muted, fontSize: 11, dy: 35 }}
            />
            <Tooltip
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: '12px',
                fontSize: '13px',
              }}
              formatter={(_value: any, _name: any, props: any) => {
                const period = props.payload as BacktestPeriod;
                return [
                  `${period.yearsLasted} years — ${STATUS_LABELS[period.status]}${period.endBalance > 0 ? ` (ended at ${formatValue(period.endBalance)})` : ''}`,
                  `Starting ${period.startYear}`,
                ];
              }}
              labelFormatter={() => ''}
            />
            <ReferenceLine
              y={maxYears}
              stroke={colors.text.muted}
              strokeDasharray="3 3"
              strokeOpacity={0.4}
            />
            <Bar dataKey="yearsLasted" radius={[2, 2, 0, 0]} maxBarSize={24}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.status]} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-3">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS.success }} />
          Survived full period
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS.close }} />
          Almost made it
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLORS.failed }} />
          Ran out early
        </div>
      </div>
    </div>
  );
}
