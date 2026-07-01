import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Surface / Card — the elevation primitive. `tone` picks the surface level,
 * `pad` the internal breathing room. `interactive` adds a gentle lift on hover.
 */
const surface = cva('rounded-ui-lg border transition-all duration-200 ease-ui', {
  variants: {
    tone: {
      panel: 'bg-panel border-line shadow-ui-sm',
      raised: 'bg-panel-raised border-line shadow-ui-md',
      sunken: 'bg-canvas-sunken border-line',
      ghost: 'bg-transparent border-dashed border-line-strong shadow-none',
      brand: 'bg-brand-soft border-transparent shadow-none',
    },
    pad: {
      none: 'p-0',
      sm: 'p-4',
      md: 'p-5 sm:p-6',
      lg: 'p-6 sm:p-8',
    },
    interactive: {
      true: 'cursor-pointer hover:-translate-y-0.5 hover:shadow-ui-md hover:border-line-strong',
      false: '',
    },
  },
  defaultVariants: { tone: 'panel', pad: 'md', interactive: false },
});

export interface SurfaceProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surface> {}

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { className, tone, pad, interactive, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn(surface({ tone, pad, interactive }), className)} {...props} />
  );
});

/** Optional card header — eyebrow + title + description, with a right slot. */
export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold leading-snug text-content">{title}</h3>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-content-muted">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
