import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import { Skeleton } from './Skeleton';

/**
 * PageMeta — the muted line of page context that sits under an <h1>.
 *
 * Chips are state, meta is facts. A filled Badge earns its fill by being
 * object state, a row tag, or an interactive chip. Page context is not any of
 * those, and as a tinted pill it measured ~1.1:1 against the page behind it,
 * so the fill drew a smudge rather than a shape. As plain text runs separated
 * by gap, every tone clears WCAG AA in both modes and the line wraps at 320px
 * where `whitespace-nowrap` pills used to overflow.
 *
 * `min-h-[1.45em]` matches the line box one text run would draw, so the
 * wrapper holds a row's height whether it carries a loading skeleton, the real
 * runs, or nothing at all. Mount it unconditionally and the header stops
 * shoving the page when the data lands or turns out to be empty.
 *
 * Note that a line carrying a `Badge` is taller than 1.45em, so a conditional
 * Badge inside an otherwise-reserved line can still shift it.
 *
 * This is the meta line ONLY. Each page keeps its own <header> and <h1>.
 */
export const PageMeta = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function PageMeta({ className, children, ...props }, ref) {
    return (
      <p
        ref={ref}
        className={cn(
          'mt-1.5 flex min-h-[1.45em] min-w-0 flex-wrap items-center gap-x-3 gap-y-1',
          'text-[13.5px] font-semibold leading-[1.45] text-content-muted',
          className,
        )}
        {...props}
      >
        {children}
      </p>
    );
  },
);

/**
 * One run inside a PageMeta. `gap-x-3` (12px) against a ~3.5px word space at
 * 13.5px is a 3.4x ratio, so runs read as separate without a separator glyph.
 * Tone carries state on the one run that has state; the rest inherit muted.
 */
const pageMetaItem = cva('', {
  variants: {
    tone: {
      muted: '',
      strong: 'text-content-secondary',
      positive: 'text-positive',
      negative: 'text-negative',
      caution: 'text-caution',
      brand: 'text-[rgb(var(--ui-brand-ink))]',
    },
  },
  defaultVariants: { tone: 'muted' },
});

export interface PageMetaItemProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pageMetaItem> {}

export const PageMetaItem = forwardRef<HTMLSpanElement, PageMetaItemProps>(
  function PageMetaItem({ className, tone, children, ...props }, ref) {
    return (
      <span ref={ref} className={cn(pageMetaItem({ tone }), className)} {...props}>
        {children}
      </span>
    );
  },
);

/**
 * The loading placeholder for a PageMeta, as one bar per run it will resolve
 * to. Give it the widths the real runs measure and the placeholder wraps where
 * they wrap, at every viewport, so the reserved height is right by
 * construction rather than by a per-page `min-h` guess that a breakpoint
 * cannot track. Each bar sits in a full 1.45em line box so a wrapped row is
 * exactly as tall as a wrapped row of text.
 */
export function PageMetaSkeleton({ widths }: { widths: string[] }) {
  return (
    <>
      {widths.map((w, i) => (
        <span key={i} className="inline-flex h-[1.45em] items-center">
          <Skeleton className={cn('h-3.5 rounded-ui-sm', w)} />
        </span>
      ))}
    </>
  );
}
