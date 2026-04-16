import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  TrendingUp,
  Receipt,
  Sparkles,
  Target,
  CreditCard,
  Compass,
  Plus,
  ChevronDown,
  Loader2,
  X,
  Building2,
  LogOut,
  ChevronUp,
  PieChart,
  User,
  Lightbulb,
  ShoppingCart,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
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
  { id: 'home', name: 'Home', icon: LayoutDashboard, path: '/' },
  { id: 'actions', name: 'Actions', icon: Lightbulb, path: '/actions' },
  { id: 'priorities', name: 'Your Layers', icon: Compass, path: '/priorities' },
  { id: 'accounts', name: 'Accounts', icon: Building2, path: '/accounts' },
  { id: 'spending', name: 'Spending', icon: ShoppingCart, path: '/spending' },
  { id: 'debt', name: 'Debt', icon: CreditCard, path: '/debt' },
  { id: 'invest', name: 'Portfolio', icon: PieChart, path: '/invest' },
  { id: 'retirement', name: 'Retirement', icon: Target, path: '/retirement' },
  { id: 'tax', name: 'Tax', icon: Receipt, path: '/tax' },
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
  const { user, tenant, logout } = useAuth();
  const [plansExpanded, setPlansExpanded] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getPlans()
      .then(({ plans }) => setPlans(plans))
      .catch((err) => console.error("Failed to load plans:", err))
      .finally(() => setLoadingPlans(false));
  }, [location]);

  const handleDeletePlan = async (planId: string, planTitle: string, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigation to plan detail
    e.stopPropagation();

    const confirmed = window.confirm(`Delete '${planTitle}'? This will archive the plan.`);
    if (!confirmed) return;

    setDeletingPlanId(planId);
    try {
      await api.deletePlan(planId);
      setPlans((prevPlans) => prevPlans.filter((plan) => plan.id !== planId));
    } catch (error) {
      console.error("Failed to delete plan:", error);
      alert("Failed to delete plan. Please try again.");
    } finally {
      setDeletingPlanId(null);
    }
  };

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
          <Logo size={36} />
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
                      <motion.div
                        key={plan.id}
                        whileHover={{ x: 2 }}
                        whileTap={{ scale: 0.98 }}
                        className="relative group"
                      >
                        <button
                          onClick={() => navigate(planPath)}
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
                        </button>
                        <button
                          onClick={(e) => handleDeletePlan(plan.id, plan.title, e)}
                          disabled={deletingPlanId === plan.id}
                          className="absolute top-1/2 -translate-y-1/2 right-2 p-1 rounded-md hover:bg-red-500/10 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label="Delete plan"
                        >
                          {deletingPlanId === plan.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <X className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </motion.div>
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
            <div className="text-sm text-text-muted truncate capitalize">{tenant?.plan || 'free'} plan</div>
          </div>
          <ChevronUp className={cn('w-4 h-4 text-text-muted transition-transform', userMenuOpen ? '' : 'rotate-180')} />
        </button>
      </div>
    </aside>
  );
}
