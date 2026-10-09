import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * TextLink — the one look for a text link that goes somewhere ("View all",
 * "Largest $3,032.35 ›", "Reconnect"): brand ink, semibold, a trailing chevron,
 * underline on hover where hover exists. With `href` it is a client-side Link
 * (never a full reload); with `onClick` it is a button.
 */
export function TextLink({
  href,
  onClick,
  children,
  className,
  chevron = true,
  title,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  /** Off for links inside a sentence, where the arrow would interrupt it. */
  chevron?: boolean;
  title?: string;
}) {
  const cls = cn(
    'ui-focus touch-target-inline inline-flex max-w-full items-center gap-0.5 rounded-ui-xs text-left text-[13.5px] font-semibold text-[rgb(var(--ui-brand-ink))] [@media(hover:hover)]:hover:underline',
    className,
  );
  const body = (
    <>
      <span className="truncate">{children}</span>
      {chevron && <ChevronRight size={13} className="shrink-0" aria-hidden />}
    </>
  );
  return href ? (
    <Link href={href} className={cls} title={title}>{body}</Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} title={title}>{body}</button>
  );
}
