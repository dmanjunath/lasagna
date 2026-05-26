import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Menu, Wallet,
  LayoutDashboard, Zap, Layers,
  TrendingUp, PieChart, CreditCard, AlertCircle, Receipt, Target,
  Building2, User, MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useChatStore } from '../../lib/chat-store';

interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
}

interface NavSection {
  section: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { label: 'Dashboard',  icon: LayoutDashboard, path: '/' },
      { label: 'Money',      icon: Wallet,          path: '/money' },
      { label: 'Actions',    icon: Zap,             path: '/insights' },
      { label: 'Financial Level', icon: Layers, path: '/financial-level' },
    ],
  },
  {
    section: 'Wealth',
    items: [
      { label: 'Retirement', icon: TrendingUp,  path: '/retirement' },
      { label: 'Portfolio',  icon: PieChart,    path: '/portfolio' },
      { label: 'Spending',   icon: CreditCard,  path: '/spending' },
      { label: 'Debt',       icon: AlertCircle, path: '/debt' },
      { label: 'Tax',        icon: Receipt,     path: '/tax' },
      { label: 'Goals',      icon: Target,      path: '/goals' },
    ],
  },
  {
    section: 'Setup',
    items: [
      { label: 'Accounts', icon: Building2,    path: '/accounts' },
      { label: 'Profile',  icon: User,         path: '/profile' },
    ],
  },
];

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileNav({ isOpen, onClose }: MobileNavProps) {
  const [location, navigate] = useLocation();
  const { tenant, logout } = useAuth();
  const { openChat } = useChatStore();

  const isActive = (path: string) => path === '/' ? location === '/' : location.startsWith(path);

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  const rawName = tenant?.name || '';
  const firstName = rawName.startsWith('Seed ') ? 'User' : (rawName.split(' ')[0] || 'User');
  const initial = firstName[0]?.toUpperCase() || 'U';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 top-[-5%] h-[110%] bg-black/50 z-40 md:hidden"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed top-0 left-0 bottom-0 w-[88%] max-w-[360px] z-50 overflow-y-auto
                       bg-bg shadow-2xl md:hidden scrollbar-thin"
          >
            <nav
              className="px-3 space-y-1"
              style={{
                paddingTop: 'max(16px, env(safe-area-inset-top))',
                paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
              }}
            >
              {/* Profile card — matches Simple drawer */}
              <button
                onClick={() => handleNavigate('/profile')}
                className="flex items-center gap-3 p-4 w-full bg-bg-elevated rounded-2xl border border-rule hover:border-accent/30 transition text-left"
              >
                <div className="w-14 h-14 rounded-full bg-accent grid place-items-center text-xl font-serif font-medium text-white shrink-0 shadow-sm">
                  {initial}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-base font-serif font-medium leading-tight">{firstName}</div>
                  <div className="text-xs text-text-muted mt-1">View profile &amp; settings</div>
                </div>
                <div className="text-text-muted text-xs">›</div>
              </button>

              {NAV_SECTIONS.map(({ section, items }) => (
                <div key={section} className="mb-2">
                  <div className="font-mono text-[10px] tracking-[0.14em] uppercase text-text-muted px-3 pt-4 pb-2">
                    {section}
                  </div>
                  {items.map(({ label, icon: Icon, path }) => {
                    const active = isActive(path);
                    return (
                      <button
                        key={path}
                        onClick={() => handleNavigate(path)}
                        className={`flex items-center gap-3 w-full p-3 rounded-xl mb-0.5
                                   cursor-pointer text-left text-sm transition-colors active:scale-[0.98]
                                   min-h-[44px] ${active ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'}`}
                      >
                        <div className="w-9 h-9 rounded-xl bg-bg-elevated grid place-items-center shrink-0">
                          <Icon size={16} className={active ? 'text-accent' : 'text-text-muted'} />
                        </div>
                        <span className={active ? 'font-semibold text-accent' : 'font-medium'}>{label}</span>
                        <div className="text-text-muted text-xs ml-auto">›</div>
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* AI Chat */}
              <div className="mb-2">
                <button
                  onClick={() => { openChat(); onClose(); }}
                  className="flex items-center gap-3 w-full p-3 rounded-xl
                             cursor-pointer text-left text-sm
                             transition-colors active:scale-[0.98] hover:bg-bg-elevated
                             min-h-[44px]"
                >
                  <div className="w-9 h-9 rounded-xl bg-bg-elevated grid place-items-center shrink-0">
                    <MessageSquare size={16} className="text-text-muted" />
                  </div>
                  <span className="font-medium">AI Chat</span>
                  <div className="text-text-muted text-xs ml-auto">›</div>
                </button>
              </div>

              {/* Sign out */}
              <button
                onClick={() => { onClose(); logout(); }}
                className="flex items-center gap-3 w-full p-3 mt-4 rounded-xl hover:bg-bg-elevated text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-bg-elevated grid place-items-center shrink-0">
                  <X size={16} className="text-text-muted" />
                </div>
                <span className="text-sm font-medium text-text-secondary">Sign out</span>
              </button>
            </nav>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className="fixed top-3.5 left-4 z-30 w-9 h-9 rounded-lg
                 bg-lf-paper border border-border
                 flex items-center justify-center cursor-pointer
                 active:scale-95 transition-transform duration-200
                 md:hidden min-w-[44px] min-h-[44px]"
    >
      <Menu size={18} className="text-lf-ink" strokeWidth={2} />
    </motion.button>
  );
}
