import { PieChart as RechartsPieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { colors } from '../../styles/theme';

interface PieDataPoint {
  name: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieDataPoint[];
  innerRadius?: number;
  outerRadius?: number;
  size?: number;
}

export function DonutChart({
  data,
  innerRadius = 50,
  outerRadius = 80,
  size = 200,
}: PieChartProps) {
  return (
    <div style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsPieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: colors.bg.elevated,
              border: `1px solid ${colors.border.DEFAULT}`,
              borderRadius: '12px',
            }}
            formatter={(value) => [`$${Number(value).toLocaleString()}`, '']}
          />
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}
