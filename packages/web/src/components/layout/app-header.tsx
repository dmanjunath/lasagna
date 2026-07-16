import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUiMode } from '../uikit/mode';
import { BrandMark } from '../common/BrandMark';
import { subscribePull, getPullState } from '../../lib/pull-store';

interface AppHeaderProps {
  /** Hamburger / back-arrow / etc. Mounted on the left. */
  leadingSlot?: React.ReactNode;
  /** @deprecated — kept for prop compatibility. Page titles now come from
   * the page's own `<PageHeader>` to avoid double-titling on mobile. */
  title?: string;
  /** @deprecated — kept for prop compatibility. */
  variant?: 'simple' | 'advanced';
}

// How far the nav logo can be yanked down. Capped (and the page content moves
// down faster) so the mark stays in the pull gap and never reaches content.
const LOGO_MAX_TRAVEL = 44;

/** A few gray wisps that puff outward as the logo lands back in the nav. */
function SmokePuff() {
  const wisps = [
    { x: -13, y: -1 }, { x: 13, y: -3 }, { x: -7, y: -11 },
    { x: 9, y: -9 }, { x: 0, y: -13 }, { x: -2, y: 4 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
      {wisps.map((w, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ width: 11, height: 11, background: 'rgb(var(--ui-content-muted) / 0.32)' }}
          initial={{ opacity: 0.55, scale: 0.35, x: 0, y: 0 }}
          animate={{ opacity: 0, scale: 1.9, x: w.x, y: w.y }}
          transition={{ duration: 0.5, delay: i * 0.012, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/**
 * The centered brand mark. Doubles as the pull-to-refresh indicator: it's the
 * real nav logo, yanked down with the pull (stretching from the top), then
 * sprung back up into the nav with a puff of smoke when the refresh lands.
 */
function NavBrandMark({ size }: { size: number }) {
  const { pull, phase } = useSyncExternalStore(subscribePull, getPullState, getPullState);
  const progress = Math.min(1, pull / 64);
  const y = phase === 'pulling'
    ? Math.min(pull * 0.7, LOGO_MAX_TRAVEL)
    : phase === 'refreshing'
      ? LOGO_MAX_TRAVEL * 0.7
      : 0; // idle / returning → home in the nav
  return (
    <div className="relative grid place-items-center">
      <motion.div
        className="origin-top"
        animate={{ y, scaleY: phase === 'pulling' ? 1 + progress * 0.18 : 1 }}
        transition={
          phase === 'pulling'
            ? { duration: 0 } // track the finger 1:1
            : phase === 'returning'
              ? { type: 'spring', stiffness: 620, damping: 30 } // snap home
              : { type: 'spring', stiffness: 380, damping: 24 } // settle while refreshing
        }
      >
        <BrandMark size={size} />
      </motion.div>
      {phase === 'returning' && <SmokePuff />}
      {(phase === 'pulling' || phase === 'refreshing') && <span className="sr-only" role="status">Refreshing</span>}
    </div>
  );
}

/**
 * Shared top bar (mobile only). Lives `fixed top-0`. Renders the leading slot
 * (hamburger / back), a centered brand mark, and the light/dark toggle.
 */
export function AppHeader({ leadingSlot }: AppHeaderProps) {
  const { mode, toggle } = useUiMode();
  const isDark = mode === 'dark';
  return (
    <header
      className="fixed top-0 inset-x-0 z-30 border-b border-line pt-safe-top backdrop-blur-md"
      style={{ background: 'rgb(var(--ui-canvas) / 0.86)' }}
    >
      <div className="mx-auto px-4 h-12 flex items-center gap-2">
        <div className="w-11 -ml-2 shrink-0 flex items-center">{leadingSlot}</div>
        <div className="flex-1 flex items-center justify-center min-w-0">
          <NavBrandMark size={28} />
        </div>
        <button
          type="button"
          onClick={toggle}
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-11 h-11 -mr-2 shrink-0 grid place-items-center rounded-[10px] text-content-secondary hover:bg-canvas-sunken hover:text-content transition-colors"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
