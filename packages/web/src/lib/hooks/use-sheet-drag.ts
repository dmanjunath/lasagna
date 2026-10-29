import { useEffect, useRef, type RefObject } from 'react';
import { animate, useMotionValue, type MotionValue } from 'framer-motion';

/**
 * Swipe-to-dismiss for a phone bottom sheet, the way Instagram's sheets work:
 * a drag down anywhere on the sheet pulls it down while its content is at the
 * top, and scrolls the content back up first while it isn't. A drag up always
 * scrolls the content. Released far or fast enough, the sheet slides out and
 * `onClose` runs; otherwise it springs back.
 *
 * It also keeps every touch inside `rootRef` (the sheet and its scrim) off the
 * page behind: a move with nothing left to scroll is cancelled, so it can't
 * chain to the document the way iOS lets it.
 *
 * Touch events, not pointer events: only a cancelable touchmove can stop the
 * native scroll once we decide the gesture is a drag.
 *
 * Returns the sheet's y offset, for the panel's motion `style`.
 */
export function useSheetDrag({
  enabled,
  onClose,
  rootRef,
  panelRef,
}: {
  enabled: boolean;
  onClose: () => void;
  rootRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
}): MotionValue<number> {
  const y = useMotionValue(0);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!enabled || !root || !panel) return;
    y.set(0);

    let mode: 'idle' | 'drag' | 'off' = 'idle';
    let inPanel = false;
    let scroller: HTMLElement | null = null;
    let base = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;

    // The nearest ancestor of the touch, inside the panel, that can scroll.
    const scrollerOf = (target: EventTarget | null) => {
      for (let el = target as HTMLElement | null; el && el !== panel; el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      }
      return null;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || (e.target as Element).closest?.('input[type="range"]')) {
        mode = 'off';
        return;
      }
      mode = 'idle';
      inPanel = panel.contains(e.target as Node);
      scroller = inPanel ? scrollerOf(e.target) : null;
      lastY = e.touches[0].clientY;
      lastT = e.timeStamp;
      velocity = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (mode === 'off') return;
      const cy = e.touches[0].clientY;
      const delta = cy - lastY;
      const dt = Math.max(1, e.timeStamp - lastT);
      velocity = 0.8 * (delta / dt) + 0.2 * velocity;
      lastY = cy;
      lastT = e.timeStamp;

      if (!inPanel) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (mode === 'drag') {
        if (e.cancelable) e.preventDefault();
        y.set(Math.max(0, cy - base));
        return;
      }
      const atTop = !scroller || scroller.scrollTop <= 0;
      const atBottom = !scroller || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if (delta > 0 && atTop && e.cancelable) {
        // Pulling down with nothing above: the sheet follows the finger.
        mode = 'drag';
        base = cy;
        e.preventDefault();
      } else if ((delta < 0 && atBottom) || (delta > 0 && atTop)) {
        // Nothing left to scroll this way: don't hand it to the page.
        if (e.cancelable) e.preventDefault();
      }
    };

    const onEnd = () => {
      if (mode === 'drag') {
        if (y.get() > 96 || velocity > 0.5) {
          void animate(y, panel.offsetHeight, { duration: 0.18, ease: 'easeIn' }).then(() => onCloseRef.current());
        } else {
          void animate(y, 0, { type: 'spring', stiffness: 500, damping: 40 });
        }
      }
      mode = 'idle';
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, rootRef, panelRef, y]);

  return y;
}
