import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface KPIGridProps {
  children: ReactNode;
  variant?: 'light' | 'dark';
  /** Hints column min-width: 'tight' for ≥4 KPIs, 'loose' for 2-3 */
  cols?: 'default' | 'tight' | 'loose';
  className?: string;
}

export function KPIGrid({ children, variant = 'light', cols = 'default', className }: KPIGridProps) {
  return (
    <div
      className={cn(
        'ds-kpi-grid',
        variant === 'dark' && 'ds-kpi-grid--dark',
        cols === 'tight' && 'ds-kpi-grid--cols-4',
        cols === 'loose' && 'ds-kpi-grid--cols-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface KPIProps {
  eyebrow: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Color tint for the value (e.g. trend) */
  tone?: 'default' | 'pos' | 'neg' | 'warn';
}

export function KPI({ eyebrow, value, sub, tone = 'default' }: KPIProps) {
  const valueClass =
    tone === 'pos' ? 'ds-kpi__value ds-pos' :
    tone === 'neg' ? 'ds-kpi__value ds-neg' :
    tone === 'warn' ? 'ds-kpi__value ds-warn' :
    'ds-kpi__value';
  return (
    <div className="ds-kpi">
      <span className="ds-kpi__eyebrow">{eyebrow}</span>
      <span className={valueClass}>{value}</span>
      {sub && <span className="ds-kpi__sub">{sub}</span>}
    </div>
  );
}
