import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Wallet, LogOut,
  LayoutDashboard, Zap, Layers,
  TrendingUp, PieChart, CreditCard, AlertCircle, Receipt, Target,
  Building2, User, MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useChatStore } from '../../lib/chat-store';
import { BrandMark } from '../common/BrandMark';

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
                       bg-canvas border-r border-line shadow-2xl md:hidden scrollbar-thin"
          >
            <nav
              className="px-3 space-y-1"
              style={{
                paddingTop: 'max(14px, env(safe-area-inset-top))',
                paddingBottom: 'max(16px, env(safe-area-inset-bottom))',
              }}
            >
              {/* Header — brand + close */}
              <div className="flex items-center justify-between px-2 pt-1 pb-3">
                <div className="flex items-center gap-2.5">
                  <BrandMark size={30} />
                  <span className="font-editorial text-[18px] font-semibold tracking-[-0.01em] text-content">LasagnaFi</span>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close menu"
                  className="grid place-items-center w-11 h-11 -mr-1 rounded-ui-md text-content-muted hover:bg-canvas-sunken hover:text-content transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Profile card */}
              <button
                onClick={() => handleNavigate('/profile')}
                className="flex items-center gap-3 p-4 w-full bg-panel rounded-ui-lg border border-line hover:border-brand/40 hover:shadow-ui-sm transition text-left"
              >
                <div className="w-12 h-12 rounded-full bg-brand grid place-items-center text-lg font-editorial font-bold text-[rgb(var(--ui-brand-fg))] shrink-0 shadow-ui-sm">
                  {initial}
                </div>
                <div className="flex-1 text-left">
                  <div className="text-[15px] font-bold leading-tight tracking-tight text-content">{firstName}</div>
                  <div className="text-[12px] text-content-muted mt-0.5">View profile &amp; settings</div>
                </div>
                <div className="text-content-faint text-sm">›</div>
              </button>

              {NAV_SECTIONS.map(({ section, items }) => (
                <div key={section} className="mb-2">
                  <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-content-faint px-3 pt-4 pb-2">
                    {section}
                  </div>
                  {items.map(({ label, icon: Icon, path }) => {
                    const active = isActive(path);
                    return (
                      <button
                        key={path}
                        onClick={() => handleNavigate(path)}
                        className={`flex items-center gap-3 w-full p-2.5 rounded-ui-md mb-0.5
                                   cursor-pointer text-left text-[15px] transition-colors active:scale-[0.98]
                                   min-h-[44px] ${active ? 'bg-brand-soft' : 'hover:bg-canvas-sunken'}`}
                      >
                        <div className={`w-9 h-9 rounded-ui-md grid place-items-center shrink-0 ${active ? 'bg-brand text-[rgb(var(--ui-brand-fg))]' : 'bg-canvas-sunken text-content-muted'}`}>
                          <Icon size={16} />
                        </div>
                        <span className={active ? 'font-bold text-[rgb(var(--ui-brand-ink))]' : 'font-semibold text-content'}>{label}</span>
                        <div className="text-content-faint text-sm ml-auto">›</div>
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* AI Chat */}
              <div className="mb-2">
                <button
                  onClick={() => { openChat(); onClose(); }}
                  className="flex items-center gap-3 w-full p-2.5 rounded-ui-md
                             cursor-pointer text-left text-[15px]
                             transition-colors active:scale-[0.98] hover:bg-canvas-sunken
                             min-h-[44px]"
                >
                  <div className="w-9 h-9 rounded-ui-md bg-canvas-sunken grid place-items-center shrink-0 text-content-muted">
                    <MessageSquare size={16} />
                  </div>
                  <span className="font-semibold text-content">AI Chat</span>
                  <div className="text-content-faint text-sm ml-auto">›</div>
                </button>
              </div>

              {/* Sign out */}
              <button
                onClick={() => { onClose(); logout(); }}
                className="flex items-center gap-3 w-full p-2.5 mt-3 rounded-ui-md hover:bg-canvas-sunken text-left min-h-[44px]"
              >
                <div className="w-9 h-9 rounded-ui-md bg-canvas-sunken grid place-items-center shrink-0 text-content-muted">
                  <LogOut size={16} />
                </div>
                <span className="text-[15px] font-semibold text-content-secondary">Sign out</span>
              </button>
            </nav>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
