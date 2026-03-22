import { useState } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { Progress } from '../ui/progress';

interface NavItem {
  id: string;
  name: string;
  icon: string;
  path: string;
  version?: string;
  progress?: number;
}

const fixedTabs: NavItem[] = [
  { id: 'dashboard', name: 'Overview', icon: '◐', path: '/' },
  { id: 'net-worth', name: 'Net Worth', icon: '◈', path: '/net-worth' },
  { id: 'cash-flow', name: 'Cash Flow', icon: '◉', path: '/cash-flow' },
  { id: 'tax-strategy', name: 'Tax Strategy', icon: '◇', path: '/tax-strategy' },
  { id: 'plans', name: 'AI Plans', icon: '◈', path: '/plans' },
];

// TODO: These will come from API later
const userPlans: NavItem[] = [
  { id: 'retirement', name: 'Retirement Plan', icon: '◎', path: '/plans/retirement', version: 'v3' },
  { id: 'savings-house', name: 'House Down Payment', icon: '◎', path: '/plans/savings/house', progress: 45 },
  { id: 'savings-vacation', name: 'Europe Vacation', icon: '◎', path: '/plans/savings/vacation', progress: 72 },
  { id: 'debt-payoff', name: 'Debt Payoff', icon: '◆', path: '/plans/debt-payoff' },
];

interface SidebarProps {
  onNewPlan?: () => void;
  className?: string;
}

export function Sidebar({ onNewPlan, className }: SidebarProps) {
  const [location, navigate] = useLocation();
  const [plansExpanded, setPlansExpanded] = useState(true);

  const isActive = (path: string) => location === path;

  return (
    <aside className={cn('w-64 h-full bg-bg-elevated border-r border-border flex flex-col', className)}>
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <h1 className="font-display text-xl font-medium tracking-tight flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent-dim flex items-center justify-center text-bg text-sm font-bold shadow-lg">
            L
          </span>
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
            {fixedTabs.map((tab) => (
              <motion.button
                key={tab.id}
                onClick={() => navigate(tab.path)}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  'w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-colors duration-200',
                  isActive(tab.path)
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent'
                )}
              >
                <span className={cn('text-lg', isActive(tab.path) ? 'text-accent' : 'text-text-muted')}>
                  {tab.icon}
                </span>
                <span className="flex-1 font-medium">{tab.name}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* User Plans */}
        <div>
          <button
            onClick={() => setPlansExpanded(!plansExpanded)}
            className="w-full flex items-center justify-between text-xs uppercase tracking-wider text-text-secondary font-semibold mb-3 px-2 hover:text-text transition-colors"
          >
            <span>Your Plans</span>
            <motion.span
              animate={{ rotate: plansExpanded ? 0 : -90 }}
              transition={{ duration: 0.2 }}
            >
              ▾
            </motion.span>
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
                {userPlans.map((plan) => (
                  <motion.button
                    key={plan.id}
                    onClick={() => navigate(plan.path)}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      'w-full text-left px-3 py-3 rounded-xl text-sm flex items-center gap-3 transition-colors duration-200',
                      isActive(plan.path)
                        ? 'bg-accent/10 text-accent border border-accent/20'
                        : 'hover:bg-surface-hover text-text-secondary hover:text-text border border-transparent'
                    )}
                  >
                    <span className={cn('text-lg', isActive(plan.path) ? 'text-accent' : 'text-text-muted')}>
                      {plan.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{plan.name}</div>
                      {plan.progress !== undefined && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <Progress value={plan.progress} className="flex-1 h-1" />
                          <span className="text-xs text-text-muted tabular-nums">{plan.progress}%</span>
                        </div>
                      )}
                    </div>
                    {plan.version && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-surface-solid text-text-muted">
                        {plan.version}
                      </span>
                    )}
                  </motion.button>
                ))}

                <motion.button
                  onClick={onNewPlan}
                  whileHover={{ x: 2 }}
                  className="w-full px-3 py-3 rounded-xl text-sm text-text-muted hover:text-text hover:bg-surface-hover transition-all duration-200 flex items-center gap-3 border border-dashed border-border/50 hover:border-accent/30 mt-2"
                >
                  <span className="text-lg">+</span>
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
            DM
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
