import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-[13px] font-medium text-content-secondary', className)}
      {...props}
    />
  );
}

const fieldBase =
  'w-full rounded-ui-md bg-panel text-content placeholder:text-content-faint ' +
  'border border-line-strong shadow-ui-sm transition-[border-color,box-shadow] duration-150 ease-ui ' +
  'focus:outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)] ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  leadingIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, leadingIcon, ...props },
  ref,
) {
  if (leadingIcon) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-content-muted">
          {leadingIcon}
        </span>
        <input
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(
            fieldBase,
            'h-11 min-h-touch pl-10 pr-3.5 text-sm',
            invalid && 'border-negative focus:border-negative focus:shadow-[0_0_0_3px_var(--ui-negative-soft)]',
            className,
          )}
          {...props}
        />
      </div>
    );
  }
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBase,
        'h-11 min-h-touch px-3.5 text-sm',
        invalid && 'border-negative focus:border-negative focus:shadow-[0_0_0_3px_var(--ui-negative-soft)]',
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          fieldBase,
          'min-h-[88px] px-3.5 py-2.5 text-sm leading-relaxed',
          invalid && 'border-negative focus:border-negative focus:shadow-[0_0_0_3px_var(--ui-negative-soft)]',
          className,
        )}
        {...props}
      />
    );
  },
);

/**
 * Field — composes Label + control + helper/error text with a shared id, so the
 * control is always labelled and errors are announced.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={id}>
          {label}
          {required && <span className="ml-0.5 text-brand">*</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-negative">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-content-muted">{hint}</p>
      ) : null}
    </div>
  );
}
