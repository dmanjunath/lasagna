import { useEffect } from 'react';

/**
 * Freezes document scroll while an overlay is up.
 *
 * On mobile the document owns vertical scroll (see shell.tsx), so a sheet or
 * popover with nothing of its own to scroll hands the gesture straight to the
 * page and the content slides around underneath it.
 *
 * Hiding overflow also removes a classic scrollbar, which would shift the page
 * sideways on platforms that reserve space for one, so the width it freed is
 * added back as padding.
 *
 * Ref-counted, so nested overlays (a picker opened from inside a modal) can
 * mount and unmount in any order without one clearing the other's lock.
 */
let locks = 0;
let restoreOverflow = '';
let restoreHtmlOverflow = '';
let restorePadding = '';

/**
 * True while any overlay holds the lock. Document-level gesture handlers
 * (pull-to-refresh, the edge swipes in shell.tsx) must stand down when it is:
 * their events still fire from inside an open sheet, and acting on them drives
 * the page behind the overlay.
 */
export function isScrollLocked(): boolean {
  return locks > 0;
}

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      const body = document.body;
      const html = document.documentElement;
      restoreOverflow = body.style.overflow;
      restoreHtmlOverflow = html.style.overflow;
      restorePadding = body.style.paddingRight;
      const gutter = window.innerWidth - html.clientWidth;
      // html too: theme.css gives html `overflow-x: clip`, which stops body's
      // overflow reaching the viewport, so hiding body alone left the page
      // scrolling under every open sheet.
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      if (gutter > 0) {
        const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
        body.style.paddingRight = `${current + gutter}px`;
      }
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) {
        document.documentElement.style.overflow = restoreHtmlOverflow;
        document.body.style.overflow = restoreOverflow;
        document.body.style.paddingRight = restorePadding;
      }
    };
  }, [active]);
}
