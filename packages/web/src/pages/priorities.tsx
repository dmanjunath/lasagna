import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Gift,
  Flame,
  HeartPulse,
  Sprout,
  TrendingUp,
  CreditCard,
  Rocket,
  Check,
  ChevronDown,
  Loader2,
  AlertCircle,
  ArrowRight,
  DollarSign,
  Wallet,
  PiggyBank,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { LucideIcon } from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  shield: Shield,
  gift: Gift,
  flame: Flame,
  'heart-pulse': HeartPulse,
  sprout: Sprout,
  'trending-up': TrendingUp,
  'credit-card': CreditCard,
  rocket: Rocket,
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

interface PriorityStep {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  icon: string;
  status: string;
  current: number | null;
  target: number | null;
  progress: number;
  action: string;
  detail: string;
  priority: string;
}

interface PrioritySummary {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySurplus: number;
  totalCash: number;
  totalInvested: number;
  totalHighInterestDebt: number;
  totalMediumInterestDebt: number;
  age: number | null;
  retirementAge: number;
  filingStatus: string | null;
}

interface PriorityData {
  steps: PriorityStep[];
  currentStepId: string;
  summary: PrioritySummary;
}

function ProgressBar({ progress, priority }: { progress: number; priority: string }) {
  const colorClass =
    priority === 'critical'
      ? 'bg-accent'
      : priority === 'high'
        ? 'bg-warning'
        : 'bg-blue-500';

  return (
    <div className="h-2 bg-border rounded-full overflow-hidden">
      <motion.div
        className={cn('h-full rounded-full', colorClass)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(progress, 100)}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  );
}

function SummaryCard({ summary }: { summary: PrioritySummary }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-bg-elevated border border-border rounded-xl p-6 mb-8"
    >
      <h2 className="text-lg font-semibold text-text-primary mb-4">Monthly Cash Flow</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-accent" />
          </div>
          <div>
            <div className="text-sm text-text-muted">Income</div>
            <div className="text-lg font-semibold text-text-primary">
              {formatCurrency(summary.monthlyIncome)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-danger/10 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-danger" />
          </div>
          <div>
            <div className="text-sm text-text-muted">Expenses</div>
            <div className="text-lg font-semibold text-text-primary">
              {formatCurrency(summary.monthlyExpenses)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <PiggyBank className="w-5 h-5 text-accent" />
          </div>
          <div>
            <div className="text-sm text-text-muted">Surplus to Deploy</div>
            <div
              className={cn(
                'text-lg font-semibold',
                summary.monthlySurplus >= 0 ? 'text-accent' : 'text-danger'
              )}
            >
              {formatCurrency(summary.monthlySurplus)}
              <span className="text-sm text-text-muted font-normal">/mo</span>
            </div>
          </div>
        </div>
      </div>
      {(summary.totalCash > 0 || summary.totalInvested > 0) && (
        <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-text-muted">Total Cash: </span>
            <span className="text-text-primary font-medium">{formatCurrency(summary.totalCash)}</span>
          </div>
          <div>
            <span className="text-text-muted">Total Invested: </span>
            <span className="text-text-primary font-medium">{formatCurrency(summary.totalInvested)}</span>
          </div>
          {summary.totalHighInterestDebt > 0 && (
            <div>
              <span className="text-text-muted">High-Interest Debt: </span>
              <span className="text-danger font-medium">
                {formatCurrency(summary.totalHighInterestDebt)}
              </span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function StepCard({
  step,
  isCurrent,
  isLast,
  index,
}: {
  step: PriorityStep;
  isCurrent: boolean;
  isLast: boolean;
  index: number;
}) {
  const isComplete = step.status === 'complete';
  const isFuture = !isComplete && !isCurrent;
  const [expanded, setExpanded] = useState(isCurrent);

  const Icon = iconMap[step.icon] || Shield;

  const circleColor = isComplete
    ? 'bg-accent text-white'
    : isCurrent
      ? 'bg-accent/20 text-accent border-2 border-accent'
      : 'bg-border text-text-muted';

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.06 }}
      className="relative flex gap-4"
    >
      {/* Timeline */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-10',
            circleColor
          )}
        >
          {isComplete ? (
            <Check className="w-5 h-5" />
          ) : (
            <span className="text-sm font-bold">{step.order}</span>
          )}
        </div>
        {!isLast && (
          <div
            className={cn(
              'w-0.5 flex-1 mt-0',
              isComplete ? 'bg-accent/40' : 'bg-border'
            )}
          />
        )}
      </div>

      {/* Card */}
      <div
        className={cn(
          'flex-1 mb-4 rounded-xl border transition-all duration-200',
          isCurrent
            ? 'bg-bg-elevated border-accent/30 shadow-[0_0_20px_rgba(34,197,94,0.05)]'
            : isComplete
              ? 'bg-bg-elevated/60 border-border'
              : 'bg-bg-elevated/40 border-border/60'
        )}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full p-4 flex items-start gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-xl"
        >
          <div
            className={cn(
              'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
              isComplete
                ? 'bg-accent/10'
                : isCurrent
                  ? 'bg-accent/10'
                  : 'bg-border/30'
            )}
          >
            <Icon
              className={cn(
                'w-5 h-5',
                isComplete
                  ? 'text-accent'
                  : isCurrent
                    ? 'text-accent'
                    : 'text-text-muted'
              )}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3
                className={cn(
                  'font-semibold',
                  isFuture ? 'text-text-muted' : 'text-text-primary'
                )}
              >
                {step.title}
              </h3>
              {isComplete && (
                <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">
                  Done
                </span>
              )}
              {isCurrent && (
                <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <ArrowRight className="w-3 h-3" />
                  Current
                </span>
              )}
            </div>
            <p className={cn('text-sm mt-0.5', isFuture ? 'text-text-muted/60' : 'text-text-secondary')}>
              {step.subtitle}
            </p>
          </div>

          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 mt-1"
          >
            <ChevronDown className="w-4 h-4 text-text-muted" />
          </motion.div>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 space-y-3">
                {/* Progress */}
                {step.target !== null && step.current !== null && (
                  <div>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span className="text-text-secondary">
                        {formatCurrency(step.current)}
                      </span>
                      <span className="text-text-muted">
                        {step.target === 0
                          ? 'Goal: $0'
                          : `of ${formatCurrency(step.target)}`}
                      </span>
                    </div>
                    <ProgressBar progress={step.progress} priority={step.priority} />
                  </div>
                )}

                {/* Action */}
                <div
                  className={cn(
                    'flex items-start gap-2 p-3 rounded-lg text-sm',
                    isComplete
                      ? 'bg-accent/5 text-accent'
                      : 'bg-surface-hover text-text-primary'
                  )}
                >
                  {isComplete ? (
                    <Check className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  ) : (
                    <ArrowRight className="w-4 h-4 mt-0.5 flex-shrink-0 text-accent" />
                  )}
                  <span>{step.action}</span>
                </div>

                {/* Detail */}
                <p className="text-xs text-text-muted leading-relaxed">{step.detail}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export function Priorities() {
  const [data, setData] = useState<PriorityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPriorities()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-danger mx-auto mb-2" />
          <p className="text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { steps, currentStepId, summary } = data;

  // Check if user has any meaningful data
  const hasNoData = summary.monthlyIncome === 0 && summary.totalCash === 0 && summary.totalInvested === 0;

  if (hasNoData) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8 max-w-3xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-16"
        >
          <Rocket className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h2 className="font-display text-2xl font-medium mb-2">Let&apos;s layer your lasagna</h2>
          <p className="text-text-muted text-sm max-w-md mx-auto mb-6">
            To build your personalized financial layers, we need to know about your income, accounts, and profile. This takes about 2 minutes.
          </p>
          <div className="flex gap-3 justify-center">
            <a href="/onboarding" className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-bg font-semibold text-sm rounded-xl hover:bg-accent/90 transition-colors">
              Get Started
            </a>
            <a href="/accounts" className="inline-flex items-center gap-2 px-4 py-2.5 border border-border text-text-secondary text-sm rounded-xl hover:bg-bg-elevated transition-colors">
              Link Bank Account
            </a>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-8 max-w-3xl mx-auto w-full">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6"
      >
        <h1 className="text-2xl md:text-3xl font-bold text-text-primary">
          Layer Your Lasagna
        </h1>
        <p className="text-text-secondary mt-1">
          Build your financial foundation one layer at a time.
        </p>
      </motion.div>

      <SummaryCard summary={summary} />

      <div className="relative">
        {steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            isCurrent={step.id === currentStepId}
            isLast={i === steps.length - 1}
            index={i}
          />
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="text-xs text-text-muted text-center mt-8 mb-4 leading-relaxed"
      >
        This is educational guidance, not financial advice. Consult a qualified
        financial professional for personalized recommendations.
      </motion.p>
    </div>
  );
}
