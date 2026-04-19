import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Receipt,
  Target,
  CreditCard,
  Compass,
  Building2,
  LogOut,
  ChevronUp,
  PieChart,
  User,
  ShoppingCart,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { Logo } from '../common/Logo';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  id: string;
  name: string;
  icon: LucideIcon;
  path: string;
}

const fixedTabs: NavItem[] = [
  { id: 'home', name: 'Home', icon: LayoutDashboard, path: '/' },
  { id: 'priorities', name: 'Focus', icon: Compass, path: '/priorities' },
  { id: 'spending', name: 'Spending', icon: ShoppingCart, path: '/spending' },
  { id: 'debt', name: 'Debt', icon: CreditCard, path: '/debt' },
  { id: 'invest', name: 'Portfolio', icon: PieChart, path: '/invest' },
  { id: 'retirement', name: 'Retirement', icon: Target, path: '/retirement' },
  { id: 'tax', name: 'Tax', icon: Receipt, path: '/tax' },
];

interface SidebarProps {
  onNewPlan?: () => void;
  className?: string;
}

export function Sidebar({ className }: SidebarProps) {
  const [location, navigate] = useLocation();
  const { user, tenant, logout } = useAuth();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user menu on click outside
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

  const isActive = (path: string) => location === path;

  return (
    <aside className={cn('w-full h-full bg-bg-elevated flex flex-col', className)}>
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <h1 className="font-display text-xl font-medium tracking-tight flex items-center gap-3">
          <Logo width={30} />
          <span>Lasagna</span>
        </h1>
        <p className="text-sm text-text-secondary mt-1.5 ml-12">AI Financial Advisor</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto scrollbar-thin">
        {/* Fixed Tabs */}
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-text-secondary font-semibold mb-3 px-2">
            Main
          </div>
          <div className="space-y-1">
            {fixedTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <motion.button
                  key={tab.id}
                  onClick={() => navigate(tab.path)}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  className={cn(
                    'w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    isActive(tab.path)
                      ? 'bg-white/[0.07] text-accent'
                      : 'hover:bg-surface-hover text-text-secondary hover:text-text'
                  )}
                >
                  <Icon className={cn('w-5 h-5', isActive(tab.path) ? 'text-accent' : 'text-text-secondary')} />
                  <span className="flex-1 font-medium">{tab.name}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

      </nav>

      {/* User profile */}
      <div className="relative border-t border-border bg-bg/50" ref={userMenuRef}>
        <AnimatePresence>
          {userMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-2 right-2 mb-1 bg-surface-solid border border-border rounded-xl shadow-lg overflow-hidden z-50"
            >
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/accounts'); }}
                className="w-full px-3 py-2.5 text-sm text-text-secondary hover:text-text hover:bg-surface-hover flex items-center gap-2.5 transition-colors"
              >
                <Building2 className="w-4 h-4" />
                Accounts
              </button>
              <div className="border-t border-border" />
              <button
                onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                className="w-full px-3 py-2.5 text-sm text-text-secondary hover:text-text hover:bg-surface-hover flex items-center gap-2.5 transition-colors"
              >
                <User className="w-4 h-4" />
                Profile
              </button>
              <div className="border-t border-border" />
              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                className="w-full px-3 py-2.5 text-sm text-danger/80 hover:text-danger hover:bg-danger/5 flex items-center gap-2.5 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Log out
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className="w-full p-4 flex items-center gap-3 hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent/20 to-accent-dim/20 border border-accent/20 flex items-center justify-center text-sm font-semibold text-accent">
            {(tenant?.name || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-semibold truncate">{tenant?.name || 'User'}</div>
            <div className="text-sm text-text-secondary truncate capitalize">{tenant?.plan || 'free'} plan</div>
          </div>
          <ChevronUp className={cn('w-4 h-4 text-text-secondary transition-transform', userMenuOpen ? '' : 'rotate-180')} />
        </button>
      </div>
    </aside>
  );
}
