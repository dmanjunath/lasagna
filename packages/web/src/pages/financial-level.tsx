import { useState, useEffect } from 'react';
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
import {
  Page,
  Section,
  Button,
  Pill,
  Eyebrow,
  EmptyState,
  StatStrip,
} from '../components/ds';

// ── constants ────────────────────────────────────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  shield: Shield, gift: Gift, flame: Flame, 'heart-pulse': HeartPulse,
  sprout: Sprout, 'trending-up': TrendingUp, 'credit-card': CreditCard, rocket: Rocket,
  'alert-circle': AlertCircle, 'piggy-bank': PiggyBank, landmark: Landmark, layers: Layers,
};

// Whimsy: 12-step earth ramp from sauce (urgent base layers) → basil (FI).
// Each level gets a distinct color so the journey reads as a literal climb.
const LEVEL_COLORS = [
  '#B83B3B', '#C25030', '#C46425', '#B87A1E', '#8B7A22', '#5E7A28',
  '#3D7A35', '#2D7040', '#25664A', '#1E5C50', '#185248', '#134840',
];
const levelColor = (order: number) => LEVEL_COLORS[Math.min(LEVEL_COLORS.length, Math.max(1, order)) - 1] ?? '#7A5C3F';
const withAlpha = (hex: string, a: number) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
};

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

function isAutoTracked(step: PriorityStep): boolean {
  return step.target !== null;
}

// ── WhyThisOrderPopover ──────────────────────────────────────────────────────

function WhyThisOrderPopover() {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          font: 'inherit',
          fontSize: 12,
          color: 'var(--lf-muted)',
          textDecoration: 'underline',
          textUnderlineOffset: 3,
          cursor: 'pointer',
        }}
      >
        Why this order? ⓘ
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 49 }}
          />
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            zIndex: 50,
            width: 360,
            background: 'var(--lf-paper)',
            border: '1px solid var(--lf-rule)',
            borderRadius: 14,
            padding: '18px 20px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
          }}>
            <Eyebrow style={{ marginBottom: 10 }}>Why this order</Eyebrow>
            <p className="ds-body ds-body--sm" style={{ marginBottom: 10 }}>
              Each layer builds on the one below it. Skip ahead and you risk undoing your own progress —
              paying off debt while overdraft fees eat your checking account, or investing while 22% APR
              credit cards compound against you.
            </p>
            <p className="ds-body ds-body--sm" style={{ marginBottom: 10 }}>
              The order follows one rule: <strong style={{ color: 'var(--lf-ink)' }}>do the thing with the highest guaranteed
              return first.</strong> Employer match (100% instant return) beats emergency fund (loss prevention)
              beats investing (7–10% expected). Paying off 22% debt is a guaranteed 22% return — no
              stock market year consistently beats that.
            </p>
            <p className="ds-body ds-body--sm" style={{ margin: 0 }}>
              The layers are the same for everyone. What changes is where you start and how fast you move.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── LevelRow — editorial row, hairline separated ─────────────────────────────

function LevelRow({ step, isCurrent, isComplete, isSkipped, isSelected, onSelect }: {
  step: PriorityStep;
  isCurrent: boolean;
  isComplete: boolean;
  isSkipped: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const fill = isComplete ? 100 : Math.min(step.progress, 100);
  const isFuture = !isComplete && !isCurrent && !isSkipped;
  const Icon = iconMap[step.icon] ?? Layers;
  const color = levelColor(step.order);

  const pillTone: 'basil' | 'cheese' | 'ghost' | undefined =
    isComplete ? 'basil' :
    isCurrent ? 'cheese' :
    isSkipped ? 'ghost' :
    undefined;
  const pillLabel = isComplete ? 'Done' : isCurrent ? 'You are here' : isSkipped ? 'Skipped' : null;

  return (
    <li
      className={`fl-row ${isCurrent ? 'is-current' : ''} ${isSelected && !isCurrent ? 'is-selected' : ''}`}
      style={{
        opacity: isFuture ? 0.78 : isSkipped ? 0.5 : 1,
        ['--level-color' as any]: color,
      }}
    >
      <button type="button" onClick={onSelect} className="fl-row__btn">
        <span className="fl-row__chip" aria-hidden="true">
          {String(step.order).padStart(2, '0')}
        </span>
        <span className="fl-row__icon" style={{ background: withAlpha(color, 0.12) }}>
          <Icon size={14} style={{ color }} />
        </span>
        <span className="fl-row__body">
          <span
            className="fl-row__title"
            style={{ textDecoration: isSkipped ? 'line-through' : 'none' }}
          >
            {step.title}
          </span>
          {!isComplete && !isSkipped && fill > 0 && (
            <span className="fl-row__progress">
              <span style={{ width: `${fill}%`, background: color }} />
            </span>
          )}
        </span>
        {pillLabel && pillTone && <Pill tone={pillTone}>{pillLabel}</Pill>}
      </button>
    </li>
  );
}

// ── FocusArticle — the selected level, rendered as editorial article ─────────

function FocusArticle({ step, skipped, onSkip, onAsk, onComplete, onUndoComplete }: {
  step: PriorityStep;
  skipped: boolean;
  onSkip: () => void;
  onAsk: () => void;
  onComplete: (id: string, note: string) => void;
  onUndoComplete: (id: string) => void;
}) {
  const [pendingDone, setPendingDone] = useState(false);
  const [noteText, setNoteText] = useState('');
  const isComplete = step.status === 'complete';
  const fill = isComplete ? 100 : Math.min(step.progress, 100);
  const Icon = iconMap[step.icon] ?? Layers;

  let progressDetail = '';
  if (step.target !== null && step.current !== null) {
    if (step.target === 0) progressDetail = 'Goal: $0';
    else if (isComplete) progressDetail = fmt(step.current) + ' saved';
    else if (step.target > step.current) progressDetail = fmt(step.target - step.current) + ' to go';
    else progressDetail = fmt(step.current) + ' saved';
  }
  const hasProgress = !isComplete && fill > 0;
  const color = levelColor(step.order);

  return (
    <article className="fl-focus" style={{ ['--level-color' as any]: color, borderTopColor: color }}>
      <div className="fl-focus__head">
        <span
          className="fl-focus__chip"
          aria-hidden="true"
          style={{ background: color, color: 'var(--lf-paper)' }}
        >
          L{String(step.order).padStart(2, '0')}
        </span>
        <span className="fl-focus__icon" aria-hidden="true" style={{ background: withAlpha(color, 0.14) }}>
          <Icon size={16} style={{ color }} />
        </span>
        {isComplete && <Pill tone="basil">Complete</Pill>}
        {!isComplete && hasProgress && <Pill tone="cheese">In progress</Pill>}
        {skipped && <Pill tone="ghost">Skipped</Pill>}
      </div>

      <h3 className="fl-focus__title">{step.title}</h3>
      {step.subtitle && <p className="fl-focus__sub">{step.subtitle}</p>}
      {step.description && <p className="fl-focus__body">{step.description}</p>}

      {hasProgress && (
        <div className="fl-focus__progress">
          <div className="fl-focus__progress-meta">
            <Eyebrow>Progress</Eyebrow>
            <span className="ds-caption ds-num">
              {fill}%{progressDetail ? ` · ${progressDetail}` : ''}
            </span>
          </div>
          <div className="fl-focus__bar">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${fill}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              style={{ background: color }}
            />
          </div>
        </div>
      )}

      {step.action && (
        <div className="fl-focus__callout">
          <Eyebrow style={{ marginBottom: 6 }}>Next step</Eyebrow>
          <p className="ds-body ds-body--sm" style={{ color: 'var(--lf-ink)', margin: 0 }}>
            {step.action}
          </p>
        </div>
      )}

      {isComplete && step.note && (
        <div style={{ marginBottom: 16 }}>
          <Eyebrow style={{ marginBottom: 4 }}>Your note</Eyebrow>
          <p className="ds-body ds-body--sm" style={{ fontStyle: 'italic', margin: 0 }}>
            "{step.note}"
          </p>
        </div>
      )}

      <div className="fl-focus__actions">
        <Button variant="ink" size="sm" onClick={onAsk}>
          Walk me through this →
        </Button>
        {!isComplete && !isAutoTracked(step) && !pendingDone && (
          <Button variant="ghost" size="sm" onClick={() => setPendingDone(true)}>
            Mark done ✓
          </Button>
        )}
        {isComplete && !isAutoTracked(step) && (
          <Button variant="link" onClick={() => onUndoComplete(step.id)}>
            Undo
          </Button>
        )}
        {!isComplete && (
          <Button variant="link" onClick={onSkip}>
            {skipped ? 'Unskip' : 'Skip this step'}
          </Button>
        )}
      </div>

      {!isComplete && !isAutoTracked(step) && pendingDone && (
        <div style={{ marginTop: 12 }}>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onComplete(step.id, noteText);
                setPendingDone(false);
                setNoteText('');
              }}
            >
              Save
            </Button>
            <Button
              variant="link"
              onClick={() => { setPendingDone(false); setNoteText(''); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

// ── AllCompleteView ──────────────────────────────────────────────────────────

function AllCompleteView({ onAsk }: { onAsk: () => void }) {
  return (
    <EmptyState
      icon={<Rocket size={32} />}
      title="All levels complete"
      body="You've worked through every layer of the financial level stack. Time to fine-tune your plan — ask Lasagna what's next."
      cta={<Button variant="ink" onClick={onAsk}>Ask what's next →</Button>}
    />
  );
}

// ── Financial Level ──────────────────────────────────────────────────────────

export function FinancialLevel() {
  const [data, setData] = useState<PriorityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
        const serverSkipped = d.steps.filter(s => s.skipped).map(s => s.id);
        if (serverSkipped.length) setSkippedStepIds(new Set(serverSkipped));
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  if (error) return (
    <Page>
      <EmptyState
        icon={<AlertCircle size={28} />}
        title="Couldn't load your levels"
        body={error}
      />
    </Page>
  );

  if (!data) return null;

  const { steps, currentStepId, summary } = data;

  // No data empty state
  const hasNoData = summary.monthlyIncome === 0 && summary.totalCash === 0 && summary.totalInvested === 0;
  if (hasNoData) return (
    <Page>
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Financial Level</h1>
          <span className="ds-page-bar__subtitle">Get started</span>
        </div>
      </header>
      <div className="ds-page-bar__subtitle-mobile">Get started</div>
      <EmptyState
        icon={<Rocket size={32} />}
        title="Let's build your plan"
        body="Add your income and accounts to see your personalized priority levels."
        cta={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <a href="/onboarding" className="ds-btn ds-btn--ink">Get started →</a>
            <a href="/accounts" className="ds-btn ds-btn--ghost">Link account</a>
          </div>
        }
      />
    </Page>
  );

  const completeCount = steps.filter(s => s.status === 'complete').length;
  const selectedStep = steps.find(s => s.id === selectedStepId) ?? steps.find(s => s.id === currentStepId) ?? steps[0];
  const allComplete = completeCount === steps.length;
  const currentStep = steps.find(s => s.id === currentStepId) ?? steps[0];

  const surplusTone: 'pos' | 'neg' | 'default' =
    summary.monthlySurplus == null ? 'default' :
    summary.monthlySurplus >= 0 ? 'pos' : 'neg';
  const investedOrCash = summary.totalInvested > 0 ? summary.totalInvested : summary.totalCash;
  const investedLabel = summary.totalInvested > 0 ? 'total portfolio' : summary.totalCash > 0 ? 'cash holdings' : 'link accounts';

  // Iter 8: ds-page-bar replaces editorial PageHeader + Lede. The "you are on
  // Level N" line moves to the subtitle slot (truncated on mobile to just
  // progress count).
  const subtitleText = currentStep && !allComplete
    ? `Level ${currentStep.order} of 12 · ${currentStep.title}`
    : `${completeCount} of ${steps.length} complete`;
  const subtitleMobile = `${completeCount} of ${steps.length} complete`;

  return (
    <Page>
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Financial Level</h1>
          <span className="ds-page-bar__subtitle">{subtitleText}</span>
        </div>
      </header>
      <div className="ds-page-bar__subtitle-mobile">{subtitleMobile}</div>

      <StatStrip
        className="fl-stats"
        items={[
          {
            label: 'Current level',
            value: <span className="ds-num">{completeCount}/{steps.length}</span>,
            sub: summary.retirementAge ? `FI target age ${summary.retirementAge}` : 'levels complete',
          },
          {
            label: 'Monthly income',
            value: <span className="ds-num">{summary.monthlyIncome > 0 ? fmt(summary.monthlyIncome) : '—'}</span>,
            sub: 'per month',
          },
          {
            label: 'Surplus/mo',
            value: <span className="ds-num">{summary.monthlySurplus !== null ? fmt(summary.monthlySurplus) : '—'}</span>,
            sub: 'income − expenses',
            tone: surplusTone,
          },
          {
            label: summary.totalInvested > 0 ? 'Invested' : 'Cash',
            value: <span className="ds-num">{investedOrCash > 0 ? fmt(investedOrCash) : '—'}</span>,
            sub: investedLabel,
          },
        ]}
      />

      <Section
        title={allComplete ? 'All levels complete' : 'The 12 levels'}
        eyebrow={allComplete ? 'You did it' : 'Each layer builds on the one below it'}
        actions={!allComplete ? <WhyThisOrderPopover /> : undefined}
      >
        {allComplete ? (
          <AllCompleteView
            onAsk={() => openChat("I've completed all 12 financial levels. What should I focus on next?")}
          />
        ) : (
          <motion.ul
            className="fl-list"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            {steps.map((step) => (
              <LevelRow
                key={step.id}
                step={step}
                isCurrent={step.id === currentStepId}
                isComplete={step.status === 'complete'}
                isSkipped={skippedStepIds.has(step.id)}
                isSelected={selectedStepId === step.id}
                onSelect={() => setSelectedStepId(step.id)}
              />
            ))}
          </motion.ul>
        )}
      </Section>

      {!allComplete && selectedStep && (
        <Section
          title="Current focus"
          eyebrow={`Level ${selectedStep.order} · ${selectedStep.status === 'complete' ? 'Complete' : 'In play'}`}
        >
          <motion.div
            key={selectedStep.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <FocusArticle
              step={selectedStep}
              skipped={skippedStepIds.has(selectedStep.id)}
              onSkip={() => handleSkipStep(selectedStep.id)}
              onComplete={handleCompleteStep}
              onUndoComplete={handleUndoComplete}
              onAsk={() => openChat(
                `Help me with this financial step:\n\nTitle: ${selectedStep.title}\nDescription: ${selectedStep.description || selectedStep.subtitle}\n\nWhat exactly should I do, and why does it matter for my finances?`
              )}
            />
          </motion.div>
        </Section>
      )}

      {/* Page-scoped layout — no typography tokens here. */}
      <style>{`
        .fl-stats { margin: 24px 0 48px; }

        .fl-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .fl-row {
          border-top: 1px solid var(--lf-rule);
        }
        .fl-row:first-child { border-top: 1px solid var(--lf-ink); }
        .fl-row:last-child { border-bottom: 1px solid var(--lf-rule); }

        .fl-row__btn {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          min-height: 56px;
          background: none;
          border: 0;
          padding: 14px 0;
          text-align: left;
          cursor: pointer;
          color: inherit;
          transition: color 0.15s;
        }
        /* Only the current step gets the cream extension — unifies with the "You are here" pill. */
        .fl-row.is-current .fl-row__btn { background: var(--lf-cream); padding-left: 12px; padding-right: 12px; }
        /* A non-current row that's been clicked to inspect uses a subtle inset rule, not the cream fill. */
        .fl-row.is-selected .fl-row__btn { box-shadow: inset 2px 0 0 var(--lf-ink); padding-left: 12px; }
        .fl-row__btn:hover .fl-row__title { color: var(--lf-sauce); }

        .fl-row__chip {
          flex-shrink: 0;
          width: 44px;
          height: 44px;
          border-radius: 8px;
          background: var(--level-color);
          color: var(--lf-paper);
          display: grid;
          place-items: center;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        .fl-row__icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .fl-row__body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .fl-row__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 19px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.25;
          letter-spacing: -0.005em;
          transition: color 0.15s;
        }
        .fl-row__progress {
          display: block;
          height: 3px;
          background: var(--lf-cream-deep);
          border-radius: 2px;
          overflow: hidden;
          max-width: 320px;
        }
        .fl-row__progress > span {
          display: block;
          height: 100%;
          border-radius: 2px;
          transition: width 0.4s ease;
        }

        /* Focus article */
        .fl-focus {
          padding: 28px 0 8px;
          border-top: 3px solid var(--lf-ink);
        }
        .fl-focus__head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 18px;
          flex-wrap: wrap;
        }
        .fl-focus__chip {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.06em;
          flex-shrink: 0;
        }
        .fl-focus__icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }
        .fl-focus__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 500;
          font-size: clamp(28px, 4vw, 40px);
          line-height: 1.05;
          letter-spacing: -0.015em;
          color: var(--lf-ink);
          margin: 0 0 12px;
        }
        .fl-focus__sub {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 15px;
          line-height: 1.55;
          color: var(--lf-ink-soft);
          margin: 0 0 12px;
          max-width: 60ch;
        }
        .fl-focus__body {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 15px;
          line-height: 1.6;
          color: var(--lf-ink-soft);
          max-width: 60ch;
          margin: 0 0 24px;
        }
        .fl-focus__progress { margin-bottom: 20px; max-width: 480px; }
        .fl-focus__progress-meta {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 8px;
        }
        .fl-focus__bar {
          height: 6px;
          background: var(--lf-cream-deep);
          border-radius: 3px;
          overflow: hidden;
        }
        .fl-focus__bar > div {
          height: 100%;
          background: var(--lf-cheese);
          border-radius: 3px;
        }
        .fl-focus__callout {
          background: var(--lf-cream);
          border: 1px solid var(--lf-rule);
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 20px;
        }
        .fl-focus__actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          padding-top: 16px;
          border-top: 1px solid var(--lf-rule);
        }

        @media (max-width: 640px) {
          .fl-row__num { display: none; }
          .fl-row__title { font-size: 17px; }
        }
      `}</style>
    </Page>
  );
}
