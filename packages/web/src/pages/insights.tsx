import { useState } from 'react';
import { useLocation } from 'wouter';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { useInsights } from '../hooks/useInsights';
import { ActionItem } from '../components/common/action-item';
import { cn } from '../lib/utils';

const TYPE_FILTERS = [
  { label: 'All', value: null },
  { label: 'Spending', value: 'spending' },
  { label: 'Behavioral', value: 'behavioral' },
  { label: 'Debt', value: 'debt' },
  { label: 'Tax', value: 'tax' },
  { label: 'Portfolio', value: 'portfolio' },
  { label: 'Savings', value: 'savings' },
  { label: 'Retirement', value: 'retirement' },
];

const URGENCY_ORDER = ['critical', 'high', 'medium', 'low'];

const URGENCY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High Priority',
  medium: 'Medium',
  low: 'Low',
};

const URGENCY_COLORS: Record<string, string> = {
  critical: 'text-danger',
  high: 'text-warning',
  medium: 'text-accent',
  low: 'text-text-secondary',
};

const PAGE_LINKS: Record<string, string> = {
  spending: '/spending',
  behavioral: '/spending',
  debt: '/debt',
  tax: '/tax',
  portfolio: '/invest',
  savings: '/goals',
  retirement: '/retirement',
  general: '/',
};

export function Insights() {
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const [refreshing, setRefreshing] = useState(false);

  const { insights, isLoading, dismiss, refresh } = useInsights(
    activeFilter ?? undefined
  );

  const grouped = URGENCY_ORDER.reduce<Record<string, typeof insights>>(
    (acc, u) => {
      acc[u] = insights.filter((i) => i.urgency === u);
      return acc;
    },
    {}
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-accent" />
          <h1 className="text-lg font-semibold">All Actions</h1>
          {!isLoading && (
            <span className="text-xs text-text-secondary bg-surface-elevated px-1.5 py-0.5 rounded-full">
              {insights.length}
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-secondary transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Type filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setActiveFilter(f.value)}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
              activeFilter === f.value
                ? 'bg-accent text-white'
                : 'bg-surface-elevated text-text-secondary hover:bg-surface-hover'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-sm text-text-secondary text-center py-12">
          Loading actions…
        </div>
      )}

      {/* Empty */}
      {!isLoading && insights.length === 0 && (
        <div className="text-center py-12 space-y-2">
          <Lightbulb className="w-8 h-8 text-text-secondary mx-auto" />
          <p className="text-sm text-text-secondary">No actions yet.</p>
          <button
            onClick={handleRefresh}
            className="text-sm text-accent hover:text-accent/80 transition-colors"
          >
            Generate actions →
          </button>
        </div>
      )}

      {/* Insights grouped by urgency */}
      {!isLoading &&
        URGENCY_ORDER.map((urgency) => {
          const items = grouped[urgency];
          if (!items?.length) return null;
          return (
            <section key={urgency} className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'text-xs font-bold uppercase tracking-wider',
                    URGENCY_COLORS[urgency]
                  )}
                >
                  {URGENCY_LABELS[urgency]}
                </span>
                <span className="text-xs text-text-secondary">({items.length})</span>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                {items.map((insight) => {
                  const insightType = insight.type ?? 'general';
                  const contextLink = PAGE_LINKS[insightType];
                  return (
                    <ActionItem
                      key={insight.id}
                      title={insight.title}
                      tag={(insight.type ?? insight.category ?? 'general').toUpperCase()}
                      description={insight.description}
                      impact={insight.impact ?? ''}
                      impactColor={
                        (insight.impactColor as 'green' | 'amber' | 'red') ??
                        'amber'
                      }
                      chatPrompt={insight.chatPrompt ?? insight.title}
                      onDismiss={() => dismiss(insight.id)}
                      onContextClick={contextLink ? () => navigate(contextLink) : undefined}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}
    </div>
  );
}
