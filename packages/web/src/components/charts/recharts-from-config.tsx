import {
  ResponsiveContainer,
  ComposedChart,
  PieChart,
  RadarChart,
  RadialBarChart,
  Treemap,
  FunnelChart,
  Sankey,
  Area,
  Bar,
  Line,
  Scatter,
  Pie,
  Radar,
  Cell,
  Funnel,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Brush,
  ReferenceLine,
  CartesianGrid,
  Label,
} from "recharts";
import { colors } from "../../styles/theme.js";
import type { RechartsConfig, RechartsComponent, AxisConfig } from "../../lib/types.js";
import { ChartError } from "./chart-error.js";

const CHART_COLORS = [
  colors.accent.DEFAULT,
  colors.success,
  "#3b82f6",
  "#a855f7",
  colors.danger,
  "#06b6d4",
];

// Format large numbers with K/M suffixes
function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }
  return value.toLocaleString();
}

// Format currency with commas and compact notation
function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

// Format full currency for tooltips
function formatFullCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// Map chartType to container component
function getChartContainer(chartType: string): React.ComponentType<any> {
  const containers: Record<string, React.ComponentType<any>> = {
    composed: ComposedChart,
    pie: PieChart,
    radar: RadarChart,
    radial: RadialBarChart,
    treemap: Treemap,
    funnel: FunnelChart,
    sankey: Sankey,
  };
  const container = containers[chartType];
  if (!container) {
    console.warn(`Unknown chart type: ${chartType}, falling back to ComposedChart`);
    return ComposedChart;
  }
  return container;
}

// Map tick formatter string to function
function getTickFormatter(formatter?: string) {
  if (formatter === "currency") {
    return formatCurrency;
  }
  if (formatter === "percent") {
    return (v: number) => `${v}%`;
  }
  if (formatter === "number") {
    return formatCompactNumber;
  }
  // Default: format numbers with commas if large
  return (v: number | string) => {
    if (typeof v === 'number' && Math.abs(v) >= 1000) {
      return formatCompactNumber(v);
    }
    return String(v);
  };
}

// Map axis config to Recharts props
function mapAxisConfig(config: AxisConfig) {
  const { tickFormatter, dataKey, type, domain, yAxisId } = config;
  return {
    dataKey,
    type,
    domain,
    yAxisId,
    stroke: colors.text.muted,
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    tickFormatter: getTickFormatter(tickFormatter),
  };
}

// Custom label renderer for pie charts
const renderPieLabel = (props: any) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  // Only show label if segment is large enough (> 5%)
  if (percent < 0.05) return null;

  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill={colors.text.DEFAULT}
      textAnchor="middle"
      dominantBaseline="central"
      className="text-xs font-semibold"
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// Render a single chart component with theme colors
function renderComponent(comp: RechartsComponent, index: number, data?: any[]) {
  const componentMap: Record<string, React.ComponentType<any>> = {
    Area,
    Bar,
    Line,
    Scatter,
    Pie,
    Radar,
    Cell,
    Funnel,
  };

  const Component = componentMap[comp.type];
  if (!Component) {
    console.warn(`Unknown component type: ${comp.type}`);
    return null;
  }

  const { type, ...props } = comp;

  // Special handling for Pie charts - add labels and cells
  if (type === "Pie" && data) {
    const pieColors = [colors.accent.DEFAULT, colors.danger, colors.success, "#3b82f6", "#a855f7"];
    return (
      <Pie
        key={`${type}-${index}`}
        data={data}
        dataKey={props.dataKey || "value"}
        nameKey={props.nameKey || "name"}
        cx="50%"
        cy="50%"
        innerRadius={props.innerRadius || 0}
        outerRadius={props.outerRadius || 80}
        label={renderPieLabel}
        labelLine={false}
        stroke={colors.bg.DEFAULT}
        strokeWidth={2}
      >
        {data.map((_, i) => (
          <Cell key={`cell-${i}`} fill={pieColors[i % pieColors.length]} />
        ))}
      </Pie>
    );
  }

  const themedProps = {
    ...props,
    fill: props.fill || CHART_COLORS[index % CHART_COLORS.length],
    stroke: props.stroke || CHART_COLORS[index % CHART_COLORS.length],
  };

  return <Component key={`${type}-${index}`} {...themedProps} />;
}

interface RechartsFromConfigProps {
  config: RechartsConfig;
  title?: string;
}

export function RechartsFromConfig({ config, title }: RechartsFromConfigProps) {
  // Validate config
  if (!config.data || !Array.isArray(config.data) || config.data.length === 0) {
    return <ChartError message="Invalid Recharts config: missing or empty data array" />;
  }

  if (!config.components || config.components.length === 0) {
    return <ChartError message="Invalid Recharts config: no components defined" data={config.data} />;
  }

  const ChartContainer = getChartContainer(config.chartType);
  const height = config.height || 300;

  const isPieChart = config.chartType === 'pie';
  const showGrid = !isPieChart && config.chartType !== 'radar' && config.chartType !== 'radial';

  // Custom tooltip formatter for better number display
  const tooltipFormatter = (value: any, name: any): [string, string] => {
    // Check if it looks like currency (usually larger numbers or has specific data keys)
    if (typeof value === 'number') {
      const nameStr = String(name || '').toLowerCase();
      if (Math.abs(value) >= 100 || nameStr.includes('value') || nameStr.includes('amount')) {
        return [formatFullCurrency(value), String(name)];
      }
      if (nameStr.includes('percent') || nameStr.includes('rate')) {
        return [`${value.toFixed(1)}%`, String(name)];
      }
      return [value.toLocaleString(), String(name)];
    }
    return [String(value), String(name)];
  };

  return (
    <div className="bg-surface/50 backdrop-blur-sm border border-border/50 rounded-2xl p-5 shadow-lg">
      {title && (
        <h4 className="text-sm font-semibold text-text mb-4">{title}</h4>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ChartContainer data={config.data}>
          {/* Subtle grid for non-pie charts */}
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={colors.border.DEFAULT}
              strokeOpacity={0.3}
              vertical={false}
            />
          )}

          {/* Axes */}
          {config.xAxis && <XAxis {...mapAxisConfig(config.xAxis)} />}
          {config.yAxis && (
            Array.isArray(config.yAxis)
              ? config.yAxis.map((y, i) => <YAxis key={i} {...mapAxisConfig(y)} />)
              : <YAxis {...mapAxisConfig(config.yAxis)} />
          )}

          {/* Tooltip */}
          {config.tooltip !== false && (
            <Tooltip
              contentStyle={{
                background: 'rgba(12, 10, 9, 0.95)',
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                padding: '12px 16px',
              }}
              labelStyle={{ color: colors.text.DEFAULT, fontWeight: 600, marginBottom: 4 }}
              itemStyle={{ color: colors.text.muted, fontSize: 13 }}
              formatter={tooltipFormatter}
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            />
          )}

          {/* Legend with better styling */}
          {config.legend && (
            <Legend
              wrapperStyle={{ paddingTop: 16 }}
              iconType="circle"
              iconSize={8}
              formatter={(value) => (
                <span style={{ color: colors.text.muted, fontSize: 12, marginLeft: 4 }}>{value}</span>
              )}
            />
          )}

          {/* Brush for selection */}
          {config.brush && (
            <Brush
              dataKey={config.brush.dataKey}
              height={config.brush.height || 30}
              fill={colors.surface.DEFAULT}
              stroke={colors.border.DEFAULT}
            />
          )}

          {/* Chart components */}
          {config.components.map((comp, i) => renderComponent(comp, i, config.data))}

          {/* Reference lines */}
          {config.referenceLines?.map((line, i) => (
            <ReferenceLine
              key={i}
              {...line}
              stroke={line.stroke || colors.text.muted}
              strokeDasharray="4 4"
            />
          ))}
        </ChartContainer>
      </ResponsiveContainer>
    </div>
  );
}
