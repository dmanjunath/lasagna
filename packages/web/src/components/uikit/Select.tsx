import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

/** Native select styled to match the field system, with a custom chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-11 min-h-touch w-full appearance-none rounded-ui-md bg-panel pl-3.5 pr-10 text-sm text-content',
          'border border-line-strong shadow-ui-sm transition-[border-color,box-shadow] duration-150 ease-ui',
          'focus:outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
          invalid && 'border-negative',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
        aria-hidden
      />
    </div>
  );
});
