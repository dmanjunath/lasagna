import { useState } from 'react';
import { useInsights } from '../../hooks/useInsights';
import { ActionItem } from './action-item';
import { Section } from './section';

interface PageActionsProps {
  /** Filter to specific insight type(s). Omit for all types (Home/Focus). */
  types?: string | string[];
  /** Show a "View all →" link (Home page only) */
  viewAllHref?: string;
}

export function PageActions({ types, viewAllHref }: PageActionsProps) {
  const { insights, isLoading, dismiss, refresh } = useInsights(types);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading || insights.length === 0) return null;

  return (
    <Section
      title="Actions"
      actions={
        <div className="flex items-center gap-3">
          {viewAllHref && (
            <a
              href={viewAllHref}
              className="text-xs text-accent hover:text-accent/80 transition-colors"
            >
              View all →
            </a>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs text-text-secondary hover:text-accent transition-colors disabled:opacity-50"
          >
            {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      }
    >
      <div className="bg-bg-elevated border border-border rounded-xl px-4">
        {insights.map((insight, i) => (
          <ActionItem
            key={insight.id}
            title={insight.title}
            tag={(insight.type ?? insight.category ?? 'general').toUpperCase()}
            description={insight.description}
            impact={insight.impact ?? ''}
            impactColor={(insight.impactColor as 'green' | 'amber' | 'red') ?? 'amber'}
            chatPrompt={insight.chatPrompt ?? insight.title}
            defaultOpen={i === 0}
            onDismiss={() => dismiss(insight.id)}
          />
        ))}
      </div>
    </Section>
  );
}
