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
          className={cn(
            'ui-root z-[110] max-w-xs rounded-ui-sm bg-panel-raised px-2.5 py-1.5 text-[12px] font-medium text-content',
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
