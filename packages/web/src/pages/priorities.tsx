import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';
import {
  Shield, Gift, Flame, HeartPulse, Sprout,
  TrendingUp, CreditCard, Rocket,
  Loader2, AlertCircle, ChevronDown,
} from 'lucide-react';
import { api } from '../lib/api';
import { useChatStore } from '../lib/chat-store';
import type { LucideIcon } from 'lucide-react';

// ── constants ────────────────────────────────────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  shield: Shield, gift: Gift, flame: Flame, 'heart-pulse': HeartPulse,
  sprout: Sprout, 'trending-up': TrendingUp, 'credit-card': CreditCard, rocket: Rocket,
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
  fontSize: 13,
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
              fontSize: 13,
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
            <p style={{ ...eyebrowStyle, marginBottom: 5 }}>Next step</p>
            <p style={{ fontSize: 13, color: 'var(--lf-ink)', lineHeight: 1.5, margin: 0 }}>
              {step.action}
            </p>
            {progressDetail && isComplete && (
              <p style={{ fontSize: 13, color: 'var(--lf-muted)', marginTop: 4, margin: '4px 0 0' }}>
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
            fontSize: 13,
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
              fontSize: 13,
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
                fontSize: 13,
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
                    fontSize: 13,
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
                    fontSize: 13,
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
                    fontSize: 13,
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
                      <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.55, margin: '0 0 10px' }}>
                        {step.detail}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => onAsk(step)}
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 13,
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
                            fontSize: 13,
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
  const [skippedStepIds, setSkippedStepIds] = useState<Set<string>>(new Set());
  const { openChat } = useChatStore();

  const handleSkipStep = async (stepId: string) => {
    const isCurrentlySkipped = skippedStepIds.has(stepId);
    setSkippedStepIds(prev => {
      const next = new Set(prev);
      isCurrentlySkipped ? next.delete(stepId) : next.add(stepId);
      return next;
    });
    try {
      await api.skipPriorityStep(stepId, !isCurrentlySkipped);
    } catch {
      setSkippedStepIds(prev => {
        const next = new Set(prev);
        isCurrentlySkipped ? next.add(stepId) : next.delete(stepId);
        return next;
      });
    }
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
      padding: 'clamp(16px, 4vw, 28px)',
      paddingBottom: 'clamp(80px, 12vw, 48px)',
      maxWidth: 1100,
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box',
    }}>
      <style>{`
        @media (max-width: 640px) {
          .prio-main-grid { grid-template-columns: 1fr !important; }
          .prio-hero-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ marginBottom: 24 }}
      >
        <p style={eyebrowStyle}>Financial priorities · waterfall</p>
        <h1 style={{
          ...serifStyle,
          fontSize: 30,
          fontWeight: 400,
          color: 'var(--lf-ink)',
          margin: '6px 0 0',
          lineHeight: 1.2,
        }}>
          Your{' '}
          <em style={{ color: 'var(--lf-sauce)', fontStyle: 'italic' }}>
            lasagna, layer by layer.
          </em>
        </h1>
      </motion.div>

      {/* ── Dark Hero — Priority Overview ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.4 }}
        style={{
          background: 'var(--lf-ink)', color: 'var(--lf-paper)',
          borderRadius: 14, padding: 'clamp(20px, 4vw, 32px)', marginBottom: 24,
        }}
      >
        <div className="prio-hero-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.6fr) repeat(3, minmax(80px, 1fr))', gap: 24, alignItems: 'end' }}>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>
              Priority waterfall
            </div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 64, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lf-paper)' }}>
              {completeCount}<span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 32, color: '#D4C6B0' }}> / {steps.length}</span>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-cheese)', marginTop: 10 }}>
              layers complete{summary.retirementAge ? ` · FI target age ${summary.retirementAge}` : ''}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>Monthly income</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, letterSpacing: '-0.02em', color: 'var(--lf-paper)' }}>
              {summary.monthlyIncome > 0 ? fmt(summary.monthlyIncome) : '—'}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 6 }}>per month</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>Surplus</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, letterSpacing: '-0.02em', color: summary.monthlySurplus !== null ? (summary.monthlySurplus >= 0 ? '#9FD18E' : '#E89070') : '#D4C6B0' }}>
              {summary.monthlySurplus !== null ? fmt(summary.monthlySurplus) : '—'}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 6 }}>per month</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--lf-cheese)', marginBottom: 6 }}>Invested</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, letterSpacing: '-0.02em', color: 'var(--lf-paper)' }}>
              {summary.totalInvested > 0 ? fmt(summary.totalInvested) : summary.totalCash > 0 ? fmt(summary.totalCash) : '—'}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 6 }}>
              {summary.totalInvested > 0 ? 'total portfolio' : summary.totalCash > 0 ? 'cash holdings' : 'link accounts'}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Two-column grid ── */}
      <div className="prio-main-grid" style={{
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
          <div style={{ marginTop: 0 }}>
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

    </div>
  );
}
