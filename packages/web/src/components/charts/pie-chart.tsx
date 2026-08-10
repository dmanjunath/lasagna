import { PieChart as RechartsPieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { colors } from '../../styles/theme';

interface PieDataPoint {
  name: string;
  value: number;
  color: string;
  percentage?: number;
}

interface PieChartProps {
  data: PieDataPoint[];
  innerRadius?: number;
  outerRadius?: number;
  size?: number;
  showLabels?: boolean;
}

const RADIAN = Math.PI / 180;

const renderCustomizedLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  name,
}: any) => {
  // Only show label if segment is large enough (> 5%)
  if (percent < 0.05) return null;

  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      style={{
        fontSize: '11px',
        fontWeight: 600,
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        fontFamily: 'DM Sans, system-ui, sans-serif',
      }}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

const renderOuterLabel = ({
  cx,
  cy,
  midAngle,
  outerRadius,
  percent,
  name,
}: any) => {
  // Only show label if segment is large enough (> 5%)
  if (percent < 0.05) return null;

  const radius = outerRadius + 20;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill={colors.text.secondary}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      style={{
        fontSize: '11px',
        fontWeight: 500,
        fontFamily: 'DM Sans, system-ui, sans-serif',
      }}
    >
      {name}
    </text>
  );
};

// Combined label renderer that shows both percentage inside and name outside
const renderCombinedLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  name,
  value,
}: any) => {
  if (percent < 0.03) return null;

  const RADIAN_LOCAL = Math.PI / 180;

  // Inner percentage label
  const innerRadius2 = innerRadius + (outerRadius - innerRadius) * 0.5;
  const innerX = cx + innerRadius2 * Math.cos(-midAngle * RADIAN_LOCAL);
  const innerY = cy + innerRadius2 * Math.sin(-midAngle * RADIAN_LOCAL);

  // Outer name label
  const outerRadiusOffset = outerRadius + 25;
  const outerX = cx + outerRadiusOffset * Math.cos(-midAngle * RADIAN_LOCAL);
  const outerY = cy + outerRadiusOffset * Math.sin(-midAngle * RADIAN_LOCAL);

  return (
    <g>
      {/* Inner percentage */}
      {percent >= 0.05 && (
        <text
          x={innerX}
          y={innerY}
          fill="#fff"
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            fontFamily: 'DM Sans, system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          {`${(percent * 100).toFixed(0)}%`}
        </text>
      )}
      {/* Outer name */}
      {percent >= 0.05 && (
        <text
          x={outerX}
          y={outerY}
          fill={colors.text.secondary}
          textAnchor={outerX > cx ? 'start' : 'end'}
          dominantBaseline="central"
          style={{
            fontSize: '11px',
            fontWeight: 500,
            fontFamily: 'DM Sans, system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          {name}
        </text>
      )}
    </g>
  );
};

export function DonutChart({
  data,
  innerRadius = 50,
  outerRadius = 80,
  size = 200,
  showLabels = true,
}: PieChartProps) {
  // Add extra padding for labels
  const effectiveSize = showLabels ? size + 60 : size;

  return (
    <div style={{ width: effectiveSize, height: effectiveSize }}>
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
            label={showLabels ? renderCombinedLabel : undefined}
            labelLine={showLabels ? { stroke: colors.text.muted, strokeWidth: 1 } : false}
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
              fontFamily: 'DM Sans, system-ui, sans-serif',
            }}
            formatter={(value, name, props) => {
              const item = props.payload;
              return [`$${Number(value).toLocaleString()}`, item.name];
            }}
          />
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}
