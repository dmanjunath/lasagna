import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandMark } from '../common/BrandMark';

const THRESHOLD = 64; // px of (dampened) pull that arms a refresh
const MAX_PULL = 110;

/**
 * Pull-to-refresh for the mobile document-scroll shell. iOS has no native
 * web pull-to-refresh (and overscroll-behavior disables Android's), so this
 * owns the gesture: pulling down from the very top reveals the brand waves,
 * which bob while the page reloads.
 *
 * Content is translated inside a wrapper div — the fixed header/tab bar are
 * siblings, so they stay put.
 */
export function PullToRefresh({ topOffset, children }: { topOffset: string; children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const engaged = useRef(false);

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
      setPull(Math.max(0, Math.min(MAX_PULL, dy * 0.45)));
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (!engaged.current) return;
      engaged.current = false;
      setPull((p) => {
        if (p >= THRESHOLD) {
          setRefreshing(true);
          // Let the waves bob for a beat so the refresh feels acknowledged.
          setTimeout(() => window.location.reload(), 450);
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
  }, [refreshing]);

  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <>
      {/* Wave indicator — fades/scales in with the pull, bobs while refreshing. */}
      <div
        aria-hidden={pull === 0}
        role="status"
        aria-label={refreshing ? 'Refreshing' : undefined}
        className="pointer-events-none fixed left-1/2 z-20 -translate-x-1/2"
        style={{ top: `calc(${topOffset} + 6px)`, opacity: refreshing ? 1 : progress }}
      >
        <div
          className={refreshing ? 'animate-p2r-bob' : undefined}
          style={{ transform: refreshing ? undefined : `scale(${0.6 + progress * 0.4}) rotate(${progress * 20 - 20}deg)` }}
        >
          <BrandMark size={30} />
        </div>
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: startY.current === null && !refreshing ? 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
        }}
      >
        {children}
      </div>
    </>
  );
}
