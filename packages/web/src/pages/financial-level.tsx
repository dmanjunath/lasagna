import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, Gift, Flame, HeartPulse, Sprout,
  TrendingUp, CreditCard, Rocket,
  AlertCircle,
  PiggyBank, Landmark, Layers,
} from 'lucide-react';
import { api } from '../lib/api';
import { useChatStore } from '../lib/chat-store';
import type { LucideIcon } from 'lucide-react';

// ── constants ────────────────────────────────────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  shield: Shield, gift: Gift, flame: Flame, 'heart-pulse': HeartPulse,
  sprout: Sprout, 'trending-up': TrendingUp, 'credit-card': CreditCard, rocket: Rocket,
  'alert-circle': AlertCircle, 'piggy-bank': PiggyBank, landmark: Landmark, layers: Layers,
};

// ── layer color map ──────────────────────────────────────────────────────────

// Red → green gradient across 12 layers
const LAYER_COLORS = [
  { bg: '#B83B3B', text: '#fff' },     // 1  - deep red
  { bg: '#C25030', text: '#fff' },     // 2  - red-orange
  { bg: '#C46425', text: '#fff' },     // 3  - burnt orange
  { bg: '#B87A1E', text: '#fff' },     // 4  - amber
  { bg: '#8B7A22', text: '#fff' },     // 5  - dark gold
  { bg: '#5E7A28', text: '#fff' },     // 6  - olive
  { bg: '#3D7A35',  text: '#fff' },    // 7  - forest green
  { bg: '#2D7040', text: '#fff' },     // 8  - green
  { bg: '#25664A', text: '#fff' },     // 9  - teal-green
  { bg: '#1E5C50', text: '#fff' },     // 10 - dark teal
  { bg: '#185248', text: '#fff' },     // 11 - deep teal
  { bg: '#134840', text: '#fff' },     // 12 - darkest green
];

function layerColor(order: number): string {
  return LAYER_COLORS[order - 1]?.bg ?? '#7A5C3F';
}


// ── types ────────────────────────────────────────────────────────────────────

interface PriorityStep {
  id: string; order: number; title: string; subtitle: string;
  description: string;
  icon: string; status: string; current: number | null;
  target: number | null; progress: number;
  action: string; detail: string; priority: string;
  skipped: boolean;
  note: string;
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

// ── StepDetailPanel ──────────────────────────────────────────────────────────

function isAutoTracked(step: PriorityStep): boolean {
  return step.target !== null;
}

function StepDetailPanel({ step, onSkip, onAsk, onComplete, onUndoComplete, skipped }: {
  step: PriorityStep;
  onSkip: () => void;
  onAsk: () => void;
  onComplete: (id: string, note: string) => void;
  onUndoComplete: (id: string) => void;
  skipped: boolean;
}) {
  const [pendingDone, setPendingDone] = useState(false);
  const [noteText, setNoteText] = useState('');
  const color = layerColor(step.order);
  const isComplete = step.status === 'complete';
  const fill = isComplete ? 100 : Math.min(step.progress, 100);

  let progressDetail = '';
  if (step.target !== null && step.current !== null) {
    if (step.target === 0)               progressDetail = 'Goal: $0';
    else if (isComplete)                 progressDetail = fmt(step.current) + ' saved';
    else if (step.target > step.current) progressDetail = fmt(step.target - step.current) + ' to go';
    else                                 progressDetail = fmt(step.current) + ' saved';
  }

  const hasProgress = !isComplete && fill > 0;
  const panelBorder = isComplete
    ? '1px solid rgba(90,158,111,0.5)'
    : hasProgress
    ? '1px solid rgba(200,160,60,0.45)'
    : '1px solid var(--lf-rule)';
  const panelBg = isComplete
    ? 'rgba(90,158,111,0.1)'
    : hasProgress
    ? 'rgba(200,160,60,0.08)'
    : 'var(--lf-paper)';

  return (
    <div style={{ ...cardStyle, overflow: 'hidden', border: panelBorder, background: panelBg }}>
      {/* Eyebrow */}
      <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={eyebrowStyle}>
          Layer {String(step.order).padStart(2, '0')}{isComplete ? ' · Complete' : hasProgress ? ' · In Progress' : ''}
        </span>
      </div>

      {/* Title */}
      <div style={{ padding: '10px 20px 0' }}>
        <h2 style={{
          ...serifStyle,
          fontSize: 20,
          fontWeight: 400,
          color: 'var(--lf-ink)',
          lineHeight: 1.25,
          margin: 0,
        }}>
          {step.title}
        </h2>
      </div>

      {/* Description */}
      {step.description && (
        <div style={{ padding: '12px 20px 0' }}>
          <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.65, margin: 0 }}>
            {step.description}
          </p>
        </div>
      )}

      {/* Progress */}
      {!isComplete && fill > 0 && (
        <div style={{ padding: '14px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={eyebrowStyle}>Progress</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color }}>
              {fill}%{progressDetail ? ` · ${progressDetail}` : ''}
            </span>
          </div>
          <div style={{ height: 4, background: 'var(--lf-cream-deep)', borderRadius: 4, overflow: 'hidden' }}>
            <motion.div
              style={{ height: '100%', background: color, borderRadius: 4 }}
              initial={{ width: 0 }}
              animate={{ width: `${fill}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      )}

      {/* Action */}
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
          </div>
        </div>
      )}

      {/* Your note (for completed steps) */}
      {step.status === 'complete' && step.note && (
        <div style={{ padding: '12px 20px 0' }}>
          <p style={{ ...eyebrowStyle, marginBottom: 4 }}>Your note</p>
          <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>
            "{step.note}"
          </p>
        </div>
      )}

      {/* Actions */}
      <div style={{
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        borderTop: '1px solid var(--lf-rule)',
        marginTop: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button type="button" onClick={onAsk} style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            letterSpacing: '0.08em',
            color,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}>
            Walk me through this →
          </button>
          {!isComplete && !isAutoTracked(step) && !pendingDone && (
            <button type="button" onClick={() => setPendingDone(true)} style={{
              fontSize: 13,
              color: 'var(--lf-ink)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}>
              Mark done
            </button>
          )}
          {isComplete && !isAutoTracked(step) && (
            <button type="button" onClick={() => onUndoComplete(step.id)} style={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.08em',
              color: 'var(--lf-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}>
              Undo
            </button>
          )}
          {!isComplete && (
            <button type="button" onClick={onSkip} style={{
              fontSize: 13,
              color: 'var(--lf-muted)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}>
              {skipped ? 'Unskip' : 'Skip this step'}
            </button>
          )}
        </div>
        {!isComplete && !isAutoTracked(step) && pendingDone && (
          <div style={{ width: '100%' }}>
            <textarea
              autoFocus
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Add a note (optional) — e.g. 'Got Geico quote, saved $340/year'"
              rows={2}
              style={{
                width: '100%',
                fontSize: 13,
                fontFamily: 'inherit',
                color: 'var(--lf-ink)',
                background: 'var(--lf-cream)',
                border: '1px solid var(--lf-rule)',
                borderRadius: 8,
                padding: '8px 10px',
                resize: 'vertical',
                boxSizing: 'border-box',
                outline: 'none',
                lineHeight: 1.5,
                marginBottom: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => {
                  onComplete(step.id, noteText);
                  setPendingDone(false);
                  setNoteText('');
                }}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--lf-paper)',
                  background: 'var(--lf-pos, #5A9E6F)',
                  border: 'none',
                  borderRadius: 6,
                  padding: '5px 14px',
                  cursor: 'pointer',
                }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setPendingDone(false); setNoteText(''); }}
                style={{
                  fontSize: 13,
                  color: 'var(--lf-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── WhyThisOrderCard ─────────────────────────────────────────────────────────

function WhyThisOrderPopover() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          ...eyebrowStyle,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          color: 'var(--lf-muted)',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textUnderlineOffset: '3px',
        }}
      >
        Why this order?
      </button>
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 49 }}
          />
          {/* Popover */}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 8,
            zIndex: 50,
            width: 360,
            ...cardStyle,
            padding: '18px 20px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
          }}>
            <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.7, margin: '0 0 10px' }}>
              Each layer builds on the one below it. Skip ahead and you risk undoing your own progress —
              paying off debt while overdraft fees eat your checking account, or investing while 22% APR
              credit cards compound against you.
            </p>
            <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.7, margin: '0 0 10px' }}>
              The order follows one rule: <strong style={{ color: 'var(--lf-ink)' }}>do the thing with the highest guaranteed
              return first.</strong> Employer match (100% instant return) beats emergency fund (loss prevention)
              beats investing (7–10% expected). Paying off 22% debt is a guaranteed 22% return — no
              stock market year consistently beats that.
            </p>
            <p style={{ fontSize: 13, color: 'var(--lf-ink-soft)', lineHeight: 1.7, margin: 0 }}>
              The layers are the same for everyone. What changes is where you start and how fast you move.
            </p>
          </div>
        </>
      )}
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

// ── StepList ──────────────────────────────────────────────────────────────────

function StepList({ steps, currentStepId, skippedStepIds, onSelect, selectedStepId }: {
  steps: PriorityStep[];
  currentStepId: string;
  skippedStepIds: Set<string>;
  onSelect: (id: string) => void;
  selectedStepId: string | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map((step) => {
        const isCurrent = step.id === currentStepId;
        const isComplete = step.status === 'complete';
        const isSkipped = skippedStepIds.has(step.id);
        const isFuture = !isComplete && !isCurrent && !isSkipped;
        const color = layerColor(step.order);
        const isSelected = selectedStepId === step.id;

        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onSelect(step.id)}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: isCurrent ? '16px 18px' : '12px 18px',
              background: isSkipped ? 'var(--lf-cream-deep)' : color,
              border: isSelected ? '2px solid var(--lf-ink)' : '2px solid transparent',
              borderRadius: 12,
              cursor: 'pointer',
              textAlign: 'left',
              opacity: isFuture ? 0.55 : isSkipped ? 0.5 : 1,
              boxShadow: isCurrent
                ? `0 0 0 2px ${color}, 0 4px 20px -4px rgba(0,0,0,0.3)`
                : '0 1px 0 rgba(0,0,0,0.04), 0 8px 16px -12px rgba(31,26,22,0.2)',
              transition: 'transform 0.2s ease, opacity 0.2s ease',
              transform: isCurrent ? 'scale(1.02)' : 'scale(1)',
              overflow: 'hidden',
            }}
          >
            {/* Completed overlay — subtle lightening to distinguish from active layers */}
            {isComplete && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(255,255,255,0.15)',
                pointerEvents: 'none',
              }} />
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, position: 'relative' }}>
              {/* Order number — always shown */}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: isSkipped ? 'var(--lf-muted)' : 'rgba(251,246,236,0.7)',
                flexShrink: 0,
                minWidth: 16,
              }}>
                {String(step.order).padStart(2, '0')}
              </span>

              {/* Title */}
              <span style={{
                fontSize: 13,
                fontWeight: 500,
                color: isSkipped ? 'var(--lf-muted)' : '#FBF6EC',
                textDecoration: isSkipped ? 'line-through' : 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {step.title}
              </span>
            </div>

            {/* Right side */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, position: 'relative' }}>
              {isComplete && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: '#FBF6EC',
                  background: 'rgba(255,255,255,0.2)',
                  padding: '2px 8px',
                  borderRadius: 20,
                  textTransform: 'uppercase',
                }}>
                  Done
                </span>
              )}
              {isSkipped && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: 'var(--lf-muted)',
                  textTransform: 'uppercase',
                }}>
                  Skipped
                </span>
              )}
              {isCurrent && (
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: '#FBF6EC',
                  background: 'rgba(255,255,255,0.2)',
                  padding: '2px 8px',
                  borderRadius: 20,
                  textTransform: 'uppercase',
                }}>
                  You are here
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Financial Level ───────────────────────────────────────────────────────────

export function FinancialLevel() {
  const [data, setData]       = useState<PriorityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [skippedStepIds, setSkippedStepIds] = useState<Set<string>>(new Set());
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const { openChat } = useChatStore();

  const handleSkipStep = async (stepId: string) => {
    const isCurrentlySkipped = skippedStepIds.has(stepId);
    setSkippedStepIds(prev => {
      const next = new Set(prev);
      if (isCurrentlySkipped) { next.delete(stepId); } else { next.add(stepId); }
      return next;
    });
    try {
      await api.skipPriorityStep(stepId, !isCurrentlySkipped);
    } catch {
      setSkippedStepIds(prev => {
        const next = new Set(prev);
        if (isCurrentlySkipped) { next.add(stepId); } else { next.delete(stepId); }
        return next;
      });
    }
  };

  const handleCompleteStep = async (stepId: string, note: string = '') => {
    try {
      await api.completePriorityStep(stepId, true, note);
      const d = await api.getPriorities();
      setData(d);
    } catch {
      // ignore
    }
  };

  const handleUndoComplete = async (stepId: string) => {
    try {
      await api.completePriorityStep(stepId, false, '');
      const d = await api.getPriorities();
      setData(d);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    api.getPriorities()
      .then(d => {
        setData(d);
        setSelectedStepId(d.currentStepId);
        // Initialise skipped steps from server state
        const serverSkipped = d.steps.filter(s => s.skipped).map(s => s.id);
        if (serverSkipped.length) setSkippedStepIds(new Set(serverSkipped));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // ── loading ──
  if (loading) return null;

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
  const selectedStep = steps.find(s => s.id === selectedStepId) ?? steps.find(s => s.id === currentStepId) ?? steps[0];

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: 'clamp(16px, 4vw, 40px)',
      paddingBottom: 'clamp(80px, 12vw, 48px)',
      maxWidth: 1100,
      margin: '0 auto',
      width: '100%',
      boxSizing: 'border-box',
    }}>
      <style>{`
        @media (max-width: 860px) {
          .prio-main-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
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
        <h1 style={{
          ...serifStyle,
          fontSize: 36,
          fontWeight: 400,
          color: 'var(--lf-ink)',
          margin: 0,
          lineHeight: 1.1,
        }}>
          Financial Level
        </h1>
        <p style={{ ...eyebrowStyle, marginTop: 6 }}>{completeCount} of {steps.length} complete</p>
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
              Financial level
            </div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 64, letterSpacing: '-0.03em', lineHeight: 1, color: 'var(--lf-paper)' }}>
              {completeCount}<span style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 32, color: '#D4C6B0' }}> / {steps.length}</span>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--lf-cheese)', marginTop: 10 }}>
              levels complete{summary.retirementAge ? ` · FI target age ${summary.retirementAge}` : ''}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <p style={{ ...eyebrowStyle, margin: 0 }}>Your Financial Level</p>
              <WhyThisOrderPopover />
            </div>
            <StepList
              steps={steps}
              currentStepId={currentStepId}
              skippedStepIds={skippedStepIds}
              selectedStepId={selectedStepId}
              onSelect={(id) => setSelectedStepId(id)}
            />
          </div>
        </motion.div>

        {/* RIGHT: Detail + Why */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {selectedStep && (
            <StepDetailPanel
              step={selectedStep}
              skipped={skippedStepIds.has(selectedStep.id)}
              onSkip={() => handleSkipStep(selectedStep.id)}
              onComplete={handleCompleteStep}
              onUndoComplete={handleUndoComplete}
              onAsk={() => openChat(
                `Help me with this financial step:\n\nTitle: ${selectedStep.title}\nDescription: ${selectedStep.description || selectedStep.subtitle}\n\nWhat exactly should I do, and why does it matter for my finances?`
              )}
            />
          )}
        </motion.div>
      </div>

    </div>
  );
}
