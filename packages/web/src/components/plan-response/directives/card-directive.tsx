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
      <div className={cn('text-[13px] font-semibold mb-2', labelStyles[variant])}>
        {variant === 'warning' ? 'Warning' : variant === 'highlight' ? 'Key insight' : 'Note'}
      </div>
      <div className="max-w-none text-sm [&_p]:text-content-secondary [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:text-content [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:text-content-secondary [&_li]:mb-1 [&_li>p]:my-0 marker:text-content-faint">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
