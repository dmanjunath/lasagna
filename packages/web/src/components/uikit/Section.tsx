import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** Eyebrow — small tracked uppercase label that sits above a title. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--ui-accent-ink))]',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * PageHeader — the top of a screen. Eyebrow / title / lede on the left, one
 * cluster of actions on the right. The title uses the editorial serif for a
 * warm, confident voice.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="font-editorial text-[30px] font-medium leading-[1.05] tracking-[-0.01em] text-content sm:text-[38px]">
          {title}
        </h1>
        {lede && (
          <p className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-content-secondary">
            {lede}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Section — a titled band of content. Sections are separated by generous space,
 * not heavy rules (calm over dense).
 */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-4', className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {title && <h2 className="text-[18px] font-semibold leading-snug text-content">{title}</h2>}
            {description && (
              <p className="mt-1 text-[13px] text-content-muted">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
