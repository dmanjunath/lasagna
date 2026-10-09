import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, type MotionStyle } from 'framer-motion';
import { useLocation } from 'wouter';
import { ChevronLeft } from 'lucide-react';
import { PrivacyToggle } from '../uikit/PrivacyToggle';
import { BrandMark } from '../common/BrandMark';
import { subscribePull, getPullState } from '../../lib/pull-store';
import { titleForPath } from '../../lib/page-titles';
import { useMobileHeaderConfig } from '../../lib/mobile-header';

interface AppHeaderProps {
  /** Hamburger / back-arrow / etc. Mounted on the left. */
  leadingSlot?: React.ReactNode;
  /** Carries the drawer's push offset. */
  style?: MotionStyle;
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
 * One icon control in the top bar's trailing slot. Pages pass these through
 * useMobileHeader, so every page's actions share one size and one idiom.
 */
export function HeaderAction({
  label, onClick, children, active = false, expanded, controls, disabled = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  /** A toggle that is on, e.g. filters applied. Adds a dot. */
  active?: boolean;
  /** For a control that opens a panel: whether it is open now. */
  expanded?: boolean;
  /** The id of the panel it opens. */
  controls?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-expanded={expanded}
      aria-controls={controls}
      className={`ui-focus relative w-11 h-11 grid place-items-center rounded-[10px] [@media(hover:hover)]:hover:bg-canvas-sunken [@media(hover:hover)]:hover:text-content active:bg-canvas-sunken transition-colors disabled:opacity-40 ${
        expanded ? 'bg-canvas-sunken text-content' : 'text-content-secondary'
      }`}
    >
      {children}
      {active && <span aria-hidden className="absolute top-2 right-2 w-2 h-2 rounded-full bg-brand" />}
    </button>
  );
}

/** A text verb in the top bar (Create, Save), for forms. */
export function HeaderTextAction({
  label, onClick, disabled = false,
}: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="ui-focus h-11 px-2 rounded-[10px] text-[16px] font-bold text-[rgb(var(--ui-brand-ink))] disabled:text-content-muted transition-colors"
    >
      {label}
    </button>
  );
}

/**
 * Shared top bar (mobile only). Lives `fixed top-0`. Renders the leading slot
 * (hamburger / back), the page name (brand mark on the home page, and for the
 * length of a pull-to-refresh), the page's own actions, and the hide-amounts
 * toggle. A page overrides the back step, title and actions through
 * useMobileHeader (lib/mobile-header.ts).
 */
export function AppHeader({ leadingSlot, style }: AppHeaderProps) {
  const [location] = useLocation();
  const page = useMobileHeaderConfig();
  const title = page?.title ?? titleForPath(location);

  // The title is centred on the screen, as iOS centres it, not in whatever
  // room the sides leave: with sides of different widths that put it off
  // centre, and it shifted every time an action changed width (Select to
  // Done). Centred, it may run as wide as the screen minus twice the wider
  // side. Where the title would not fit in that (a chat thread's question
  // beside three actions) it fills the gap between the sides instead.
  const rowRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [titleBox, setTitleBox] = useState<{ left: number; right: number }>({ left: 60, right: 60 });
  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current?.clientWidth ?? window.innerWidth;
      const lead = (leadRef.current?.offsetWidth ?? 0) + 12;
      const trail = (trailRef.current?.offsetWidth ?? 0) + 12;
      const side = Math.max(lead, trail);
      const text = titleRef.current?.querySelector<HTMLElement>('.truncate');
      const need = text ? text.scrollWidth : 0;
      setTitleBox(row - 2 * side >= need ? { left: side, right: side } : { left: lead, right: trail });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rowRef.current) ro.observe(rowRef.current);
    if (leadRef.current) ro.observe(leadRef.current);
    if (trailRef.current) ro.observe(trailRef.current);
    return () => ro.disconnect();
  }, [title]);

  return (
    <motion.header style={style} className="fixed top-0 inset-x-0 z-30 border-b border-line pt-safe-top">
      {/* Blur on its own layer so the pulled mark is never inside a
          backdrop-filtered element. (Measured: backdrop-filter does not clip
          descendants in WebKit or Chromium, so this is defensive, not a fix.) */}
      <div
        aria-hidden
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: 'rgb(var(--ui-canvas) / 0.86)' }}
      />
      <div ref={rowRef} className="relative mx-auto px-2 h-12 flex items-center justify-between">
        <div ref={leadRef} className="flex items-center">
          {page?.onBack ? (
            <button
              onClick={page.onBack}
              aria-label="Back"
              className="ui-focus w-11 h-11 grid place-items-center rounded-[10px] text-content-secondary [@media(hover:hover)]:hover:bg-canvas-sunken [@media(hover:hover)]:hover:text-content active:bg-canvas-sunken transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
          ) : leadingSlot}
        </div>
        <div
          ref={titleRef}
          className="absolute top-0 h-12 flex items-center justify-center"
          style={titleBox}
        >
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
        <div ref={trailRef} className="flex items-center justify-end">
          {page?.actions}
          <PrivacyToggle size={44} />
        </div>
      </div>
    </motion.header>
  );
}
