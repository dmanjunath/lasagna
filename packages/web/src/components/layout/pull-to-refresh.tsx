import { useEffect, useRef, useState, type ReactNode } from 'react';
import { hapticLight, hapticMedium } from '../../lib/haptics';
import { setPullState } from '../../lib/pull-store';

const THRESHOLD = 64; // px of (dampened) pull that arms a refresh
const MAX_PULL = 110;

/**
 * Pull-to-refresh for the mobile document-scroll shell. iOS has no native
 * web pull-to-refresh (and overscroll-behavior disables Android's), so this
 * owns the gesture: pulling down from the very top drags the page — and, via
 * pull-store, yanks the top-nav brand mark down with it (AppHeader animates the
 * real logo). A soft refresh: the shell stays put; only the page content
 * remounts and refetches.
 *
 * Content is translated inside a wrapper div — the fixed header/tab bar are
 * siblings, so they stay put.
 */
export function PullToRefresh({
  topOffset,
  onRefresh,
  children,
}: {
  topOffset: string;
  onRefresh: () => void;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [returning, setReturning] = useState(false); // springing the mark back up into the nav
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const engaged = useRef(false);
  const buzzed = useRef(false); // haptic fired for this pull's threshold crossing

  // Mirror gesture state to the shared store so AppHeader's nav logo can be
  // yanked down / sprung back. Reset to idle on unmount.
  useEffect(() => {
    const phase = refreshing ? 'refreshing' : returning ? 'returning' : pull > 0 ? 'pulling' : 'idle';
    setPullState({ pull, phase });
  }, [pull, refreshing, returning]);
  useEffect(() => () => setPullState({ pull: 0, phase: 'idle' }), []);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (refreshing || window.scrollY > 0) return;
      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      engaged.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = Math.abs(e.touches[0].clientX - startX.current);
      if (!engaged.current) {
        // Engage only for a clearly-vertical downward pull that starts at the top.
        if (dy > 10 && dy > dx * 1.5 && window.scrollY <= 0) engaged.current = true;
        else if (dy < 0 || window.scrollY > 0) { startY.current = null; return; }
        else return;
      }
      e.preventDefault(); // we own the gesture — stop rubber-band/scroll
      const next = Math.max(0, Math.min(MAX_PULL, dy * 0.45));
      if (next >= THRESHOLD && !buzzed.current) {
        buzzed.current = true;
        hapticLight();
      }
      setPull(next);
    };
    const onEnd = () => {
      buzzed.current = false;
      if (startY.current === null) return;
      startY.current = null;
      if (!engaged.current) return;
      engaged.current = false;
      setPull((p) => {
        if (p >= THRESHOLD) {
          hapticMedium();
          setRefreshing(true);
          onRefresh();
          // The remounted page shows its own skeletons; bob for a beat so the
          // refresh feels acknowledged, then spring the mark back up into the
          // nav (the "put it back" motion) before clearing.
          setTimeout(() => {
            setRefreshing(false);
            setReturning(true);
            setPull(0);
            setTimeout(() => setReturning(false), 420);
          }, 900);
          return THRESHOLD;
        }
        return 0;
      });
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing, onRefresh]);

  // The nav logo (AppHeader) is the pull indicator now — see pull-store. Here we
  // just drag the page content down to open the gap the logo drops into.
  return (
    <div
      style={{
        transform: pull > 0 ? `translateY(${pull}px)` : undefined,
        transition: startY.current === null && !refreshing ? 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
      }}
    >
      {children}
    </div>
  );
}
