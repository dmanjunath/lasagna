import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * The page's `<h1>`.
 *
 * On mobile the page name lives in the top bar, so the heading is `sr-only`
 * below 768px rather than removed: the document still has exactly one `<h1>` at
 * every width, in reading order inside `<main>`, so the VoiceOver heading rotor
 * still lands on it. The breakpoint is `md:` (768px) because that is the exact
 * width at which the bar itself stops mounting. `sm:` is the stock 640px here
 * (`tailwind.config.js` declares `screens` outside `theme`, so the custom scale
 * is discarded and the defaults apply) and would leave a 700px tablet showing
 * the bar title and the page title at once.
 *
 * Pages whose heading is an entity name or a purpose-led line keep their own
 * `<h1>`. This is for the ones whose heading is just the page name.
 */
export function PageTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h1
      className={cn(
        'sr-only md:not-sr-only md:block',
        'font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.028em] text-content',
        className,
      )}
    >
      {children}
    </h1>
  );
}
