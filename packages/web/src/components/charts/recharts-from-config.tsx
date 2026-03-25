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
    return (v: number) => `$${v.toLocaleString()}`;
  }
  if (formatter === "percent") {
    return (v: number) => `${v}%`;
  }
  return undefined;
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

// Render a single chart component with theme colors
function renderComponent(comp: RechartsComponent, index: number) {
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

  return (
    <div className="glass-card p-4">
      {title && (
        <h4 className="text-sm font-medium text-text-muted mb-3">{title}</h4>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ChartContainer data={config.data}>
          {/* Axes */}
          {config.xAxis && <XAxis {...mapAxisConfig(config.xAxis)} />}
          {config.yAxis && (
            Array.isArray(config.yAxis)
              ? config.yAxis.map((y, i) => <YAxis key={i} {...mapAxisConfig(y)} />)
              : <YAxis {...mapAxisConfig(config.yAxis)} />
          )}

          {/* Tooltip */}
          {config.tooltip && (
            <Tooltip
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
              }}
              labelStyle={{ color: colors.text.secondary }}
              itemStyle={{ color: colors.text.DEFAULT }}
            />
          )}

          {/* Legend */}
          {config.legend && <Legend />}

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
          {config.components.map((comp, i) => renderComponent(comp, i))}

          {/* Reference lines */}
          {config.referenceLines?.map((line, i) => (
            <ReferenceLine
              key={i}
              {...line}
              stroke={line.stroke || colors.text.muted}
            />
          ))}
        </ChartContainer>
      </ResponsiveContainer>
    </div>
  );
}
