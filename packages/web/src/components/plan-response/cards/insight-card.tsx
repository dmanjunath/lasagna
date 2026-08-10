import { useState } from 'react';
import { Lightbulb } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ExpandButton } from '../primitives/expand-button.js';
import { cn } from '../../../lib/utils.js';

interface InsightCardProps {
  headline: string;
  details?: string;
  variant?: 'default' | 'warning' | 'success';
}

const variantStyles = {
  default: {
    border: 'border-[rgb(var(--ui-accent))]/25',
    bg: 'bg-[var(--ui-accent-soft)]',
    icon: 'text-[rgb(var(--ui-accent-ink))]',
  },
  warning: {
    border: 'border-[rgb(var(--ui-caution))]/25',
    bg: 'bg-[var(--ui-caution-soft)]',
    icon: 'text-[rgb(var(--ui-caution))]',
  },
  success: {
    border: 'border-[rgb(var(--ui-brand))]/25',
    bg: 'bg-brand-soft',
    icon: 'text-[rgb(var(--ui-brand-ink))]',
  },
};

export function InsightCard({ headline, details, variant = 'default' }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const styles = variantStyles[variant];

  return (
    <div className={cn('rounded-ui-lg border p-4', styles.border, styles.bg)}>
      <div className="flex items-start gap-3">
        <Lightbulb className={cn('w-4 h-4 mt-0.5 flex-shrink-0', styles.icon)} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-content leading-relaxed">{headline}</p>

          {details && (
            <>
              <div className="mt-3">
                <ExpandButton
                  expanded={expanded}
                  onToggle={() => setExpanded(!expanded)}
                  label="analysis"
                />
              </div>

              {expanded && (
                <div className="mt-3 pt-3 border-t border-line">
                  <div className="response-text prose prose-sm max-w-none prose-p:text-content-secondary prose-strong:text-content prose-li:text-content-secondary marker:text-content-faint">
                    <ReactMarkdown>{details}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
