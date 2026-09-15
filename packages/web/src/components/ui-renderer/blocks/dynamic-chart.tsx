import { lazy, Suspense } from "react";
import type { DynamicChartBlock } from "../../../lib/types.js";
import { maskCurrencyInText } from "../../../lib/hide-amounts.js";
import { RechartsFromConfig } from "../../charts/recharts-from-config.js";
import { ChartError } from "../../charts/chart-error.js";

// Lazy load Vega-Lite to reduce initial bundle size
const VegaLiteChart = lazy(() =>
  import("../../charts/vega-lite-chart.js").then((m) => ({ default: m.VegaLiteChart }))
);

function ChartLoadingFallback() {
  return (
    <div className="rounded-ui-lg border border-line bg-canvas-sunken p-4 min-h-[200px] flex items-center justify-center">
      <div className="text-content-muted text-sm font-semibold">Loading chart...</div>
    </div>
  );
}

export function DynamicChartRenderer({ block }: { block: DynamicChartBlock }) {
  // The title is model prose, so it is masked here, where it is handed to
  // either renderer, rather than once inside each of them.
  const title = block.title ? maskCurrencyInText(block.title) : block.title;

  if (block.renderer === "vega-lite") {
    if (!block.vegaLiteSpec) {
      return <ChartError message="Vega-Lite renderer selected but no spec provided" />;
    }
    return (
      <Suspense fallback={<ChartLoadingFallback />}>
        <VegaLiteChart spec={block.vegaLiteSpec} title={title} />
      </Suspense>
    );
  }

  if (block.renderer === "recharts") {
    if (!block.rechartsConfig) {
      return <ChartError message="Recharts renderer selected but no config provided" />;
    }
    return <RechartsFromConfig config={block.rechartsConfig} title={title} />;
  }

  return <ChartError message={`Unknown renderer: ${block.renderer}`} />;
}
