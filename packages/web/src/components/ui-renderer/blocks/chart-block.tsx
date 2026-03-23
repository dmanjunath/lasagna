import { AreaChart } from "../../charts/area-chart.js";
import { DonutChart } from "../../charts/pie-chart.js";
import type { ChartBlock as ChartBlockType } from "../../../lib/types.js";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { colors } from "../../../styles/theme.js";

// Chart colors that complement the theme
const CHART_COLORS = [
  colors.accent.DEFAULT,  // amber
  colors.success,         // green
  "#3b82f6",              // blue
  "#a855f7",              // purple
  colors.danger,          // red
  "#06b6d4",              // cyan
];

export function ChartBlockRenderer({ block }: { block: ChartBlockType }) {
  if (block.chartType === "area") {
    return (
      <div className="h-64">
        {block.title && (
          <h4 className="text-sm font-medium text-text-muted mb-2">
            {block.title}
          </h4>
        )}
        <AreaChart
          data={block.data}
          xKey="label"
          yKey="value"
        />
      </div>
    );
  }

  if (block.chartType === "donut") {
    // Transform data to include colors
    const donutData = block.data.map((d, i) => ({
      name: d.label,
      value: d.value,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

    return (
      <div className="h-64 flex items-center justify-center">
        {block.title && (
          <h4 className="text-sm font-medium text-text-muted mb-2 absolute top-0 left-0">
            {block.title}
          </h4>
        )}
        <DonutChart data={donutData} size={200} />
      </div>
    );
  }

  if (block.chartType === "bar") {
    return (
      <div className="h-64">
        {block.title && (
          <h4 className="text-sm font-medium text-text-muted mb-2">
            {block.title}
          </h4>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={block.data}>
            <XAxis dataKey="label" stroke={colors.text.muted} fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke={colors.text.muted} fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                background: colors.bg.elevated,
                border: `1px solid ${colors.border.DEFAULT}`,
                borderRadius: "12px",
              }}
            />
            <Bar dataKey="value" fill={colors.accent.DEFAULT} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return null;
}
