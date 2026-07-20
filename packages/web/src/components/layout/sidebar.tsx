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
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { id: 'home',  label: 'Home',    icon: LayoutDashboard, path: '/' },
      { id: 'goals', label: 'Goals',   icon: Target,          path: '/goals' },
      // Chat's path only marks it active on the full-screen /chat route —
      // clicking opens the chat panel instead of navigating.
      { id: 'chat',  label: 'AI Chat', icon: MessageSquare,   path: '/chat' },
    ],
  },
  {
    label: 'Financial Insights',
    items: [
      { id: 'actions',         label: 'Actions',         icon: Zap,    path: '/insights' },
      { id: 'financial-level', label: 'Financial Level', icon: Layers, path: '/financial-level' },
    ],
  },
  {
    label: 'Money',
    items: [
      { id: 'money',      label: 'My Money',            icon: Wallet,      path: '/money' },
      { id: 'retirement', label: 'Retirement Planning', icon: TrendingUp,  path: '/retirement' },
      { id: 'portfolio',  label: 'Portfolio',           icon: PieChart,    path: '/portfolio' },
      { id: 'tax',        label: 'Tax',                 icon: Receipt,     path: '/tax' },
      { id: 'debt',       label: 'Debt',                icon: AlertCircle, path: '/debt' },
    ],
  },
  {
    label: 'Income & Expenses',
    items: [
      { id: 'spending',     label: 'Spending',     icon: CreditCard,     path: '/spending' },
      { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight, path: '/transactions' },
    ],
  },
];

const SECTIONS_OPEN_KEY = 'lasagna-sidebar-sections-open';

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
    return location.startsWith(path);
  };

  // Sections default open; user toggles persist as a label->bool map.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(window.localStorage.getItem(SECTIONS_OPEN_KEY) ?? '{}');
    } catch {
      return {};
    }
  });
  const isSectionOpen = (label: string) => openSections[label] !== false;
  const toggleSection = (label: string) => {
    setOpenSections((prev) => {
      const next = { ...prev, [label]: !isSectionOpen(label) };
      window.localStorage.setItem(SECTIONS_OPEN_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Auto-open the section containing the active route (e.g. deep link or chat
  // navigation) so the highlighted item is never hidden. Doesn't persist, so
  // the user's saved preference survives.
  useEffect(() => {
    const section = NAV_SECTIONS.find((s) => s.items.some((item) => isActive(item.path)));
    if (section && !isSectionOpen(section.label)) {
      setOpenSections((prev) => ({ ...prev, [section.label]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

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
        <BrandMark size={38} />
        <div className="font-editorial text-[19px] font-semibold leading-none tracking-[-0.01em] text-content">
          LasagnaFi
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 mt-4 flex flex-col gap-0.5 overflow-y-auto scrollbar-thin">
        {NAV_SECTIONS.map(({ label, items }, sectionIndex) => {
          const open = isSectionOpen(label);
          return (
            <div key={label}>
              {sectionIndex > 0 && <div className="h-px bg-line mx-3 mt-1.5" />}
              <button
                type="button"
                onClick={() => toggleSection(label)}
                aria-expanded={open}
                className="w-full flex items-center justify-between gap-2 px-3 pt-3 pb-1 cursor-pointer"
              >
                <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-content-muted">
                  {label}
                </span>
                <ChevronDown
                  size={13}
                  className={cn(
                    'text-content-faint transition-transform duration-200',
                    !open && '-rotate-90',
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
                      {items.map((entry) => (
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
      whileTap={{ scale: 0.985 }}
      className={cn(
        'relative flex items-center gap-3 w-full text-left px-3 py-[6px] rounded-ui-md border-0 cursor-pointer text-[14px] transition-colors',
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
