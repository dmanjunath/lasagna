import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const button = cva(
  [
    'ui-focus relative inline-flex items-center justify-center gap-2 select-none',
    'font-semibold whitespace-nowrap rounded-ui-md',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-ui',
    'disabled:pointer-events-none disabled:opacity-50',
    'active:translate-y-px',
  ],
  {
    variants: {
      // All variants share the soft-tinted "pill" pattern (tint bg + ink text +
      // bold + subtle hover lift/ring), differing only by semantic color.
      variant: {
        primary:
          'bg-brand-soft text-[rgb(var(--ui-brand-ink))] font-bold hover:-translate-y-px hover:shadow-ui-sm hover:ring-1 hover:ring-[var(--ui-brand-ring)]',
        secondary:
          'bg-canvas-sunken text-content font-bold border border-line hover:-translate-y-px hover:shadow-ui-sm hover:border-line-strong',
        ghost:
          'bg-transparent text-content-secondary font-semibold hover:bg-canvas-sunken hover:text-content',
        destructive:
          'bg-[var(--ui-negative-soft)] text-[rgb(var(--ui-negative))] font-bold hover:-translate-y-px hover:shadow-ui-sm hover:ring-1 hover:ring-[rgb(var(--ui-negative))]/40',
      },
      size: {
        sm: 'h-9 px-3.5 text-[13px] touch-target',
        md: 'h-11 px-5 text-sm min-h-touch',
        lg: 'h-12 px-6 text-[15px] min-h-touch',
        icon: 'h-11 w-11 min-h-touch min-w-touch p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, leadingIcon, trailingIcon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(button({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {!loading && leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});
