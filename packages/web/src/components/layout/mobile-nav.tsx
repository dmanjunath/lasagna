import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  X,
  LayoutDashboard,
  Building2,
  CreditCard,
  PieChart,
  Receipt,
  Target,
  User,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { LucideIcon } from 'lucide-react';

interface NavSection {
  label: string;
  items: { name: string; icon: LucideIcon; path: string }[];
}

const navSections: NavSection[] = [
  {
    label: 'Main',
    items: [
      { name: 'Home', icon: LayoutDashboard, path: '/' },
      { name: 'Accounts', icon: Building2, path: '/accounts' },
      { name: 'Debt', icon: CreditCard, path: '/debt' },
      { name: 'Invest', icon: PieChart, path: '/invest' },
      { name: 'Tax', icon: Receipt, path: '/tax' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { name: 'Probability', icon: Target, path: '/probability' },
    ],
  },
  {
    label: 'Account',
    items: [
      { name: 'Profile', icon: User, path: '/profile' },
      { name: 'Plans', icon: Sparkles, path: '/plans' },
    ],
  },
];

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileNav({ isOpen, onClose }: MobileNavProps) {
  const [location, navigate] = useLocation();

  const isActive = (path: string) => location === path;

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  // Lock body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — 110% height to cover any iOS bounce */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed z-40 md:hidden bg-black/50"
            style={{ top: '-5%', left: 0, right: 0, height: '110%' }}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-y-0 left-0 w-72 z-50 md:hidden bg-bg-elevated border-r border-border flex flex-col"
          >
            {/* Header */}
            <div className="p-4 flex items-center justify-between border-b border-border">
              <span className="font-display text-lg font-medium">Menu</span>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-hover transition-colors"
              >
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>

            {/* Navigation sections */}
            <nav className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-6">
              {navSections.map((section) => (
                <div key={section.label}>
                  <div className="text-xs uppercase tracking-wider text-text-secondary font-semibold mb-2 px-2">
                    {section.label}
                  </div>
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.path);
                      return (
                        <button
                          key={item.name}
                          onClick={() => handleNavigate(item.path)}
                          className={cn(
                            'w-full text-left px-3 py-2.5 rounded-xl text-sm flex items-center gap-3 transition-colors',
                            active
                              ? 'bg-accent/10 text-accent border border-accent/20'
                              : 'hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent'
                          )}
                        >
                          <Icon className={cn('w-5 h-5', active ? 'text-accent' : 'text-text-muted')} />
                          <span className="font-medium">{item.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
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
      className="md:hidden fixed top-4 left-4 z-30 w-10 h-10 rounded-xl bg-surface-solid border border-border flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <Menu className="w-5 h-5 text-text" />
    </motion.button>
  );
}
