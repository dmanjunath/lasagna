import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { TrendingUp, Building2, Sparkles, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { StatCard } from '../components/common/stat-card';
import { Section } from '../components/common/section';
import type { Plan } from '../lib/types';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

interface ActionItem {
  id: string;
  text: string;
  linkText: string;
  path: string;
  priority: 'high' | 'medium' | 'low';
}

export function Dashboard() {
  const { user, tenant } = useAuth();
  const [, navigate] = useLocation();
  const [completedActions, setCompletedActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [accountCount, setAccountCount] = useState(0);
  const [planCount, setPlanCount] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [institutionCount, setInstitutionCount] = useState(0);

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] })),
      api.getPlans().catch(() => ({ plans: [] as Plan[] })),
      api.getItems().catch(() => ({ items: [] })),
    ]).then(([balanceData, planData, itemData]) => {
      // Compute net worth from balances
      const balances = balanceData.balances;
      if (balances.length > 0) {
        const total = balances.reduce((sum, b) => {
          const val = parseFloat(b.balance || '0');
          // Credit and loan balances are liabilities
          return b.type === 'credit' || b.type === 'loan' ? sum - val : sum + val;
        }, 0);
        setNetWorth(total);
      }
      setAccountCount(balances.length);

      setPlans(planData.plans);
      setPlanCount(planData.plans.length);

      setInstitutionCount(itemData.items.length);
    }).finally(() => setLoading(false));
  }, []);

  const toggleAction = (id: string) => {
    setCompletedActions((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const priorityColors = {
    high: 'bg-danger',
    medium: 'bg-warning',
    low: 'bg-accent',
  };

  const firstName = tenant?.name?.split(' ')[0] || 'there';

  // Build contextual action items based on actual state
  const actionItems: ActionItem[] = [];
  if (institutionCount === 0) {
    actionItems.push({
      id: 'link-account',
      text: 'Link your first bank account to get started',
      linkText: 'Linked Accounts',
      path: '/accounts',
      priority: 'high',
    });
  }
  if (planCount === 0) {
    actionItems.push({
      id: 'create-plan',
      text: 'Create your first financial plan',
      linkText: 'AI Plans',
      path: '/plans',
      priority: 'high',
    });
  }
  if (institutionCount > 0 && planCount === 0) {
    actionItems.push({
      id: 'review-net-worth',
      text: 'Review your net worth breakdown',
      linkText: 'Net Worth',
      path: '/net-worth',
      priority: 'medium',
    });
  }
  if (plans.length > 0) {
    // Add an action item for the most recent plan
    const latestPlan = plans[0];
    actionItems.push({
      id: `plan-${latestPlan.id}`,
      text: `Continue working on "${latestPlan.title}"`,
      linkText: latestPlan.title,
      path: `/plans/${latestPlan.id}`,
      priority: 'medium',
    });
  }
  if (institutionCount > 0) {
    actionItems.push({
      id: 'check-cash-flow',
      text: 'Check your cash flow and spending',
      linkText: 'Cash Flow',
      path: '/cash-flow',
      priority: 'low',
    });
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-10"
      >
        <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-medium tracking-tight">
          {getGreeting()} <span className="capitalize">{firstName}</span>
        </h2>
      </motion.div>

      {/* Summary Cards */}
      <Section title="Your Finances">
        {loading ? (
          <div className="flex items-center gap-2 text-text-muted py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
            <StatCard
              icon={TrendingUp}
              label="Net Worth"
              value={netWorth !== null ? formatCurrency(netWorth) : '—'}
              description={accountCount > 0 ? `Across ${accountCount} account${accountCount !== 1 ? 's' : ''}` : 'Link accounts to track'}
              status={netWorth !== null && netWorth > 0 ? 'success' : 'default'}
              onClick={() => navigate('/net-worth')}
              delay={0}
            />
            <StatCard
              icon={Building2}
              label="Linked Accounts"
              value={String(institutionCount)}
              description={institutionCount > 0 ? `${accountCount} account${accountCount !== 1 ? 's' : ''} total` : 'No accounts linked'}
              status={institutionCount > 0 ? 'success' : 'warning'}
              onClick={() => navigate('/accounts')}
              delay={0.05}
            />
            <StatCard
              icon={Sparkles}
              label="AI Plans"
              value={String(planCount)}
              description={planCount > 0 ? `${plans.filter(p => p.status === 'active').length} active` : 'Create your first plan'}
              status={planCount > 0 ? 'success' : 'default'}
              onClick={() => navigate('/plans')}
              delay={0.1}
            />
          </div>
        )}
      </Section>

      {/* Action Items */}
      {actionItems.length > 0 && (
        <Section title="Suggested Next Steps">
          <div className="glass-card rounded-2xl divide-y divide-border overflow-hidden">
            {actionItems.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className={cn(
                  'p-4 md:p-5 flex items-center gap-3 md:gap-4 transition-all duration-300 hover:bg-surface-hover',
                  completedActions.includes(item.id) && 'opacity-40'
                )}
              >
                <button
                  onClick={() => toggleAction(item.id)}
                  className={cn(
                    'w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-200 flex-shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                    completedActions.includes(item.id)
                      ? 'bg-accent border-accent text-bg'
                      : 'border-border hover:border-accent/50'
                  )}
                >
                  {completedActions.includes(item.id) && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>

                <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', priorityColors[item.priority])} />

                <div className="flex-1 min-w-0">
                  <div className={cn('text-sm font-medium', completedActions.includes(item.id) && 'line-through text-text-muted')}>
                    {item.text}
                  </div>
                  <button
                    onClick={() => navigate(item.path)}
                    className="text-sm text-text-muted hover:text-accent transition-colors flex items-center gap-1"
                  >
                    {item.linkText}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
