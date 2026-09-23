import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';

/**
 * Skeleton — a warm shimmer placeholder. Uses a moving highlight rather than a
 * harsh pulse so loading feels calm.
 *
 * `as="span"` for a skeleton standing in for inline content. A `<div>` inside a
 * `<p>` is invalid HTML: the browser closes the paragraph early, so the markup
 * React renders is not the markup that ends up in the document, and React logs
 * a hydration error for it on every load.
 */
export function Skeleton({
  className,
  as: Tag = 'div',
  style,
}: {
  className?: string;
  as?: 'div' | 'span';
  /**
   * For a dimension that has to match a value computed in code rather than a
   * Tailwind step. A skeleton exists to reserve the exact space its content
   * will take, and a class name cannot be built from a variable at runtime.
   */
  style?: CSSProperties;
}) {
  return (
    <Tag
      style={style}
      className={cn(
        'relative overflow-hidden rounded-ui-sm bg-canvas-sunken',
        'after:absolute after:inset-0 after:-translate-x-full',
        'after:bg-gradient-to-r after:from-transparent after:via-white/25 after:to-transparent',
        'after:animate-[ui-shimmer_1.6s_infinite] dark:after:via-white/10',
        // A span is inline by default, which would collapse the width and
        // height every caller sets on it.
        Tag === 'span' && 'block',
        className,
      )}
      aria-hidden
    />
  );
}

/** A stacked text-line skeleton (last line shorter, like real copy). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
