import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';
import {
  Shield, Gift, Flame, HeartPulse, Sprout,
  TrendingUp, CreditCard, Rocket,
  Loader2, AlertCircle, RefreshCw, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
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
  critical: 'var(--lf-sauce)', high: 'var(--lf-cheese)', medium: 'var(--lf-noodle)', low: 'var(--lf-muted)',
};
const PAGE_LINKS: Record<string, string> = {
  spending: '/spending', behavioral: '/spending', debt: '/debt',
  tax: '/tax', portfolio: '/invest', savings: '/goals',
  retirement: '/retirement', general: '/',
};

// ── layer color map ──────────────────────────────────────────────────────────

function layerColor(order: number): string {
  switch (order) {
    case 1: return 'var(--lf-sauce)';
    case 2: return 'var(--lf-cheese)';
    case 3: return 'var(--lf-noodle)';
    case 4: return 'var(--lf-basil)';
    case 5: return 'var(--lf-crust)';
    case 6: return 'var(--lf-burgundy)';
    case 7: return '#A68965';
    default: return '#7A5C3F';
  }
}

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

// ── styles ───────────────────────────────────────────────────────────────────

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--lf-muted)',
};

const serifStyle: React.CSSProperties = {
  fontFamily: "'Instrument Serif', Georgia, serif",
};

const cardStyle: React.CSSProperties = {
  background: 'var(--lf-paper)',
  border: '1px solid var(--lf-rule)',
  borderRadius: 14,
};

const darkCardStyle: React.CSSProperties = {
  background: 'var(--lf-ink)',
  color: 'var(--lf-paper)',
  borderRadius: 14,
};

// ── LayersVisual ─────────────────────────────────────────────────────────────

function LayersVisual({ steps, currentStepId, skippedStepIds }: {
  steps: PriorityStep[];
  currentStepId: string;
  skippedStepIds: Set<string>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map((step, i) => {
        const isCurrent = step.id === currentStepId;
        const isComplete = step.status === 'complete';
        const isSkipped = skippedStepIds.has(step.id);
        const isFuture = !isComplete && !isCurrent && !isSkipped;
        const color = layerColor(step.order);
        const fill = isComplete ? 100 : isFuture ? 0 : Math.min(step.progress, 100);

        return (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.045, ease: [0.16, 1, 0.3, 1] }}
            style={{
              marginLeft: `${i * 3}%`,
              marginRight: `${(steps.length - 1 - i) * 2}%`,
              opacity: isFuture || isSkipped ? 0.45 : 1,
              position: 'relative',
              borderRadius: 8,
              overflow: 'hidden',
              border: isCurrent ? `1.5px solid ${color}` : '1px solid var(--lf-rule)',
              background: 'var(--lf-paper)',
            }}
          >
            {/* Progress fill */}
            {fill > 0 && (
              <motion.div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: `${color}18`,
                  transformOrigin: 'left',
                }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: fill / 100 }}
                transition={{ duration: 0.8, delay: i * 0.045 + 0.15, ease: [0.16, 1, 0.3, 1] }}
              />
            )}

            {/* Left accent strip */}
            <div style={{
              position: 'absolute',
              top: 0, bottom: 0, left: 0,
              width: 4,
              background: isSkipped ? 'var(--lf-rule)' : color,
              borderRadius: '8px 0 0 8px',
            }} />

            {/* Content */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px 9px 16px',
              position: 'relative',
            }}>
              <span style={{
                ...eyebrowStyle,
                fontSize: 10,
                color: isSkipped ? 'var(--lf-muted)' : color,
                flexShrink: 0,
                minWidth: 22,
              }}>
                {String(step.order).padStart(2, '0')}
              </span>

              <span style={{
                flex: 1,
                fontSize: 12,
                fontWeight: isCurrent ? 600 : isComplete ? 500 : 400,
                color: isSkipped
                  ? 'var(--lf-muted)'
                  : isFuture
                  ? 'var(--lf-ink-soft)'
                  : 'var(--lf-ink)',
                textDecoration: isSkipped ? 'line-through' : 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {step.title}
              </span>

              <span style={{
                ...eyebrowStyle,
                fontSize: 10,
                color: isFuture || isSkipped ? 'var(--lf-muted)' : color,
                flexShrink: 0,
              }}>
                {isComplete ? '100%' : isFuture ? '—' : `${Math.round(fill)}%`}
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── CurrentFocusCard ─────────────────────────────────────────────────────────

function CurrentFocusCard({ step, onSkip, onAsk, skipped }: {
  step: PriorityStep;
  onSkip: () => void;
  onAsk: () => void;
  skipped: boolean;
}) {
  const color = layerColor(step.order);
  const isComplete = step.status === 'complete';
  const fill = isComplete ? 100 : Math.min(step.progress, 100);

  let progressDetail = '';
  if (step.target !== null && step.current !== null) {
    if (step.target === 0)               progressDetail = 'Goal: $0';
    else if (isComplete)                 progressDetail = fmt(step.current) + (step.icon === 'credit-card' ? ' paid' : ' saved');
    else if (step.target > step.current) progressDetail = fmt(step.target - step.current) + ' to go';
    else                                 progressDetail = fmt(step.current) + ' saved';
  } else if (step.current !== null) {
    progressDetail = fmt(step.current);
  }

  return (
    <div style={{ ...cardStyle, overflow: 'hidden' }}>
      {/* Eyebrow bar */}
      <div style={{
        padding: '14px 20px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span style={eyebrowStyle}>
          Current Focus · Layer {String(step.order).padStart(2, '0')}
        </span>
      </div>

      {/* Title */}
      <div style={{ padding: '10px 20px 0' }}>
        <h2 style={{
          ...serifStyle,
          fontSize: 22,
          fontWeight: 400,
          color: 'var(--lf-ink)',
          lineHeight: 1.25,
          margin: 0,
        }}>
          {step.title}
        </h2>
        <p style={{
          fontSize: 13,
          color: 'var(--lf-ink-soft)',
          marginTop: 4,
          lineHeight: 1.5,
        }}>
          {step.subtitle}
        </p>
      </div>

      {/* Progress */}
      {!isComplete && fill > 0 && (
        <div style={{ padding: '14px 20px 0' }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 6,
          }}>
            <span style={{ ...eyebrowStyle }}>Progress</span>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color,
            }}>
              {fill}%{progressDetail ? ` · ${progressDetail}` : ''}
            </span>
          </div>
          <div style={{
            height: 4,
            background: 'var(--lf-cream-deep)',
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            <motion.div
              style={{ height: '100%', background: color, borderRadius: 4 }}
              initial={{ width: 0 }}
              animate={{ width: `${fill}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      )}

      {/* Do this next box */}
      {step.action && (
        <div style={{ padding: '14px 20px 0' }}>
          <div style={{
            background: 'var(--lf-cream)',
            border: '1px solid var(--lf-rule)',
            borderRadius: 10,
            padding: '12px 14px',
          }}>
            <p style={{ ...eyebrowStyle, marginBottom: 5 }}>Do this next</p>
            <p style={{ fontSize: 13, color: 'var(--lf-ink)', lineHeight: 1.5, margin: 0 }}>
              {step.action}
            </p>
            {progressDetail && isComplete && (
              <p style={{ fontSize: 12, color: 'var(--lf-muted)', marginTop: 4, margin: '4px 0 0' }}>
                {progressDetail}
              </p>
            )}
          </div>
        </div>
      )}

      {step.detail && (
        <div style={{ padding: '10px 20px 0' }}>
          <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.55, margin: 0 }}>
            {step.detail}
          </p>
        </div>
      )}

      {/* Actions */}
      <div style={{
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        borderTop: '1px solid var(--lf-rule)',
        marginTop: 16,
      }}>
        <button
          type="button"
          onClick={onAsk}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.08em',
            color: color,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Ask LasagnaFi how →
        </button>
        {!isComplete && (
          <button
            type="button"
            onClick={onSkip}
            style={{
              fontSize: 12,
              color: 'var(--lf-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {skipped ? 'Unskip' : 'Skip this step'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── WhyThisOrderCard ─────────────────────────────────────────────────────────

function WhyThisOrderCard() {
  return (
    <div style={{ ...cardStyle, padding: '18px 20px' }}>
      <p style={{ ...eyebrowStyle, marginBottom: 8 }}>Why this order?</p>
      <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.6, margin: 0 }}>
        The layers follow the proven financial waterfall: protect yourself first (insurance, emergency fund),
        capture free money (employer match), then eliminate costly debt before investing. Each layer builds
        the foundation for the next — like a proper lasagna.
      </p>
    </div>
  );
}

// ── SummaryStrip ──────────────────────────────────────────────────────────────

function SummaryStrip({ summary }: { summary: PrioritySummary }) {
  if (summary.monthlyIncome <= 0) return null;

  const items = [
    { label: 'Income', value: `${fmt(summary.monthlyIncome)}/mo`, color: undefined },
    summary.monthlyExpenses !== null
      ? { label: 'Expenses', value: `${fmt(summary.monthlyExpenses)}/mo`, color: undefined }
      : null,
    summary.monthlySurplus !== null
      ? {
          label: 'Surplus',
          value: `${fmt(summary.monthlySurplus)}/mo`,
          color: summary.monthlySurplus >= 0 ? 'var(--lf-pos)' : 'var(--lf-sauce)',
        }
      : null,
    summary.totalCash > 0 ? { label: 'Cash', value: fmt(summary.totalCash), color: undefined } : null,
    summary.totalInvested > 0 ? { label: 'Invested', value: fmt(summary.totalInvested), color: undefined } : null,
    summary.totalHighInterestDebt > 0
      ? { label: 'High-rate debt', value: fmt(summary.totalHighInterestDebt), color: 'var(--lf-sauce)' }
      : null,
  ].filter(Boolean) as { label: string; value: string; color?: string }[];

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '12px 32px',
      padding: '14px 0',
      borderBottom: '1px solid var(--lf-rule)',
      marginBottom: 24,
    }}>
      {items.map(item => (
        <div key={item.label}>
          <p style={{ ...eyebrowStyle, marginBottom: 2 }}>{item.label}</p>
          <p style={{
            fontSize: 14,
            fontWeight: 600,
            color: item.color ?? 'var(--lf-ink)',
            fontVariantNumeric: 'tabular-nums',
            margin: 0,
          }}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── ActionsSection ────────────────────────────────────────────────────────────

function ActionsSection({
  insights,
  insightsLoading,
  activeFilter,
  setActiveFilter,
  grouped,
  dismiss,
  navigate,
  handleRefresh,
  refreshing,
  actionsRef,
}: {
  insights: ReturnType<typeof useInsights>['insights'];
  insightsLoading: boolean;
  activeFilter: string | null;
  setActiveFilter: (v: string | null) => void;
  grouped: Record<string, typeof insights>;
  dismiss: (id: string) => void;
  navigate: (path: string) => void;
  handleRefresh: () => void;
  refreshing: boolean;
  actionsRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={actionsRef} style={{ marginTop: 40 }}>
      {/* Section header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={eyebrowStyle}>Actions</span>
          {!insightsLoading && insights.length > 0 && (
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: 'var(--lf-muted)',
            }}>
              {insights.length}
            </span>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11,
            color: 'var(--lf-muted)',
            background: 'none',
            border: 'none',
            cursor: refreshing ? 'default' : 'pointer',
            padding: 0,
            opacity: refreshing ? 0.5 : 1,
          }}
        >
          <RefreshCw size={12} style={refreshing ? { animation: 'spin 1s linear infinite' } : {}} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {TYPE_FILTERS.map(f => (
          <button
            key={f.label}
            onClick={() => setActiveFilter(f.value)}
            style={{
              padding: '4px 12px',
              borderRadius: 20,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.06em',
              border: '1px solid var(--lf-rule)',
              background: activeFilter === f.value ? 'var(--lf-ink)' : 'var(--lf-paper)',
              color: activeFilter === f.value ? 'var(--lf-paper)' : 'var(--lf-muted)',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {insightsLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
          <Loader2 size={18} style={{ color: 'var(--lf-muted)', animation: 'spin 1s linear infinite' }} />
        </div>
      )}

      {/* Empty */}
      {!insightsLoading && insights.length === 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <p style={{ fontSize: 13, color: 'var(--lf-muted)', marginBottom: 8 }}>No actions yet.</p>
          <button
            onClick={handleRefresh}
            style={{
              fontSize: 12,
              color: 'var(--lf-sauce)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Generate actions →
          </button>
        </div>
      )}

      {/* Urgency groups */}
      {!insightsLoading && URGENCY_ORDER.map(urgency => {
        const items = grouped[urgency];
        if (!items?.length) return null;
        return (
          <section key={urgency} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                ...eyebrowStyle,
                color: URGENCY_COLORS[urgency],
              }}>
                {URGENCY_LABELS[urgency]}
              </span>
              <span style={{ ...eyebrowStyle, color: 'var(--lf-muted)' }}>({items.length})</span>
            </div>
            <div style={{
              ...cardStyle,
              overflow: 'hidden',
              padding: '0 4px',
            }}>
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
  );
}

// ── AllLayersAccordion ────────────────────────────────────────────────────────

function AllLayersAccordion({ steps, currentStepId, skippedStepIds, onSkip, onAsk }: {
  steps: PriorityStep[];
  currentStepId: string;
  skippedStepIds: Set<string>;
  onSkip: (id: string) => void;
  onAsk: (step: PriorityStep) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(currentStepId);

  return (
    <div style={{ ...cardStyle, overflow: 'hidden' }}>
      {steps.map((step, i) => {
        const isCurrent = step.id === currentStepId;
        const isComplete = step.status === 'complete';
        const isSkipped = skippedStepIds.has(step.id);
        const isFuture = !isComplete && !isCurrent && !isSkipped;
        const color = layerColor(step.order);
        const isOpen = openId === step.id;
        const fill = isComplete ? 100 : isFuture ? 0 : Math.min(step.progress, 100);

        return (
          <div
            key={step.id}
            style={{
              borderBottom: i < steps.length - 1 ? '1px solid var(--lf-rule)' : 'none',
              position: 'relative',
              opacity: isFuture || isSkipped ? 0.6 : 1,
            }}
          >
            {/* Left accent */}
            <div style={{
              position: 'absolute',
              top: 0, bottom: 0, left: 0,
              width: 3,
              background: isSkipped ? 'var(--lf-rule)' : color,
              borderRadius: '0 2px 2px 0',
            }} />

            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : step.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 16px 11px 20px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{
                ...eyebrowStyle,
                fontSize: 10,
                color: isSkipped ? 'var(--lf-muted)' : color,
                minWidth: 20,
                flexShrink: 0,
              }}>
                {String(step.order).padStart(2, '0')}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: 13,
                  fontWeight: isCurrent ? 600 : 500,
                  color: isSkipped ? 'var(--lf-muted)' : isFuture ? 'var(--lf-ink-soft)' : 'var(--lf-ink)',
                  textDecoration: isSkipped ? 'line-through' : 'none',
                  margin: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {step.title}
                </p>
                {!isOpen && (
                  <p style={{
                    fontSize: 11,
                    color: 'var(--lf-muted)',
                    margin: '1px 0 0',
                  }}>
                    {step.subtitle}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {isSkipped && (
                  <span style={{
                    ...eyebrowStyle,
                    fontSize: 9,
                    background: 'var(--lf-cream-deep)',
                    padding: '2px 6px',
                    borderRadius: 20,
                  }}>
                    Skipped
                  </span>
                )}
                {!isSkipped && (
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 10,
                    color: isFuture ? 'var(--lf-muted)' : color,
                  }}>
                    {isFuture ? '—' : `${Math.round(fill)}%`}
                  </span>
                )}
                <ChevronDown
                  size={14}
                  style={{
                    color: 'var(--lf-muted)',
                    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                  }}
                />
              </div>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{ padding: '4px 20px 16px 44px' }}>
                    {isCurrent && fill > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ height: 3, background: 'var(--lf-cream-deep)', borderRadius: 3, overflow: 'hidden' }}>
                          <motion.div
                            style={{ height: '100%', background: color, borderRadius: 3 }}
                            initial={{ width: 0 }}
                            animate={{ width: `${fill}%` }}
                            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                          />
                        </div>
                      </div>
                    )}
                    {step.detail && (
                      <p style={{ fontSize: 12, color: 'var(--lf-ink-soft)', lineHeight: 1.55, margin: '0 0 10px' }}>
                        {step.detail}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => onAsk(step)}
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 10,
                          letterSpacing: '0.08em',
                          color,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        Ask LasagnaFi →
                      </button>
                      {!isComplete && (
                        <button
                          type="button"
                          onClick={() => onSkip(step.id)}
                          style={{
                            fontSize: 11,
                            color: 'var(--lf-muted)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                          }}
                        >
                          {isSkipped ? 'Unskip' : 'Skip'}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
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
        // Initialise skipped steps from server state
        const serverSkipped = d.steps.filter(s => s.skipped).map(s => s.id);
        if (serverSkipped.length) setSkippedStepIds(new Set(serverSkipped));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // ── loading ──
  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={20} style={{ color: 'var(--lf-muted)', animation: 'spin 1s linear infinite' }} />
    </div>
  );

  // ── error ──
  if (error) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <AlertCircle size={28} style={{ color: 'var(--lf-sauce)', margin: '0 auto 8px' }} />
        <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)' }}>{error}</p>
      </div>
    </div>
  );

  if (!data) return null;

  const { steps, currentStepId, summary } = data;

  // ── no data empty state ──
  const hasNoData = summary.monthlyIncome === 0 && summary.totalCash === 0 && summary.totalInvested === 0;
  if (hasNoData) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ textAlign: 'center', maxWidth: 360 }}
      >
        <Rocket size={36} style={{ color: 'var(--lf-muted)', margin: '0 auto 16px' }} />
        <h2 style={{ ...serifStyle, fontSize: 24, color: 'var(--lf-ink)', marginBottom: 8 }}>
          Let's build your plan
        </h2>
        <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', marginBottom: 24, lineHeight: 1.6 }}>
          Add your income and accounts to see your personalized priority layers.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <a
            href="/onboarding"
            style={{
              padding: '9px 18px',
              background: 'var(--lf-ink)',
              color: 'var(--lf-paper)',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 10,
              textDecoration: 'none',
            }}
          >
            Get Started
          </a>
          <a
            href="/accounts"
            style={{
              padding: '9px 18px',
              border: '1px solid var(--lf-rule)',
              color: 'var(--lf-ink-soft)',
              fontSize: 13,
              borderRadius: 10,
              textDecoration: 'none',
              background: 'var(--lf-paper)',
            }}
          >
            Link Account
          </a>
        </div>
      </motion.div>
    </div>
  );

  const completeCount = steps.filter(s => s.status === 'complete').length;
  const currentStep = steps.find(s => s.id === currentStepId) ?? steps[0];

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '28px 24px 48px',
      maxWidth: 1100,
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box',
    }}>

      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: 4 }}
      >
        <p style={eyebrowStyle}>Financial priorities · waterfall</p>
        <h1 style={{
          ...serifStyle,
          fontSize: 30,
          fontWeight: 400,
          color: 'var(--lf-ink)',
          margin: '6px 0 4px',
          lineHeight: 1.2,
        }}>
          Your{' '}
          <em style={{ color: 'var(--lf-sauce)', fontStyle: 'italic' }}>
            lasagna, layer by layer.
          </em>
        </h1>
        <p style={{ fontSize: 13, color: 'var(--lf-muted)', margin: 0 }}>
          {completeCount} of {steps.length} layers complete
          {summary.retirementAge ? ` · FI target age ${summary.retirementAge}` : ''}
        </p>
      </motion.div>

      {/* ── Summary strip ── */}
      <SummaryStrip summary={summary} />

      {/* ── Two-column grid ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
        gap: 20,
        alignItems: 'start',
      }}>

        {/* LEFT: The stack */}
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
        >
          <div style={{ ...cardStyle, padding: '20px 20px 24px' }}>
            <p style={{ ...eyebrowStyle, marginBottom: 16 }}>The stack</p>
            <LayersVisual
              steps={steps}
              currentStepId={currentStepId}
              skippedStepIds={skippedStepIds}
            />
          </div>

          {/* Accordion of all layers below the visual on larger screens */}
          <div style={{ marginTop: 16 }}>
            <p style={{ ...eyebrowStyle, marginBottom: 10 }}>All layers</p>
            <AllLayersAccordion
              steps={steps}
              currentStepId={currentStepId}
              skippedStepIds={skippedStepIds}
              onSkip={handleSkipStep}
              onAsk={(step) => openChat(`Tell me about this financial step: "${step.title}". ${step.subtitle}`)}
            />
          </div>
        </motion.div>

        {/* RIGHT: Focus + Why */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {currentStep && (
            <CurrentFocusCard
              step={currentStep}
              skipped={skippedStepIds.has(currentStep.id)}
              onSkip={() => handleSkipStep(currentStep.id)}
              onAsk={() => openChat(`Tell me about this financial step: "${currentStep.title}". ${currentStep.subtitle}`)}
            />
          )}
          <WhyThisOrderCard />
        </motion.div>
      </div>

      {/* ── Actions / Insights ── */}
      <ActionsSection
        insights={insights}
        insightsLoading={insightsLoading}
        activeFilter={activeFilter}
        setActiveFilter={setActiveFilter}
        grouped={grouped}
        dismiss={dismiss}
        navigate={navigate}
        handleRefresh={handleRefresh}
        refreshing={refreshing}
        actionsRef={actionsRef}
      />
    </div>
  );
}
