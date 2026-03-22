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

// Default colors for donut chart segments
const DONUT_COLORS = ["#fbbf24", "#22c55e", "#3b82f6", "#a855f7", "#f43f5e", "#06b6d4"];

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
      color: DONUT_COLORS[i % DONUT_COLORS.length],
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
            <XAxis dataKey="label" stroke="#a8a29e" fontSize={12} />
            <YAxis stroke="#a8a29e" fontSize={12} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1c1917",
                border: "1px solid rgba(120, 113, 108, 0.2)",
                borderRadius: "8px",
              }}
            />
            <Bar dataKey="value" fill="#fbbf24" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return null;
}
