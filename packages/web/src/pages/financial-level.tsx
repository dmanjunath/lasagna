import { useState, useEffect, useRef, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Gift, Flame, HeartPulse, Sprout,
  TrendingUp, CreditCard, Rocket,
  AlertCircle, Check,
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
  SkeletonLine,
  SkeletonBlock,
} from '../components/ds';

// ── constants ────────────────────────────────────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  shield: Shield, gift: Gift, flame: Flame, 'heart-pulse': HeartPulse,
  sprout: Sprout, 'trending-up': TrendingUp, 'credit-card': CreditCard, rocket: Rocket,
  'alert-circle': AlertCircle, 'piggy-bank': PiggyBank, landmark: Landmark, layers: Layers,
};

// State drives color, not order. Three intentional, token-only states:
//   done    → basil (green)  · settled, earned
//   current → cheese (amber) · the hero — "you are here"
//   future  → muted (neutral)· quiet, ahead of you
//   skipped → muted, struck
// The CSS reads a single `--st` custom property set per state class, so the
// palette lives in one place and never drifts to a foreign hex.
type LevelState = 'done' | 'current' | 'future' | 'skipped';

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

function levelStateOf(step: PriorityStep, currentStepId: string, skipped: Set<string>): LevelState {
  if (step.status === 'complete') return 'done';
  if (skipped.has(step.id)) return 'skipped';
  if (step.id === currentStepId) return 'current';
  return 'future';
}

// ── LevelLadder — the hero. A 12-rung climb. Height AND color tell ONE story,
// driven by state (never index): cleared levels stand tall, the current level
// is the summit you're on, levels ahead sit low until you reach them. A done
// rung can never appear "more advanced" than the amber "you are here" rung. ──

const RUNG_HEIGHT: Record<LevelState, number> = {
  done: 78,     // climbed — elevated, consistent
  current: 100, // the summit — "you are here"
  future: 46,   // ahead, not yet climbed
  skipped: 46,  // stepped over, low
};

function LevelLadder({ states }: { states: LevelState[] }) {
  return (
    <div className="fl-ladder" aria-hidden="true">
      {states.map((st, i) => (
        <span
          key={i}
          className={`fl-ladder__rung is-${st}`}
          style={{ height: `${RUNG_HEIGHT[st]}%` }}
        />
      ))}
    </div>
  );
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

function LevelRow({ step, state, isSelected, onSelect }: {
  step: PriorityStep;
  state: LevelState;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isComplete = state === 'done';
  const isCurrent = state === 'current';
  const isSkipped = state === 'skipped';
  const fill = isComplete ? 100 : Math.min(step.progress, 100);
  const Icon = iconMap[step.icon] ?? Layers;

  const pillTone: 'basil' | 'cheese' | 'ghost' | undefined =
    isComplete ? 'basil' :
    isCurrent ? 'cheese' :
    isSkipped ? 'ghost' :
    undefined;
  const pillLabel = isComplete ? 'Done' : isCurrent ? 'You are here' : isSkipped ? 'Skipped' : null;

  return (
    <li className={`fl-row is-${state} ${isSelected && !isCurrent ? 'is-selected' : ''}`}>
      <button type="button" onClick={onSelect} className="fl-row__btn">
        <span className="fl-row__chip" aria-hidden="true">
          {isComplete
            ? <Check size={16} strokeWidth={2.5} />
            : String(step.order).padStart(2, '0')}
        </span>
        <span className="fl-row__icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <span className="fl-row__body">
          <span className="fl-row__title">{step.title}</span>
          {!isComplete && !isSkipped && fill > 0 && (
            <span className="fl-row__progress">
              <span style={{ width: `${fill}%` }} />
            </span>
          )}
        </span>
        {pillLabel && pillTone && <Pill tone={pillTone}>{pillLabel}</Pill>}
      </button>
    </li>
  );
}

// ── FocusArticle — the selected level, rendered as editorial article ─────────

function FocusArticle({ step, state, skipped, onSkip, onAsk, onComplete, onUndoComplete }: {
  step: PriorityStep;
  state: LevelState;
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

  return (
    <article className={`fl-focus is-${state}`}>
      <div className="fl-focus__head">
        <span className="fl-focus__chip" aria-hidden="true">
          {`L${String(step.order).padStart(2, '0')}`}
        </span>
        <span className="fl-focus__icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        {isComplete && <Pill tone="basil">Complete</Pill>}
        {!isComplete && state === 'current' && <Pill tone="cheese">You are here</Pill>}
        {!isComplete && state === 'future' && <Pill tone="ghost">Ahead</Pill>}
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
  const focusRef = useRef<HTMLDivElement>(null);
  const { openChat } = useChatStore();

  // Below the side-panel breakpoint (1080px) the detail expands inline beneath
  // the tapped row (accordion); at/above it, the detail lives in a sticky side
  // panel. Track which mode we're in so the render + tap behaviour match.
  const [isStacked, setIsStacked] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1079px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1079px)');
    const update = () => setIsStacked(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const handleSelectStep = (stepId: string) => {
    // Accordion: tapping the open row collapses it. On the desktop side panel
    // there's nothing to collapse, so just select.
    if (isStacked) {
      setSelectedStepId(prev => (prev === stepId ? null : stepId));
    } else {
      setSelectedStepId(stepId);
    }
  };

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

  if (loading) return (
    <Page>
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Financial Level</h1>
        </div>
      </header>
      <div className="fl-hero fl-hero--skeleton">
        <div className="fl-hero__lead">
          <SkeletonLine width="92px" height={11} style={{ marginBottom: 14 }} />
          <SkeletonLine width="118px" height={46} style={{ marginBottom: 14 }} />
          <SkeletonLine width="210px" height={13} />
        </div>
        <div className="fl-hero__meter">
          <SkeletonBlock height={66} />
          <SkeletonLine width="70%" height={12} style={{ marginTop: 14 }} />
        </div>
      </div>
      <SkeletonBlock height={88} style={{ borderRadius: 12, margin: '24px 0 28px' }} />
      <div className="fl-list fl-list--skeleton">
        {Array.from({ length: 6 }).map((_, i) => (
          <div className="fl-row-sk" key={i}>
            <span className="ds-skeleton" style={{ width: 44, height: 44, borderRadius: 8, flexShrink: 0 }} />
            <SkeletonLine width={`${52 - i * 4}%`} height={16} />
          </div>
        ))}
      </div>
      <style>{flStyles}</style>
    </Page>
  );

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

  // Shared between the inline accordion (mobile/tablet) and the sticky side
  // panel (desktop) so the detail markup stays in one place.
  const renderFocus = (step: PriorityStep) => (
    <FocusArticle
      step={step}
      state={levelStateOf(step, currentStepId, skippedStepIds)}
      skipped={skippedStepIds.has(step.id)}
      onSkip={() => handleSkipStep(step.id)}
      onComplete={handleCompleteStep}
      onUndoComplete={handleUndoComplete}
      onAsk={() => openChat(
        `Help me with this financial step:\n\nTitle: ${step.title}\nDescription: ${step.description || step.subtitle}\n\nWhat exactly should I do, and why does it matter for my finances?`
      )}
    />
  );

  const surplusTone: 'pos' | 'neg' | 'default' =
    summary.monthlySurplus == null ? 'default' :
    summary.monthlySurplus >= 0 ? 'pos' : 'neg';
  const investedOrCash = summary.totalInvested > 0 ? summary.totalInvested : summary.totalCash;
  const investedLabel = summary.totalInvested > 0 ? 'total portfolio' : summary.totalCash > 0 ? 'cash holdings' : 'link accounts';

  const states = steps.map(s => levelStateOf(s, currentStepId, skippedStepIds));
  const futureCount = states.filter(s => s === 'future').length;

  return (
    <Page>
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Financial Level</h1>
        </div>
      </header>

      {/* ── Hero: the climb. Geist level number (tabular, matches the app's
          canonical hero figures) + a 12-rung ladder that reads done / here /
          ahead at a glance. ── */}
      <section className="fl-hero">
        <div className="fl-hero__lead">
          <Eyebrow>Your climb</Eyebrow>
          <div className="fl-hero__level">
            <span className="fl-hero__num ds-num">
              {allComplete ? steps.length : currentStep.order}
            </span>
            <span className="fl-hero__of">of {steps.length}</span>
          </div>
          <p className="fl-hero__now">
            {allComplete ? (
              <>Every level cleared — time to fine-tune.</>
            ) : (
              <>Working on <strong>{currentStep.title}</strong></>
            )}
            {summary.retirementAge ? <> · FI target age {summary.retirementAge}</> : null}
          </p>
        </div>
        <div className="fl-hero__meter">
          <LevelLadder states={states} />
          <div className="fl-hero__legend">
            <span className="fl-hero__key is-done"><i aria-hidden="true" />{completeCount} done</span>
            {!allComplete && <span className="fl-hero__key is-current"><i aria-hidden="true" />1 here</span>}
            {futureCount > 0 && <span className="fl-hero__key is-future"><i aria-hidden="true" />{futureCount} ahead</span>}
          </div>
        </div>
      </section>

      <StatStrip
        className="fl-stats"
        items={[
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

      {allComplete ? (
        <Section title="All levels complete">
          <AllCompleteView
            onAsk={() => openChat("I've completed all 12 financial levels. What should I focus on next?")}
          />
        </Section>
      ) : (
        <div className="fl-layout">
          <div className="fl-layout__main">
            <Section title="The 12 levels" actions={<WhyThisOrderPopover />}>
              <p className="ds-caption" style={{ margin: '0 0 14px', color: 'var(--lf-muted)' }}>
                Levels can be completed in any order — we highlight your highest-impact next step.
              </p>
              <motion.ul
                className="fl-list"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
              >
                {steps.map((step) => (
                  <Fragment key={step.id}>
                    <LevelRow
                      step={step}
                      state={levelStateOf(step, currentStepId, skippedStepIds)}
                      isSelected={selectedStepId === step.id}
                      onSelect={() => handleSelectStep(step.id)}
                    />
                    {/* Mobile/tablet: detail expands inline beneath the row. */}
                    {isStacked && (
                      <AnimatePresence initial={false}>
                        {selectedStepId === step.id && (
                          <motion.li
                            className="fl-row-detail"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                            style={{ overflow: 'hidden' }}
                          >
                            {renderFocus(step)}
                          </motion.li>
                        )}
                      </AnimatePresence>
                    )}
                  </Fragment>
                ))}
              </motion.ul>
            </Section>
          </div>

          {/* Desktop: sticky side panel. */}
          {!isStacked && selectedStep && (
            <div className="fl-layout__detail" ref={focusRef}>
              <Section title="Current focus">
                <motion.div
                  key={selectedStep.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {renderFocus(selectedStep)}
                </motion.div>
              </Section>
            </div>
          )}
        </div>
      )}

      <style>{flStyles}</style>
    </Page>
  );
}

// Page-scoped styles — shared by the loading shell and the loaded page.
// Palette is token-only; state is carried by a single `--st` custom property
// set per state class (is-done / is-current / is-future / is-skipped).
const flStyles = `
        .fl-stats { margin: 24px 0 28px; }

        /* ── Hero: serif level number + the climb ladder ── */
        .fl-hero {
          display: grid;
          grid-template-columns: 1fr;
          gap: 22px;
          background: var(--lf-surface);
          border: 1px solid var(--lf-rule-neutral);
          border-radius: 16px;
          box-shadow: var(--shadow-card);
          padding: 24px 24px;
          margin-top: 4px;
        }
        @media (min-width: 760px) {
          .fl-hero {
            grid-template-columns: minmax(0, auto) minmax(0, 1fr);
            align-items: center;
            gap: 44px;
            padding: 28px 32px;
          }
        }
        .fl-hero__lead { min-width: 0; }
        .fl-hero__level {
          display: flex;
          align-items: baseline;
          gap: 10px;
          margin: 6px 0 10px;
        }
        .fl-hero__num {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: clamp(52px, 13vw, 66px);
          line-height: 0.85;
          color: var(--lf-ink);
        }
        .fl-hero__of {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 16px;
          font-weight: 500;
          color: var(--lf-muted);
        }
        .fl-hero__now {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: var(--lf-muted);
          margin: 0;
        }
        .fl-hero__now strong { color: var(--lf-ink); font-weight: 600; }

        .fl-hero__meter { min-width: 0; }
        .fl-ladder {
          display: flex;
          align-items: flex-end;
          gap: 6px;
          height: 72px;
        }
        .fl-ladder__rung {
          flex: 1;
          min-width: 0;
          border-radius: 4px 4px 2px 2px;
          background: var(--lf-cream-deep);
          transition: background 0.2s ease;
        }
        .fl-ladder__rung.is-done    { background: var(--lf-basil); }
        .fl-ladder__rung.is-current {
          background: var(--lf-cheese);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--lf-cheese) 24%, transparent);
        }
        .fl-ladder__rung.is-skipped { background: var(--lf-cream-deep); opacity: 0.65; }

        .fl-hero__legend {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 18px;
          margin-top: 14px;
        }
        .fl-hero__key {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px;
          font-weight: 500;
          color: var(--lf-muted);
        }
        .fl-hero__key i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; flex-shrink: 0; }
        .fl-hero__key.is-done i    { background: var(--lf-basil); }
        .fl-hero__key.is-current i { background: var(--lf-cheese); }
        .fl-hero__key.is-future i  { background: var(--lf-cream-deep); border: 1px solid var(--lf-rule); }

        /* Skeleton list rows */
        .fl-list--skeleton .fl-row-sk {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 16px 0;
          border-top: 1px solid var(--lf-rule);
        }
        .fl-list--skeleton .fl-row-sk:first-child { border-top: 0; }

        /* Two-column layout: 12-level list on the left, the selected level's
           detail in a sticky panel on the right (desktop). On mobile it stacks
           and the detail scrolls into view on select. */
        .fl-layout { display: block; }
        .fl-layout__detail { margin-top: 28px; }
        @media (min-width: 1080px) {
          .fl-layout {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
            gap: 24px;
            align-items: start;
          }
          .fl-layout__detail { margin-top: 0; position: sticky; top: 24px; }
          .fl-layout__detail .ds-section { margin-bottom: 0; }
        }

        .fl-list {
          list-style: none;
          margin: 0;
          padding: 2px 18px;
          background: var(--lf-surface);
          border: 1px solid var(--lf-rule-neutral);
          border-radius: 12px;
          box-shadow: var(--shadow-card);
        }
        .fl-row {
          border-top: 1px solid var(--lf-rule);
        }
        .fl-row:first-child { border-top: 0; }
        .fl-row:last-child { border-bottom: 0; }

        /* ── State palette — one source of truth via --st ── */
        .fl-row.is-done    { --st: var(--lf-basil); }
        .fl-row.is-current { --st: var(--lf-cheese); }
        .fl-row.is-future  { --st: var(--lf-muted); }
        .fl-row.is-skipped { --st: var(--lf-muted); opacity: 0.6; }
        .fl-row.is-skipped .fl-row__title { text-decoration: line-through; }

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
        /* Current step: soft amber wash bleeding to the card edges + a left
           accent bar — the "you are here" focal row. */
        .fl-row.is-current .fl-row__btn {
          background: color-mix(in srgb, var(--lf-cheese) 8%, var(--lf-surface));
          box-shadow: inset 3px 0 0 var(--lf-cheese);
          /* width grows by the 36px the negative margins consume so the box
             bleeds to both card edges; plain width:100% would only shift it
             left, dragging the right-aligned pill inward. */
          width: calc(100% + 36px);
          margin: 0 -18px;
          padding-left: 18px;
          padding-right: 18px;
          border-radius: 8px;
        }
        /* A non-current row that's been clicked to inspect uses a subtle inset rule. */
        .fl-row.is-selected .fl-row__btn { box-shadow: inset 2px 0 0 var(--lf-ink); width: calc(100% + 36px); margin: 0 -18px; padding-left: 18px; padding-right: 18px; }
        .fl-row__btn:hover .fl-row__title { color: var(--lf-sauce); }

        .fl-row__chip {
          flex-shrink: 0;
          width: 44px;
          height: 44px;
          border-radius: 8px;
          background: color-mix(in srgb, var(--st) 13%, var(--lf-surface));
          color: var(--st);
          display: grid;
          place-items: center;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        /* Current chip: solid amber, the boldest mark on the list. */
        .fl-row.is-current .fl-row__chip { background: var(--st); color: var(--lf-paper); }
        .fl-row__icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
          background: color-mix(in srgb, var(--st) 10%, transparent);
          color: var(--st);
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
          font-size: 16px;
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
          background: var(--st);
          transition: width 0.4s ease;
        }

        /* ── Focus article — state-tinted ── */
        .fl-focus.is-done    { --st: var(--lf-basil); }
        .fl-focus.is-current { --st: var(--lf-cheese); }
        .fl-focus.is-future  { --st: var(--lf-muted); }
        .fl-focus.is-skipped { --st: var(--lf-muted); }
        .fl-focus {
          padding: 28px 0 8px;
          border-top: 3px solid var(--st);
        }
        /* Inline accordion detail (mobile/tablet): lives inside the list card,
           so soften the heavy 3px divider to a hairline and tighten padding. */
        .fl-row-detail { list-style: none; }
        .fl-row-detail .fl-focus {
          border-top: 1px solid var(--lf-rule);
          padding: 14px 0 18px;
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
          background: var(--st);
          color: var(--lf-paper);
        }
        .fl-focus__icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
          background: color-mix(in srgb, var(--st) 14%, transparent);
          color: var(--st);
        }
        .fl-focus__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 600;
          font-size: clamp(18px, 2vw, 22px);
          line-height: 1.2;
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
          background: var(--st);
          border-radius: 3px;
        }
        .fl-focus__callout {
          background: var(--lf-rule-soft);
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
          /* Free horizontal room for the title: drop the secondary icon box and
             shrink the number chip so titles stop wrapping to two lines. */
          .fl-list { padding: 2px 14px; }
          .fl-row__btn { gap: 12px; }
          .fl-row__icon { display: none; }
          .fl-row__chip { width: 34px; height: 34px; font-size: 12px; border-radius: 7px; }
          .fl-row__title { font-size: 16px; }
          .fl-row.is-current .fl-row__btn,
          .fl-row.is-selected .fl-row__btn { margin: 0 -14px; padding-left: 14px; padding-right: 14px; }
          .fl-hero { padding: 22px 20px; }
          .fl-ladder { gap: 5px; height: 64px; }
        }
`;
