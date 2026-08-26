import { useState, useEffect, useRef, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Gift, Flame, HeartPulse, Sprout,
  TrendingUp, CreditCard, Rocket, Target, Home,
  AlertCircle, Check, ChevronRight, Sparkles, ArrowRight, Info,
  PiggyBank, Landmark, Layers, Wallet, Percent, LineChart,
} from 'lucide-react';
import { Link } from 'wouter';
import { api } from '../lib/api';
import { stripAccountMask } from '../lib/utils';
import { useChatStore } from '../lib/chat-store';
import type { LucideIcon } from 'lucide-react';
import { Button, EmptyState, Skeleton, Textarea, useToast } from '../components/uikit';
import { type LevelState, levelStateOf, SegmentedRail, LegendSwatch } from '../components/common/level-rail';

// ── constants ────────────────────────────────────────────────────────────────

// `target` is the same mark the Goals nav uses, so a goal reads as a goal
// wherever it appears. `home` keeps a mortgage from wearing the estate icon.
const iconMap: Record<string, LucideIcon> = {
  shield: Shield, gift: Gift, flame: Flame, 'heart-pulse': HeartPulse,
  sprout: Sprout, 'trending-up': TrendingUp, 'credit-card': CreditCard, rocket: Rocket,
  'alert-circle': AlertCircle, 'piggy-bank': PiggyBank, landmark: Landmark, layers: Layers,
  target: Target, home: Home, wallet: Wallet, percent: Percent, 'line-chart': LineChart,
};

// LevelState + the rail visuals live in components/common/level-rail so the home
// summary and this page share one source of truth.

// ── types ────────────────────────────────────────────────────────────────────

interface LevelDebtAccount {
  id: string; name: string; mask: string | null;
  balance: number; apr: number | null;
}

interface PathStep {
  id: string; order: number; kind: string; title: string; subtitle: string;
  description: string;
  /** Why this step is on this person's path. */
  why: string;
  icon: string; mandatory: boolean; status: string; current: number | null;
  target: number | null; progress: number;
  monthlyFunding: number;
  projectedDate: string | null;
  action: string;
  /** What is true of this step in any state. Never an instruction. */
  fact: string;
  /** Anything the figures would otherwise imply but not state. */
  notes: string[];
  skipped: boolean;
  note: string;
  /** The one account a debt step acts on. */
  accounts?: LevelDebtAccount[];
  goal?: { id: string; name: string; targetAmount: number; currentAmount: number; deadline: string | null };
}

interface PathSummary {
  monthlyIncome: number; monthlyExpenses: number | null;
  monthlySurplus: number | null; totalCash: number;
  totalInvested: number; totalDebt: number; stepCount: number;
  age: number | null;
  retirementAge: number;
  /** False when the age above is our default rather than their own figure. */
  retirementAgeSet: boolean;
  filingStatus: string | null;
  /** Null when the simulation could not be run on what this person has given us. */
  retirement: {
    successRate: number;
    targetSuccess: number;
    verdict: 'on_track' | 'needs_attention' | 'at_risk';
    retirementAge: number;
  } | null;
}

interface PathData {
  steps: PathStep[]; currentStepId: string; summary: PathSummary;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function isAutoTracked(step: PathStep): boolean {
  return step.target !== null;
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

// ── WhyThisPathPopover — Bright panel ────────────────────────────────────────

function WhyThisPathPopover({ steps, surplus }: { steps: PathStep[]; surplus: number | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const debtCount = steps.filter(s => s.kind === 'debt').length;
  const goalCount = steps.filter(s => s.kind === 'goal').length;

  // Reads as a sentence about THIS path: what is in it, and why in this order.
  const madeOf = [
    debtCount > 0 ? `${debtCount} ${debtCount === 1 ? 'debt account' : 'debt accounts'}` : null,
    goalCount > 0 ? `${goalCount} ${goalCount === 1 ? 'goal' : 'goals'}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="ui-focus inline-flex items-center gap-1.5 h-9 px-3 rounded-ui-md text-[12.5px] font-bold text-content-muted hover:bg-brand-softer hover:text-brand transition-colors"
      >
        <Info className="h-[15px] w-[15px]" />
        Why these steps?
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-[49]" />
          <div
            role="dialog"
            aria-label="Why these steps"
            className="absolute top-full right-0 mt-2 z-[50] w-[min(360px,calc(100vw-36px))] rounded-ui-xl border border-line bg-panel-raised shadow-ui-lg p-5"
          >
            <p className="mb-2.5 text-[13.5px] leading-relaxed text-content-secondary">
              These {steps.length} steps are built from your own accounts, goals and profile.
              {madeOf.length > 0 && <> One step each for {madeOf.join(' and ')}, named individually.</>}
              {' '}Anything that does not apply to you is left out rather than shown greyed.
            </p>
            <p className="mb-2.5 text-[13.5px] leading-relaxed text-content-secondary">
              The order follows one rule: <strong className="font-bold text-content">do the thing with the
              highest guaranteed return first.</strong>
              {debtCount > 0 && <> Clearing a balance returns its own rate with no uncertainty, so each debt
              account is placed by that rate rather than by a band.</>}
            </p>
            <p className="text-[13.5px] leading-relaxed text-content-secondary">
              {surplus !== null && surplus > 0 ? (
                <>Your {fmt(surplus)} a month goes to the step you are on, then moves down as each finishes.</>
              ) : (
                <>Add income or link a spending account and each step gets a monthly figure and a date.</>
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── RetirementVerdict — on track, or not, and the way to the run behind it ──
//
// Same pill idiom as StatePill above, in the caution tokens the rest of the app
// warns with. It is a link because a verdict invites the obvious next question,
// and /retirement is where the simulation that produced it lives.
//
// The success rate itself is deliberately not here: a bare percentage next to a
// retirement age reads as a second age, and the number means nothing without the
// threshold beside it. It is stated where it is explained, on the readiness step
// and on the page this links to.
//
// Hover is an inset ring rather than a tint change, because both fills are
// already tinted and going lighter on hover reads as going away. It matches the
// ring StatePill puts on the current step.

function RetirementVerdict({ retirement }: { retirement: NonNullable<PathSummary['retirement']> }) {
  const onTrack = retirement.verdict === 'on_track';
  return (
    <Link
      href="/retirement"
      className={`ui-focus touch-target group inline-flex items-center gap-1.5 h-8 pl-3 pr-2.5 rounded-full text-[12.5px] font-bold transition-shadow ${
        onTrack
          ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))] hover:shadow-[inset_0_0_0_1.5px_var(--ui-brand-ring)]'
          : 'bg-caution-soft text-caution hover:shadow-[inset_0_0_0_1.5px_rgb(var(--ui-caution)/0.45)]'
      }`}
    >
      {onTrack
        ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />
        : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
      {onTrack
        ? `On track to retire at ${retirement.retirementAge}`
        : `Not on track to retire at ${retirement.retirementAge}`}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

// ── LevelRow — a compact, tappable index row ─────────────────────────────────

function LevelRow({ step, state, isSelected, onSelect }: {
  step: PathStep;
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
        aria-expanded={isSelected}
        className={`ui-focus flex items-center gap-3.5 w-full text-left min-h-touch py-3.5 px-3.5 rounded-ui-md transition-colors group`}
        style={isCurrent ? { background: 'var(--ui-brand-soft)' } : undefined}
      >
        <span
          className="grid place-items-center h-[42px] w-[42px] shrink-0 rounded-[13px]"
          style={{ background: chipBg, color: chipFg, opacity: isSkipped ? 0.6 : 1 }}
        >
          {isComplete ? <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> : <Icon className="h-[18px] w-[18px]" />}
        </span>

        <span className="flex-1 min-w-0 flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-content-muted">
            Step {step.order}
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

// ── DebtAccountRow — one named account behind a debt level ───────────────────
//
// Local to this page on purpose: the app's live "account row that drills to
// /accounts/:id" is the one in pages/Accounts.tsx, and this copies its idiom
// (name + mask, secondary line, right-aligned balance, chevron) rather than
// forking a shared abstraction for three call sites in one file. It uses a
// real <Link>, so middle-click and Enter behave like links everywhere else.

/**
 * A rate is shown to at most 2 decimals, trailing zeros dropped. 0 is a real
 * rate (a 0% promo card) and is shown as one — conflating it with a missing
 * rate is the bug this whole change exists to remove.
 *
 * No rate on file reads `Add rate`, not `Rate not set`. The gap decides which
 * level this account is counted under, the row already links to the page where
 * the rate is editable, and naming the gap without saying it is fixable leaves
 * the user at a dead end.
 */
function aprLabel(apr: number | null): string {
  if (apr == null) return 'Add rate';
  return `${Math.round(apr * 100) / 100}% APR`;
}

function DebtAccountRow({ account }: { account: LevelDebtAccount }) {
  const name = stripAccountMask(account.name, account.mask);
  const rate = aprLabel(account.apr);

  // A `title` that repeats text the user can already read is a tooltip for
  // nothing, so it is offered only when the name is actually clipped.
  const nameRef = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [name]);

  return (
    // The hover tint and focus ring are pulled wider than the text so the text
    // isn't flush against the tint edge, but only 4px on mobile, where the
    // card's padding is 14px and the ring has to clear its 4px accent rail.
    // px cancels mx, so the divider stays inside either way, level with this
    // card's other rules.
    <Link
      href={`/accounts/${account.id}`}
      className="ui-focus group block rounded-ui-sm -mx-1 px-1 transition-colors hover:bg-brand-softer sm:-mx-2 sm:px-2"
    >
      <span className="flex items-center gap-3 border-t border-line py-3 group-first:border-t-0">
        <span className="min-w-0 flex-1">
          {/* The mask rides the muted line, not the name line. Accounts.tsx can
              afford them side by side across a full-width page; this panel is
              360px, where the mask's ~49px truncated ordinary names like
              "Sallie Mae Student Loan" and naming the account is the point. */}
          <span
            ref={nameRef}
            className="block truncate text-[14.5px] font-bold leading-tight"
            title={clipped ? name : undefined}
          >
            {name}
          </span>
          {/* The card above already states the balance and the rate, so the
              second line appears only when there is something new to say: the
              prompt to add the rate this account is missing. */}
          {account.apr == null && (
            <span className="mt-0.5 block text-[12.5px] font-semibold text-[rgb(var(--ui-brand-ink))]">
              {rate}
            </span>
          )}
        </span>

        <ChevronRight size={16} className="shrink-0 text-content-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

// ── DebtAccountLink — the one account a debt step acts on ───────────────────
//
// No heading and no balance: the card above is titled with the account and has
// just stated what it owes. What the row adds is the account's rate (or the
// prompt to add one) and the way through to the account itself, which is where
// both are editable.

function DebtAccountLink({ step }: { step: PathStep }) {
  // A $0 balance is not something to pay off — rendering it is noise. Test the
  // value a row would print: a 40-cent balance renders as `$0` too.
  const account = (step.accounts ?? []).find((a) => Math.round(Math.abs(a.balance)) > 0);
  if (!account) return null;

  return (
    // -mb-4 cancels most of the action row's own mt-5 below, so the row sits
    // 16px inside its rule at both ends instead of 16 top / 32 bottom.
    <div className="mt-5 -mb-4 border-t border-line pt-1">
      <DebtAccountRow account={account} />
    </div>
  );
}

// ── GoalLink — the goal a goal step acts on ─────────────────────────────────
//
// Same idiom as the account row above, and the same reason: the step is about
// one object, so the card ends with the way through to it.

function GoalLink({ goal }: { goal: NonNullable<PathStep['goal']> }) {
  return (
    <div className="mt-5 -mb-4 border-t border-line pt-1">
      <Link
        href={`/plans/savings/${goal.id}`}
        className="ui-focus group block rounded-ui-sm -mx-1 px-1 transition-colors hover:bg-brand-softer sm:-mx-2 sm:px-2"
      >
        <span className="flex items-center gap-3 py-3">
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold leading-tight">
            {goal.name}
          </span>
          <ChevronRight size={16} className="shrink-0 text-content-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </Link>
    </div>
  );
}

// ── FocusArticle — the selected step, as a Bright action card ────────────────

function FocusArticle({ step, state, skipped, hideHeader = false, onSkip, onAsk, onComplete, onUndoComplete }: {
  step: PathStep;
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
    // A savings rate is a flow, not a balance. "saved of target" would read the
    // month's surplus as a pot of money that has been put aside.
    else if (step.kind === 'savings-rate' || step.kind === 'retirement-readiness')
      progressDetail = `${fmt(step.current)} of ${fmt(step.target)} a month`;
    else progressDetail = `${fmt(step.current)} saved of ${fmt(step.target)} target`;
  }
  const hasProgress = !isComplete && fill > 0;

  return (
    <article className="relative overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6">
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
          <span className="text-[13px] font-semibold text-content-muted">
            Step {step.order}
          </span>
          <span className="ml-auto"><StatePill state={state} /></span>
        </div>
      )}

      <h3 className="font-editorial text-[20px] sm:text-[22px] font-bold leading-[1.18] tracking-[-0.02em] text-content">
        {step.title}
      </h3>
      {/* `why` is this person's own reason, in their own figures, so it leads.
          The generic argument follows it. The short `subtitle` form is what the
          home summary shows and would only repeat `why` here. */}
      {step.why && (
        <p className="mt-2 text-[14.5px] leading-[1.5] font-semibold text-content max-w-[58ch]">{step.why}</p>
      )}
      {step.description && (
        <p className="mt-2.5 text-[14px] leading-[1.6] text-content-secondary max-w-[58ch]">{step.description}</p>
      )}

      {hasProgress && (
        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-content-muted">Progress</span>
            <span className="text-[12.5px] font-bold text-[rgb(var(--ui-brand-ink))] ui-tnum">
              {fill}%{progressDetail ? ` (${progressDetail})` : ''}
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

      {/* "Next step" is only real for the step you're on — steps ahead would
          just show generic filler, so hide it for them. */}
      {state === 'current' && step.action && (
        <div className="mt-5 rounded-ui-lg border border-line bg-canvas-sunken/50 p-3.5">
          <div className="text-[13px] font-semibold text-content-muted mb-1.5">Next step</div>
          <p className="text-[14px] leading-[1.5] font-semibold text-content">{step.action}</p>
        </div>
      )}

      {/* Off the current step there is no "Next step" box, so the figure the
          note qualifies had nowhere to appear: step 12 read "The $840 minimum is
          our estimate" with no $840 anywhere on the card. A step you are not on
          still states the fact, it just does not issue the order. */}
      {state !== 'current' && step.fact && (
        <p className="mt-5 text-[14px] leading-[1.5] font-semibold text-content">{step.fact}</p>
      )}

      {/* Anything the figures above would otherwise be read as, but aren't — an
          estimated minimum payment is not the lender's own number. This sits
          OUTSIDE the "Next step" box on purpose: it used to be inside, so the
          disclosure appeared only while you happened to be standing on the step,
          and the same estimated figure went unqualified everywhere else. */}
      {step.notes.length > 0 && (
        <div className="mt-4">
          {step.notes.map((n) => (
            <p key={n} className="text-[12.5px] leading-[1.45] text-content-muted">{n}</p>
          ))}
        </div>
      )}

      {/* Not gated on the step being complete: when the figures take the
          decision back off a tick, the note the user typed is exactly what
          explains the step's history, and hiding it there loses their words in
          the one case worth keeping them for. */}
      {step.note && (
        <div className="mt-5">
          <div className="text-[13px] font-semibold text-content-muted mb-1">
            {isComplete ? 'Your note' : 'Your note from when you marked this done'}
          </div>
          <p className="text-[14px] italic text-content-secondary">"{step.note}"</p>
        </div>
      )}

      <DebtAccountLink step={step} />
      {step.goal && <GoalLink goal={step.goal} />}

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
            className="ui-focus touch-target h-9 px-3 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
          >
            Undo
          </button>
        )}
        {!isComplete && (
          <button
            type="button"
            onClick={onSkip}
            className="ui-focus touch-target h-9 px-3 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
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
            placeholder="Add a note (optional), e.g. 'Got Geico quote, saved $340/year'"
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
  const [data, setData] = useState<PathData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skippedStepIds, setSkippedStepIds] = useState<Set<string>>(new Set());
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const { openChat } = useChatStore();
  const toast = useToast();

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
    } catch (err) {
      setSkippedStepIds(prev => {
        const next = new Set(prev);
        if (isCurrentlySkipped) { next.add(stepId); } else { next.delete(stepId); }
        return next;
      });
      toast({ tone: 'negative', title: err instanceof Error && err.message ? err.message : "Couldn't update this step. Try again." });
    }
  };

  const handleCompleteStep = async (stepId: string, note: string = '') => {
    try {
      await api.completePriorityStep(stepId, true, note);
      const d = await api.getFinancialPath();
      setData(d);
    } catch (err) {
      toast({ tone: 'negative', title: err instanceof Error && err.message ? err.message : "Couldn't update this step. Try again." });
    }
  };

  const handleUndoComplete = async (stepId: string) => {
    try {
      await api.completePriorityStep(stepId, false, '');
      const d = await api.getFinancialPath();
      setData(d);
    } catch (err) {
      toast({ tone: 'negative', title: err instanceof Error && err.message ? err.message : "Couldn't update this step. Try again." });
    }
  };

  useEffect(() => {
    api.getFinancialPath()
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
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
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
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <EmptyState
        icon={<AlertCircle className="h-7 w-7" />}
        title="Couldn't load your path"
        description={error}
      />
    </div>
  );

  if (!data) return null;

  const { steps, currentStepId, summary } = data;

  // ── No-data empty state ──
  const hasNoData = summary.monthlyIncome === 0 && summary.totalCash === 0 && summary.totalInvested === 0;
  if (hasNoData) return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <header className="animate-fade-in">
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em]">Financial Level</h1>
      </header>
      <EmptyState
        className="mt-8"
        icon={<Rocket className="h-8 w-8" />}
        title="Let's build your plan"
        description="Add your income and accounts and we'll build the steps that apply to you."
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
  const renderFocus = (step: PathStep, inline = false) => (
    <FocusArticle
      step={step}
      state={levelStateOf(step, currentStepId, skippedStepIds)}
      skipped={skippedStepIds.has(step.id)}
      hideHeader={inline}
      onSkip={() => handleSkipStep(step.id)}
      onComplete={handleCompleteStep}
      onUndoComplete={handleUndoComplete}
      onAsk={() => openChat(
        `Help me with this step on my financial path:\n\nTitle: ${step.title}\nWhy it's on my path: ${step.why}\nDescription: ${step.description || step.subtitle}\n\nWhat exactly should I do, and why does it matter for my finances?`
      )}
    />
  );

  const surplusTone: 'pos' | 'neg' | undefined =
    summary.monthlySurplus == null ? undefined :
    summary.monthlySurplus >= 0 ? 'pos' : 'neg';
  const investedOrCash = summary.totalInvested > 0 ? summary.totalInvested : summary.totalCash;
  const investedLabel = summary.totalInvested > 0 ? 'total portfolio' : summary.totalCash > 0 ? 'cash holdings' : 'link accounts';

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="animate-fade-in">
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em]">
          Financial Level
        </h1>
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
              {allComplete ? 'Every step done' : 'Current step'}
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="font-editorial text-[58px] sm:text-[68px] font-extrabold leading-[0.85] tracking-[-0.03em] text-[rgb(var(--ui-brand-ink))] ui-tnum">
                {allComplete ? steps.length : currentStep.order}
              </span>
              <span className="font-editorial text-[18px] font-bold text-content-muted ui-tnum">of {steps.length}</span>
            </div>
            {/* When every step is done the panel below says so and offers the
                next move, so this line would only repeat it. The kicker above
                already says this is the current step, so the name stands on its
                own rather than being read into a sentence an imperative title
                cannot finish. */}
            {!allComplete && (
              <>
                <p className="mt-3 text-[14.5px] font-bold leading-[1.5] text-content max-w-[40ch]">
                  {currentStep.title}
                </p>
                {/* Only when there is no verdict to show instead. A profile
                    echo does not earn the footer band the verdict gets. */}
                {!summary.retirement && summary.retirementAgeSet && (
                  <p className="mt-1 text-[13px] font-medium text-content-muted">
                    FI target age {summary.retirementAge}
                  </p>
                )}
              </>
            )}

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
                  {completeCount} {completeCount === 1 ? 'step' : 'steps'} cleared
                </span>
                <span className="text-[12px] font-semibold text-content-muted ui-tnum">{clearedPct}%</span>
              </div>
            </div>

          </div>

          {/* progress rail — one segment per step, colored by state */}
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

        {/* The verdict the retirement simulation reached, which the target age
            alone never told anyone. It links through to the page that shows the
            run behind it. Absent entirely when we cannot compute one, and the
            target age stands in as before, as a quiet line in the column above.

            It closes the panel rather than sitting under the step name, because
            a rounded pill directly under a title on this page means that step's
            status, and amber there read as a warning about the employer-match
            step. Below both columns it is last on mobile too, so it never
            splits the two progress readouts. */}
        {summary.retirement && (
          <div className="relative mt-6 pt-5 border-t border-line">
            <RetirementVerdict retirement={summary.retirement} />
          </div>
        )}
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
            title="Every step done"
            description="You've worked through every step on your path. Time to fine-tune your plan. Ask Lasagna what's next."
            action={
              <Button
                onClick={() => openChat(`I've finished all ${steps.length} steps on my financial path. What should I focus on next?`)}
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
            <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">
              Your {steps.length} {steps.length === 1 ? 'step' : 'steps'}
            </h2>
            <span className="flex-1 h-px bg-line min-w-[12px]" aria-hidden />
            <WhyThisPathPopover steps={steps} surplus={summary.monthlySurplus} />
          </div>
          <p className="mt-2 text-[13.5px] font-medium text-content-muted">
            Earlier steps usually pay off most, but you can work them in any order.
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
                <h3 className="text-[15px] font-semibold text-content mb-3">Current focus</h3>
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
