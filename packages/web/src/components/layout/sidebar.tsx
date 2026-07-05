import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Zap, Layers, TrendingUp, PieChart, Wallet,
  CreditCard, AlertCircle, Receipt, Target,
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

const PRIMARY_NAV: NavItem[] = [
  { id: 'dashboard',        label: 'Dashboard',       icon: LayoutDashboard, path: '/' },
  { id: 'money',            label: 'Money',           icon: Wallet,          path: '/money' },
  { id: 'actions',          label: 'Actions',         icon: Zap,             path: '/insights' },
  { id: 'financial-level',  label: 'Financial Level', icon: Layers,          path: '/financial-level' },
  { id: 'goals',            label: 'Goals',           icon: Target,          path: '/goals' },
];

const ADVANCED_NAV: NavItem[] = [
  { id: 'retirement', label: 'Retirement', icon: TrendingUp,  path: '/retirement' },
  { id: 'portfolio',  label: 'Portfolio',  icon: PieChart,    path: '/portfolio' },
  { id: 'spending',   label: 'Spending',   icon: CreditCard,  path: '/spending' },
  { id: 'debt',       label: 'Debt',       icon: AlertCircle, path: '/debt' },
  { id: 'tax',        label: 'Tax',        icon: Receipt,     path: '/tax' },
];

const ADVANCED_OPEN_KEY = 'lasagna-sidebar-advanced-open';
const ADVANCED_TOUCHED_KEY = 'lasagna-sidebar-advanced-touched';

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

  // Default-open on first visit so users can see the section exists. After
  // they explicitly toggle it once we remember their preference.
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const touched = window.localStorage.getItem(ADVANCED_TOUCHED_KEY) === '1';
    if (!touched) return true;
    return window.localStorage.getItem(ADVANCED_OPEN_KEY) === '1';
  });

  const toggleAdvanced = () => {
    setAdvancedOpen((v) => {
      const next = !v;
      window.localStorage.setItem(ADVANCED_OPEN_KEY, next ? '1' : '0');
      window.localStorage.setItem(ADVANCED_TOUCHED_KEY, '1');
      return next;
    });
  };

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

  // Auto-open "More" when the user navigates to a route inside it (e.g. from
  // chat or a deep link). Don't auto-open if the user explicitly closed it
  // during this session — respect their intent.
  useEffect(() => {
    if (ADVANCED_NAV.some((item) => isActive(item.path)) && !advancedOpen) {
      const touched = window.localStorage.getItem(ADVANCED_TOUCHED_KEY) === '1';
      const userClosed = touched && window.localStorage.getItem(ADVANCED_OPEN_KEY) === '0';
      if (!userClosed) setAdvancedOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';
  const isDark = mode === 'dark';

  return (
    <aside
      className={cn('w-full h-full flex flex-col px-4 pt-[22px] pb-[18px] text-content', className)}
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
      <nav className="flex-1 mt-6 flex flex-col gap-0.5 overflow-y-auto scrollbar-thin">
        {/* Primary nav */}
        {PRIMARY_NAV.map((entry) => (
          <NavButton
            key={entry.id}
            active={isActive(entry.path)}
            icon={entry.icon}
            label={entry.label}
            onClick={() => navigate(entry.path)}
          />
        ))}

        {/* AI Chat button */}
        <NavButton
          active={false}
          icon={MessageSquare}
          label="AI Chat"
          onClick={() => openChat()}
        />

        {/* More — collapsible group of secondary finance areas (admin only) */}
        {user?.isAdmin && (
          <>
            <button
              type="button"
              onClick={toggleAdvanced}
              aria-expanded={advancedOpen}
              className="w-full flex items-center justify-between gap-2 px-3 pt-4 pb-1.5 mt-1 rounded-ui-md cursor-pointer hover:bg-brand-softer transition-colors group"
            >
              <span className="text-[11px] font-semibold tracking-[0.12em] uppercase text-content-muted group-hover:text-content transition-colors">
                More
              </span>
              <ChevronDown
                size={13}
                className={cn(
                  'text-content-faint group-hover:text-content-muted transition-transform duration-200',
                  !advancedOpen && '-rotate-90',
                )}
              />
            </button>
            <AnimatePresence initial={false}>
              {advancedOpen && (
                <motion.div
                  key="advanced"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                  className="flex flex-col gap-0.5"
                >
                  {ADVANCED_NAV.map((entry) => (
                    <NavButton
                      key={entry.id}
                      active={isActive(entry.path)}
                      icon={entry.icon}
                      label={entry.label}
                      onClick={() => navigate(entry.path)}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

      </nav>

      {/* Account chip + light/dark toggle */}
      <div className="mt-3 pt-3.5 border-t border-line relative" ref={userMenuRef}>
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
                onClick={() => { setUserMenuOpen(false); navigate('/accounts'); }}
                className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-canvas-sunken transition-colors cursor-pointer"
              >
                Connected Accounts
              </button>
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                className="w-full text-left px-4 py-2.5 text-sm text-content-secondary hover:bg-canvas-sunken transition-colors cursor-pointer"
              >
                Profile
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

function NavButton({ active, icon: Icon, label, onClick }: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      className={cn(
        'relative flex items-center gap-3 w-full text-left px-3 py-[9px] rounded-ui-md border-0 cursor-pointer text-[14.5px] transition-colors',
        active
          ? 'bg-brand-soft text-brand font-semibold'
          : 'text-content-secondary font-medium hover:bg-brand-softer hover:text-content',
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute -left-4 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-[3px] bg-brand"
        />
      )}
      <Icon
        size={19}
        strokeWidth={1.75}
        className={cn('shrink-0', active ? 'text-brand' : 'text-content-muted')}
      />
      <span className="flex-1">{label}</span>
    </motion.button>
  );
}
