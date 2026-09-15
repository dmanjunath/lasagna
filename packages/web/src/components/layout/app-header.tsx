import { useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { useLocation } from 'wouter';
import { PrivacyToggle } from '../uikit/PrivacyToggle';
import { BrandMark } from '../common/BrandMark';
import { subscribePull, getPullState } from '../../lib/pull-store';
import { titleForPath } from '../../lib/page-titles';

interface AppHeaderProps {
  /** Hamburger / back-arrow / etc. Mounted on the left. */
  leadingSlot?: React.ReactNode;
}

// How far the nav logo can be yanked down. Capped (and the page content moves
// down faster) so the mark stays in the pull gap and never reaches content.
//
// Both values must clear the divider under the header, or the mark comes to
// rest sitting on the line. The nav row is 48px and the mark starts 10px into
// it, so it needs 38px of travel just to touch the line — the refresh rest
// position used to be 30.8px, i.e. straddling it for the whole refresh.
const LOGO_MAX_TRAVEL = 72;
const LOGO_REFRESH_TRAVEL = 52; // mark lands at 62..90, clear of the 49px edge

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
 * The centered slot. At rest it shows `idleContent` (the page name); the moment
 * a pull starts it cross-fades to the brand mark, which doubles as the
 * pull-to-refresh indicator: it's the real nav logo, yanked down with the pull
 * (stretching from the top), then sprung back up into the nav with a puff of
 * smoke when the refresh lands.
 *
 * The pull subscription stays in here on purpose. It fires at 60Hz for the
 * length of a drag, so lifting it into AppHeader would re-render the whole bar
 * — privacy toggle and all — every frame of the gesture.
 */
function NavBrandMark({ size, idleContent }: { size: number; idleContent?: React.ReactNode }) {
  const { pull, phase } = useSyncExternalStore(subscribePull, getPullState, getPullState);
  const progress = Math.min(1, pull / 64);
  const y = phase === 'pulling'
    ? Math.min(pull * 0.7, LOGO_MAX_TRAVEL)
    : phase === 'refreshing'
      ? LOGO_REFRESH_TRAVEL
      : 0; // idle / returning → home in the nav
  // `returning` still belongs to the mark: it is the spring that puts the logo
  // back, so the title only comes back once the gesture is fully over.
  const showTitle = phase === 'idle' && idleContent != null;
  return (
    <div className="relative grid w-full min-w-0 place-items-center">
      {idleContent != null && (
        <motion.div
          className="[grid-area:1/1] min-w-0 max-w-full"
          animate={{ opacity: showTitle ? 1 : 0 }}
          transition={{ duration: 0.12 }}
        >
          {idleContent}
        </motion.div>
      )}
      <motion.div
        className="[grid-area:1/1]"
        animate={{ opacity: showTitle ? 0 : 1 }}
        transition={{ duration: 0.12 }}
      >
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
      </motion.div>
      {phase === 'returning' && <SmokePuff />}
      {(phase === 'pulling' || phase === 'refreshing') && <span className="sr-only" role="status">Refreshing</span>}
    </div>
  );
}

/**
 * Shared top bar (mobile only). Lives `fixed top-0`. Renders the leading slot
 * (hamburger / back), the page name (brand mark on the home page, and for the
 * length of a pull-to-refresh), and the hide-amounts toggle.
 */
export function AppHeader({ leadingSlot }: AppHeaderProps) {
  const [location] = useLocation();
  const title = titleForPath(location);
  return (
    <header className="fixed top-0 inset-x-0 z-30 border-b border-line pt-safe-top">
      {/* Blur on its own layer so the pulled mark is never inside a
          backdrop-filtered element. (Measured: backdrop-filter does not clip
          descendants in WebKit or Chromium, so this is defensive, not a fix.) */}
      <div
        aria-hidden
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: 'rgb(var(--ui-canvas) / 0.86)' }}
      />
      <div className="relative mx-auto px-4 h-12 flex items-center gap-2">
        <div className="w-11 -ml-2 shrink-0 flex items-center">{leadingSlot}</div>
        <div className="flex-1 flex items-center justify-center min-w-0">
          <NavBrandMark
            size={28}
            idleContent={
              title ? (
                <span className="block truncate px-1 font-editorial text-[17px] font-bold leading-none tracking-[-0.02em] text-content">
                  {title}
                </span>
              ) : null
            }
          />
        </div>
        <PrivacyToggle size={44} />
      </div>
    </header>
  );
}
