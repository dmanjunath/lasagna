import { useEffect, useRef } from "react";
import embed from "vega-embed";
import type { VegaLiteSpec } from "../../lib/types.js";
import { colors } from "../../styles/theme.js";
import { useAmountsHidden } from "../../lib/hide-amounts.js";
import { ChartError } from "./chart-error.js";

interface VegaLiteChartProps {
  spec: VegaLiteSpec;
  title?: string;
}

export function VegaLiteChart({ spec, title }: VegaLiteChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * The one chart that is not rendered at all while amounts are hidden.
   *
   * Every other chart masks its text and keeps its geometry, because the
   * renderer knows which channel is money: a Recharts axis declares
   * `tickFormatter: "currency"`. A Vega-Lite spec declares nothing of the
   * sort. It is free-form model JSON, and the dollars can sit in a raw
   * `data.values` row, an axis `format`, a `text` mark, a tooltip channel, a
   * nested `layer`/`hconcat`, or a `transform` that computes them, and vega
   * paints its own SVG plus a body-level tooltip outside React. There is no
   * field to point the mask at, so the honest move is to not embed it: an
   * absent chart is a far smaller loss than one quietly painting real
   * balances.
   */
  const hidden = useAmountsHidden();

  useEffect(() => {
    if (hidden || !containerRef.current) return;

    // Apply theme to spec
    const themedSpec = {
      ...spec,
      background: "transparent",
      config: {
        ...spec.config,
        axis: {
          labelColor: colors.text.muted,
          titleColor: colors.text.secondary,
          gridColor: colors.border.DEFAULT,
          domainColor: colors.border.DEFAULT,
        },
        legend: {
          labelColor: colors.text.secondary,
          titleColor: colors.text.secondary,
        },
        title: {
          color: colors.text.DEFAULT,
        },
        view: {
          stroke: "transparent",
        },
        range: {
          category: [colors.accent.DEFAULT, colors.success, "#3b82f6", "#a855f7", colors.danger, "#06b6d4"],
        },
      },
    };

    let cleanup: (() => void) | undefined;

    embed(containerRef.current, themedSpec as any, {
      actions: false,
      renderer: "svg",
    }).then((result) => {
      cleanup = () => result.finalize();
    }).catch((err) => {
      console.error("Vega-Lite render error:", err);
    });

    return () => {
      cleanup?.();
    };
  }, [spec, hidden]);

  // Validate spec has required data
  if (!spec.data?.values || !Array.isArray(spec.data.values)) {
    return <ChartError message="Invalid Vega-Lite spec: missing data.values array" />;
  }

  return (
    <div className="glass-card p-4">
      {title && (
        <h4 className="text-sm font-medium text-text-secondary mb-3">{title}</h4>
      )}
      {hidden ? (
        <div className="rounded-ui-lg border border-line bg-canvas-sunken p-4 min-h-[200px] flex items-center justify-center">
          <p className="text-content-muted text-sm font-semibold">
            Chart hidden. Show amounts to see it.
          </p>
        </div>
      ) : (
        <div ref={containerRef} className="min-h-[200px]" />
      )}
    </div>
  );
}
