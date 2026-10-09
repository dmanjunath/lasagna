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
import { maskCurrencyInText } from "../../../lib/hide-amounts.js";

// The categorical viz palette, which .dark remaps.
const CHART_COLORS = [
  "var(--ui-viz-1)",
  "var(--ui-viz-2)",
  "var(--ui-viz-3)",
  "var(--ui-viz-4)",
  "var(--ui-viz-5)",
  "var(--ui-viz-6)",
];

export function ChartBlockRenderer({ block }: { block: ChartBlockType }) {
  if (block.chartType === "area") {
    return (
      <div className="h-64">
        {block.title && (
          <h4 className="text-[14px] font-semibold text-content mb-2">
            {maskCurrencyInText(block.title)}
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
          <h4 className="text-[14px] font-semibold text-content mb-2 absolute top-0 left-0">
            {maskCurrencyInText(block.title)}
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
          <h4 className="text-[14px] font-semibold text-content mb-2">
            {maskCurrencyInText(block.title)}
          </h4>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={block.data}>
            <XAxis dataKey="label" stroke="rgb(var(--ui-content-muted))" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="rgb(var(--ui-content-muted))" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                background: "rgb(var(--ui-panel-raised))",
                border: "1px solid var(--ui-line)",
                borderRadius: "12px",
              }}
            />
            <Bar dataKey="value" fill="rgb(var(--ui-brand))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return null;
}
