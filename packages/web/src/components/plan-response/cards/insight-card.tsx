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
    border: 'border-accent/20',
    bg: 'bg-accent/5',
    icon: 'text-accent',
    label: 'text-accent',
  },
  warning: {
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/5',
    icon: 'text-amber-500',
    label: 'text-amber-500',
  },
  success: {
    border: 'border-emerald-500/20',
    bg: 'bg-emerald-500/5',
    icon: 'text-emerald-500',
    label: 'text-emerald-500',
  },
};

export function InsightCard({ headline, details, variant = 'default' }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);
  const styles = variantStyles[variant];

  return (
    <div className={cn('rounded-xl border p-4', styles.border, styles.bg)}>
      <div className="flex items-start gap-3">
        <Lightbulb className={cn('w-4 h-4 mt-0.5 flex-shrink-0', styles.icon)} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] text-text leading-relaxed">{headline}</p>

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
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="response-text prose prose-sm prose-invert max-w-none">
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
