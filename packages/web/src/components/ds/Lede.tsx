import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface LedeProps {
  children: ReactNode;
  className?: string;
}

/**
 * Large editorial paragraph that addresses the user directly.
 * Use <Lede.Num /> for inline tabular money values that take the ink color.
 */
export function Lede({ children, className }: LedeProps) {
  return <p className={cn('ds-lede', className)}>{children}</p>;
}

interface NumProps {
  children: ReactNode;
  tone?: 'default' | 'pos' | 'neg';
  /** Highlight with a soft cheese underline (e.g. for the day's focus phrase) */
  highlight?: boolean;
}

Lede.Num = function LedeNum({ children, tone = 'default', highlight }: NumProps) {
  if (highlight) return <span className="ds-lede__hi">{children}</span>;
  return (
    <span className={cn(
      'ds-lede__num',
      tone === 'pos' && 'ds-lede__num--pos',
      tone === 'neg' && 'ds-lede__num--neg',
    )}>
      {children}
    </span>
  );
};
