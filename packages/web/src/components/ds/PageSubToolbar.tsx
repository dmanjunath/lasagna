import { ReactNode } from 'react';

interface PageSubToolbarProps {
  /** Left slot: tabs, segmented controls, view toggles. */
  left?: ReactNode;
  /** Right slot: filter chips, range, sync. */
  right?: ReactNode;
  className?: string;
}

/**
 * PageSubToolbar — thin 40px row that lives BELOW the page-bar hairline.
 *
 * Page-bar is locked to 56px desktop / 48px mobile with a single action slot.
 * Anything else (tabs, view toggles, month navs, sync chips, filter chips)
 * migrates here so the masthead stays a true single-row primitive.
 *
 * Use sparingly. If a page doesn't need tabs or filters, omit this entirely.
 */
export function PageSubToolbar({ left, right, className }: PageSubToolbarProps) {
  if (!left && !right) return null;
  return (
    <div className={`ds-page-subtoolbar ${className ?? ''}`}>
      <div className="ds-page-subtoolbar__left">{left}</div>
      {right && <div className="ds-page-subtoolbar__right">{right}</div>}
    </div>
  );
}
