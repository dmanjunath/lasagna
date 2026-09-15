import { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { isMasked } from '../../lib/hide-amounts';
import { HiddenAmount } from '../uikit/HiddenAmount';

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
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Color tint for the value (e.g. trend) */
  tone?: 'default' | 'pos' | 'neg' | 'warn';
}

export function KPI({ label, value, sub, tone = 'default' }: KPIProps) {
  // A masked amount carries no tone — red/green on it would leak the sign.
  const masked = isMasked(value);
  const valueClass =
    masked ? 'ds-kpi__value' :
    tone === 'pos' ? 'ds-kpi__value ds-pos' :
    tone === 'neg' ? 'ds-kpi__value ds-neg' :
    tone === 'warn' ? 'ds-kpi__value ds-warn' :
    'ds-kpi__value';
  return (
    <div className="ds-kpi">
      <span className="ds-kpi__label">{label}</span>
      <span className={valueClass}>{masked ? <HiddenAmount /> : value}</span>
      {sub && <span className="ds-kpi__sub">{sub}</span>}
    </div>
  );
}
