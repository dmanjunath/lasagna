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
import { HIDDEN_AMOUNT, isAmountsHidden, maskCurrencyInText } from "../../lib/hide-amounts.js";
import type { RechartsConfig, RechartsComponent, AxisConfig } from "../../lib/types.js";
import { ChartError } from "./chart-error.js";

const CHART_COLORS = [
  "var(--ui-viz-1)",
  "var(--ui-viz-2)",
  "var(--ui-viz-3)",
  "var(--ui-viz-4)",
  "var(--ui-viz-5)",
  "var(--ui-viz-6)",
];

// Format large numbers with K/M suffixes
function formatCompactNumber(value: number): string {
  const sign = value < 0 ? "\u2212" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(0)}K`;
  }
  return `${sign}${abs.toLocaleString()}`;
}

// Format currency with commas and compact notation
function formatCurrency(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  const sign = value < 0 ? "\u2212" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  }
  return `${sign}$${abs.toLocaleString()}`;
}

// Format full currency for tooltips
function formatFullCurrency(value: number): string {
  if (isAmountsHidden()) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value).replace(/^-/, "\u2212");
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

// Map axis config to Recharts props. A currency-formatted axis is HIDDEN while
// amounts are hidden (labels removed, not replaced by a column of identical
// masks, and the width they reserved collapses with them). Only "currency" is
// treated that way: "number" and "percent" axes count things and stay, the same
// sigil-anchored rule maskCurrencyInText follows.
function mapAxisConfig(config: AxisConfig) {
  const { tickFormatter, dataKey, type, domain, yAxisId } = config;
  const maskMoney = isAmountsHidden() && tickFormatter === "currency";
  return {
    dataKey,
    type,
    // The one place the mask moves GEOMETRY, and deliberately. `domain` comes
    // from the model, and an absolute bound like [0, 1000000] pins the marks
    // to a dollar scale, so the bar heights keep stating the magnitude the
    // hidden tick labels stopped stating. Dropped, the axis falls back to a
    // domain derived from its own data, which carries no magnitude, the same
    // as every other masked chart.
    domain: maskMoney ? undefined : domain,
    yAxisId,
    stroke: "rgb(var(--ui-content-muted))",
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    tickFormatter: getTickFormatter(tickFormatter),
    hide: maskMoney,
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
      fill="#fff"
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
    const pieColors = ["var(--ui-viz-1)", "var(--ui-viz-2)", "var(--ui-viz-3)", "var(--ui-viz-4)", "var(--ui-viz-5)"];
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
        stroke="rgb(var(--ui-panel))"
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
    <div className="bg-panel border border-line rounded-2xl p-5 shadow-ui-sm">
      {title && (
        <h4 className="text-sm font-semibold text-content mb-4">{title}</h4>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ChartContainer data={config.data}>
          {/* Subtle grid for non-pie charts */}
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--ui-line)"
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
                background: 'rgb(var(--ui-panel-raised))',
                border: "1px solid var(--ui-line)",
                borderRadius: "12px",
                boxShadow: 'var(--ui-shadow-md)',
                padding: '12px 16px',
              }}
              labelStyle={{ color: "rgb(var(--ui-content))", fontWeight: 600, marginBottom: 4 }}
              itemStyle={{ color: "rgb(var(--ui-content-muted))", fontSize: 13 }}
              formatter={tooltipFormatter}
              cursor={{ fill: 'var(--ui-hairline)' }}
            />
          )}

          {/* Legend with better styling */}
          {config.legend && (
            <Legend
              wrapperStyle={{ paddingTop: 16 }}
              iconType="circle"
              iconSize={8}
              formatter={(value) => (
                <span className="text-content-secondary" style={{ fontSize: 12, marginLeft: 4 }}>{value}</span>
              )}
            />
          )}

          {/* Brush for selection */}
          {config.brush && (
            <Brush
              dataKey={config.brush.dataKey}
              height={config.brush.height || 30}
              fill="rgb(var(--ui-panel))"
              stroke="var(--ui-line)"
            />
          )}

          {/* Chart components */}
          {config.components.map((comp, i) => renderComponent(comp, i, config.data))}

          {/* Reference lines. The label is model prose ("$1.2M target"), so it
              goes through the text mask; the line's own position is left alone,
              the same as the plotted marks. */}
          {config.referenceLines?.map((line, i) => (
            <ReferenceLine
              key={i}
              {...line}
              label={line.label ? maskCurrencyInText(line.label) : line.label}
              stroke={line.stroke || "rgb(var(--ui-content-muted))"}
              strokeDasharray="4 4"
            />
          ))}
        </ChartContainer>
      </ResponsiveContainer>
    </div>
  );
}
