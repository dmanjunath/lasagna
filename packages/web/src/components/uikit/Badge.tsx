import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Badge / Pill — a small status label. Every tone pairs a tinted background
 * with a readable foreground; meaning is never carried by color alone, so pass
 * an icon or explicit text where it matters.
 */
const badge = cva(
  'inline-flex items-center gap-1.5 rounded-full font-medium leading-none whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-canvas-sunken text-content-secondary border border-line',
        brand: 'bg-brand-soft text-brand border border-transparent',
        positive: 'bg-positive-soft text-positive border border-transparent',
        negative: 'bg-negative-soft text-negative border border-transparent',
        caution: 'bg-caution-soft text-caution border border-transparent',
        info: 'bg-info-soft text-info border border-transparent',
      },
      size: {
        sm: 'px-2 py-0.5 text-[11px]',
        md: 'px-2.5 py-1 text-[12px]',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {
  dot?: boolean;
}

const dotColor: Record<string, string> = {
  neutral: 'bg-content-muted',
  brand: 'bg-brand',
  positive: 'bg-positive',
  negative: 'bg-negative',
  caution: 'bg-caution',
  info: 'bg-info',
};

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone, size }), className)} {...props}>
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', dotColor[tone ?? 'neutral'])}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
