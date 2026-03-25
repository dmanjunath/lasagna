import { useEffect, useRef } from "react";
import embed from "vega-embed";
import type { VegaLiteSpec } from "../../lib/types.js";
import { colors } from "../../styles/theme.js";
import { ChartError } from "./chart-error.js";

interface VegaLiteChartProps {
  spec: VegaLiteSpec;
  title?: string;
}

export function VegaLiteChart({ spec, title }: VegaLiteChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

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
  }, [spec]);

  // Validate spec has required data
  if (!spec.data?.values || !Array.isArray(spec.data.values)) {
    return <ChartError message="Invalid Vega-Lite spec: missing data.values array" />;
  }

  return (
    <div className="glass-card p-4">
      {title && (
        <h4 className="text-sm font-medium text-text-muted mb-3">{title}</h4>
      )}
      <div ref={containerRef} className="min-h-[200px]" />
    </div>
  );
}
