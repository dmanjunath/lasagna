import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { HIDDEN_AMOUNT } from '../../lib/hide-amounts';
import { MASK_TEXT_STYLE, useRevealOnFocus } from './HiddenAmount';

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

/**
 * An Input holding a real dollar amount. Identical to Input, except that while
 * hide-amounts is on it shows the mask instead of its value and reveals the
 * real one on focus (see useRevealOnFocus). A resting money field is a number
 * on a masked screen, which is the leak the mode exists to prevent; a focused
 * one is the field you are editing, which you have to be able to read.
 *
 * A field that already paints a `$` leadingIcon shows only the bullets, so the
 * two together read as the one mask and not as "$ $•••••". The icon itself
 * STAYS: Input renders a different element tree with and without it, so
 * dropping it on focus remounts the input and throws away the focus that was
 * meant to reveal the value.
 *
 * An EMPTY field is never masked: there is no amount to hide, and a mask over
 * an empty field hides its placeholder and reads as a filled one.
 *
 * A masked field also SAYS it is masked. The bullets are one picture to the eye
 * but five separate characters to assistive tech, so browsing the form
 * announced "Annual gross income, read only, bullet bullet bullet bullet
 * bullet" with nothing to explain the state or the way out of it. The sr-only
 * line below is APPENDED to whatever the field is already described by (the
 * Field hint or error), never substituted for it, so the field reads as
 * "Annual gross income, read only, ..., Amount hidden, focus to reveal". It is
 * the counterpart of the `role="img" aria-label="Amount hidden"` the span
 * primitive already carries, plus the way out, because unlike the span this
 * mask can be opened.
 */
export const MoneyInput = forwardRef<HTMLInputElement, InputProps>(function MoneyInput(
  { type = 'number', value, readOnly, leadingIcon, style, onFocus, onBlur, 'aria-describedby': describedBy, ...props },
  ref,
) {
  const reveal = useRevealOnFocus();
  const maskDescId = useId();
  const masked = reveal.masked && value != null && String(value) !== '';
  const mask = leadingIcon ? HIDDEN_AMOUNT.slice(1) : HIDDEN_AMOUNT;
  const input = (
    <Input
      ref={ref}
      type={masked ? 'text' : type}
      value={masked ? mask : value}
      readOnly={masked || readOnly}
      leadingIcon={leadingIcon}
      style={masked ? { ...style, ...MASK_TEXT_STYLE } : style}
      onFocus={(e) => { reveal.onFocus(); onFocus?.(e); }}
      onBlur={(e) => { reveal.onBlur(); onBlur?.(e); }}
      aria-describedby={masked ? [describedBy, maskDescId].filter(Boolean).join(' ') : describedBy}
      {...props}
    />
  );
  if (!masked) return input;
  return (
    <>
      {input}
      <span id={maskDescId} className="sr-only">Amount hidden, focus to reveal</span>
    </>
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
  // Wire the label to the (single) child control. A child's own id wins; the
  // hint/error paragraph is announced via aria-describedby.
  let control = children;
  let controlId = htmlFor ?? autoId;
  const descId = error || hint ? `${controlId}-desc` : undefined;
  if (Children.count(children) === 1 && isValidElement(children)) {
    const child = children as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
    controlId = child.props.id ?? controlId;
    control = cloneElement(child, {
      id: controlId,
      'aria-describedby': child.props['aria-describedby'] ?? descId,
      'aria-invalid': child.props['aria-invalid'] ?? (error ? true : undefined),
    });
  }
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <Label htmlFor={controlId}>
          {label}
          {required && <span className="ml-0.5 text-brand">*</span>}
        </Label>
      )}
      {control}
      {error ? (
        <p id={descId} className="flex items-center gap-1.5 text-[12px] font-medium text-negative">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="text-[12px] text-content-muted">{hint}</p>
      ) : null}
    </div>
  );
}
