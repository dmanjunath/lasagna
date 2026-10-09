import { useEffect, useRef } from 'react';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { useLocation } from 'wouter';
import { motion, useTransform, animate, type MotionValue, type PanInfo } from 'framer-motion';
import {
  X, LogOut, ChevronDown, Zap, Layers,
  TrendingUp, PieChart, CreditCard, AlertCircle, Receipt, ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { PlanUsage } from './plan-usage';
import { useScrollFade } from './use-scroll-fade';

interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  /** Extra routes this entry owns — see the same field in sidebar.tsx. */
  match?: string[];
  adminOnly?: boolean;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

function matchesPath(path: string, location: string): boolean {
  if (path === '/') return location === '/';
  return location === path || location.startsWith(path + '/');
}

// The desktop sidebar's sections (sidebar.tsx) minus Overview, all expanded:
// this drawer is dismissed after one tap, so there is nothing to collapse for.
// Overview's pages are the tab bar's, which stays in view beside the open
// menu, so listing them again only made the menu scroll on a standard iPhone.
// The profile/close header and the foot (plan standing + Sign out) are pinned
// outside the list, so the way out is always on screen. On a shorter phone the
// list can still scroll, which is why its bottom edge carries an explicit cue.
const NAV_SECTIONS: NavSection[] = [
  {
    section: 'Financial insights',
    items: [
      { label: 'Actions',         icon: Zap,    path: '/insights' },
      { label: 'Financial journey', icon: Layers, path: '/financial-level' },
    ],
  },
  {
    section: 'Income & expenses',
    items: [
      { label: 'Spending',     icon: CreditCard,     path: '/spending' },
      { label: 'Transactions', icon: ArrowLeftRight, path: '/transactions' },
    ],
  },
  {
    section: 'Advanced',
    items: [
      { label: 'Retirement', icon: TrendingUp,  path: '/retirement' },
      { label: 'Portfolio',           icon: PieChart,    path: '/portfolio' },
      { label: 'Tax',                 icon: Receipt,     path: '/tax' },
      { label: 'Debt',                icon: AlertCircle, path: '/debt' },
    ],
  },
];

const itemPaths = (item: NavItem) => [item.path, ...(item.match ?? [])];

/** Every nav destination, so `isActive` can let the deepest match win. */
const NAV_PATHS = NAV_SECTIONS.flatMap((s) => s.items.flatMap(itemPaths));

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * How far the app is pushed aside, 0 when closed and the panel width when
   * open. Owned by the Shell, which springs it on open/close and writes it
   * directly during an edge swipe. A MotionValue rather than state, so a 60Hz
   * drag writes the transform without re-rendering anything.
   */
  x: MotionValue<number>;
  /** True while an edge drag is in flight. */
  dragging?: boolean;
}

/**
 * Mirrors the panel's width below, for the drag maths. Narrower than a cover
 * drawer, so a strip of the pushed screen stays in view as the way back.
 */
export function drawerWidth(): number {
  if (typeof window === 'undefined') return 320;
  return Math.min(window.innerWidth * 0.8, 320);
}

export function MobileNav({ isOpen, onClose, x, dragging = false }: MobileNavProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout, user } = useAuth();

  const width = drawerWidth();
  const panelX = useTransform(x, (v) => v - width);
  const scrimOpacity = useTransform(x, (v) => Math.min(1, v / width) * 0.35);
  // Off the screen and out of the accessibility tree once fully closed. Visible
  // the moment it is opened, before the spring has moved it, or focus could not
  // enter it on open.
  const settledVisibility = useTransform(x, (v) => (v > 0.5 ? 'visible' : 'hidden'));
  const visibility = isOpen || dragging ? 'visible' : settledVisibility;

  // A swipe left anywhere on the menu or on the pushed screen closes it, with
  // the push following the finger. Short of the threshold it springs back.
  const onPan = (_e: PointerEvent, info: PanInfo) => {
    x.set(Math.max(0, Math.min(width, width + info.offset.x)));
  };
  const onPanEnd = (_e: PointerEvent, info: PanInfo) => {
    if (info.offset.x < -64 || info.velocity.x < -400) onClose();
    else animate(x, width, { type: 'spring', damping: 34, stiffness: 340 });
  };

  useBodyScrollLock(isOpen || dragging);

  // Destructured — see the same note in sidebar.tsx.
  const { ref: navRef, onScroll: onNavScroll, style: fadeStyle, clipped: navClipped } =
    useScrollFade<HTMLElement>([isOpen]);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // The drawer is modal — it takes a scrim, a scroll lock and Escape — so it has
  // to behave like one for the keyboard too: focus moves in on open, back to
  // whatever opened it on close, and Tab cycles inside it instead of walking
  // into the page behind the scrim.
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    // Motion writes `visibility` on its own frame, after this effect, and a
    // hidden element refuses focus. Show it now so focus can move in.
    if (panelRef.current) panelRef.current.style.visibility = 'visible';
    closeRef.current?.focus();
    return () => openerRef.current?.focus?.();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const stops = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);


  // Exact or sub-route match, with the DEEPEST matching entry winning: a plain
  // prefix match lights two rows at once wherever one nav path is a prefix of
  // another, and a plain startsWith would also light "/retirement" up on
  // "/retirement-v2".
  const isActive = (item: NavItem) => {
    const hit = itemPaths(item).find((p) => matchesPath(p, location));
    if (!hit) return false;
    return !NAV_PATHS.some((p) => p.length > hit.length && matchesPath(p, location));
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';

  return (
        <>
          {/* Covers the pushed screen: dims it, and a tap on it closes the menu. */}
          <motion.div
            aria-hidden
            onClick={onClose}
            onPan={onPan}
            onPanEnd={onPanEnd}
            style={{ x, opacity: scrimOpacity, visibility, touchAction: 'none' }}
            className="fixed inset-0 top-[-5%] h-[110%] bg-black z-40 md:hidden"
          />

          {/* Drawer */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            aria-hidden={!isOpen && !dragging}
            style={{ x: panelX, visibility, width }}
            onPan={onPan}
            onPanEnd={onPanEnd}
            className="fixed top-0 left-0 bottom-0 z-50 flex flex-col overflow-hidden
                       bg-canvas border-r border-line md:hidden"
          >
            {/* Who you are + close, pinned above the list. One row, not a brand
                row over a profile card: the menu has to fit a standard iPhone
                without scrolling, and the brand mark told the user nothing. */}
            <div
              className="shrink-0 flex items-center justify-between gap-2 pl-3 pr-4 pb-1"
              style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}
            >
              <button
                onClick={() => handleNavigate('/profile')}
                className="ui-focus flex min-w-0 flex-1 items-center gap-3 rounded-ui-md p-1.5 text-left transition-colors [@media(hover:hover)]:hover:bg-canvas-sunken active:bg-canvas-sunken"
              >
                <div className="w-9 h-9 rounded-full bg-brand grid place-items-center text-lg font-editorial font-bold text-[rgb(var(--ui-brand-fg))] shrink-0 shadow-ui-sm">
                  {initial}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold leading-tight tracking-tight text-content">{firstName}</div>
                  <div className="text-[12px] text-content-muted mt-0.5">Profile and settings</div>
                </div>
              </button>
              <button
                ref={closeRef}
                onClick={onClose}
                aria-label="Close menu"
                className="ui-focus grid place-items-center w-11 h-11 -mr-1 rounded-ui-md text-content-muted [@media(hover:hover)]:hover:bg-canvas-sunken [@media(hover:hover)]:hover:text-content transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* The NAV scrolls, not the panel: a fade on the panel would take
                its background and border down with it. */}
            <div className="flex min-h-0 flex-1 flex-col">
            <nav
              ref={navRef}
              onScroll={onNavScroll}
              className="h-full overflow-y-auto overscroll-contain scrollbar-thin px-3 pt-1 space-y-0.5 pb-2"
              style={{
                // `overflow-y: auto` makes this a scroll container on BOTH axes,
                // and the browser then claims the horizontal gesture for itself:
                // a real touch drag-to-close died at pointercancel while a
                // pointer-emulated one still worked. Conceding only the vertical
                // axis hands the horizontal swipe back to the panel's drag.
                touchAction: 'pan-y',
                ...fadeStyle,
              }}
            >
              {NAV_SECTIONS.map(({ section, items }, sectionIndex) => (
                <div key={section}>
                  {sectionIndex > 0 && <div className="h-px bg-line mx-3 mt-2" />}
                  <div className="text-[12px] font-semibold text-content-muted px-3 pt-2.5 pb-1">
                    {section}
                  </div>
                  <div className="ml-4 pl-2 border-l border-line">
                    {items.filter((e) => !e.adminOnly || user?.isAdmin).map((item) => {
                      const { label, icon: Icon, path } = item;
                      const active = isActive(item);
                      return (
                        <button
                          key={path}
                          onClick={() => handleNavigate(path)}
                          aria-current={active ? 'page' : undefined}
                          className="ui-focus relative flex items-center gap-3 w-full px-2.5 py-1 rounded-ui-md
                                     cursor-pointer text-left text-[15px] transition-colors active:scale-[0.98]
                                     min-h-[40px]"
                        >
                          {active && (
                            <span
                              aria-hidden="true"
                              className="absolute -left-[10px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-brand"
                            />
                          )}
                          <div className={`w-7 h-7 rounded-ui-md grid place-items-center shrink-0 ${active ? 'bg-brand text-[rgb(var(--ui-brand-fg))]' : 'bg-canvas-sunken text-content-muted'}`}>
                            <Icon size={14} />
                          </div>
                          <span className={active ? 'font-bold text-[rgb(var(--ui-brand-ink))]' : 'font-semibold text-content'}>{label}</span>
                          <div className="text-content-faint text-sm ml-auto">›</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

            </nav>

            {/* The fade alone is not a cue: it only reads as "more below" when
                the clip lands ON a row. Landing in a gutter or on a section
                divider, the menu looked finished while whole destinations sat
                below it — and the tab bar carries none of them.
                
                Its own reserved gutter, never floating over the list: as a disc
                pinned to the nav's bottom edge it covered the tail of whichever
                row it landed on and took 28px out of that row's 40px target. The
                gutter is reserved whether or not the hint shows, so adding it
                can never change whether the list scrolls.
                
                A hint, not a control — you scroll the list by dragging it — so
                it takes no tap target, no tab stop, and no pointer events. */}
            <div aria-hidden="true" className="pointer-events-none grid h-5 shrink-0 place-items-center">
              {navClipped.end && <ChevronDown size={14} className="text-content-muted" />}
            </div>
            </div>

            {/* Pinned foot, like the desktop sidebar's. Inside the scrolling nav
                these sat below the fold on a stock 390x844 phone — Sign out
                entirely off-screen, and at the plan cap the Upgrade row was
                half-clipped INSIDE the bottom fade, which read as a rendering
                fault rather than as something to scroll to. The drawer is the
                only sign-out on mobile, so it cannot be the thing that scrolls
                away. */}
            <div
              // Transparent, not absent — see the same guard in sidebar.tsx.
              // Removing the rule changed the nav's height, which changed
              // whether it overflowed, which put the rule back: a self-feeding
              // loop at the crossing height.
              className={`shrink-0 border-t px-3 pt-2.5 ${navClipped.end ? 'border-transparent' : 'border-line'}`}
              style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
            >
              <PlanUsage className="mb-1.5 px-2.5" onNavigate={onClose} />

              <button
                onClick={() => { onClose(); logout(); }}
                className="ui-focus flex items-center gap-3 w-full px-2.5 py-1 rounded-ui-md [@media(hover:hover)]:hover:bg-canvas-sunken active:bg-canvas-sunken text-left min-h-[40px]"
              >
                <div className="w-7 h-7 rounded-ui-md bg-canvas-sunken grid place-items-center shrink-0 text-content-muted">
                  <LogOut size={14} />
                </div>
                <span className="text-[15px] font-semibold text-content-secondary">Sign out</span>
              </button>
            </div>
          </motion.div>
        </>
  );
}
