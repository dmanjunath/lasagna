import type { ReactNode } from 'react';
import * as RTooltip from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';

/**
 * Tooltip — built on Radix. Wrap once at the app/styleguide root with
 * <TooltipProvider>, then use <Tooltip content="…">{trigger}</Tooltip>.
 */
export const TooltipProvider = RTooltip.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          // `ui-root` is kept to pull the `--ui-*` token scope + content
          // color/typography into the portal, but its unlayered
          // `background-color: rgb(var(--ui-canvas))` rule (theme.css) beats
          // any Tailwind `bg-*` utility class (they share specificity and the
          // build flattens @layer, so source order decides and `.ui-root` is
          // emitted last). An inline style outranks every class, so we set the
          // raised-panel surface here to match the white Arrow below.
          style={{ backgroundColor: 'rgb(var(--ui-panel-raised))' }}
          className={cn(
            'ui-root z-[110] max-w-xs rounded-ui-sm px-2.5 py-1.5 text-[12px] font-medium text-content',
            'border border-line shadow-ui-lg',
            'data-[state=delayed-open]:[animation:ui-fade-in_120ms_ease-out]',
            className,
          )}
        >
          {content}
          <RTooltip.Arrow className="fill-[rgb(var(--ui-panel-raised))]" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
