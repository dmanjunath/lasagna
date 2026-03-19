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

const COLORS = ['#f5a623', '#4a90d9', '#7ed321', '#d0021b', '#9013fe'];

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
      <div className="p-4 bg-surface rounded-xl border border-border text-text-secondary text-center">
        Chart data unavailable
      </div>
    );
  }

  return (
    <div className="my-6 p-4 bg-surface rounded-xl border border-border">
      {config.title && (
        <h4 className="text-sm font-medium text-text mb-4">{config.title}</h4>
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
            <Tooltip />
            <Legend />
          </PieChart>
        ) : config.type === 'bar' ? (
          <BarChart data={data}>
            <XAxis dataKey="label" stroke="#666" />
            <YAxis stroke="#666" />
            <Tooltip />
            <Bar dataKey="value" fill="#f5a623" />
          </BarChart>
        ) : (
          <AreaChart data={data}>
            <XAxis dataKey="label" stroke="#666" />
            <YAxis stroke="#666" />
            <Tooltip />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#f5a623"
              fill="#f5a623"
              fillOpacity={0.3}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
