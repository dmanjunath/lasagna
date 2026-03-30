import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  Building2,
  Sparkles,
  Loader2,
  CheckCircle2,
  Circle,
  User,
  Wallet,
  Target,
  ChevronRight,
  CreditCard,
  Shield,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { usePageContext } from '../lib/page-context';
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

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  path: string;
  done: boolean;
  icon: typeof User;
}

interface BalanceEntry {
  accountId: string;
  name: string;
  type: string;
  mask: string | null;
  balance: string | null;
  available: string | null;
  currency: string;
  asOf: string | null;
}

export function Dashboard() {
  const { user, tenant } = useAuth();
  const [, navigate] = useLocation();
  const { setPageContext } = usePageContext();
  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<number | null>(null);
  const [accountCount, setAccountCount] = useState(0);
  const [planCount, setPlanCount] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [institutionCount, setInstitutionCount] = useState(0);
  const [hasName, setHasName] = useState(false);
  const [monthlySpend, setMonthlySpend] = useState<number | null>(null);
  const [runwayMonths, setRunwayMonths] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as BalanceEntry[] })),
      api.getPlans().catch(() => ({ plans: [] as Plan[] })),
      api.getItems().catch(() => ({ items: [] })),
      api.getProfile().catch(() => ({ profile: { name: null, email: '', plan: 'free', createdAt: '' } })),
    ]).then(([balanceData, planData, itemData, profileData]) => {
      const balances = balanceData.balances;

      // Compute net worth
      let totalAssets = 0;
      let totalLiabilities = 0;
      let depositoryTotal = 0;
      let creditTotal = 0;

      for (const b of balances) {
        const val = parseFloat(b.balance || '0');
        if (b.type === 'credit' || b.type === 'loan') {
          totalLiabilities += val;
          if (b.type === 'credit') creditTotal += val;
        } else {
          totalAssets += val;
          if (b.type === 'depository') depositoryTotal += val;
        }
      }

      if (balances.length > 0) {
        setNetWorth(totalAssets - totalLiabilities);
      }
      setAccountCount(balances.length);

      // Monthly spend estimate from credit card balances
      if (creditTotal > 0) {
        setMonthlySpend(creditTotal);
        // Runway = liquid cash / monthly spend
        if (depositoryTotal > 0) {
          setRunwayMonths(Math.floor(depositoryTotal / creditTotal));
        }
      }

      setPlans(planData.plans);
      setPlanCount(planData.plans.length);

      setInstitutionCount(itemData.items.length);

      const name = profileData.profile.name;
      setHasName(!!name && name !== profileData.profile.email?.split('@')[0]);
    }).finally(() => setLoading(false));
  }, []);

  // Set page context for floating chat
  useEffect(() => {
    if (!loading) {
      setPageContext({
        pageId: 'dashboard',
        pageTitle: 'Dashboard',
        description: 'Overview of financial health including net worth, accounts, and plans.',
        data: {
          netWorth,
          accountCount,
          planCount,
          institutionCount,
          monthlySpend,
          runwayMonths,
        },
      });
    }
  }, [loading, netWorth, accountCount, planCount, institutionCount, monthlySpend, runwayMonths, setPageContext]);

  const firstName = tenant?.name?.split(' ')[0] || 'there';

  // Onboarding checklist
  const checklist: ChecklistItem[] = useMemo(() => [
    {
      id: 'profile',
      label: 'Set up your profile',
      description: 'Add your name so we can personalize your experience',
      path: '/settings',
      done: hasName,
      icon: User,
    },
    {
      id: 'connect',
      label: 'Connect a bank account',
      description: 'Link your accounts for real-time tracking',
      path: '/accounts',
      done: institutionCount > 0,
      icon: Building2,
    },
    {
      id: 'net-worth',
      label: 'Review your net worth',
      description: 'See your full financial picture in one place',
      path: '/net-worth',
      done: netWorth !== null,
      icon: Wallet,
    },
    {
      id: 'plan',
      label: 'Create a financial plan',
      description: 'Get AI-powered analysis for retirement, debt, or custom goals',
      path: '/plans/new',
      done: planCount > 0,
      icon: Target,
    },
  ], [hasName, institutionCount, netWorth, planCount]);

  const completedCount = checklist.filter((c) => c.done).length;
  const allDone = completedCount === checklist.length;

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

      {/* Onboarding Checklist */}
      {!loading && !allDone && (
        <Section title={`Get Started — ${completedCount} of ${checklist.length}`}>
          <div className="glass-card rounded-2xl overflow-hidden">
            {/* Progress bar */}
            <div className="px-5 pt-4 pb-2">
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${(completedCount / checklist.length) * 100}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </div>
            </div>

            <div className="divide-y divide-border">
              {checklist.map((item, i) => {
                const Icon = item.icon;
                return (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.3 }}
                    onClick={() => !item.done && navigate(item.path)}
                    className={cn(
                      'w-full px-5 py-4 flex items-center gap-4 text-left transition-colors',
                      item.done
                        ? 'opacity-50'
                        : 'hover:bg-surface-hover cursor-pointer'
                    )}
                  >
                    {item.done ? (
                      <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-border flex-shrink-0" />
                    )}

                    <Icon className={cn('w-5 h-5 flex-shrink-0', item.done ? 'text-text-muted' : 'text-text-secondary')} />

                    <div className="flex-1 min-w-0">
                      <div className={cn('text-sm font-medium', item.done && 'line-through text-text-muted')}>
                        {item.label}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">
                        {item.description}
                      </div>
                    </div>

                    {!item.done && (
                      <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>
        </Section>
      )}

      {/* Summary Cards */}
      <Section title="Your Finances">
        {loading ? (
          <div className="flex items-center gap-2 text-text-muted py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
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
              icon={CreditCard}
              label="Monthly Spend"
              value={monthlySpend !== null ? formatCurrency(monthlySpend) : '—'}
              description={monthlySpend !== null ? 'From credit card balances' : 'Link a credit card'}
              status={monthlySpend !== null ? 'default' : 'default'}
              delay={0.05}
            />
            <StatCard
              icon={Shield}
              label="Runway"
              value={runwayMonths !== null ? `${runwayMonths} mo` : '—'}
              description={runwayMonths !== null ? 'Months of expenses covered' : 'Based on cash & spending'}
              status={runwayMonths !== null && runwayMonths >= 6 ? 'success' : runwayMonths !== null ? 'warning' : 'default'}
              delay={0.1}
            />
            <StatCard
              icon={Building2}
              label="Linked Accounts"
              value={String(institutionCount)}
              description={institutionCount > 0 ? `${accountCount} account${accountCount !== 1 ? 's' : ''} total` : 'No accounts linked'}
              status={institutionCount > 0 ? 'success' : 'warning'}
              onClick={() => navigate('/accounts')}
              delay={0.15}
            />
            <StatCard
              icon={Sparkles}
              label="AI Plans"
              value={String(planCount)}
              description={planCount > 0 ? `${plans.filter(p => p.status === 'active').length} active` : 'Create your first plan'}
              status={planCount > 0 ? 'success' : 'default'}
              onClick={() => navigate('/plans')}
              delay={0.2}
            />
          </div>
        )}
      </Section>
    </div>
  );
}
