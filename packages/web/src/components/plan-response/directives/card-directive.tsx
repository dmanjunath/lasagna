import ReactMarkdown from 'react-markdown';
import { cn } from '../../../lib/utils.js';

const variantStyles = {
  default: 'border-border/50 bg-surface/30',
  warning: 'border-warning/40 bg-warning/5',
  highlight: 'border-accent/40 bg-accent/5',
};

const labelStyles = {
  default: 'text-text-muted',
  warning: 'text-warning',
  highlight: 'text-accent',
};

interface CardDirectiveProps {
  variant: 'default' | 'warning' | 'highlight';
  content: string;
}

export function CardDirective({ variant, content }: CardDirectiveProps) {
  return (
    <div className={cn('my-6 p-5 rounded-xl border', variantStyles[variant])}>
      <div className={cn('text-xs font-semibold uppercase tracking-wider mb-2', labelStyles[variant])}>
        {variant === 'warning' ? '⚠ Warning' : variant === 'highlight' ? '★ Key Insight' : '◆ Note'}
      </div>
      <div className="prose prose-sm prose-invert max-w-none prose-p:text-text-secondary">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
