import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useInsights } from '../../hooks/useInsights';
import { ActionItem } from './action-item';
import { LegalDisclaimer } from './legal-disclaimer';

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
    <div className="mb-8">
      {/* Section header — periwinkle eyebrow + quiet controls (matches redesigned pages) */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <span className="inline-flex items-center gap-2.5">
          <span
            className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
            style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
          />
          <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
            Actions
          </span>
        </span>

        <div className="flex items-center gap-3">
          {viewAllHref && (
            <a
              href={viewAllHref}
              className="text-[12.5px] font-semibold text-content-muted hover:text-brand transition-colors"
            >
              View all →
            </a>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-content-muted hover:text-brand transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className="h-[13px] w-[13px]"
              style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }}
            />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Action cards — stacked, on-skin, matching /insights */}
      <div className="flex flex-col gap-3.5">
        {insights.map((insight) => (
          <ActionItem
            key={insight.id}
            title={insight.title}
            tag={(insight.type ?? insight.category ?? 'general').toUpperCase()}
            description={insight.description}
            impact={insight.impact ?? ''}
            impactColor={(insight.impactColor as 'green' | 'amber' | 'red') ?? 'amber'}
            chatPrompt={insight.chatPrompt ?? insight.title}
            onDismiss={() => dismiss(insight.id)}
          />
        ))}
      </div>

      <div className="mt-5">
        <LegalDisclaimer variant="insights" />
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
