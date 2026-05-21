import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Zap, Layers, TrendingUp, PieChart,
  CreditCard, AlertCircle, Receipt, Target, Building2,
  User, MessageSquare, Sparkles, ChevronUp, type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { useChatStore } from '../../lib/chat-store';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

interface NavSection {
  section: string;
}

type NavEntry = NavItem | NavSection;

const NAV: NavEntry[] = [
  { section: 'OVERVIEW' },
  { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard, path: '/' },
  { id: 'actions',    label: 'Actions',    icon: Zap,             path: '/insights' },
  { id: 'financial-level', label: 'Financial Level', icon: Layers, path: '/financial-level' },
  { section: 'WEALTH' },
  { id: 'retirement', label: 'Retirement', icon: TrendingUp,      path: '/retirement' },
  { id: 'portfolio',  label: 'Portfolio',  icon: PieChart,        path: '/portfolio' },
  { id: 'spending',   label: 'Spending',   icon: CreditCard,      path: '/spending' },
  { id: 'debt',       label: 'Debt',       icon: AlertCircle,     path: '/debt' },
  { id: 'tax',        label: 'Tax',        icon: Receipt,         path: '/tax' },
  { id: 'goals',      label: 'Goals',      icon: Target,          path: '/goals' },
  { section: 'SETUP' },
  { id: 'accounts',   label: 'Accounts',   icon: Building2,       path: '/accounts' },
  { id: 'profile',    label: 'Profile',    icon: User,            path: '/profile' },
];

function isSection(entry: NavEntry): entry is NavSection {
  return 'section' in entry;
}

interface SidebarProps {
  onNewPlan?: () => void;
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout, setUiMode } = useAuth();
  const { openChat } = useChatStore();
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

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';

  return (
    <aside className={cn('w-full h-full flex flex-col bg-bg-elevated', className)}>
      {/* Brand */}
      <div className="px-4 pt-6 pb-5">
        <div className="flex items-center gap-2.5 px-2">
          <div className="lf-mark">
            <span /><span /><span />
          </div>
          <span className="font-serif text-xl text-text tracking-tight">
            Lasagna<em className="italic text-accent">Fi</em>
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 overflow-y-auto scrollbar-thin">
        {NAV.map((entry, i) => {
          if (isSection(entry)) {
            return (
              <div
                key={i}
                className="font-mono text-[11px] tracking-[0.14em] uppercase text-text-muted px-3 mt-5 mb-2"
              >
                {entry.section}
              </div>
            );
          }

          const active = isActive(entry.path);
          return (
            <NavButton
              key={entry.id}
              active={active}
              icon={entry.icon}
              label={entry.label}
              onClick={() => navigate(entry.path)}
            />
          );
        })}

        {/* AI Chat button */}
        <NavButton
          active={false}
          icon={MessageSquare}
          label="AI Chat"
          onClick={() => openChat()}
        />

        {/* Switch to Simple mode */}
        <NavButton
          active={false}
          icon={Sparkles}
          label="Try Simple mode"
          onClick={async () => {
            await setUiMode('simple');
            navigate('/s');
          }}
        />
      </nav>

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
              {[
                { label: 'Accounts', path: '/accounts' },
                { label: 'Profile', path: '/profile' },
              ].map(({ label, path }, i) => (
                <button
                  key={path}
                  onClick={() => { setUserMenuOpen(false); navigate(path); }}
                  className={cn(
                    'w-full text-left px-4 py-2.5 text-sm hover:bg-bg-elevated transition-colors cursor-pointer',
                    i > 0 && 'border-t border-rule',
                  )}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                className="w-full text-left px-4 py-2.5 text-sm text-accent hover:bg-bg-elevated border-t border-rule transition-colors cursor-pointer"
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
              {tenant?.plan === 'pro' ? 'pro plan' : 'self-hosted'}
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
        'flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl mb-0.5 border-0 cursor-pointer text-sm transition-colors',
        active
          ? 'bg-text text-white'
          : 'text-text-secondary hover:bg-bg-subtle',
      )}
    >
      <Icon
        size={16}
        className={cn(
          'shrink-0',
          active ? 'text-cheese opacity-100' : 'opacity-60',
        )}
      />
      <span className="flex-1">{label}</span>
    </motion.button>
  );
}
