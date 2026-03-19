import { useInsights } from '../../hooks/useInsights';
import { ActionItem } from './action-item';

interface ContextualInsightsProps {
  /** Type filter(s). Pass undefined or [] to show all types. */
  types?: string | string[];
  /** If set, only show insights with this urgency level. */
  urgencyFilter?: string;
  /** Max insights to show. Default: 3 */
  maxItems?: number;
}

export function ContextualInsights({
  types,
  urgencyFilter,
  maxItems = 3,
}: ContextualInsightsProps) {
  const { insights, isLoading, dismiss } = useInsights(types);

  const filtered = urgencyFilter
    ? insights.filter((i) => i.urgency === urgencyFilter)
    : insights;

  const shown = filtered.slice(0, maxItems);

  if (isLoading || shown.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Actions
        </span>
        <span className="text-xs text-text-muted">({shown.length})</span>
      </div>
      <div className="bg-bg-elevated border border-border rounded-xl px-4">
        {shown.map((insight) => (
          <ActionItem
            key={insight.id}
            title={insight.title}
            tag={(insight.type ?? insight.category ?? 'general').toUpperCase()}
            description={insight.description}
            impact={insight.impact ?? ''}
            impactColor={
              (insight.impactColor as 'green' | 'amber' | 'red') ?? 'amber'
            }
            chatPrompt={insight.chatPrompt ?? insight.title}
            onDismiss={() => dismiss(insight.id)}
          />
        ))}
      </div>
    </div>
  );
}
