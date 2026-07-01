import { cn } from '../../lib/utils';

/**
 * Skeleton — a warm shimmer placeholder. Uses a moving highlight rather than a
 * harsh pulse so loading feels calm.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-ui-sm bg-canvas-sunken',
        'after:absolute after:inset-0 after:-translate-x-full',
        'after:bg-gradient-to-r after:from-transparent after:via-white/25 after:to-transparent',
        'after:animate-[ui-shimmer_1.6s_infinite] dark:after:via-white/10',
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
