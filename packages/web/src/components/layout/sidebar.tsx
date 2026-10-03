import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Zap, Layers, TrendingUp, PieChart, Wallet,
  CreditCard, AlertCircle, Receipt, Target, ArrowLeftRight,
  MessageSquare, ChevronUp, ChevronDown, type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { useChatStore } from '../../lib/chat-store';
import { PrivacyToggle } from '../uikit/PrivacyToggle';
import { BrandMark } from '../common/BrandMark';
import { PlanUsage } from './plan-usage';
import { useScrollFade } from './use-scroll-fade';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  /**
   * Extra routes this entry owns. /accounts is the management surface of Money,
   * not a destination of its own, so Money stays lit while you are on it —
   * otherwise nothing in the nav is highlighted there.
   */
  match?: string[];
  adminOnly?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

function matchesPath(path: string, location: string): boolean {
  if (path === '/') return location === '/';
  return location === path || location.startsWith(path + '/');
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { id: 'home',  label: 'Home',    icon: LayoutDashboard, path: '/' },
      { id: 'money', label: 'Money',   icon: Wallet,          path: '/money', match: ['/accounts'] },
      { id: 'goals', label: 'Goals',   icon: Target,          path: '/goals' },
      // Chat's path only marks it active on the full-screen /chat route —
      // clicking opens the chat panel instead of navigating.
      { id: 'chat',  label: 'Chat', icon: MessageSquare,   path: '/chat' },
    ],
  },
  {
    label: 'Financial insights',
    items: [
      { id: 'actions',         label: 'Actions',         icon: Zap,    path: '/insights' },
      { id: 'financial-level', label: 'Financial journey', icon: Layers, path: '/financial-level' },
    ],
  },
  {
    label: 'Income & expenses',
    items: [
      { id: 'spending',     label: 'Spending',     icon: CreditCard,     path: '/spending' },
      { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight, path: '/transactions' },
    ],
  },
  {
    label: 'Advanced',
    defaultOpen: false,
    items: [
      { id: 'retirement',    label: 'Retirement', icon: TrendingUp,  path: '/retirement' },
      { id: 'portfolio',  label: 'Portfolio',           icon: PieChart,    path: '/portfolio' },
      { id: 'tax',        label: 'Tax',                 icon: Receipt,     path: '/tax' },
      { id: 'debt',       label: 'Debt',                icon: AlertCircle, path: '/debt' },
    ],
  },
];

const itemPaths = (item: NavItem) => [item.path, ...(item.match ?? [])];

/** Every nav destination, so `isActive` can let the deepest match win. */
const NAV_PATHS = NAV_SECTIONS.flatMap((s) => s.items.flatMap(itemPaths));

const SECTIONS_OPEN_KEY = 'lasagna-sidebar-sections-open-v2';

// Inset, like the nav rows above and for the same reason: the panel clips its
// children, so an outward ring loses an edge on the first and last item.
const MENU_ITEM =
  'w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer hover:bg-canvas-sunken focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)]';

interface SidebarProps {
  onNewPlan?: () => void;
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout, user } = useAuth();
  const { openChat } = useChatStore();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const userMenuPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    // Hover moves focus (onPointerEnter on each item): with a roving ring, a
    // mouse user hovering one row while the ring sat on another had two rows
    // reading as current at once. Same behaviour as Radix/Linear menus.
    const items = () =>
      Array.from(userMenuPanelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

    // `role="menu"` is a promise about the keyboard, not just a label: arrows
    // move between items, Home/End jump to the ends, Escape closes and hands
    // focus back to the chip. Outside-click used to be the only way out, which
    // strands a keyboard user inside the one menu holding Admin, Accounts and
    // Sign out.
    const handleKey = (e: KeyboardEvent) => {
      const all = items();
      const i = all.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Escape') {
        setUserMenuOpen(false);
        userMenuTriggerRef.current?.focus();
        return;
      }
      if (i === -1 || !all.length) return;
      const to =
        e.key === 'ArrowDown' ? (i + 1) % all.length
        : e.key === 'ArrowUp' ? (i - 1 + all.length) % all.length
        : e.key === 'Home' ? 0
        : e.key === 'End' ? all.length - 1
        : -1;
      if (to === -1) return;
      e.preventDefault();
      all[to].focus();
    };

    // Tabbing past either end left focus on the page with the menu still open.
    // A menu is done the moment focus leaves it.
    const handleFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && userMenuPanelRef.current?.contains(next)) return;
      setUserMenuOpen(false);
    };
    if (userMenuOpen) {
      // The popover is DOM-ordered BEFORE its trigger (it opens upward), so
      // leaving focus on the trigger sent a forward Tab straight past the menu.
      // Move into it, as a menu should.
      userMenuPanelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
      const panel = userMenuPanelRef.current;
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKey);
      panel?.addEventListener('focusout', handleFocusOut);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleKey);
        panel?.removeEventListener('focusout', handleFocusOut);
      };
    }
  }, [userMenuOpen]);

  // Exact or sub-route match, with the DEEPEST matching entry winning: a plain
  // prefix match lights two rows at once wherever one nav path is a prefix of
  // another, and a plain startsWith would also light "/retirement" up on
  // "/retirement-v2".
  const isActive = (item: NavItem) => {
    const hit = itemPaths(item).find((p) => matchesPath(p, location));
    if (!hit) return false;
    return !NAV_PATHS.some(
      (p) => p.length > hit.length && matchesPath(p, location),
    );
  };

  // Sections open unless they declare defaultOpen: false; user toggles persist
  // as a label->bool map.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      // Validate the shape, don't just guard the parse: a stored "null" or
      // "[]" parses fine and then blows up on the first property read. Drop
      // non-boolean values too, or {"Advanced":"yes"} lands verbatim in
      // aria-expanded. getItem itself throws where storage is blocked, so it
      // stays inside the try.
      const stored = JSON.parse(window.localStorage.getItem(SECTIONS_OPEN_KEY) ?? '{}');
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
      return Object.fromEntries(
        Object.entries(stored).filter(([, value]) => typeof value === 'boolean'),
      ) as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const sectionHasActiveRoute = (label: string) =>
    NAV_SECTIONS.find((s) => s.label === label)?.items.some((item) => isActive(item)) ?? false;
  // Openness is derived, never stored: the section holding the active route
  // auto-expands (deep link, chat navigation) and drops back to its default the
  // moment you leave it. Storing that auto-expand instead would strand the
  // section open for the rest of the session.
  const resolveOpen = (prefs: Record<string, boolean>, label: string) => {
    const pref = prefs[label];
    if (pref !== undefined) return pref;
    if (sectionHasActiveRoute(label)) return true;
    return NAV_SECTIONS.find((s) => s.label === label)?.defaultOpen ?? true;
  };
  const isSectionOpen = (label: string) => resolveOpen(openSections, label);
  // Flip from `prev`, not from the closed-over map: two toggles in one tick
  // would both read the pre-batch value and resolve to the same result.
  const toggleSection = (label: string) => {
    setOpenSections((prev) => ({ ...prev, [label]: !resolveOpen(prev, label) }));
  };
  useEffect(() => {
    try {
      // Nothing toggled and nothing stored: skip the write so an untouched
      // sidebar leaves the slot null instead of stamping "{}" on every mount.
      const nothingToPersist =
        Object.keys(openSections).length === 0 &&
        window.localStorage.getItem(SECTIONS_OPEN_KEY) === null;
      if (nothingToPersist) return;
      window.localStorage.setItem(SECTIONS_OPEN_KEY, JSON.stringify(openSections));
    } catch {
      // Storage blocked (Safari "Block All Cookies", quota, some WebViews) —
      // the sidebar still works, it just won't remember across reloads. An
      // uncaught throw here white-screens every authenticated route.
    }
  }, [openSections]);

  // Destructured, not held as one object: react-hooks/refs treats every member
  // read on a ref-bearing object as a render-time ref access, and `clipped` /
  // `style` are plain state.
  const { ref: navRef, onScroll: onNavScroll, style: fadeStyle, clipped: navClipped } =
    useScrollFade<HTMLElement>([openSections, location]);

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';

  return (
    <aside
      className={cn('w-full h-full flex flex-col px-4 pt-4 pb-3 text-content', className)}
      style={{
        backgroundImage:
          'linear-gradient(180deg, rgb(var(--ui-canvas-sunken) / 0.45), transparent 220px)',
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-2 pt-1.5">
        {/* 34, not 38: the mark stood 1.53x the wordmark's cap height here
            against 1.34x in the mobile nav, the heaviest lockup in the app.
            34 lands at 1.37x and matches the mark size the login screen uses. */}
        <BrandMark size={34} />
        <div className="font-editorial text-[19px] font-semibold leading-none tracking-[-0.01em] text-content">
          LasagnaFi
        </div>
      </div>

      {/* Navigation. On a short viewport this list clips, and the sidebar is the
          ONLY nav on desktop — there is no tab bar to fall back on — so whole
          destinations became unreachable whenever the clip landed past the last
          row and the fade had nothing to dim. Same treatment as the drawer: a
          fade for the edge, plus an explicit hint in its own reserved gutter. */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
      {/* The TOP edge needs the same hint as the bottom: auto-scrolling to an
          expanded section pushes whole groups above the fold, and with overlay
          scrollbars there is no track to say so. */}
      <div aria-hidden="true" className="pointer-events-none grid h-5 shrink-0 place-items-center">
        {navClipped.start && <ChevronUp size={14} className="text-content-muted" />}
      </div>
      <nav
        ref={navRef}
        onScroll={onNavScroll}
        style={fadeStyle}
        className="min-h-0 flex-1 flex flex-col gap-0.5 overflow-y-auto scrollbar-thin"
      >
        {NAV_SECTIONS.map(({ label, items }, sectionIndex) => {
          const open = isSectionOpen(label);
          const showActiveRail = !open && sectionHasActiveRoute(label);
          return (
            <div key={label}>
              {sectionIndex > 0 && <div className="h-px bg-line mx-3 mt-1.5" />}
              <button
                type="button"
                onClick={() => toggleSection(label)}
                aria-expanded={open}
                // Inset ring, not `ui-focus`: that one paints an OUTWARD
                // box-shadow and this full-width header sits flush against the
                // scrolling nav's edges, which clipped both of its sides away.
                className="group w-full flex items-center justify-between gap-2 px-3 pt-3 pb-1.5 rounded-ui-sm text-left cursor-pointer focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)]"
              >
                <span className="relative text-[12px] font-semibold text-content-muted transition-colors group-hover:text-content">
                  {/* Collapsed, the active item's own rail is hidden with it —
                      so the header carries it. Same rail as NavButton, sized to
                      the label and anchored to the nav's left edge. */}
                  {showActiveRail && (
                    <span
                      aria-hidden="true"
                      className="absolute -left-3 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-[3px] bg-brand"
                    />
                  )}
                  {label}
                  {/* The rail is decorative, so say the same thing for screen
                      readers. Collapsed only: expanded, the active item's own
                      aria-current carries it. */}
                  {showActiveRail && <span className="sr-only"> (contains the current page)</span>}
                </span>
                <ChevronDown
                  size={13}
                  className={cn(
                    'text-content-muted transition-[transform,color] duration-200 group-hover:text-content-secondary',
                    open && 'rotate-180',
                  )}
                />
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="items"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="ml-4 pl-2 border-l border-line flex flex-col gap-0.5 pb-0.5">
                      {items.filter((entry) => !entry.adminOnly || user?.isAdmin).map((entry) => (
                        <NavButton
                          key={entry.id}
                          active={isActive(entry)}
                          icon={entry.icon}
                          label={entry.label}
                          inset
                          onClick={() => (entry.id === 'chat' ? openChat() : navigate(entry.path))}
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

      </nav>

      {/* A hint, not a control — you scroll the list by dragging it. Its own
          reserved gutter, so it never covers a row and its appearing can never
          change whether the list scrolls. */}
      <div aria-hidden="true" className="pointer-events-none grid h-5 shrink-0 place-items-center">
        {navClipped.end && <ChevronDown size={14} className="text-content-muted" />}
      </div>
      </div>

      {/* Foot: free-plan standing, then the account chip + hide-amounts toggle.
          The rule goes TRANSPARENT rather than away while the nav can still
          scroll — a hard line under a clipped list reads as "the list ends
          here", the opposite of what the fade above it says. Removing the
          border instead made it load-bearing layout: dropping 1px grew the flex
          nav by 1px, which pushed the overflow under the hook's 4px threshold,
          which put the border back, which shrank it again. At the crossing
          height that ping-ponged every frame forever. Keeping the box constant
          and swapping only the colour removes the feedback path entirely. */}
      <div className={cn('mt-2.5 pt-3 border-t', navClipped.end ? 'border-transparent' : 'border-line')}>
        <PlanUsage className="mb-3" />
        <div className="relative" ref={userMenuRef}>
          <AnimatePresence>
            {userMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                role="menu"
                aria-label="Account"
                ref={userMenuPanelRef}
                className="absolute bottom-full left-0 right-0 mb-2 bg-panel-raised border border-line-strong rounded-ui-md overflow-hidden shadow-ui-lg z-50"
              >
                {/* Connected Accounts + Profile live in this account menu (not the
                    main sidebar nav). Admin appears for operators only. */}
                {user?.isAdmin && (
                  <button
                    role="menuitem"
                    onPointerEnter={(e) => e.currentTarget.focus()}
                    onClick={() => { setUserMenuOpen(false); navigate('/admin'); }}
                    className={cn(MENU_ITEM, 'text-content-secondary')}
                  >
                    Admin
                  </button>
                )}
                <button
                  role="menuitem"
                  onPointerEnter={(e) => e.currentTarget.focus()}
                  onClick={() => { setUserMenuOpen(false); navigate('/accounts'); }}
                  className={cn(MENU_ITEM, 'text-content-secondary')}
                >
                  Accounts
                </button>
                <button
                  role="menuitem"
                  onPointerEnter={(e) => e.currentTarget.focus()}
                  onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                  className={cn(MENU_ITEM, 'text-content-secondary')}
                >
                  Profile &amp; Settings
                </button>
                <div role="separator" className="h-px mx-3 my-1 bg-line" />
                <button
                  role="menuitem"
                  onPointerEnter={(e) => e.currentTarget.focus()}
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                  className={cn(MENU_ITEM, 'text-brand')}
                >
                  Sign out
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-2.5">
            <button
              ref={userMenuTriggerRef}
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              className="ui-focus flex-1 min-w-0 flex items-center gap-3 cursor-pointer text-left rounded-ui-md p-1 -m-1 hover:bg-brand-softer transition-colors"
            >
              <div className="w-9 h-9 rounded-[11px] grid place-items-center font-semibold text-sm text-content bg-canvas-sunken border border-line shrink-0">
                {initial}
              </div>
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[13.5px] font-semibold text-content truncate">{firstName}</div>
                <div className="text-[11.5px] text-content-muted truncate">{user?.email || (tenant?.plan === 'pro' ? 'pro plan' : 'free plan')}</div>
              </div>
              <ChevronUp
                size={13}
                className={cn(
                  'text-content-muted shrink-0 transition-transform duration-150',
                  !userMenuOpen && 'rotate-180',
                )}
              />
            </button>
            <PrivacyToggle size={36} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavButton({ active, icon: Icon, label, onClick, inset }: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  inset?: boolean;
}) {
  // Arriving on a route inside a collapsed group expands it, but the nav does
  // not scroll — so on a short viewport the row that just lit up was below the
  // fold and NOTHING in the visible sidebar was highlighted. `nearest` moves the
  // list only when the row is actually out of view.
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      whileTap={{ scale: 0.985 }}
      className={cn(
        'relative flex items-center gap-3 w-full text-left px-3 py-[6px] rounded-ui-md border-0 cursor-pointer text-[14px] transition-colors',
        // Matches the section header's ring. Inset, not `ui-focus`: the nav
        // scrolls, and an outward shadow gets clipped by its padding box.
        'focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)]',
        active
          ? 'text-brand font-semibold'
          : 'text-content-secondary font-medium hover:text-content',
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 -translate-y-1/2 w-[3px] h-5 bg-brand',
            // Inset items sit inside the section rail: overlay the segment of
            // the rail beside the active item instead of the aside edge bar.
            inset ? '-left-[10px] rounded-full' : '-left-4 rounded-r-[3px]',
          )}
        />
      )}
      <Icon
        size={18}
        strokeWidth={1.75}
        className={cn('shrink-0', active ? 'text-brand' : 'text-content-muted')}
      />
      <span className="flex-1">{label}</span>
    </motion.button>
  );
}
