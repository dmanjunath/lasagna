import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

// Recharts' default tooltip is a white box, so it is set to the panel tokens.
const tooltipStyle = {
  background: 'rgb(var(--ui-panel-raised))',
  border: '1px solid var(--ui-line)',
  borderRadius: 12,
  boxShadow: 'var(--ui-shadow-md)',
  color: 'rgb(var(--ui-content))',
};

const COLORS = ['var(--ui-viz-1)', 'var(--ui-viz-2)', 'var(--ui-viz-3)', 'var(--ui-viz-4)', 'var(--ui-viz-5)'];

interface ChartDirectiveProps {
  config: {
    type: 'area' | 'bar' | 'pie' | 'line';
    title?: string;
    source?: string;
    data?: Array<{ label: string; value: number }>;
  };
  toolResults?: Map<string, unknown>;
}

export function ChartDirective({ config, toolResults }: ChartDirectiveProps) {
  // Get data from source or inline
  let data = config.data;
  if (config.source && toolResults?.has(config.source)) {
    const result = toolResults.get(config.source) as { data?: unknown[] };
    data = result?.data as typeof data;
  }

  if (!data || !data.length) {
    return (
      <div className="p-4 bg-canvas-sunken rounded-ui-md border border-line text-content-muted text-center text-sm font-semibold">
        Chart data unavailable
      </div>
    );
  }

  return (
    <div className="my-6 p-4 sm:p-5 bg-canvas-sunken rounded-ui-lg border border-line">
      {config.title && (
        <h4 className="text-[14px] font-semibold text-content mb-4">{config.title}</h4>
      )}
      <ResponsiveContainer width="100%" height={250}>
        {config.type === 'pie' ? (
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
          </PieChart>
        ) : config.type === 'bar' ? (
          <BarChart data={data}>
            <XAxis dataKey="label" stroke="rgb(var(--ui-content-muted))" />
            <YAxis stroke="rgb(var(--ui-content-muted))" />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill="rgb(var(--ui-brand))" />
          </BarChart>
        ) : (
          <AreaChart data={data}>
            <XAxis dataKey="label" stroke="rgb(var(--ui-content-muted))" />
            <YAxis stroke="rgb(var(--ui-content-muted))" />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="rgb(var(--ui-brand))"
              fill="rgb(var(--ui-brand))"
              fillOpacity={0.3}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
