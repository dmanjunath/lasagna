import { useState, useEffect, useRef, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Gift, Flame, HeartPulse, Sprout,
  TrendingUp, CreditCard, Rocket,
  AlertCircle, Check, ChevronRight, Sparkles, ArrowRight, Info,
  PiggyBank, Landmark, Layers,
} from 'lucide-react';
import { api } from '../lib/api';
import { useChatStore } from '../lib/chat-store';
import type { LucideIcon } from 'lucide-react';
import { Button, Eyebrow, EmptyState, Skeleton, Textarea } from '../components/uikit';

// ── constants ────────────────────────────────────────────────────────────────

const iconMap: Record<string, LucideIcon> = {
  shield: Shield, gift: Gift, flame: Flame, 'heart-pulse': HeartPulse,
  sprout: Sprout, 'trending-up': TrendingUp, 'credit-card': CreditCard, rocket: Rocket,
  'alert-circle': AlertCircle, 'piggy-bank': PiggyBank, landmark: Landmark, layers: Layers,
};

// State drives the whole palette. Four intentional, token-only states:
//   done    → brand green (filled) · settled, earned
//   current → brand green (loud)   · the focal "you are here"
//   future  → neutral faint        · quiet, ahead of you
//   skipped → neutral faint, struck
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

// Per-state Bright accents. Green stays brand; current is the loudest green,
// done is the calm brand-soft, future/skipped are quiet neutrals.
const STATE_ACCENT: Record<LevelState, string> = {
  done: 'rgb(var(--ui-brand))',
  current: 'rgb(var(--ui-brand))',
  future: 'rgb(var(--ui-content-faint))',
  skipped: 'rgb(var(--ui-content-faint))',
};

// ── StatePill — small status chip, never color-only ──────────────────────────

function StatePill({ state, className = '' }: { state: LevelState; className?: string }) {
  const base = `inline-flex items-center gap-1 h-[22px] px-2.5 rounded-full text-[10.5px] font-extrabold uppercase tracking-[0.06em] whitespace-nowrap ${className}`;
  // current: readable brand-ink on the soft tint + a brand ring + leading dot,
  // so it passes AA on light and stays visually distinct from the "Done" pill.
  if (state === 'current')
    return (
      <span
        className={`${base} bg-brand-soft text-[rgb(var(--ui-brand-ink))]`}
        style={{ boxShadow: 'inset 0 0 0 1.5px var(--ui-brand-ring)' }}
      >
        <span className="h-[7px] w-[7px] rounded-full bg-brand shrink-0" />
        You are here
      </span>
    );
  if (state === 'done')
    return <span className={`${base} bg-brand-soft text-[rgb(var(--ui-brand-ink))]`}><Check className="h-3 w-3" strokeWidth={3} />Done</span>;
  if (state === 'skipped')
    return <span className={`${base} bg-canvas-sunken text-content-muted`}>Skipped</span>;
  return <span className={`${base} bg-canvas-sunken text-content-muted`}>Ahead</span>;
}

// ── SegmentedRail — the hero's honest progress visual. One equal-height segment
// per level, colored only by STATE (never index or height, since completion is
// non-linear): done = brand-green fill, current = green with a ring/halo + a
// centred marker dot ("you are here"), future = quiet neutral track, skipped =
// muted dashed outline. No varying heights — order is non-linear, so a staircase
// would lie. ──

function SegmentedRail({ states }: { states: LevelState[] }) {
  return (
    <div className="flex items-stretch gap-[6px] h-10 px-1.5" aria-hidden="true">
      {states.map((st, i) => {
        const common = 'relative flex-1 min-w-0 rounded-[6px] transition-colors';
        if (st === 'done')
          return <span key={i} className={common} style={{ background: 'rgb(var(--ui-brand))' }} />;
        if (st === 'current')
          return (
            <span
              key={i}
              className={`${common} grid place-items-center`}
              style={{
                background: 'rgb(var(--ui-brand))',
                boxShadow: '0 0 0 2px rgb(var(--ui-panel)), 0 0 0 4px var(--ui-brand-ring)',
              }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: 'rgb(var(--ui-brand-fg))' }} />
            </span>
          );
        if (st === 'skipped')
          return (
            <span
              key={i}
              className={common}
              style={{ border: '1.5px dashed color-mix(in srgb, rgb(var(--ui-content-faint)) 60%, transparent)' }}
            />
          );
        return (
          <span
            key={i}
            className={common}
            style={{ background: 'color-mix(in srgb, rgb(var(--ui-content-faint)) 22%, transparent)' }}
          />
        );
      })}
    </div>
  );
}

// Small swatch that mirrors a SegmentedRail segment for the legend.
function LegendSwatch({ state }: { state: LevelState }) {
  if (state === 'current')
    return (
      <span
        className="grid place-items-center w-[11px] h-[11px] rounded-[3px] shrink-0 bg-brand"
        style={{ boxShadow: '0 0 0 1.5px var(--ui-brand-ring)' }}
      >
        <span className="w-[4px] h-[4px] rounded-full" style={{ background: 'rgb(var(--ui-brand-fg))' }} />
      </span>
    );
  if (state === 'done')
    return <span className="w-[11px] h-[11px] rounded-[3px] shrink-0 bg-brand" />;
  if (state === 'skipped')
    return (
      <span
        className="w-[11px] h-[11px] rounded-[3px] shrink-0"
        style={{ border: '1.5px dashed color-mix(in srgb, rgb(var(--ui-content-faint)) 60%, transparent)' }}
      />
    );
  return (
    <span
      className="w-[11px] h-[11px] rounded-[3px] shrink-0"
      style={{ background: 'color-mix(in srgb, rgb(var(--ui-content-faint)) 22%, transparent)' }}
    />
  );
}

// ── WhyThisOrderPopover — Bright panel ───────────────────────────────────────

function WhyThisOrderPopover() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-ui-md text-[12.5px] font-bold text-content-muted hover:bg-brand-softer hover:text-brand transition-colors"
      >
        <Info className="h-[15px] w-[15px]" />
        Why this order?
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-[49]" />
          <div className="absolute top-full right-0 mt-2 z-[50] w-[min(360px,calc(100vw-36px))] rounded-ui-xl border border-line bg-panel-raised shadow-ui-lg p-5">
            <Eyebrow>Why this order</Eyebrow>
            <p className="mt-2.5 mb-2.5 text-[13.5px] leading-relaxed text-content-secondary">
              It's a priority order, not a rigid ladder. Chase a lower-priority move first and you can undo
              your own progress — investing while 22% APR credit cards compound against you, or saving while
              overdraft fees eat your checking account.
            </p>
            <p className="mb-2.5 text-[13.5px] leading-relaxed text-content-secondary">
              The order follows one rule: <strong className="font-bold text-content">do the thing with the
              highest guaranteed return first.</strong> Employer match (100% instant return) beats emergency
              fund beats investing. Paying off 22% debt is a guaranteed 22% return — no stock market year
              consistently beats that.
            </p>
            <p className="text-[13.5px] leading-relaxed text-content-secondary">
              The priorities are the same for everyone. What changes is where you start and how fast you move.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── LevelRow — a compact, tappable index row ─────────────────────────────────

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
  const accent = STATE_ACCENT[state];

  // chip surface per state
  const chipBg = isCurrent
    ? 'rgb(var(--ui-brand))'
    : isComplete
      ? 'var(--ui-brand-soft)'
      : 'var(--ui-canvas-sunken)';
  const chipFg = isCurrent
    ? 'var(--ui-brand-fg)'
    : isComplete
      ? 'rgb(var(--ui-brand-ink))'
      : 'rgb(var(--ui-content-muted))';

  return (
    <li className="relative border-t border-line first:border-t-0">
      {(isCurrent || isSelected) && (
        <span
          className="absolute left-0 top-0 bottom-0 w-1 rounded-full"
          style={{ background: isCurrent ? 'rgb(var(--ui-brand))' : 'var(--ui-line-strong)' }}
          aria-hidden
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        className={`flex items-center gap-3.5 w-full text-left min-h-touch py-3.5 px-3.5 transition-colors group ${
          isCurrent ? 'rounded-ui-md' : ''
        }`}
        style={isCurrent ? { background: 'var(--ui-brand-soft)' } : undefined}
      >
        <span
          className="grid place-items-center h-[42px] w-[42px] shrink-0 rounded-[13px]"
          style={{ background: chipBg, color: chipFg, opacity: isSkipped ? 0.6 : 1 }}
        >
          {isComplete ? <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> : <Icon className="h-[18px] w-[18px]" />}
        </span>

        <span className="flex-1 min-w-0 flex flex-col gap-1.5">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-content-muted">
            Level {String(step.order).padStart(2, '0')}
          </span>
          <span
            className={`font-editorial text-[15.5px] font-bold leading-[1.2] tracking-[-0.012em] line-clamp-2 transition-colors group-hover:text-brand ${
              isSkipped ? 'line-through text-content-muted' : 'text-content'
            }`}
          >
            {step.title}
          </span>
          {isCurrent && fill > 0 && fill < 100 && (
            <span className="mt-0.5 flex items-center gap-2 max-w-[260px]">
              <span className="h-[6px] flex-1 rounded-full bg-canvas-sunken overflow-hidden">
                <span className="block h-full rounded-full" style={{ width: `${fill}%`, background: accent }} />
              </span>
              <span className="text-[11px] font-bold text-[rgb(var(--ui-brand-ink))] ui-tnum">{fill}%</span>
            </span>
          )}
          {/* Mobile: the pill lives on its own line so it never eats the name. */}
          <StatePill state={state} className="sm:hidden mt-0.5 self-start" />
        </span>

        {/* Desktop/tablet: pill sits inline at the end of the row. */}
        <StatePill state={state} className="hidden sm:inline-flex" />
        <ChevronRight className="h-4 w-4 shrink-0 text-content-faint transition-transform group-hover:translate-x-0.5" />
      </button>
    </li>
  );
}

// ── FocusArticle — the selected level, as a Bright action card ───────────────

function FocusArticle({ step, state, skipped, hideHeader = false, onSkip, onAsk, onComplete, onUndoComplete }: {
  step: PriorityStep;
  state: LevelState;
  skipped: boolean;
  hideHeader?: boolean;
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
  const accent = STATE_ACCENT[state];
  const greenText = state === 'done' || state === 'current';

  let progressDetail = '';
  if (step.target !== null && step.current !== null) {
    if (step.target === 0) progressDetail = 'Goal: $0';
    else if (isComplete) progressDetail = fmt(step.current) + ' saved';
    else if (step.target > step.current) progressDetail = fmt(step.target - step.current) + ' to go';
    else progressDetail = fmt(step.current) + ' saved';
  }
  const hasProgress = !isComplete && fill > 0;

  return (
    <article className="relative overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5 sm:p-6">
      {/* left accent rail */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} aria-hidden />

      {/* When inline under its own row (mobile accordion) the row already shows
          the icon, "Level NN" and the pill — suppress this header to avoid the
          duplicate. */}
      {!hideHeader && (
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <span
            className="grid place-items-center h-11 w-11 shrink-0 rounded-[13px]"
            style={{
              background: greenText ? 'var(--ui-brand-soft)' : 'var(--ui-canvas-sunken)',
              color: greenText ? 'rgb(var(--ui-brand-ink))' : 'rgb(var(--ui-content-muted))',
            }}
          >
            <Icon className="h-5 w-5" />
          </span>
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-content-muted">
            Level {String(step.order).padStart(2, '0')}
          </span>
          <span className="ml-auto"><StatePill state={state} /></span>
        </div>
      )}

      <h3 className="font-editorial text-[20px] sm:text-[22px] font-bold leading-[1.18] tracking-[-0.02em] text-content">
        {step.title}
      </h3>
      {step.subtitle && (
        <p className="mt-2 text-[14.5px] leading-[1.5] text-content-secondary max-w-[58ch]">{step.subtitle}</p>
      )}
      {step.description && (
        <p className="mt-2.5 text-[14px] leading-[1.6] text-content-secondary max-w-[58ch]">{step.description}</p>
      )}

      {hasProgress && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">Progress</span>
            <span className="text-[12.5px] font-bold text-[rgb(var(--ui-brand-ink))] ui-tnum">
              {fill}%{progressDetail ? ` · ${progressDetail}` : ''}
            </span>
          </div>
          <div className="h-[9px] rounded-full bg-canvas-sunken overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 60%, transparent), ${accent})` }}
              initial={{ width: 0 }}
              animate={{ width: `${fill}%` }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      )}

      {/* "Next step" is only real for the level you're on — future levels would
          just show generic filler, so hide it for them. */}
      {state === 'current' && step.action && (
        <div className="mt-5 rounded-ui-lg border border-line bg-canvas-sunken/50 p-3.5">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted mb-1.5">Next step</div>
          <p className="text-[14px] leading-[1.5] font-semibold text-content">{step.action}</p>
        </div>
      )}

      {isComplete && step.note && (
        <div className="mt-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted mb-1">Your note</div>
          <p className="text-[14px] italic text-content-secondary">"{step.note}"</p>
        </div>
      )}

      <div className="flex items-center gap-2 mt-5 pt-4 flex-wrap border-t border-line">
        <Button size="sm" onClick={onAsk} trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
          Walk me through this
        </Button>
        {!isComplete && !isAutoTracked(step) && !pendingDone && (
          <Button size="sm" variant="ghost" onClick={() => setPendingDone(true)} leadingIcon={<Check className="h-3.5 w-3.5" />}>
            Mark done
          </Button>
        )}
        {isComplete && !isAutoTracked(step) && (
          <button
            type="button"
            onClick={() => onUndoComplete(step.id)}
            className="touch-target h-9 px-3 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
          >
            Undo
          </button>
        )}
        {!isComplete && (
          <button
            type="button"
            onClick={onSkip}
            className="touch-target h-9 px-3 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
          >
            {skipped ? 'Unskip' : 'Skip this step'}
          </button>
        )}
      </div>

      {!isComplete && !isAutoTracked(step) && pendingDone && (
        <div className="mt-3.5">
          <Textarea
            autoFocus
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="Add a note (optional) — e.g. 'Got Geico quote, saved $340/year'"
            rows={2}
            className="ui-tnum"
          />
          <div className="flex gap-2 mt-2.5">
            <Button
              size="sm"
              onClick={() => {
                onComplete(step.id, noteText);
                setPendingDone(false);
                setNoteText('');
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setPendingDone(false); setNoteText(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

// ── StatTile ─────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, tone }: {
  label: string; value: string; sub: string; tone?: 'pos' | 'neg';
}) {
  const valueColor =
    tone === 'pos' ? 'rgb(var(--ui-positive))' : tone === 'neg' ? 'rgb(var(--ui-negative))' : undefined;
  return (
    <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-4 sm:p-5">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">{label}</div>
      <div
        className="mt-1.5 font-editorial text-[24px] sm:text-[27px] font-extrabold leading-none tracking-[-0.02em] ui-tnum"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] font-semibold text-content-muted">{sub}</div>
    </div>
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

  // ── Loading ──
  if (loading) return (
    <div className="mx-auto max-w-[1180px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-9 w-64" />
      <div className="mt-7 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
        <div className="grid gap-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center">
          <div>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-4 h-12 w-40" />
            <Skeleton className="mt-4 h-3 w-56" />
            <Skeleton className="mt-5 h-2.5 w-full rounded-full" />
          </div>
          <Skeleton className="h-[78px] w-full rounded-ui-lg" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-[92px] w-full rounded-ui-xl" />)}
      </div>
      <div className="mt-8 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-3.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3.5 py-3.5 px-2 border-t border-line first:border-t-0">
            <Skeleton className="h-[42px] w-[42px] rounded-[13px]" />
            <Skeleton className={`h-4 ${['w-1/2', 'w-2/5', 'w-2/5', 'w-1/3', 'w-1/3', 'w-1/4'][i]}`} />
          </div>
        ))}
      </div>
    </div>
  );

  // ── Error ──
  if (error) return (
    <div className="mx-auto max-w-[1180px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
      <EmptyState
        icon={<AlertCircle className="h-7 w-7" />}
        title="Couldn't load your levels"
        description={error}
      />
    </div>
  );

  if (!data) return null;

  const { steps, currentStepId, summary } = data;

  // ── No-data empty state ──
  const hasNoData = summary.monthlyIncome === 0 && summary.totalCash === 0 && summary.totalInvested === 0;
  if (hasNoData) return (
    <div className="mx-auto max-w-[1180px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
      <header className="animate-fade-in">
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em]">Financial Level</h1>
      </header>
      <EmptyState
        className="mt-8"
        icon={<Rocket className="h-8 w-8" />}
        title="Let's build your plan"
        description="Add your income and accounts to see your personalized priority levels."
        action={
          <div className="flex flex-wrap justify-center gap-2.5">
            <a href="/onboarding" className="inline-flex items-center justify-center h-11 px-5 rounded-ui-md bg-brand-soft text-[rgb(var(--ui-brand-ink))] text-sm font-bold hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow]">Get started →</a>
            <a href="/accounts" className="inline-flex items-center justify-center h-11 px-5 rounded-ui-md bg-panel border border-line-strong text-content text-sm font-semibold shadow-ui-sm hover:bg-canvas-sunken transition-colors">Link account</a>
          </div>
        }
      />
    </div>
  );

  const completeCount = steps.filter(s => s.status === 'complete').length;
  const selectedStep = steps.find(s => s.id === selectedStepId) ?? steps.find(s => s.id === currentStepId) ?? steps[0];
  const allComplete = completeCount === steps.length;
  const currentStep = steps.find(s => s.id === currentStepId) ?? steps[0];

  const states = steps.map(s => levelStateOf(s, currentStepId, skippedStepIds));
  const futureCount = states.filter(s => s === 'future').length;
  const skippedCount = states.filter(s => s === 'skipped').length;
  const clearedPct = Math.round((completeCount / steps.length) * 100);

  // Shared between the inline accordion (mobile/tablet) and the sticky side
  // panel (desktop) so the detail markup stays in one place.
  const renderFocus = (step: PriorityStep, inline = false) => (
    <FocusArticle
      step={step}
      state={levelStateOf(step, currentStepId, skippedStepIds)}
      skipped={skippedStepIds.has(step.id)}
      hideHeader={inline}
      onSkip={() => handleSkipStep(step.id)}
      onComplete={handleCompleteStep}
      onUndoComplete={handleUndoComplete}
      onAsk={() => openChat(
        `Help me with this financial step:\n\nTitle: ${step.title}\nDescription: ${step.description || step.subtitle}\n\nWhat exactly should I do, and why does it matter for my finances?`
      )}
    />
  );

  const surplusTone: 'pos' | 'neg' | undefined =
    summary.monthlySurplus == null ? undefined :
    summary.monthlySurplus >= 0 ? 'pos' : 'neg';
  const investedOrCash = summary.totalInvested > 0 ? summary.totalInvested : summary.totalCash;
  const investedLabel = summary.totalInvested > 0 ? 'total portfolio' : summary.totalCash > 0 ? 'cash holdings' : 'link accounts';

  return (
    <div className="mx-auto max-w-[1180px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="animate-fade-in">
        <span className="inline-flex items-center gap-2.5 mb-3">
          <span className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))]" style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }} />
          <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Your climb</span>
        </span>
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em]">
          Financial Level
        </h1>
        <p className="mt-2 text-[14px] font-semibold text-content-muted">
          {allComplete
            ? 'Every level cleared — time to fine-tune your plan.'
            : <>{steps.length} money milestones, ordered by impact — we spotlight your highest-impact next move.</>}
        </p>
      </header>

      {/* ════════ Hero — the climb ════════ */}
      <section className="relative mt-7 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7 animate-fade-in">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'radial-gradient(95% 80% at 0% 8%, var(--ui-brand-softer), transparent 60%)',
          }}
        />
        <div className="relative grid gap-7 sm:gap-10 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] items-center">
          {/* lead */}
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
              {allComplete ? 'All levels complete' : 'Current level'}
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="font-editorial text-[58px] sm:text-[68px] font-extrabold leading-[0.85] tracking-[-0.03em] text-[rgb(var(--ui-brand-ink))] ui-tnum">
                {allComplete ? steps.length : currentStep.order}
              </span>
              <span className="font-editorial text-[18px] font-bold text-content-muted ui-tnum">of {steps.length}</span>
            </div>
            <p className="mt-3 text-[14.5px] font-medium leading-[1.5] text-content-secondary max-w-[40ch]">
              {allComplete ? (
                <>You've worked through every layer of the stack.</>
              ) : (
                <>Working on <strong className="font-bold text-content">{currentStep.title}</strong></>
              )}
              {summary.retirementAge ? <span className="text-content-muted"> · FI target age {summary.retirementAge}</span> : null}
            </p>

            {/* overall progress through the stack */}
            <div className="mt-5 max-w-[420px]">
              <div className="h-[10px] rounded-full bg-canvas-sunken overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(clearedPct, completeCount === 0 ? 0 : 4)}%`,
                    background: 'linear-gradient(90deg, var(--ui-viz-1), rgb(var(--ui-brand)))',
                    minWidth: completeCount === 0 ? 0 : undefined,
                  }}
                />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-[12.5px] font-extrabold text-[rgb(var(--ui-brand-ink))] ui-tnum">
                  {completeCount} {completeCount === 1 ? 'level' : 'levels'} cleared
                </span>
                <span className="text-[12px] font-semibold text-content-muted ui-tnum">· {clearedPct}%</span>
              </div>
            </div>
          </div>

          {/* progress rail — one segment per level, colored by state */}
          <div className="min-w-0 w-full">
            <SegmentedRail states={states} />
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                <LegendSwatch state="done" />
                {completeCount} done
              </span>
              {!allComplete && (
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                  <LegendSwatch state="current" />
                  You are here
                </span>
              )}
              {futureCount > 0 && (
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                  <LegendSwatch state="future" />
                  {futureCount} ahead
                </span>
              )}
              {skippedCount > 0 && (
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                  <LegendSwatch state="skipped" />
                  {skippedCount} skipped
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ════════ Stat tiles ════════ */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <StatTile
          label="Monthly income"
          value={summary.monthlyIncome > 0 ? fmt(summary.monthlyIncome) : '—'}
          sub="per month"
        />
        <StatTile
          label="Surplus / mo"
          value={summary.monthlySurplus !== null ? fmt(summary.monthlySurplus) : '—'}
          sub="income − expenses"
          tone={surplusTone}
        />
        <StatTile
          label={summary.totalInvested > 0 ? 'Invested' : 'Cash'}
          value={investedOrCash > 0 ? fmt(investedOrCash) : '—'}
          sub={investedLabel}
        />
      </div>

      {/* ════════ Levels ════════ */}
      {allComplete ? (
        <div className="mt-10">
          <EmptyState
            icon={<Rocket className="h-8 w-8" />}
            title="All levels complete"
            description="You've worked through every layer of the financial level stack. Time to fine-tune your plan — ask Lasagna what's next."
            action={
              <Button
                onClick={() => openChat("I've completed all 12 financial levels. What should I focus on next?")}
                trailingIcon={<ArrowRight className="h-4 w-4" />}
              >
                Ask what's next
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* section header */}
          <div className="mt-10 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-2.5">
              <span className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))]" style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }} />
              <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">The {steps.length} levels</span>
            </span>
            <span className="flex-1 h-px bg-hairline min-w-[12px]" aria-hidden />
            <WhyThisOrderPopover />
          </div>
          <p className="mt-2 text-[13.5px] font-medium text-content-muted">
            Ordered by impact — earlier levels usually pay off most, but you can work them in any order.
          </p>

          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] gap-6 items-start">
            {/* list */}
            <motion.ul
              className="rounded-ui-xl border border-line bg-panel shadow-ui-sm px-2 sm:px-3.5 py-1"
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
                          className="list-none overflow-hidden"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <div className="pb-3.5 pt-1 px-1">{renderFocus(step, true)}</div>
                        </motion.li>
                      )}
                    </AnimatePresence>
                  )}
                </Fragment>
              ))}
            </motion.ul>

            {/* Desktop: sticky side panel. */}
            {!isStacked && selectedStep && (
              <div className="sticky top-6" ref={focusRef}>
                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted mb-3">Current focus</div>
                <motion.div
                  key={selectedStep.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {renderFocus(selectedStep)}
                </motion.div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
