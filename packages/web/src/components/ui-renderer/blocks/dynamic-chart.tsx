import { lazy, Suspense } from "react";
import type { DynamicChartBlock } from "../../../lib/types.js";
import { RechartsFromConfig } from "../../charts/recharts-from-config.js";
import { ChartError } from "../../charts/chart-error.js";

// Lazy load Vega-Lite to reduce initial bundle size
const VegaLiteChart = lazy(() =>
  import("../../charts/vega-lite-chart.js").then((m) => ({ default: m.VegaLiteChart }))
);

function ChartLoadingFallback() {
  return (
    <div className="glass-card p-4 min-h-[200px] flex items-center justify-center">
      <div className="text-text-muted text-sm">Loading chart...</div>
    </div>
  );
}

export function DynamicChartRenderer({ block }: { block: DynamicChartBlock }) {
  if (block.renderer === "vega-lite") {
    if (!block.vegaLiteSpec) {
      return <ChartError message="Vega-Lite renderer selected but no spec provided" />;
    }
    return (
      <Suspense fallback={<ChartLoadingFallback />}>
        <VegaLiteChart spec={block.vegaLiteSpec} title={block.title} />
      </Suspense>
    );
  }

  if (block.renderer === "recharts") {
    if (!block.rechartsConfig) {
      return <ChartError message="Recharts renderer selected but no config provided" />;
    }
    return <RechartsFromConfig config={block.rechartsConfig} title={block.title} />;
  }

  return <ChartError message={`Unknown renderer: ${block.renderer}`} />;
}
