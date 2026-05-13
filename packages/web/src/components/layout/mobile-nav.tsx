import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Menu,
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
            className="fixed top-0 left-0 bottom-0 w-72 z-50 flex flex-col
                       bg-lf-cream border-r border-border md:hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2.5 p-4 border-b border-border"
                 style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
              <div className="flex items-center gap-2.5">
                <div className="lf-mark">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="font-serif text-lg text-lf-ink">
                  Lasagna<em className="text-lf-sauce italic">Fi</em>
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-lf-paper border border-border
                           flex items-center justify-center cursor-pointer
                           active:scale-95 transition-transform"
              >
                <X size={16} className="text-lf-muted" />
              </button>
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto p-3 scrollbar-thin">
              {NAV_SECTIONS.map(({ section, items }) => (
                <div key={section} className="mb-2">
                  <div className="font-mono text-xs tracking-widest uppercase text-lf-muted px-2 my-4">
                    {section}
                  </div>
                  {items.map(({ label, icon: Icon, path }) => {
                    const active = isActive(path);
                    return (
                      <button
                        key={path}
                        onClick={() => handleNavigate(path)}
                        className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg mb-0.5
                                   border-0 cursor-pointer text-left font-sans text-sm
                                   transition-colors active:scale-[0.98]
                                   min-h-[44px]"
                        style={{
                          background: active ? 'var(--lf-ink)' : 'transparent',
                          color: active ? 'var(--lf-paper)' : 'var(--lf-ink-soft)',
                        }}
                      >
                        <Icon
                          size={16}
                          className="flex-shrink-0"
                          style={{
                            opacity: active ? 1 : 0.65,
                            color: active ? 'var(--lf-cheese)' : 'currentColor',
                          }}
                        />
                        {label}
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* AI Chat */}
              <div className="mb-2">
                <button
                  onClick={() => { openChat(); onClose(); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg mb-0.5
                             border-0 cursor-pointer text-left font-sans text-sm
                             transition-colors active:scale-[0.98]
                             min-h-[44px]"
                  style={{
                    background: 'transparent',
                    color: 'var(--lf-ink-soft)',
                  }}
                >
                  <MessageSquare size={16} className="flex-shrink-0 opacity-65" />
                  AI Chat
                </button>
              </div>
            </nav>

            {/* Account chip at bottom */}
            <div className="p-4 border-t border-border"
                 style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                           border border-border bg-lf-paper">
                <div className="w-7 h-7 rounded-lg bg-lf-sauce text-lf-paper
                           flex items-center justify-center font-serif text-sm
                           flex-shrink-0">
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-lf-ink text-sm truncate">
                    {firstName}
                  </div>
                  <div className="text-lf-muted text-xs font-mono">
                    {tenant?.plan === 'pro' ? 'pro plan' : 'self-hosted'}
                  </div>
                </div>
              </div>
            </div>
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
