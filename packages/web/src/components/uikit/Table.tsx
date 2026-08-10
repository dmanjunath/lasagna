import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Table primitives — a quiet, airy data table. Hairline row separators, no
 * vertical rules, comfortable row height. Wrap in Surface pad="none" for a card.
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-left', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('', className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TR({
  className,
  interactive,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        'border-b border-line last:border-0',
        interactive && 'cursor-pointer transition-colors duration-150 hover:bg-brand-softer',
        className,
      )}
      {...props}
    />
  );
}

export function TH({
  className,
  numeric,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-muted',
        numeric ? 'text-right' : 'text-left',
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TD({
  className,
  numeric,
  children,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-4 py-3 text-sm text-content-secondary',
        numeric && 'ui-tnum text-right tabular-nums text-content',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

/** Convenience cell pairing a primary label with a muted sub-label. */
export function CellStack({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="font-medium text-content">{primary}</span>
      {secondary && <span className="text-[12px] text-content-muted">{secondary}</span>}
    </div>
  );
}
