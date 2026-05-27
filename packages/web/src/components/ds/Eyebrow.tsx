import { ReactNode, CSSProperties } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'default' | 'on-dark' | 'ink' | 'sauce' | 'basil';

interface EyebrowProps {
  children: ReactNode;
  variant?: Variant;
  className?: string;
  style?: CSSProperties;
}

export function Eyebrow({ children, variant = 'default', className, style }: EyebrowProps) {
  return (
    <span
      className={cn(
        'ds-eyebrow',
        variant === 'on-dark' && 'ds-eyebrow--on-dark',
        variant === 'ink' && 'ds-eyebrow--ink',
        variant === 'sauce' && 'ds-eyebrow--sauce',
        variant === 'basil' && 'ds-eyebrow--basil',
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}
