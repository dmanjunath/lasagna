import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface StatStripItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'pos' | 'neg' | 'warn';
}

interface StatStripProps {
  items: StatStripItem[];
  className?: string;
}

/**
 * Horizontal hairline-separated stat row. No card. No background.
 * Reads like the stats line in a newspaper masthead.
 * Each cell: monospace eyebrow + big serif value + tabular sub.
 */
export function StatStrip({ items, className }: StatStripProps) {
  return (
    <dl className={cn('ds-strip', className)}>
      {items.map((it, i) => (
        <div className="ds-strip__item" key={i}>
          <dt className="ds-strip__label">{it.label}</dt>
          <dd className={cn(
            'ds-strip__value',
            it.tone === 'pos' && 'ds-strip__value--pos',
            it.tone === 'neg' && 'ds-strip__value--neg',
            it.tone === 'warn' && 'ds-strip__value--warn',
          )}>{it.value}</dd>
          {it.sub && <dd className="ds-strip__sub">{it.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}
