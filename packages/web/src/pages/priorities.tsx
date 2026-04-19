import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';
import {
  Shield, Gift, Flame, HeartPulse, Sprout,
  TrendingUp, CreditCard, Rocket,
  Loader2, AlertCircle, Lock, RefreshCw, Check, SkipForward, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useInsights } from '../hooks/useInsights';
import { useChatStore } from '../lib/chat-store';
import { ActionItem } from '../components/common/action-item';
import type { LucideIcon } from 'lucide-react';

// ── constants ────────────────────────────────────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  shield: Shield, gift: Gift, flame: Flame, 'heart-pulse': HeartPulse,
  sprout: Sprout, 'trending-up': TrendingUp, 'credit-card': CreditCard, rocket: Rocket,
};

const TYPE_FILTERS = [
  { label: 'All', value: null },
  { label: 'Spending', value: 'spending' },
  { label: 'Behavioral', value: 'behavioral' },
  { label: 'Debt', value: 'debt' },
  { label: 'Tax', value: 'tax' },
  { label: 'Portfolio', value: 'portfolio' },
  { label: 'Savings', value: 'savings' },
  { label: 'Retirement', value: 'retirement' },
];

const URGENCY_ORDER = ['critical', 'high', 'medium', 'low'];
const URGENCY_LABELS: Record<string, string> = {
  critical: 'Critical', high: 'High Priority', medium: 'Medium', low: 'Low',
};
const URGENCY_COLORS: Record<string, string> = {
  critical: 'text-danger', high: 'text-warning', medium: 'text-accent', low: 'text-text-secondary',
};
const PAGE_LINKS: Record<string, string> = {
  spending: '/spending', behavioral: '/spending', debt: '/debt',
  tax: '/tax', portfolio: '/invest', savings: '/goals',
  retirement: '/retirement', general: '/',
};

// ── types ────────────────────────────────────────────────────────────────────

interface PriorityStep {
  id: string; order: number; title: string; subtitle: string;
  icon: string; status: string; current: number | null;
  target: number | null; progress: number;
  action: string; detail: string; priority: string;
  skipped: boolean;
}

interface PrioritySummary {
  monthlyIncome: number; monthlyExpenses: number | null;
  monthlySurplus: number | null; totalCash: number;
  totalInvested: number; totalHighInterestDebt: number;
  totalMediumInterestDebt: number; age: number | null;
  retirementAge: number; filingStatus: string | null;
}

interface PriorityData {
  steps: PriorityStep[]; currentStepId: string; summary: PrioritySummary;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

// ── LayerRow ─────────────────────────────────────────────────────────────────

function LayerRow({ step, isCurrent, index, isSkipped, onSkip, onAsk }: {
  step: PriorityStep; isCurrent: boolean; index: number;
  isSkipped: boolean; onSkip: () => void; onAsk: () => void;
}) {
  const [expanded, setExpanded] = useState(isCurrent);
  const isComplete = step.status === 'complete';
  const isFuture   = !isComplete && !isCurrent && !isSkipped;

  const accent = (isComplete && step.order % 2 === 0) ? '#fbbf24' : '#00e5a0';
  const fill   = isComplete ? 100 : isFuture ? 0 : Math.min(step.progress, 100);

  let progressDetail = '';
  if (!isFuture && step.target !== null && step.current !== null) {
    if (step.target === 0)               progressDetail = 'Goal: $0';
    else if (isComplete)                 progressDetail = fmt(step.current) + (step.icon === 'credit-card' ? ' paid' : ' saved');
    else if (step.target > step.current) progressDetail = fmt(step.target - step.current) + ' to go';
    else                                 progressDetail = fmt(step.current) + ' saved';
  } else if (!isFuture && step.current !== null) {
    progressDetail = fmt(step.current);
  }

  const Icon = iconMap[step.icon] || Shield;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative overflow-hidden border-b border-border last:border-b-0',
        isCurrent && 'bg-accent/[0.04]',
        isSkipped && 'bg-surface-elevated/20',
      )}
    >
      {/* Progress fill — active & complete only */}
      {(isCurrent || isComplete) && fill > 0 && (
        <motion.div
          className="absolute inset-y-0 left-0 pointer-events-none"
          style={{
            background: isComplete
              ? `linear-gradient(90deg, ${accent}20, ${accent}04)`
              : `linear-gradient(90deg, ${accent}12, ${accent}02)`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${fill}%` }}
          transition={{ duration: 0.8, delay: index * 0.04 + 0.1, ease: [0.16, 1, 0.3, 1] }}
        />
      )}

      {/* Left accent bar */}
      <div
        className="absolute left-0 inset-y-0 w-[3px] rounded-r-full"
        style={{
          background: isSkipped
            ? '#2a2a40'
            : isFuture
            ? 'repeating-linear-gradient(to bottom, #2a2a40 0px, #2a2a40 3px, transparent 3px, transparent 7px)'
            : isComplete ? accent : `${accent}70`,
        }}
      />

      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="relative w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-white/[0.015] transition-colors"
      >
        {/* Step number */}
        <span className={cn(
          'w-5 text-right text-xs font-mono flex-shrink-0 hidden sm:block',
          isCurrent ? 'text-accent/50' : 'text-text-muted',
        )}>
          {String(step.order).padStart(2, '0')}
        </span>

        {/* Icon */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: (isFuture || isSkipped) ? 'rgba(255,255,255,0.04)' : `${accent}18` }}
        >
          {isComplete
            ? <Check className="w-3.5 h-3.5" style={{ color: accent }} />
            : isSkipped
            ? <SkipForward className="w-3.5 h-3.5 text-text-muted" />
            : isFuture
            ? <Lock className="w-3.5 h-3.5 text-text-muted" />
            : <Icon className="w-4 h-4" style={{ color: accent }} />}
        </div>

        {/* Title + subtitle */}
        <div className="flex-1 min-w-0">
          <p className={cn(
            'text-sm truncate',
            isCurrent  ? 'font-semibold text-text' : '',
            isComplete ? 'font-medium text-text' : '',
            isFuture   ? 'font-medium text-text-secondary' : '',
            isSkipped  ? 'font-medium text-text-muted line-through' : '',
          )}>
            {step.title}
          </p>
          <p className={cn(
            'text-xs mt-0.5 truncate',
            isCurrent || isComplete ? 'text-text-secondary' : 'text-text-muted',
          )}>
            {step.subtitle}
            {progressDetail && !expanded ? ` · ${progressDetail}` : ''}
          </p>
        </div>

        {/* Right */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {isSkipped && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-surface-elevated px-2 py-0.5 rounded-full">
              Skipped
            </span>
          )}
          {!isSkipped && isComplete && !expanded && (
            <span className="text-xs font-semibold tabular-nums" style={{ color: accent }}>100%</span>
          )}
          {isCurrent && !expanded && (
            <span className="text-xs font-semibold tabular-nums text-accent">{fill}%</span>
          )}
          <ChevronDown className={cn(
            'w-4 h-4 text-text-muted flex-shrink-0 transition-transform duration-200',
            expanded && 'rotate-180',
          )} />
        </div>
      </button>

      {/* Expanded body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 sm:pl-[4.25rem]">
              {/* Progress bar for active step */}
              {isCurrent && (
                <div className="mb-3">
                  <div className="flex justify-between text-xs text-text-secondary mb-1.5">
                    <span>Progress</span>
                    <span className="font-semibold tabular-nums text-accent">{fill}%{progressDetail ? ` · ${progressDetail}` : ''}</span>
                  </div>
                  <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: accent }}
                      initial={{ width: 0 }}
                      animate={{ width: `${fill}%` }}
                      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </div>
              )}
              {isComplete && progressDetail && (
                <p className="text-xs text-text-secondary mb-2">{progressDetail}</p>
              )}
              {step.detail && (
                <p className="text-sm text-text-secondary mb-3 leading-relaxed">{step.detail}</p>
              )}
              <div className="flex items-center gap-4 flex-wrap">
                <button
                  type="button"
                  onClick={onAsk}
                  className="text-sm text-accent hover:text-accent/80 font-medium transition-colors"
                >
                  Walk me through this →
                </button>
                {!isComplete && (
                  <button
                    type="button"
                    onClick={onSkip}
                    className="text-sm text-text-muted hover:text-text-secondary transition-colors"
                  >
                    {isSkipped ? 'Unskip' : 'Skip this step'}
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── SectionLabel ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-text-secondary mb-3">
      {children}
    </p>
  );
}

// ── Priorities ────────────────────────────────────────────────────────────────

export function Priorities() {
  const [data, setData]       = useState<PriorityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing]     = useState(false);
  const [skippedStepIds, setSkippedStepIds] = useState<Set<string>>(new Set());
  const [, navigate] = useLocation();
  const { openChat } = useChatStore();

  const handleSkipStep = async (stepId: string) => {
    const isCurrentlySkipped = skippedStepIds.has(stepId);
    // Optimistic update
    setSkippedStepIds(prev => {
      const next = new Set(prev);
      isCurrentlySkipped ? next.delete(stepId) : next.add(stepId);
      return next;
    });
    try {
      await api.skipPriorityStep(stepId, !isCurrentlySkipped);
      // Keep optimistic update — don't replace with server response
      // (server may return cascaded skips for intermediate steps)
    } catch {
      // Revert on failure
      setSkippedStepIds(prev => {
        const next = new Set(prev);
        isCurrentlySkipped ? next.add(stepId) : next.delete(stepId);
        return next;
      });
    }
  };

  const actionsRef = useRef<HTMLDivElement>(null);

  const { insights, isLoading: insightsLoading, dismiss, refresh } =
    useInsights(activeFilter ?? undefined);

  // Scroll to Actions section when linked with #actions
  useEffect(() => {
    if (window.location.hash === '#actions' && actionsRef.current) {
      setTimeout(() => actionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
  }, []);

  const grouped = URGENCY_ORDER.reduce<Record<string, typeof insights>>((acc, u) => {
    acc[u] = insights.filter(i => i.urgency === u);
    return acc;
  }, {});

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  useEffect(() => {
    api.getPriorities()
      .then(d => {
        setData(d);
        // Initialise skipped steps from server state (server returns skipped: boolean, not status: 'skipped')
        const serverSkipped = d.steps.filter(s => s.skipped).map(s => s.id);
        if (serverSkipped.length) setSkippedStepIds(new Set(serverSkipped));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-text-secondary" />
    </div>
  );

  if (error) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-2">
        <AlertCircle className="w-7 h-7 text-danger mx-auto" />
        <p className="text-sm text-text-secondary">{error}</p>
      </div>
    </div>
  );

  if (!data) return null;

  const { steps, currentStepId, summary } = data;

  const hasNoData = summary.monthlyIncome === 0 && summary.totalCash === 0 && summary.totalInvested === 0;
  if (hasNoData) return (
    <div className="flex-1 flex items-center justify-center p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-4 max-w-sm"
      >
        <Rocket className="w-10 h-10 text-text-secondary mx-auto" />
        <div>
          <h2 className="text-lg font-semibold mb-1">Let's build your plan</h2>
          <p className="text-sm text-text-secondary">
            Add your income and accounts to see your personalized priority layers.
          </p>
        </div>
        <div className="flex gap-3 justify-center pt-1">
          <a href="/onboarding" className="px-4 py-2 bg-accent text-bg font-semibold text-sm rounded-xl hover:bg-accent/90 transition-colors">
            Get Started
          </a>
          <a href="/accounts" className="px-4 py-2 border border-border text-text-secondary text-sm rounded-xl hover:bg-bg-elevated transition-colors">
            Link Account
          </a>
        </div>
      </motion.div>
    </div>
  );

  const completeCount = steps.filter(s => s.status === 'complete').length;

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <div className="space-y-8">

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="space-y-4"
        >
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text">Focus</h1>
            <p className="text-sm text-text-secondary mt-1">
              {completeCount} of {steps.length} complete · FI target age {summary.retirementAge}
            </p>
          </div>

          {/* Cash flow */}
          {summary.monthlyIncome > 0 && (
            <div className="flex flex-wrap gap-x-8 gap-y-3 pt-4 border-t border-border">
              <Stat label="Income" value={`${fmt(summary.monthlyIncome)}/mo`} />
              {summary.monthlyExpenses !== null && (
                <Stat label="Expenses" value={`${fmt(summary.monthlyExpenses)}/mo`} />
              )}
              {summary.monthlySurplus !== null && (
                <Stat
                  label="Surplus"
                  value={`${fmt(summary.monthlySurplus)}/mo`}
                  color={summary.monthlySurplus >= 0 ? 'text-accent' : 'text-danger'}
                />
              )}
              {summary.totalCash > 0 && (
                <Stat label="Cash" value={fmt(summary.totalCash)} className="hidden sm:block" />
              )}
              {summary.totalInvested > 0 && (
                <Stat label="Invested" value={fmt(summary.totalInvested)} className="hidden sm:block" />
              )}
              {summary.totalHighInterestDebt > 0 && (
                <Stat label="High-rate debt" value={fmt(summary.totalHighInterestDebt)} color="text-danger" className="hidden sm:block" />
              )}
            </div>
          )}
        </motion.div>

        {/* ── Layers ── */}
        <div>
          <SectionLabel>Layers</SectionLabel>
          <div className="rounded-xl border border-border overflow-hidden">
            {steps.map((step, i) => (
              <LayerRow
                key={step.id}
                step={step}
                isCurrent={step.id === currentStepId}
                index={i}
                isSkipped={skippedStepIds.has(step.id)}
                onSkip={() => handleSkipStep(step.id)}
                onAsk={() => openChat(`Tell me about this financial step: "${step.title}". ${step.subtitle}`)}
              />
            ))}
          </div>
        </div>

        {/* ── Actions ── */}
        <div ref={actionsRef} className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SectionLabel>Actions</SectionLabel>
              {!insightsLoading && insights.length > 0 && (
                <span className="text-xs text-text-secondary -mt-3 tabular-nums">
                  {insights.length}
                </span>
              )}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="-mt-3 flex items-center gap-1.5 text-xs text-text-secondary hover:text-text transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {/* Filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            {TYPE_FILTERS.map(f => (
              <button
                key={f.label}
                onClick={() => setActiveFilter(f.value)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  activeFilter === f.value
                    ? 'bg-accent text-bg'
                    : 'bg-surface-elevated text-text-secondary hover:text-text hover:bg-surface-hover'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* States */}
          {insightsLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-text-secondary" />
            </div>
          )}

          {!insightsLoading && insights.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <p className="text-sm text-text-secondary">No actions yet.</p>
              <button onClick={handleRefresh} className="text-sm text-accent hover:text-accent/80 transition-colors">
                Generate actions →
              </button>
            </div>
          )}

          {/* Urgency groups */}
          {!insightsLoading && URGENCY_ORDER.map(urgency => {
            const items = grouped[urgency];
            if (!items?.length) return null;
            return (
              <section key={urgency} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn('text-xs font-bold uppercase tracking-wider', URGENCY_COLORS[urgency])}>
                    {URGENCY_LABELS[urgency]}
                  </span>
                  <span className="text-xs text-text-secondary">({items.length})</span>
                </div>
                <div className="rounded-xl border border-border overflow-hidden">
                  {items.map(insight => (
                    <ActionItem
                      key={insight.id}
                      title={insight.title}
                      tag={(insight.type ?? insight.category ?? 'general').toUpperCase()}
                      description={insight.description}
                      impact={insight.impact ?? ''}
                      impactColor={(insight.impactColor as 'green' | 'amber' | 'red') ?? 'amber'}
                      chatPrompt={insight.chatPrompt ?? insight.title}
                      onDismiss={() => dismiss(insight.id)}
                      onContextClick={PAGE_LINKS[insight.type ?? 'general']
                        ? () => navigate(PAGE_LINKS[insight.type ?? 'general'])
                        : undefined}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

      </div>
    </div>
  );
}

// ── Stat ──────────────────────────────────────────────────────────────────────

function Stat({ label, value, color, className }: {
  label: string; value: string; color?: string; className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className={cn('text-sm font-semibold text-text mt-0.5', color)}>{value}</p>
    </div>
  );
}
