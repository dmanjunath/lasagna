import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'ink' | 'sauce' | 'cheese' | 'basil' | 'ghost' | 'cream';

interface PillProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

export function Pill({ tone = 'ghost', children, className }: PillProps) {
  return (
    <span className={cn('ds-pill', `ds-pill--${tone}`, className)}>
      {children}
    </span>
  );
}
