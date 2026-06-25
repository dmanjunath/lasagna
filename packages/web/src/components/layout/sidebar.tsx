import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Zap, Layers, TrendingUp, PieChart, Wallet,
  CreditCard, AlertCircle, Receipt, Target,
  MessageSquare, ChevronUp, ChevronDown, type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { useChatStore } from '../../lib/chat-store';
import { SidebarThemePicker } from './sidebar-theme-picker';
import { Logo } from '../common/Logo';

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

  return (
    <aside className={cn('w-full h-full flex flex-col bg-bg-elevated', className)}>
      {/* Brand */}
      <div className="px-4 pt-6 pb-5">
        <div className="flex items-center gap-2.5 px-2">
          <Logo width={22} />
          <span className="lf-wordmark text-lg text-text">
            Lasagna<span className="fi">fi</span>
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 overflow-y-auto scrollbar-thin">
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
              className="w-full flex items-center justify-between gap-2 pl-4 pr-3 py-1.5 mt-4 mb-0.5 rounded-lg cursor-pointer hover:bg-bg-subtle transition-colors group"
            >
              <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-text-muted group-hover:text-text-secondary transition-colors">
                More
              </span>
              <ChevronDown
                size={13}
                className={cn(
                  'text-text-muted group-hover:text-text-secondary transition-transform duration-200',
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

      {/* Theme picker — compact swatch row above the account chip (admin only) */}
      {user?.isAdmin && <SidebarThemePicker />}

      {/* Account chip */}
      <div className="px-3 py-3 relative" ref={userMenuRef}>
        <AnimatePresence>
          {userMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-3 right-3 mb-1.5 bg-bg border border-rule rounded-xl overflow-hidden shadow-lg z-50"
            >
              {/* Connected Accounts + Profile live in this account menu (not the
                  main sidebar nav). */}
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/accounts'); }}
                className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-elevated transition-colors cursor-pointer"
              >
                Connected Accounts
              </button>
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                className="w-full text-left px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-elevated transition-colors cursor-pointer"
              >
                Profile
              </button>
              <div className="h-px mx-3 my-1" style={{ background: 'var(--lf-rule-neutral)' }} />
              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                className="w-full text-left px-4 py-2.5 text-sm text-accent hover:bg-bg-elevated transition-colors cursor-pointer"
              >
                Sign out
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          aria-haspopup="menu"
          aria-expanded={userMenuOpen}
          className="w-full flex items-center gap-2.5 p-3 bg-bg border border-rule rounded-xl cursor-pointer hover:border-accent/30 transition"
        >
          <div className="w-7 h-7 rounded-lg bg-accent text-white flex items-center justify-center font-serif text-sm shrink-0">
            {initial}
          </div>
          <div className="flex-1 text-left min-w-0">
            <div className="text-sm font-medium text-text truncate">{firstName}</div>
            <div className="text-[11px] text-text-muted font-mono truncate">
              {tenant?.plan === 'pro' ? 'pro plan' : 'free plan'}
            </div>
          </div>
          <ChevronUp
            size={13}
            className={cn(
              'text-text-muted transition-transform duration-150',
              !userMenuOpen && 'rotate-180',
            )}
          />
        </button>
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
      whileTap={{ scale: 0.98 }}
      className={cn(
        'relative flex items-center gap-2.5 w-full text-left pl-4 pr-3 py-2 rounded-lg mb-0.5 border-0 cursor-pointer text-[14px] transition-colors',
        active
          ? 'bg-accent/10 text-accent font-semibold'
          : 'text-text-secondary font-medium hover:bg-bg-subtle hover:text-text',
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-accent"
        />
      )}
      <Icon
        size={16}
        className={cn(
          'shrink-0',
          active ? 'text-accent opacity-100' : 'opacity-60',
        )}
      />
      <span className="flex-1">{label}</span>
    </motion.button>
  );
}
