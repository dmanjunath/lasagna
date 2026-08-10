import type { MetricV2 } from '../../lib/types-v2.js';

interface MetricsBarProps {
  metrics: MetricV2[];
}

// On-skin metric cards (--ui-* tokens) so the plan hero stats read correctly in
// both light and dark. A periwinkle accent rail ties them to the Bright system.
export function MetricsBar({ metrics }: MetricsBarProps) {
  if (!metrics.length) return null;

  return (
    <div data-testid="metrics-bar" className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {metrics.map((metric, i) => (
        <div
          key={i}
          className="relative overflow-hidden rounded-ui-lg border border-line bg-panel shadow-ui-sm p-5"
        >
          <span
            className="absolute inset-y-0 left-0 w-1 bg-[rgb(var(--ui-accent))]"
            aria-hidden
          />
          <p className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-content-muted">
            {metric.label}
          </p>
          <div className="mt-1.5 font-editorial text-[24px] font-extrabold leading-none tracking-[-0.02em] text-content ui-tnum">
            {metric.value}
          </div>
          {metric.context && (
            <p className="mt-2 text-[12px] font-semibold text-content-muted">{metric.context}</p>
          )}
        </div>
      ))}
    </div>
  );
}
