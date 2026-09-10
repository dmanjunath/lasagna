import { useEffect } from 'react';

/**
 * Freezes document scroll while an overlay is up.
 *
 * On mobile the document owns vertical scroll (see shell.tsx), so a bottom
 * sheet with nothing of its own to scroll hands the gesture straight to the
 * page and the content slides around underneath the sheet.
 *
 * Ref-counted, so nested overlays (a picker opened from inside a modal) can
 * mount and unmount in any order without one clearing the other's lock.
 */
let locks = 0;
let restore = '';

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      restore = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = restore;
    };
  }, [active]);
}
