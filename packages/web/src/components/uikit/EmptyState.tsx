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
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-ui-lg border border-dashed border-line-strong bg-canvas-sunken/40 px-6 py-12 text-center',
        className,
      )}
    >
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-ui-md bg-brand-soft text-brand">
          {icon}
        </div>
      )}
      <h3 className="text-[16px] font-semibold text-content">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-content-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
