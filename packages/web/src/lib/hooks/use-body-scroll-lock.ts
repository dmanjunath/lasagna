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
let restorePadding = '';

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      const body = document.body;
      restoreOverflow = body.style.overflow;
      restorePadding = body.style.paddingRight;
      const gutter = window.innerWidth - document.documentElement.clientWidth;
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
        document.body.style.overflow = restoreOverflow;
        document.body.style.paddingRight = restorePadding;
      }
    };
  }, [active]);
}
