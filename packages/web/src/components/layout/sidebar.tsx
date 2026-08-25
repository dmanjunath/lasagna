import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Zap, Layers, TrendingUp, PieChart, Wallet,
  CreditCard, AlertCircle, Receipt, Target, ArrowLeftRight,
  MessageSquare, ChevronUp, ChevronDown, Moon, Sun, type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { useChatStore } from '../../lib/chat-store';
import { useUiMode } from '../uikit/mode';
import { BrandMark } from '../common/BrandMark';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  adminOnly?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { id: 'home',  label: 'Home',    icon: LayoutDashboard, path: '/' },
      { id: 'money', label: 'Money',   icon: Wallet,          path: '/money' },
      { id: 'goals', label: 'Goals',   icon: Target,          path: '/goals' },
      // Chat's path only marks it active on the full-screen /chat route —
      // clicking opens the chat panel instead of navigating.
      { id: 'chat',  label: 'AI Chat', icon: MessageSquare,   path: '/chat' },
    ],
  },
  {
    label: 'Financial insights',
    items: [
      { id: 'actions',         label: 'Actions',         icon: Zap,    path: '/insights' },
      { id: 'financial-level', label: 'Financial Level', icon: Layers, path: '/financial-level' },
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
      { id: 'retirement',    label: 'Retirement Planning', icon: TrendingUp,  path: '/retirement' },
      { id: 'portfolio',  label: 'Portfolio',           icon: PieChart,    path: '/portfolio' },
      { id: 'tax',        label: 'Tax',                 icon: Receipt,     path: '/tax' },
      { id: 'debt',       label: 'Debt',                icon: AlertCircle, path: '/debt' },
    ],
  },
];

const SECTIONS_OPEN_KEY = 'lasagna-sidebar-sections-open-v2';

interface SidebarProps {
  onNewPlan?: () => void;
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout, user } = useAuth();
  const { openChat } = useChatStore();
  const { mode, toggle: toggleMode } = useUiMode();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [userMenuOpen]);

  const isActive = (path: string) => {
    if (path === '/') return location === '/';
    // Exact or sub-route match — a plain startsWith would light "/retirement"
    // up on "/retirement-v2" too.
    return location === path || location.startsWith(path + '/');
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
    NAV_SECTIONS.find((s) => s.label === label)?.items.some((item) => isActive(item.path)) ?? false;
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

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';
  const isDark = mode === 'dark';

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

      {/* Navigation */}
      <nav className="flex-1 mt-4 flex flex-col gap-0.5 overflow-y-auto scrollbar-thin">
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
                          active={isActive(entry.path)}
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

      {/* Account chip + light/dark toggle */}
      <div className="mt-2.5 pt-3 border-t border-line relative" ref={userMenuRef}>
        <AnimatePresence>
          {userMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-0 right-0 mb-2 bg-panel-raised border border-line-strong rounded-ui-md overflow-hidden shadow-ui-lg z-50"
            >
              {/* Connected Accounts + Profile live in this account menu (not the
                  main sidebar nav). Admin appears for operators only. */}
              {user?.isAdmin && (
                <button
                  onClick={() => { setUserMenuOpen(false); navigate('/admin'); }}
                  className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-canvas-sunken transition-colors cursor-pointer"
                >
                  Admin
                </button>
              )}
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/money'); }}
                className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-canvas-sunken transition-colors cursor-pointer"
              >
                Connected Accounts
              </button>
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-canvas-sunken transition-colors cursor-pointer"
              >
                Profile &amp; Settings
              </button>
              <div className="h-px mx-3 my-1 bg-line" />
              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                className="w-full text-left px-4 py-2.5 text-sm text-brand hover:bg-canvas-sunken transition-colors cursor-pointer"
              >
                Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer text-left rounded-ui-md p-1 -m-1 hover:bg-brand-softer transition-colors"
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
          <button
            type="button"
            onClick={toggleMode}
            role="switch"
            aria-checked={isDark}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-9 h-9 shrink-0 grid place-items-center rounded-[10px] border border-line bg-panel text-content-secondary hover:bg-canvas-sunken hover:text-content transition-colors"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
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
  return (
    <motion.button
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
