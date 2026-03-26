import { StatCard } from '../common/stat-card.js';
import type { MetricV2 } from '../../lib/types-v2.js';

interface MetricsBarProps {
  metrics: MetricV2[];
}

export function MetricsBar({ metrics }: MetricsBarProps) {
  if (!metrics.length) return null;

  return (
    <div data-testid="metrics-bar" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {metrics.map((metric, i) => (
        <StatCard
          key={i}
          label={metric.label}
          value={metric.value}
          description={metric.context}
        />
      ))}
    </div>
  );
}
