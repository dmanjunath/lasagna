import { PieChart as RechartsPieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { HIDDEN_AMOUNT, isAmountsHidden } from '../../lib/hide-amounts';

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
      fill="rgb(var(--ui-content-secondary))"
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

// The ring carries no text. Names and shares sit in the legend beside it
// (below it when the container is narrow), where long names wrap instead of
// clipping off the edge of the chart.
export function DonutChart({
  data,
  innerRadius = 50,
  outerRadius = 80,
  size = 200,
}: PieChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
      <div className="shrink-0" style={{ width: size, height: size }}>
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
                background: 'rgb(var(--ui-panel-raised))',
                border: '1px solid var(--ui-line)',
                borderRadius: '12px',
                fontFamily: 'DM Sans, system-ui, sans-serif',
              }}
              formatter={(value, name, props) => {
                const item = props.payload;
                // The slice name stays: it is what the tooltip is for, and the
                // wedge angles are shares, which carry no magnitude either way.
                if (isAmountsHidden()) return [HIDDEN_AMOUNT, item.name];
                return [`$${Number(value).toLocaleString()}`, item.name];
              }}
            />
          </RechartsPieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex min-w-[200px] max-w-[360px] flex-1 flex-col">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          return (
            <li key={`${d.name}-${i}`} className="flex items-start gap-3 px-1 py-1.5">
              <span className="mt-[3px] h-3 w-3 shrink-0 rounded-[4px]" style={{ background: d.color }} aria-hidden />
              <span className="min-w-0 flex-1 break-words text-[13.5px] font-semibold leading-snug text-content">{d.name}</span>
              <span className="shrink-0 whitespace-nowrap text-[12.5px] font-semibold leading-snug text-content-muted ui-tnum">
                {pct > 0 && pct < 1 ? '<1%' : `${pct.toFixed(0)}%`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
