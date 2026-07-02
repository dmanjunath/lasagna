import ReactMarkdown from 'react-markdown';
import { cn } from '../../../lib/utils.js';

const variantStyles = {
  default: 'border-line bg-canvas-sunken',
  warning: 'border-[rgb(var(--ui-caution))]/40 bg-[var(--ui-caution-soft)]',
  highlight: 'border-[rgb(var(--ui-accent))]/40 bg-[var(--ui-accent-soft)]',
};

const labelStyles = {
  default: 'text-content-muted',
  warning: 'text-[rgb(var(--ui-caution))]',
  highlight: 'text-[rgb(var(--ui-accent-ink))]',
};

interface CardDirectiveProps {
  variant: 'default' | 'warning' | 'highlight';
  content: string;
}

export function CardDirective({ variant, content }: CardDirectiveProps) {
  return (
    <div className={cn('my-6 p-5 rounded-ui-lg border', variantStyles[variant])}>
      <div className={cn('text-[11px] font-bold uppercase tracking-[0.12em] mb-2', labelStyles[variant])}>
        {variant === 'warning' ? '⚠ Warning' : variant === 'highlight' ? '★ Key Insight' : '◆ Note'}
      </div>
      <div className="prose prose-sm max-w-none prose-p:text-content-secondary prose-strong:text-content prose-li:text-content-secondary marker:text-content-faint">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
