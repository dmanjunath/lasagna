import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  TrendingUp,
  ArrowRightLeft,
  Receipt,
  Sparkles,
  Target,
  CreditCard,
  Plus,
  ChevronDown,
  Loader2
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';
import { Logo } from '../common/Logo';
import type { Plan, PlanType } from '../../lib/types';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  id: string;
  name: string;
  icon: LucideIcon;
  path: string;
}

const fixedTabs: NavItem[] = [
  { id: 'dashboard', name: 'Overview', icon: LayoutDashboard, path: '/' },
  { id: 'net-worth', name: 'Net Worth', icon: TrendingUp, path: '/net-worth' },
  { id: 'cash-flow', name: 'Cash Flow', icon: ArrowRightLeft, path: '/cash-flow' },
  { id: 'tax-strategy', name: 'Tax Strategy', icon: Receipt, path: '/tax-strategy' },
  { id: 'plans', name: 'AI Plans', icon: Sparkles, path: '/plans' },
];

const planTypeIcons: Record<PlanType, LucideIcon> = {
  net_worth: TrendingUp,
  retirement: Target,
  debt_payoff: CreditCard,
  custom: Sparkles,
};

interface SidebarProps {
  onNewPlan?: () => void;
  className?: string;
}

export function Sidebar({ onNewPlan, className }: SidebarProps) {
  const [location, navigate] = useLocation();
  const [plansExpanded, setPlansExpanded] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  useEffect(() => {
    api.getPlans()
      .then(({ plans }) => setPlans(plans))
      .catch((err) => console.error("Failed to load plans:", err))
      .finally(() => setLoadingPlans(false));
  }, [location]);

  const isActive = (path: string) => location === path;

  return (
    <aside className={cn('w-56 h-full bg-bg-elevated border-r border-border flex flex-col', className)}>
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <h1 className="font-display text-xl font-medium tracking-tight flex items-center gap-3">
          <Logo size={36} />
          <span>Lasagna</span>
        </h1>
        <p className="text-sm text-text-muted mt-1.5 ml-12">AI Financial Advisor</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 overflow-y-auto scrollbar-thin">
        {/* Fixed Tabs */}
        <div className="mb-6">
          <div className="text-xs uppercase tracking-wider text-text-secondary font-semibold mb-3 px-2">
            Dashboard
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
                      ? 'bg-accent/10 text-accent border border-accent/20'
                      : 'hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent'
                  )}
                >
                  <Icon className={cn('w-5 h-5', isActive(tab.path) ? 'text-accent' : 'text-text-muted')} />
                  <span className="flex-1 font-medium">{tab.name}</span>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* User Plans */}
        <div>
          <button
            onClick={() => setPlansExpanded(!plansExpanded)}
            className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-text-secondary font-semibold mb-3 px-2 hover:text-text transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded"
          >
            <span>Your Plans</span>
            <motion.div
              animate={{ rotate: plansExpanded ? 0 : -90 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-4 h-4" />
            </motion.div>
          </button>

          <AnimatePresence>
            {plansExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-1 overflow-hidden"
              >
                {loadingPlans ? (
                  <div className="px-3 py-2 text-sm text-text-muted flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading...</span>
                  </div>
                ) : plans.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-text-muted">Create your first plan</div>
                ) : (
                  plans.map((plan) => {
                    const planPath = `/plans/${plan.id}`;
                    const PlanIcon = planTypeIcons[plan.type];
                    return (
                      <motion.button
                        key={plan.id}
                        onClick={() => navigate(planPath)}
                        whileHover={{ x: 2 }}
                        whileTap={{ scale: 0.98 }}
                        className={cn(
                          'w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                          isActive(planPath)
                            ? 'bg-accent/10 text-accent border border-accent/20'
                            : 'hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent'
                        )}
                      >
                        <PlanIcon className={cn('w-5 h-5', isActive(planPath) ? 'text-accent' : 'text-text-muted')} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{plan.title}</div>
                        </div>
                      </motion.button>
                    );
                  })
                )}

                <motion.button
                  onClick={onNewPlan}
                  whileHover={{ x: 2 }}
                  className="w-full px-3 py-3 rounded-xl text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all duration-200 flex items-center gap-3 border border-dashed border-border/50 hover:border-accent/30 mt-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <Plus className="w-5 h-5" />
                  <span className="font-medium">New Plan</span>
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* User profile */}
      <div className="p-4 border-t border-border bg-bg/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent/20 to-accent-dim/20 border border-accent/20 flex items-center justify-center text-sm font-semibold text-accent">
            U
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">User</div>
            <div className="text-sm text-text-muted truncate">Pro Plan</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
