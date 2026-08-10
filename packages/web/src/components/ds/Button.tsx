import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'ink' | 'ghost' | 'ghost-dark' | 'link' | 'icon';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'ds-btn',
        variant === 'primary' && 'ds-btn--primary',
        variant === 'ink' && 'ds-btn--ink',
        variant === 'ghost' && 'ds-btn--ghost',
        variant === 'ghost-dark' && 'ds-btn--ghost-dark',
        variant === 'link' && 'ds-btn--link',
        variant === 'icon' && 'ds-btn--icon',
        size === 'sm' && 'ds-btn--sm',
        size === 'lg' && 'ds-btn--lg',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
