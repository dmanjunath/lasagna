import { useState } from 'react';
import { useLocation } from 'wouter';
import { Lightbulb, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useInsights } from '../../hooks/useInsights';
import { ActionItem } from './action-item';
import { cn } from '../../lib/utils';

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
  const [open, setOpen] = useState(true);
  const [, navigate] = useLocation();
  const { insights, isLoading, dismiss } = useInsights(types);

  const filtered = urgencyFilter
    ? insights.filter((i) => i.urgency === urgencyFilter)
    : insights;

  const shown = filtered.slice(0, maxItems);

  if (isLoading || shown.length === 0) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-4">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-elevated text-left hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium">Insights</span>
          <span className="text-xs text-text-muted">({shown.length})</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigate('/insights');
            }}
            className="text-xs text-accent hover:text-accent/80 transition-colors"
          >
            View all →
          </button>
          <ChevronDown
            className={cn(
              'w-4 h-4 text-text-muted transition-transform duration-200',
              open && 'rotate-180'
            )}
          />
        </div>
      </button>

      {/* Insight cards */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-2">
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
