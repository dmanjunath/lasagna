import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface DividerProps {
  dotted?: boolean;
  tight?: boolean;
  className?: string;
}

export function Divider({ dotted, tight, className }: DividerProps) {
  return (
    <hr
      className={cn(
        'ds-divider',
        dotted && 'ds-divider--dotted',
        tight && 'ds-divider--tight',
        className,
      )}
    />
  );
}

interface RuleLabelProps {
  children: ReactNode;
  className?: string;
}

/**
 * Editorial section break — full-width hairline with a centered eyebrow label.
 * E.g. <RuleLabel>Recent activity</RuleLabel>
 */
export function RuleLabel({ children, className }: RuleLabelProps) {
  return (
    <div className={cn('ds-rule-label', className)}>
      <span className="ds-eyebrow">{children}</span>
    </div>
  );
}
