import { ReactNode, CSSProperties, MouseEventHandler } from 'react';
import { cn } from '../../lib/utils';

type CardVariant = 'default' | 'dark' | 'ghost' | 'cream' | 'accent';

interface CardProps {
  variant?: CardVariant;
  tight?: boolean;
  flush?: boolean;
  linkable?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export function Card({
  variant = 'default',
  tight,
  flush,
  linkable,
  children,
  className,
  style,
  onClick,
}: CardProps) {
  return (
    <div
      className={cn(
        'ds-card',
        variant === 'dark' && 'ds-card--dark',
        variant === 'ghost' && 'ds-card--ghost',
        variant === 'cream' && 'ds-card--cream',
        variant === 'accent' && 'ds-card--accent',
        tight && 'ds-card--tight',
        flush && 'ds-card--flush',
        linkable && 'ds-card--linkable',
        className,
      )}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}
