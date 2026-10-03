import { useEffect, useRef } from 'react';
import { useBodyScrollLock } from '../../lib/hooks/use-body-scroll-lock';
import { useLocation } from 'wouter';
import { motion, AnimatePresence, useTransform, useMotionValue, type MotionValue } from 'framer-motion';
import {
  X, Wallet, LogOut, ChevronDown, ChevronUp,
  LayoutDashboard, Zap, Layers,
  TrendingUp, PieChart, CreditCard, AlertCircle, Receipt, Target,
  MessageSquare, ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { BrandMark } from '../common/BrandMark';
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

// Same sections as the desktop sidebar (sidebar.tsx), but all expanded: this
// drawer is dismissed after one tap, so there is nothing to collapse for.
// The brand/close header and the foot (plan standing + Sign out) are pinned
// outside the scroller, so the list between them is the only thing that moves
// and the way out is always on screen. That list does scroll on a shorter phone,
// which is why its bottom edge carries an explicit cue rather than only a fade.
// Profile lives in the profile card above, and Accounts is reachable from Money.
const NAV_SECTIONS: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { label: 'Home',    icon: LayoutDashboard, path: '/' },
      { label: 'Money',   icon: Wallet,          path: '/money', match: ['/accounts'] },
      { label: 'Goals',   icon: Target,          path: '/goals' },
      { label: 'Chat', icon: MessageSquare,   path: '/chat' },
    ],
  },
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
   * Live edge-swipe offset in px, 0 at the closed edge and the panel width when
   * fully pulled open. A MotionValue rather than state, so a 60Hz drag writes
   * the transform without re-rendering anything.
   */
  dragX?: MotionValue<number>;
  /** True while an edge drag is in flight, which is what mounts the panel. */
  dragging?: boolean;
}

/** Mirrors w-[88%] max-w-[360px] below, for the drag maths. */
export function drawerWidth(): number {
  if (typeof window === 'undefined') return 360;
  return Math.min(window.innerWidth * 0.88, 360);
}

export function MobileNav({ isOpen, onClose, dragX, dragging = false }: MobileNavProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout, user } = useAuth();

  const width = drawerWidth();
  const fallback = useMotionValue(0);
  const offset = dragX ?? fallback;
  const panelX = useTransform(offset, (v) => v - width);
  const scrimOpacity = useTransform(offset, (v) => Math.min(1, v / width));

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
    <AnimatePresence>
      {(isOpen || dragging) && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={dragging ? undefined : { opacity: 1 }}
            style={dragging ? { opacity: scrimOpacity } : undefined}
            exit={{ opacity: 0 }}
            transition={dragging ? { duration: 0 } : undefined}
            onClick={onClose}
            className="fixed inset-0 top-[-5%] h-[110%] bg-black/50 z-40 md:hidden"
          />

          {/* Drawer */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            initial={{ x: '-100%' }}
            animate={dragging ? undefined : { x: 0 }}
            style={dragging ? { x: panelX } : undefined}
            exit={{ x: '-100%' }}
            transition={dragging ? { duration: 0 } : { type: 'spring', damping: 28, stiffness: 320 }}
            drag={dragging ? false : 'x'}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.9, right: 0 }}
            onDragEnd={(_e, info) => {
              if (info.offset.x < -64 || info.velocity.x < -400) onClose();
            }}
            className="fixed top-0 left-0 bottom-0 w-[88%] max-w-[360px] z-50 flex flex-col overflow-hidden
                       bg-canvas border-r border-line shadow-2xl md:hidden"
          >
            {/* Brand + close, pinned above the scroller like the desktop
                sidebar's. Inside it, the one control that dismisses the drawer
                scrolled away exactly when the list was long enough to need
                scrolling. */}
            <div
              className="shrink-0 flex items-center justify-between px-5 pb-1"
              style={{ paddingTop: 'max(10px, env(safe-area-inset-top))' }}
            >
              <div className="flex items-center gap-2.5">
                <BrandMark size={30} />
                <span className="font-editorial text-[18px] font-semibold tracking-[-0.01em] text-content">LasagnaFi</span>
              </div>
              <button
                ref={closeRef}
                onClick={onClose}
                aria-label="Close menu"
                className="ui-focus grid place-items-center w-11 h-11 -mr-1 rounded-ui-md text-content-muted hover:bg-canvas-sunken hover:text-content transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* The NAV scrolls, not the panel: a fade on the panel would take
                its background and border down with it. */}
            <div className="flex min-h-0 flex-1 flex-col">
            {/* The TOP edge needs the same hint as the bottom: auto-scrolling to an
                expanded section pushes whole groups above the fold, and with overlay
                scrollbars there is no track to say so. */}
            <div aria-hidden="true" className="pointer-events-none grid h-5 shrink-0 place-items-center">
              {navClipped.start && <ChevronUp size={14} className="text-content-muted" />}
            </div>
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
              {/* Profile card */}
              <button
                onClick={() => handleNavigate('/profile')}
                className="ui-focus flex items-center gap-3 p-2 w-full bg-panel rounded-ui-lg border border-line hover:border-brand/40 hover:shadow-ui-sm transition text-left"
              >
                <div className="w-9 h-9 rounded-full bg-brand grid place-items-center text-lg font-editorial font-bold text-[rgb(var(--ui-brand-fg))] shrink-0 shadow-ui-sm">
                  {initial}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-[15px] font-bold leading-tight tracking-tight text-content">{firstName}</div>
                  <div className="text-[12px] text-content-muted mt-0.5">View profile &amp; settings</div>
                </div>
                <div className="text-content-faint text-sm">›</div>
              </button>

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
                className="ui-focus flex items-center gap-3 w-full px-2.5 py-1 rounded-ui-md hover:bg-canvas-sunken text-left min-h-[40px]"
              >
                <div className="w-7 h-7 rounded-ui-md bg-canvas-sunken grid place-items-center shrink-0 text-content-muted">
                  <LogOut size={14} />
                </div>
                <span className="text-[15px] font-semibold text-content-secondary">Sign out</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
