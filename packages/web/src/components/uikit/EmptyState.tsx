import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * EmptyState — a calm, reassuring placeholder. Icon in a soft brand medallion,
 * a friendly title, a plain-language line, and an optional action.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  tone = 'brand',
  variant = 'inset',
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /**
   * What the medallion says before the words are read. `negative` for a
   * failure: the brand tint is the same green a finished step wears, so a
   * "couldn't load" panel announced itself in the colour of success.
   */
  tone?: 'brand' | 'negative';
  /**
   * `inset` (default) is a placeholder in a slot on an otherwise populated page:
   * dashed, sunken, quiet, because the page around it carries the weight.
   *
   * `page` is the whole screen. There is nothing around it to be quiet against,
   * so it takes the solid panel every other card wears and a heading sized to
   * lead rather than to label.
   */
  variant?: 'inset' | 'page';
}) {
  const isPage = variant === 'page';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        isPage
          ? 'rounded-ui-xl border border-line bg-panel shadow-ui-sm'
          : 'rounded-ui-lg border border-dashed border-line-strong bg-canvas-sunken/40',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'mb-4 flex h-12 w-12 items-center justify-center rounded-ui-md',
            tone === 'negative' ? 'bg-negative-soft text-negative' : 'bg-brand-soft text-brand',
          )}
        >
          {icon}
        </div>
      )}
      <h3
        className={cn(
          'text-content',
          isPage
            ? 'font-editorial text-[22px] font-bold tracking-[-0.02em]'
            : 'text-[16px] font-semibold',
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-content-muted">
          {description}
        </p>
      )}
      {action && <div className={isPage ? 'mt-6' : 'mt-5'}>{action}</div>}
    </div>
  );
}
