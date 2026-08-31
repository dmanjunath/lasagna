import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Gift, Flame, HeartPulse, Sprout,
  TrendingUp, CreditCard, Rocket, Target, Home,
  AlertCircle, Check, ChevronRight, Sparkles, ArrowRight, Info,
  PiggyBank, Layers, Wallet, Percent, LineChart, ScrollText,
} from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { api } from '../lib/api';
import { actionArea } from '../lib/action-destination';
import { useInsights, type Insight } from '../hooks/useInsights';
import { stripAccountMask } from '../lib/utils';
import { useChatStore } from '../lib/chat-store';
import { useAuth } from '../lib/auth';
import type { LucideIcon } from 'lucide-react';
import { Button, EmptyState, Skeleton, Textarea, useToast } from '../components/uikit';
import { type LevelState, levelStateOf, SegmentedRail, LegendSwatch } from '../components/common/level-rail';
import { ActionItem } from '../components/common/action-item';

// ── constants ────────────────────────────────────────────────────────────────

// `target` is the same mark the Goals nav uses, so a goal reads as a goal
// wherever it appears. `home` keeps a mortgage from wearing a card's flame.
const iconMap: Record<string, LucideIcon> = {
  shield: Shield, gift: Gift, flame: Flame, 'heart-pulse': HeartPulse,
  sprout: Sprout, 'trending-up': TrendingUp, 'credit-card': CreditCard, rocket: Rocket,
  'alert-circle': AlertCircle, 'piggy-bank': PiggyBank, layers: Layers,
  target: Target, home: Home, wallet: Wallet, percent: Percent, 'line-chart': LineChart,
  'scroll-text': ScrollText,
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
  /** Why it sits at this point of the path. Empty when nothing chose an order. */
  reason: string;
  icon: string; status: string; current: number | null;
  target: number | null; progress: number;
  monthlyFunding: number;
  projectedDate: string | null;
  action: string;
  /** A step whose target is a monthly rate. It never takes the current-step
   *  pointer, so it renders its own instruction rather than waiting for one. */
  rateShaped: boolean;
  /** Where an unfinished step stands. Never an instruction, empty once done. */
  fact: string;
  /** Anything the figures would otherwise imply but not state. */
  notes: string[];
  /** What they wrote when they marked this step. Empty when nothing. */
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
  steps: PathStep[];
  /**
   * Steps that are not on the path: the ones this person took off, and the ones
   * their plan left out. Not counted, not numbered, offered back.
   */
  offPath: Array<{ id: string; title: string; reason: string; byYou: boolean }>;
  currentStepId: string;
  updatedAt: string;
  updatedReason: string;
  /** Who chose this order. The explanation below differs by which. */
  orderSource: 'model' | 'deterministic';
  summary: PathSummary;
}

/**
 * What last changed this person's path, in their own terms.
 *
 * The path is stored and only regenerates on an event, so a page that showed a
 * sequence without saying when it was settled leaves the reader guessing
 * whether it is today's answer or last year's.
 *
 * The date comes before the cause because the other way round reads two ways:
 * "Rebuilt when you added a goal on August 27" says either that the path was
 * rebuilt that day or that the goal was dated that day.
 *
 * A cause is named only where the server knows one. `inputs_changed` is the
 * catch-all it falls back to when the digest of the ordering inputs no longer
 * matches and nothing says which input moved. A release that changes what that
 * digest is taken over lands there as well, with nothing about the household
 * changed, so "after your figures changed" would be a sentence the reader knows
 * to be false. The date alone is true in every case.
 */
const UPDATE_CAUSE: Record<string, string> = {
  goal_added: 'after you added a goal',
  goal_updated: 'after you changed a goal',
  goal_removed: 'after you removed a goal',
  step_completed: 'after you marked a step done',
  debt_added: 'after a new balance appeared',
  debt_cleared: 'after a balance was cleared',
};

function updatedLine(updatedAt: string, reason: string): string {
  const on = new Date(updatedAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  if (reason === 'no_active_path') return `Built for you on ${on}.`;
  const cause = UPDATE_CAUSE[reason];
  return cause ? `Updated ${on}, ${cause}.` : `Updated ${on}.`;
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
// done is the calm brand-soft, future is a quiet neutral.
const STATE_ACCENT: Record<LevelState, string> = {
  done: 'rgb(var(--ui-brand))',
  current: 'rgb(var(--ui-brand))',
  ongoing: 'rgb(var(--ui-brand))',
  future: 'rgb(var(--ui-content-faint))',
};

// ── StatePill — small status chip, never color-only ──────────────────────────

function StatePill({ state, rateShaped = false, className = '' }: {
  state: LevelState;
  /**
   * A step whose target is a monthly rate. `levelStateOf` already reads it, so
   * this is only the belt to that braces: nothing about a standing condition is
   * ahead of the reader, and nothing about it is finished either.
   */
  rateShaped?: boolean;
  className?: string;
}) {
  const base = `inline-flex items-center gap-1 h-[22px] px-2.5 rounded-full text-[10.5px] font-extrabold uppercase tracking-[0.06em] whitespace-nowrap ${className}`;
  // Before either verdict, because a standing monthly condition is neither.
  // Read only in `future`, the pill said Ongoing while short and then wore a
  // DONE tick the month the rate was met, which is the same overclaim the
  // Ahead-to-Ongoing change existed to remove, in the other direction.
  if (state === 'ongoing' || rateShaped)
    return <span className={`${base} bg-brand-soft text-[rgb(var(--ui-brand-ink))]`}>Ongoing</span>;
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
  return <span className={`${base} bg-canvas-sunken text-content-muted`}>Ahead</span>;
}

// ── WhyThisPathPopover — Bright panel ────────────────────────────────────────

function WhyThisPathPopover({ steps, surplus, orderSource }: {
  steps: PathStep[];
  surplus: number | null;
  /** Who chose the sequence. Two different true sentences, never one. */
  orderSource: 'model' | 'deterministic';
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // The trigger sits beside a section heading well down the page, so on a
    // 390 wide screen the panel opened entirely below the fold and the reader
    // saw nothing happen. Bounded above and brought into view here, so opening
    // it always shows it.
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const debtSteps = steps.filter(s => s.kind === 'debt');
  const debtCount = debtSteps.length;
  const goalCount = steps.filter(s => s.kind === 'goal').length;
  // How many balances on the path actually report a rate. Most do not, and the
  // order falls back to where accounts of that type usually sit. The step's own
  // card says exactly that, so a panel one click away claiming every balance is
  // placed by its rate was contradicted by the thing it was describing.
  const ratedDebtCount = debtSteps.filter(s => s.accounts?.[0]?.apr != null).length;
  // Written for the number of balances actually there. "Balances sit by their
  // interest rate, highest first" is a sentence about a list, and a household
  // with one rated balance has no list.
  const debtOrderLine =
    ratedDebtCount === debtCount
      ? debtCount === 1
        ? 'Your balance sits where its own interest rate puts it, which is not a judgement call.'
        : 'Balances sit by their interest rate, highest first, which is not a judgement call.'
      : ratedDebtCount === 0
      ? debtCount === 1
        ? 'Your lender reports no rate, so the balance sits where accounts of its type usually sit, until you add one.'
        : 'No lender on your path reports a rate, so each balance sits where accounts of its type usually sit, until you add one.'
      : ratedDebtCount === 1
      ? 'The one balance that reports a rate sits where that rate puts it. The rest sit where accounts of their type usually sit, until you add one.'
      : 'The balances that report a rate sit by it, highest first. The rest sit where accounts of their type usually sit, until you add one.';

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
        aria-controls="why-these-steps"
        className="ui-focus touch-target inline-flex items-center gap-1.5 h-9 px-3 rounded-ui-md text-[12.5px] font-bold text-content-muted hover:bg-brand-softer hover:text-brand transition-colors"
      >
        <Info className="h-[15px] w-[15px]" />
        Why these steps?
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-[49]" />
          {/* A disclosure, not a dialog. It holds nothing focusable and traps
              nothing, so calling it a dialog promised a modal that was not
              there: Tab from the trigger walked straight into the list behind
              it. Escape and a click outside still close it.

              Bounded and scrollable because at 390 wide it opens 129px below
              the fold, and a panel taller than the viewport cannot be read to
              its end. */}
          <div
            id="why-these-steps"
            ref={panelRef}
            className="absolute top-full right-0 mt-2 z-[50] w-[min(360px,calc(100vw-36px))] max-h-[min(70vh,560px)] overflow-y-auto rounded-ui-xl border border-line bg-panel-raised shadow-ui-lg p-5"
          >
            <p className="mb-2.5 text-[13.5px] leading-relaxed text-content-secondary">
              These {steps.length} steps are built from your own accounts, goals and profile.
              {madeOf.length > 0 && <> One step each for {madeOf.join(' and ')}, named individually.</>}
              {' '}Anything that does not apply to you is left out rather than shown greyed.
            </p>
            {/* Two orders are possible and they were not chosen the same way,
                so this says which one the reader is looking at. Claiming a
                sequence was weighed against somebody's situation when it is the
                default rail is simply false, and the reader has no way to tell.
                Balances are placed the same way under both, and the sentence
                about them says which of the two placements they actually got:
                most lenders report no rate, so most balances sit by type. */}
            <p className="mb-2.5 text-[13.5px] leading-relaxed text-content-secondary">
              {orderSource === 'model' ? (
                <>
                  The order is chosen for <strong className="font-bold text-content">your situation</strong>,
                  not read off a fixed list. What protects you is weighed against what you are saving for, so a
                  goal with a date close by can sit ahead of a step that would come first for someone else.
                </>
              ) : (
                <>
                  The order is our <strong className="font-bold text-content">default sequence</strong>: steady
                  ground first, then what protects you, then what compounds.
                </>
              )}
              {debtCount > 0 && <> {debtOrderLine}</>}
              {' '}It holds until something on your path changes, and the line under the
              title says when it last did.
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
  const Icon = iconMap[step.icon] ?? Layers;

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
        // A hover surface, like every other row that opens something on this
        // page: the account row and the "Why these steps?" trigger both take
        // `hover:bg-brand-softer`. A title changing colour under the cursor is
        // not a target, and on a row 42px tall it is most of the row saying
        // nothing. The current row already carries the louder tint.
        className={`ui-focus flex items-center gap-3.5 w-full text-left min-h-touch py-3.5 px-3.5 rounded-ui-md transition-colors group${isCurrent ? '' : ' hover:bg-brand-softer'}`}
        style={isCurrent ? { background: 'var(--ui-brand-soft)' } : undefined}
      >
        <span
          className="grid place-items-center h-[42px] w-[42px] shrink-0 rounded-[13px]"
          style={{ background: chipBg, color: chipFg }}
        >
          {isComplete ? <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> : <Icon className="h-[18px] w-[18px]" />}
        </span>

        <span className="flex-1 min-w-0 flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-content-muted">
            Step {step.order}
          </span>
          <span className="font-editorial text-[15.5px] font-bold leading-[1.2] tracking-[-0.012em] line-clamp-2 text-content transition-colors group-hover:text-brand">
            {step.title}
          </span>
          {/* Mobile: the pill lives on its own line so it never eats the name. */}
          <StatePill state={state} rateShaped={step.rateShaped} className="sm:hidden mt-0.5 self-start" />
        </span>

        {/* Desktop/tablet: pill sits inline at the end of the row. */}
        <StatePill state={state} rateShaped={step.rateShaped} className="hidden sm:inline-flex" />
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

function FocusArticle({ step, state, actions, hideHeader = false, canMark, onAsk, onMark, saving, draft, onDraft }: {
  step: PathStep;
  state: LevelState;
  /** The open actions that serve this step. Empty for a step that has none. */
  actions: Insight[];
  hideHeader?: boolean;
  onAsk: () => void;
  onMark: (id: string, status: 'pending' | 'done' | 'not_applicable', note?: string) => Promise<boolean>;
  /** The mark the page has in flight, if any. Held there, not here: tapping
   *  another row remounts this card, and the guard has to outlive that. */
  /**
   * False for a demo account, whose every write is refused by the server. The
   * controls were live, and a tap answered with a toast saying to try again,
   * which is not something a demo reader can ever succeed at.
   */
  canMark: boolean;
  saving: { id: string; status: 'pending' | 'done' | 'not_applicable' } | null;
  /** What is typed into this step's note, or undefined when it is not open.
   *  Held by the page for the same reason `saving` is: tapping another row
   *  remounts this card, and a half-written sentence has to outlive that. */
  draft: string | undefined;
  onDraft: (value: string | undefined) => void;
}) {
  const [, navigate] = useLocation();
  const pendingDone = draft !== undefined;
  const busy = saving !== null;
  const spinning = (status: 'pending' | 'done' | 'not_applicable') =>
    saving?.id === step.id && saving.status === status;
  const isComplete = step.status === 'complete';
  const Icon = iconMap[step.icon] ?? Layers;
  const accent = STATE_ACCENT[state];
  const greenText = state === 'done' || state === 'current';

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
          <span className="ml-auto"><StatePill state={state} rateShaped={step.rateShaped} /></span>
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

      {/* `why` and `description` both argue for the step. This argues for its
          POSITION, which is the one part of the path that was chosen for this
          person rather than computed, so it is labelled to keep it from reading
          as a third explanation and sits after the two that are. Absent, and
          nothing renders, on a path whose order nobody chose. */}
      {step.reason && (
        <div className="mt-4">
          <div className="text-[13px] font-semibold text-content-muted mb-1">Why it sits here</div>
          {/* Same leading as `description`. They are the same size and colour
              and sit next to each other, so a tighter one visibly breaks the
              rhythm once this runs past a line. */}
          <p className="text-[14px] leading-[1.6] text-content-secondary max-w-[58ch]">{step.reason}</p>
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

      {/* Off the current step there is no "Next step" box, so without this a
          card you are not standing on carries no figure at all: an estimated
          minimum was qualified with no minimum shown anywhere, and a measured
          step named neither what is saved nor what it is aiming at. A step you
          are not on still states where it stands, it just does not issue the
          order.

          A rate step is the exception, and states its instruction here instead.
          It never takes the "you are here" pointer, because its target is a
          monthly rate it can sit short of for years, so the box above will
          never render for it and the one number that matters on it is the one
          it is asking for. Heading this "Next step" on a card nobody is
          standing on would be the wrong claim, so it takes the same quiet line
          every other unreached step gets. */}
      {state !== 'current' && step.rateShaped && step.action && (
        <div className="mt-5 rounded-ui-lg border border-line bg-canvas-sunken/50 p-3.5">
          {/* Not "Next step": nobody is standing on this card. It is a rate
              that has to hold every month, so the heading says which, and the
              box distinguishes an order from the plain readings below. */}
          <div className="text-[13px] font-semibold text-content-muted mb-1.5">Every month</div>
          <p className="text-[14px] leading-[1.5] font-semibold text-content">{step.action}</p>
        </div>
      )}
      {state !== 'current' && !step.rateShaped && step.fact && (
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

      {/* What to actually do at this step. Actions used to be a separate feed
          ordered by urgency alone, with nothing saying which part of the plan
          any of them served. Each one still opens the page it always opened. */}
      {actions.length > 0 && (
        <div className="mt-5">
          <h4 className="text-[13px] font-semibold text-content-muted mb-2">
            {actions.length === 1 ? 'Action for this step' : 'Actions for this step'}
          </h4>
          <div className="flex flex-col gap-2">
            {actions.map((a) => (
              <ActionItem
                key={a.id}
                title={a.title}
                tag={(a.type ?? a.category ?? 'general').toUpperCase()}
                description={a.description}
                impact={a.impact ?? ''}
                impactColor={(a.impactColor as 'green' | 'amber' | 'red') ?? 'amber'}
                chatPrompt={a.chatPrompt ?? a.title}
                // The desktop panel is 360px wide at any viewport, so the row
                // has to lay itself out for the column it is in, not the screen.
                compact
                onContextClick={() => navigate(actionArea(a.type, a.category).link)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-5 pt-4 flex-wrap border-t border-line">
        <Button size="sm" onClick={onAsk} trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
          Walk me through this
        </Button>
        {/* A step the figures measure completes itself off the balance behind
            it, so there is nothing here to tick: a button that appeared to set
            it and then did not would be worse than none. */}
        {canMark && !isComplete && !isAutoTracked(step) && !pendingDone && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDraft('')} leadingIcon={<Check className="h-3.5 w-3.5" />}>
            Mark done
          </Button>
        )}
        {canMark && isComplete && !isAutoTracked(step) && (
          <Button size="sm" variant="ghost" loading={spinning('pending')} disabled={busy} onClick={() => { void onMark(step.id, 'pending'); }}>
            Undo
          </Button>
        )}
        {/* Hidden while the note is open. It sat directly above the field, so
            one mis-tap threw away what they had typed and took the step off the
            path. `Mark done` is hidden there for the same reason. */}
        {canMark && !isComplete && !pendingDone && (
          <Button size="sm" variant="ghost" loading={spinning('not_applicable')} disabled={busy} onClick={() => { void onMark(step.id, 'not_applicable'); }}>
            Not applicable to me
          </Button>
        )}
      </div>

      {!isComplete && !isAutoTracked(step) && pendingDone && (
        <div className="mt-3.5">
          <Textarea
            autoFocus
            value={draft ?? ''}
            onChange={e => onDraft(e.target.value)}
            placeholder="Add a note (optional), e.g. 'Got Geico quote, saved $340/year'"
            rows={2}
            className="ui-tnum"
          />
          <div className="flex gap-2 mt-2.5">
            <Button
              size="sm"
              loading={spinning('done')}
              onClick={async () => {
                // Only clear what they typed once it is stored. The composer
                // used to close either way, so a failed save threw the note away
                // and left the step exactly as it was.
                if (await onMark(step.id, 'done', draft ?? '')) onDraft(undefined);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDraft(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

// ── Financial Level ──────────────────────────────────────────────────────────

export function FinancialLevel() {
  const [data, setData] = useState<PathData | null>(null);
  const [loading, setLoading] = useState(true);
  // A flag, not the server's sentence. The message is upstream's, written for
  // an operator, and putting it on the page leaked a database host and a
  // request id at a reader who can do nothing with either.
  const [failed, setFailed] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  // Which mark is in flight, held on the page rather than in the card. Calling
  // a step done reopens the order, which runs as long as a model call, and a
  // guard living in the card was lost the moment another row was tapped.
  const [saving, setSaving] = useState<{ id: string; status: 'pending' | 'done' | 'not_applicable' } | null>(null);
  // What is typed into each step's note composer, by step id. A key present
  // means that step's composer is open. Held here rather than in the card
  // because the card unmounts the moment another row is tapped, and dropping a
  // half-written sentence for that is the same loss as dropping it on a failed
  // save. Coming back to the row finds it exactly as it was left.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const setNoteDraft = (stepId: string, value: string | undefined) =>
    setNoteDrafts(prev => {
      if (value === undefined) {
        const { [stepId]: _closed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [stepId]: value };
    });
  const focusRef = useRef<HTMLDivElement>(null);
  // The open actions, so a step can show the ones that serve it. One list for
  // the page, filtered per step, rather than a request per panel.
  const { insights } = useInsights();
  const { openChat } = useChatStore();
  const toast = useToast();
  // A demo account is refused every write by the API, so the controls that
  // write are not offered to one. Hidden rather than disabled: a row of dead
  // buttons on every step is more of the page than the refusal is worth, and
  // the demo path is there to be read.
  const { user } = useAuth();
  const canMark = !user?.isDemo;

  // Below the side-panel breakpoint the detail expands inline beneath the tapped
  // row (accordion); at or above it, the detail lives in a sticky side panel.
  //
  // 1280px is where the list still reads once the panel has taken its 360. The
  // sidebar, the page gutters, the panel and its gap cost about 790px between
  // them, so at 1080 the list was 290px wide and the step you are standing on
  // rendered as "Ca / y..". A panel is not worth the column it takes until
  // there is a column left over.
  const [isStacked, setIsStacked] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)');
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

  // Every action on a step goes through here. The response IS the path after
  // the mark, so there is no second read to fall out of step with the first.
  //
  // It returns its promise on purpose: marking a step done can reopen the order,
  // which takes as long as a model call, and a control that closed instantly and
  // then did nothing for fifteen seconds invited a second one.
  const markStep = async (
    stepId: string,
    status: 'pending' | 'done' | 'not_applicable',
    note?: string,
  ): Promise<boolean> => {
    // Read before the write: a step taken off the path is gone from the next
    // response, and the undo below has to be able to name it.
    const title = data?.steps.find(s => s.id === stepId)?.title ?? 'That step';
    setSaving({ id: stepId, status });
    try {
      const next = await api.markPathStep(stepId, status, note);
      setData(next);
      // A step just taken off the path is gone from the list, so the panel
      // would be showing a step that is no longer there. Fall back to where
      // they now are.
      setSelectedStepId(prev =>
        next.steps.some(s => s.id === prev) ? prev : next.currentStepId,
      );
      // Taking a step off the path makes it vanish and every number after it
      // change. Say so, and offer it straight back, rather than leaving the only
      // way out at the bottom of the page.
      if (status === 'not_applicable') {
        toast({
          title: `${title} is off your path`,
          duration: 8000,
          // The uikit button, not a text link. Once the toast expires this is
          // the only way back short of scrolling to the bottom of the page, so
          // it has to be a target a thumb can hit. The negative margin cancels
          // the button's own padding, so the label still lines up under the
          // title rather than sitting indented from it.
          description: (
            <Button
              size="sm"
              variant="ghost"
              className="-ml-3.5"
              onClick={() => { void markStep(stepId, 'pending'); }}
            >
              Put back
            </Button>
          ),
        });
      }
      return true;
    } catch {
      // Our own line, never the server's. The two failures this route has are
      // a malformed body and a key that is not on the path, and neither is
      // something the reader can act on.
      toast({ tone: 'negative', title: "Couldn't update this step. Try again." });
      return false;
    } finally {
      setSaving(null);
    }
  };

  // Named, so the error state can run it again. A failed path read is almost
  // always the upstream being briefly unavailable, and asking again is the
  // whole remedy: without a button the only way out was a browser reload.
  const loadPath = useCallback(() => {
    // `?step=` names the step to open, so a step heading on the actions page
    // reaches the step it names rather than dropping the reader at the top of
    // the path. A key that is not on the path falls back to where they stand.
    const asked = new URLSearchParams(window.location.search).get('step');
    setLoading(true);
    setFailed(false);
    api.getFinancialPath()
      .then(d => {
        setData(d);
        setSelectedStepId(
          asked && d.steps.some(s => s.id === asked) ? asked : d.currentStepId,
        );
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadPath(); }, [loadPath]);

  // ── Loading ──
  if (loading) return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="mt-3 h-4 w-72" />
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
      <Skeleton className="mt-10 h-6 w-40" />
      <div className="mt-5 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-3.5">
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
  //
  // Our own words, the page's own heading, and a way out. The server's message
  // was printed straight through, so a reader met a connection string, an
  // upstream service name and a request id. The mark-a-step handler two hundred
  // lines up already refuses to echo the server for the same reason.
  if (failed) return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <header className="animate-fade-in">
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em]">
          Financial Level
        </h1>
      </header>
      <EmptyState
        className="mt-8"
        tone="negative"
        icon={<AlertCircle className="h-7 w-7" />}
        title="We couldn't load your path"
        description="Your steps and everything you have marked are safe. This is on our side, so trying again usually works."
        action={<Button onClick={loadPath}>Try again</Button>}
      />
    </div>
  );

  if (!data) return null;

  const { steps, offPath, currentStepId, summary } = data;

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

  const states = steps.map(s => levelStateOf(s, currentStepId));
  // Counted off the states the rail is painted from, so the legend can never
  // describe a segment differently from the segment or from the row's own pill.
  // A standing monthly condition was being counted "ahead" beside a pill
  // reading Ongoing.
  const doneCount = states.filter(s => s === 'done').length;
  const ongoingCount = states.filter(s => s === 'ongoing').length;
  const futureCount = states.filter(s => s === 'future').length;

  // Shared between the inline accordion (mobile/tablet) and the sticky side
  // panel (desktop) so the detail markup stays in one place.
  const renderFocus = (step: PathStep, inline = false) => (
    <FocusArticle
      step={step}
      state={levelStateOf(step, currentStepId)}
      actions={insights.filter(a => a.pathStepKey === step.id)}
      hideHeader={inline}
      canMark={canMark}
      onMark={markStep}
      saving={saving}
      draft={noteDrafts[step.id]}
      onDraft={value => setNoteDraft(step.id, value)}
      // Names the step rather than pasting it. The assistant reads the path
      // itself, so a copy of the step travelling with the question could only
      // ever go stale against the one this page is showing.
      onAsk={() => openChat(
        `Walk me through step ${step.order} of my financial path, "${step.title}". What exactly should I do on this step, and why does it sit where it does?`
      )}
    />
  );

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="animate-fade-in">
        <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em]">
          Financial Level
        </h1>
        {/* The order below was settled once and only changes on an event. A
            page that showed a sequence without saying when it was settled
            leaves the reader guessing whether it answers to today. */}
        <p className="mt-2 text-[13px] font-medium text-content-muted">
          {updatedLine(data.updatedAt, data.updatedReason)}
        </p>
        {/* Taking a step off the path, or putting it back, silently changes the
            length and every number after it. A screen reader is told. */}
        <span className="sr-only" role="status">
          {`Your path has ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}.`}
        </span>
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
            <div className="flex items-baseline gap-2.5">
              <span className="font-editorial text-[58px] sm:text-[68px] font-extrabold leading-[0.85] tracking-[-0.03em] text-[rgb(var(--ui-brand-ink))] ui-tnum">
                {allComplete ? steps.length : currentStep.order}
              </span>
              <span className="font-editorial text-[18px] font-bold text-content-muted ui-tnum">of {steps.length}</span>
            </div>
            {/* When every step is done the panel below says so and offers the
                next move, so this line would only repeat it. */}
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
          </div>

          {/* progress rail — one segment per step, colored by state */}
          <div className="min-w-0 w-full">
            <SegmentedRail states={states} />
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                <LegendSwatch state="done" />
                {doneCount} done
              </span>
              {!allComplete && (
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                  <LegendSwatch state="current" />
                  You are here
                </span>
              )}
              {ongoingCount > 0 && (
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                  <LegendSwatch state="ongoing" />
                  {ongoingCount} ongoing
                </span>
              )}
              {futureCount > 0 && (
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                  <LegendSwatch state="future" />
                  {futureCount} ahead
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
            splits the lead from the rail. */}
        {summary.retirement && (
          <div className="relative mt-6 pt-5 border-t border-line">
            <RetirementVerdict retirement={summary.retirement} />
          </div>
        )}
      </section>

      {/* ════════ Levels ════════ */}
      {/* Finishing the path does not delete it. The list was replaced by a
          panel, so somebody who had worked through every step could no longer
          read one back, undo a tick the figures had not taken back for them, or
          see anything they had written. The panel is what is NEW, so it sits
          above the list rather than in place of it, and it says the one thing
          the hero does not already: what to do next. */}
      {allComplete && (
        <section className="mt-10 flex flex-col items-start gap-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">
              Every step done
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-[1.5] font-medium text-content-muted">
              Time to fine-tune your plan.
            </p>
          </div>
          <Button
            className="shrink-0"
            onClick={() => openChat(`I've finished all ${steps.length} steps on my financial path. What should I focus on next?`)}
            trailingIcon={<ArrowRight className="h-4 w-4" />}
          >
            Ask what's next
          </Button>
        </section>
      )}

      {/* section header */}
      <div className="mt-10 flex items-center gap-3 flex-wrap">
        <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">
          Your {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        </h2>
        <span className="flex-1 h-px bg-line min-w-[12px]" aria-hidden />
        <WhyThisPathPopover
          steps={steps}
          surplus={summary.monthlySurplus}
          orderSource={data.orderSource}
        />
      </div>
      <p className="mt-2 text-[13.5px] font-medium text-content-muted">
        Earlier steps usually pay off most, but you can work them in any order.
      </p>

      {/* The same number `isStacked` watches, so the grid never holds a
          column open for a panel that is not rendering into it. */}
      <div className="mt-5 grid grid-cols-1 min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] gap-6 items-start">
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
                state={levelStateOf(step, currentStepId)}
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

      {/* ════════ Off the path ════════
          A step that is not one of your steps takes no number, no segment and
          no share of the month. Two things put one here: you said it does not
          apply to you, or your plan judged it does not belong, and then it
          carries the reason. One list, because what you can do about either is
          the same, and it is here so nothing that applies to you can vanish
          from the page without saying so. */}
      {offPath.length > 0 && (
        // The same two-column grid the step list sits in, so this list is the
        // width of that one. Full width, it ran under the sticky panel and left
        // a thousand pixels of nothing between the title and the button.
        <section className="mt-10 grid grid-cols-1 min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(320px,360px)] gap-6 items-start">
          <div className="min-w-0">
          <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em] text-content">
            Not on your path
          </h2>
          <ul className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-2 sm:px-3.5 py-1">
            {offPath.map(off => (
              <li key={off.id} className="flex items-start gap-3 border-t border-line py-3 px-1.5 first:border-t-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold text-content-secondary">{off.title}</p>
                  {/* Why it is not on the path, where there is something to
                      say. A step you took off yourself says who took it off. A
                      step the plan left out carries the line it wrote. A step
                      the plan never mentioned has no line, and the heading over
                      this list already says it is not on your path, so the row
                      says nothing rather than the same empty sentence three
                      times over. */}
                  {(off.byYou ? 'You said this does not apply to you.' : off.reason) && (
                    <p className="mt-1 text-[13px] leading-[1.5] text-content-muted">
                      {off.byYou ? 'You said this does not apply to you.' : off.reason}
                    </p>
                  )}
                </div>
                {canMark && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    loading={saving?.id === off.id}
                    disabled={saving !== null}
                    onClick={() => { void markStep(off.id, 'pending'); }}
                  >
                    Put back
                  </Button>
                )}
              </li>
            ))}
          </ul>
          </div>
        </section>
      )}
    </div>
  );
}
