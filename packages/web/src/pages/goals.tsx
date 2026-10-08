import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { Plus, Check, Target, ArrowRight, ChevronRight, Clock, Sparkles, RotateCw, Repeat } from 'lucide-react';
import { api } from '../lib/api';
import { formatStoredMonth } from '../lib/utils';
import { useChatStore } from '../lib/chat-store';
import { PageActions } from '../components/common/page-actions';
import { Badge, Button, button, EmptyState, MaskedText, PageMeta, PageMetaItem, PageMetaSkeleton, Skeleton } from '../components/uikit';
import { PageTitle } from '../components/ds/PageTitle';
import { formatCurrency, iconFor, goalAccent, GOAL_PRESETS, fetchFundableAccounts, type Account } from './goal-shared';
import { type GoalDetails } from './goal-details';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Goal {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  monthlyContribution: string | null;
  deadline: string | null;
  category: string;
  details: GoalDetails | null;
  status: string;
  icon: string | null;
  createdAt: string;
  accountIds: string[];
  isAutoTracked: boolean;
}

// ---------------------------------------------------------------------------
// Real target date → a short "Target Mon YYYY" line. The API has a deadline but
// no monthly-pace / projected-ETA, so we surface the actual target date only —
// never a fabricated finish projection.
function targetDateLabel(deadline: string | null): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < Date.now()) return 'Past target date';
  return `Target ${formatStoredMonth(deadline)}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Goals() {
  const [, setLocation] = useLocation();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const { openChat } = useChatStore();

  useEffect(() => {
    api.getGoals()
      .then(({ goals }) => setGoals(goals))
      .catch(console.error)
      .finally(() => setLoading(false));
    fetchFundableAccounts().then(setAccounts).catch(console.error);
  }, []);

  // "Reallocate surplus" on a funded goal: the money conversation belongs in
  // chat — ask how to redirect the monthly amount that was feeding this goal,
  // explicitly grounded in spending, the other goals, and the wider picture so
  // the assistant pulls that data instead of answering generically.
  const reallocate = (goal: Goal) => {
    const monthly = goal.monthlyContribution ? parseFloat(goal.monthlyContribution) : 0;
    const freed = monthly > 0
      ? `I've been putting ${formatCurrency(monthly)}/month toward it, so that amount is now freed up.`
      : `The money I was putting toward it each month is now freed up.`;
    openChat(
      `My "${goal.name}" goal is fully funded. ${freed} ` +
      `Look at my monthly spending, my other goals and their progress and planned contributions, ` +
      `and the rest of my financial picture (debts, recurring bills, net worth), ` +
      `then recommend how to best reallocate that monthly amount, and why.`,
    );
  };

  const activeGoals = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'completed');

  const totalTarget = activeGoals.reduce((s, g) => s + parseFloat(g.targetAmount), 0);
  const totalSaved = activeGoals.reduce((s, g) => s + parseFloat(g.currentAmount), 0);
  // "Funded" = an active goal that has reached its target (distinct from the
  // status==='completed' archive, which the seed data doesn't use).
  const fundedCount = activeGoals.filter(
    g => parseFloat(g.targetAmount) > 0 && parseFloat(g.currentAmount) >= parseFloat(g.targetAmount),
  ).length;
  // Mean per-goal completion — a real, non-duplicative figure (the hero foot
  // already states the dollar amount "to go", so the second KPI shouldn't).
  const avgPct = activeGoals.length
    ? Math.round(
        activeGoals.reduce((s, g) => {
          const t = parseFloat(g.targetAmount);
          const c = parseFloat(g.currentAmount);
          return s + (t > 0 ? Math.min(100, (c / t) * 100) : 0);
        }, 0) / activeGoals.length,
      )
    : 0;

  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
  const open = (id: string) => setLocation(`/plans/savings/${id}`);

  // "active" must exclude goals that have already hit their target, otherwise
  // the header reads "3 active · 1 funded" (implying 4) when only 3 exist.
  const inProgressCount = activeGoals.length - fundedCount;

  const summaryLine = !loading && activeGoals.length > 0 && (
    // One tint per line. Only the live count is a state worth coloring, and
    // brand green beside positive teal at this size read as one green smudge
    // rather than as two meanings. Funded and complete are settled facts.
    <>
      <PageMetaItem tone="brand" className="ui-tnum">{inProgressCount} active</PageMetaItem>
      {fundedCount > 0 && <PageMetaItem className="ui-tnum">{fundedCount} funded</PageMetaItem>}
      {completedGoals.length > 0 && <PageMetaItem className="ui-tnum">{completedGoals.length} complete</PageMetaItem>}
    </>
  );

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 md:pt-9 pb-6 sm:pb-28 text-content">
      <style>{`
        .g-shine::after {
          content: ""; position: absolute; inset: 0; border-radius: 999px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
          transform: translateX(-100%); animation: gshine 2.8s ease-in-out 1s infinite;
        }
        @keyframes gshine { 0% { transform: translateX(-100%) } 55%, 100% { transform: translateX(220%) } }
        @media (prefers-reduced-motion: reduce) { .g-shine::after { animation: none } }
        .g-rise { opacity: 0; transform: translateY(12px); animation: grise 0.55s cubic-bezier(0.22,1,0.36,1) forwards; }
        @keyframes grise { to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce) { .g-rise { animation: none; opacity: 1; transform: none } }
      `}</style>

      {/* ════════ Header ════════ */}
      <header className="flex flex-wrap items-start md:items-end justify-between gap-4 animate-fade-in">
        <div className="min-w-0">
          <PageTitle className="sm:text-[36px]">Goals</PageTitle>
          <PageMeta className="mt-0 md:mt-1.5">
            {loading ? <PageMetaSkeleton widths={['w-[51px]', 'w-[74px]']} /> : summaryLine}
          </PageMeta>
        </div>
        {!isDemo && (
          <Link href="/goals/new" className={button()}>
            <Plus className="h-4 w-4" />
            New goal
          </Link>
        )}
      </header>

      {/* ════════ Loading skeleton ════════ */}
      {loading && (
        <>
          <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-3 h-9 w-72" />
            <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
            <Skeleton className="mt-3 h-3 w-2/3" />
          </div>
          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5">
            {[0, 1].map(i => (
              <div key={i} className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6">
                <div className="flex items-start gap-3.5">
                  <Skeleton className="h-[46px] w-[46px] rounded-[14px]" />
                  <div className="flex-1">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="mt-2 h-5 w-40" />
                  </div>
                </div>
                <Skeleton className="mt-5 h-2.5 w-full rounded-full" />
                <Skeleton className="mt-4 h-9 w-full rounded-ui-md" />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ════════ Summary hero — saved vs target ════════ */}
      {!loading && activeGoals.length > 0 && totalTarget > 0 && (
        <SummaryHero
          totalSaved={totalSaved}
          totalTarget={totalTarget}
          fundedCount={fundedCount}
          activeCount={activeGoals.length}
          avgPct={avgPct}
        />
      )}

      {/* ════════ Goals grid / empty state ════════ */}
      {!loading && (
        activeGoals.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              icon={<Target className="h-8 w-8" />}
              title={completedGoals.length > 0 ? 'No active goals' : 'No goals yet'}
              description={
                completedGoals.length > 0
                  ? 'Everything you have set is finished. Start another whenever you are ready.'
                  : 'Setting financial goals is the first step toward achieving them. Create a goal to start tracking your progress.'
              }
              action={!isDemo ? (
                <Link href="/goals/new" className={button()}>
                  <Plus className="h-4 w-4" />
                  {completedGoals.length > 0 ? 'Create a goal' : 'Create your first goal'}
                </Link>
              ) : undefined}
            />
          </div>
        ) : activeGoals.length > 0 ? (
          <>
            <h2 className="mt-9 text-[18px] font-semibold text-content">Your goals</h2>
            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
              {activeGoals.map((goal, i) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  accounts={accounts}
                  onOpen={open}
                  onReallocate={reallocate}
                  onSetPlan={(id) => setLocation(`/plans/savings/${id}?edit=1`)}
                  index={i}
                />
              ))}
              {!isDemo && <AddGoalTile index={activeGoals.length} />}
            </div>
          </>
        ) : null
      )}

      {/* ════════ Savings insights ════════ */}
      {!loading && (
        <section className="mt-12">
          <PageActions types="savings" />
        </section>
      )}

      {/* ════════ Suggested-goal templates ════════ */}
      {!loading && !isDemo && (
        <section className="mt-12">
          <h2 className="text-[18px] font-semibold text-content">Suggested</h2>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {GOAL_PRESETS.slice(0, 6).map((preset) => {
              const color = goalAccent(preset.category);
              return (
                <Link
                  key={preset.category}
                  href={`/goals/new?kind=${preset.category}`}
                  aria-label={
                    preset.suggestedTarget
                      ? `Add ${preset.name} goal, suggested target ${formatCurrency(preset.suggestedTarget)}`
                      : `Add ${preset.name} goal`
                  }
                  className="group flex items-center gap-3 rounded-ui-lg border border-line bg-panel shadow-ui-sm p-3.5 text-left transition-[box-shadow,border-color] hover:shadow-ui-md hover:border-line-strong min-h-touch"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-ui-sm"
                    style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                  >
                    {iconFor(preset.icon, 18)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold text-content">{preset.name}</span>
                    {preset.suggestedTarget && (
                      <span className="text-[11.5px] font-semibold text-content-muted ui-tnum">
                        suggested {formatCurrency(preset.suggestedTarget)}
                      </span>
                    )}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-content-muted transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-brand" />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ════════ Completed archive ════════
          Nothing at all yet means the page already says so once, above, with
          the one action that changes it. A second panel headed "Completed",
          holding only a note that there is nothing completed, is a heading, a
          label and two lines of copy that together tell the user nothing they
          did not just read. Gated on the completed list, not on having any goals
          at all: a user months into active goals with none finished yet is the
          normal case, and the panel says exactly as little to them. */}
      {!loading && completedGoals.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[18px] font-semibold text-content">Completed</h2>
          <ul className="mt-3">
            {completedGoals.map((goal) => {
              // Honest archive: show what was actually saved, and only claim
              // "reached" when the goal really hit its target.
              const saved = parseFloat(goal.currentAmount);
              const tgt = parseFloat(goal.targetAmount);
              const reached = tgt > 0 && saved >= tgt;
              const closedPct = tgt > 0 ? Math.round((saved / tgt) * 100) : 0;
              // Skip the category when it just repeats the goal's name
              // ("Emergency fund / Reached. Emergency fund").
              const category = goal.category ? goal.category.replace(/_/g, ' ') : null;
              const showCategory = category && category.toLowerCase() !== goal.name.trim().toLowerCase();
              return (
                <li
                  key={goal.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${goal.name}`}
                  onClick={() => open(goal.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(goal.id); } }}
                  className="group flex items-center gap-3 border-t border-line py-3.5 cursor-pointer min-h-touch focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm bg-brand-soft text-brand">
                    {iconFor(goal.icon, 16)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-content-muted">{goal.name}</span>
                    <span className="text-[11.5px] font-semibold text-content-muted">
                      {reached ? 'Reached' : `Completed at ${closedPct}%`}
                      {showCategory && <>. {category.replace(/^./, (c) => c.toUpperCase())}</>}
                    </span>
                  </span>
                  <span className="text-[13px] font-bold text-content-muted ui-tnum">
                    {formatCurrency(saved)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-content-muted transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-brand" />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary hero
// ---------------------------------------------------------------------------

function SummaryHero({
  totalSaved, totalTarget, fundedCount, activeCount, avgPct,
}: {
  totalSaved: number; totalTarget: number; fundedCount: number; activeCount: number; avgPct: number;
}) {
  const pct = Math.min(100, Math.round((totalSaved / totalTarget) * 100));
  const remaining = Math.max(0, totalTarget - totalSaved);
  return (
    <section className="g-rise relative mt-6 flex flex-wrap items-center gap-7 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 100% 0%, var(--ui-info-soft), transparent 56%),' +
            'radial-gradient(90% 80% at 0% 10%, var(--ui-accent-softer), transparent 60%)',
        }}
      />
      <div className="relative min-w-[280px] flex-1">
        <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
          Total saved toward goals
        </span>
        <div className="mt-2 font-editorial text-[30px] sm:text-[40px] font-extrabold leading-none tracking-[-0.03em] ui-tnum">
          <MaskedText text={formatCurrency(totalSaved)} />{' '}
          <span className="text-[0.55em] font-bold text-content-muted">of <MaskedText text={formatCurrency(totalTarget)} /></span>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-canvas-sunken">
          <div
            className="g-shine relative h-full rounded-full"
            style={{ width: `${Math.max(pct, 2)}%`, background: 'linear-gradient(90deg, var(--ui-viz-1), rgb(var(--ui-brand)))' }}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="font-editorial text-[13px] font-extrabold text-[rgb(var(--ui-brand-ink))] ui-tnum">{pct}% of all targets</span>
          <span className="text-[12.5px] font-semibold text-content-muted ui-tnum"><MaskedText text={formatCurrency(remaining)} /> to go</span>
        </div>
      </div>
      <div className="relative flex w-full gap-3.5 sm:w-auto">
        <div className="min-w-[112px] flex-1 rounded-ui-lg border border-line bg-panel shadow-ui-sm p-4">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">Funded</div>
          <div className="mt-1.5 font-editorial text-[24px] font-extrabold leading-none tracking-[-0.02em] text-[rgb(var(--ui-brand-ink))] ui-tnum">{fundedCount}</div>
          <div className="mt-1.5 text-[11.5px] font-semibold text-content-muted">of {activeCount} goal{activeCount === 1 ? '' : 's'}</div>
        </div>
        <div className="min-w-[112px] flex-1 rounded-ui-lg border border-line bg-panel shadow-ui-sm p-4">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">Avg. progress</div>
          <div className="mt-1.5 font-editorial text-[24px] font-extrabold leading-none tracking-[-0.02em] ui-tnum">{avgPct}%</div>
          <div className="mt-1.5 text-[11.5px] font-semibold text-content-muted">across active goals</div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Goal card
// ---------------------------------------------------------------------------

function GoalCard({
  goal, accounts, onOpen, onReallocate, onSetPlan, index,
}: {
  goal: Goal; accounts: Account[]; onOpen: (id: string) => void;
  onReallocate: (goal: Goal) => void; onSetPlan: (id: string) => void; index: number;
}) {
  const target = parseFloat(goal.targetAmount);
  const current = parseFloat(goal.currentAmount);
  const rawPct = target > 0 ? (current / target) * 100 : 0;
  const pct = Math.min(100, Math.max(0, rawPct));
  const remaining = Math.max(0, target - current);
  const surplus = current - target;
  const complete = target > 0 && current >= target;
  const exceeded = complete && surplus >= 1;
  const notStarted = current <= 0;
  const accent = complete ? 'rgb(var(--ui-brand))' : goalAccent(goal.category, goal.name);
  const eta = targetDateLabel(goal.deadline);

  const linkedNames = goal.accountIds
    .map(id => accounts.find(a => a.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  const rawCategory = goal.category ? goal.category.replace(/_/g, ' ') : 'savings goal';
  const categoryLabel = rawCategory.charAt(0).toUpperCase() + rawCategory.slice(1);

  return (
    <article
      className="g-rise group relative flex cursor-pointer flex-col overflow-hidden rounded-ui-xl border bg-panel shadow-ui-sm p-6 sm:p-[22px_24px] transition-[box-shadow,border-color] hover:shadow-ui-md"
      role="button"
      tabIndex={0}
      aria-label={`Open goal ${goal.name}`}
      onClick={() => onOpen(goal.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(goal.id); } }}
      style={{
        animationDelay: `${0.04 * index}s`,
        borderColor: complete ? 'color-mix(in srgb, rgb(var(--ui-brand)) 34%, var(--ui-hairline))' : 'var(--ui-hairline)',
      }}
    >
      {/* left accent rail */}
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} aria-hidden />
      {/* funded corner wash */}
      {complete && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(120% 90% at 100% 0%, var(--ui-brand-soft), transparent 60%)' }}
          aria-hidden
        />
      )}

      {/* top: icon · name · pct */}
      <div className="relative flex items-start gap-3.5">
        <span
          className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-[14px] text-white"
          style={{ background: accent, boxShadow: 'var(--ui-shadow-sm), inset 0 1px 0 rgba(255,255,255,0.3)' }}
        >
          {iconFor(goal.icon, 23)}
        </span>
        <div className="min-w-0 flex-1">
          <div>
            <Badge tone="neutral" size="sm">{categoryLabel}</Badge>
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-editorial text-[18.5px] font-bold leading-[1.2] tracking-[-0.018em]">
            {complete && (
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-brand text-white">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            )}
            {/* The whole card opens the goal; the title keeps its own affordance
                (underline on hover) but stops propagation to avoid a double-fire. */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(goal.id); }}
              className="ui-focus min-w-0 truncate rounded-ui-sm text-left underline-offset-4 transition-colors hover:text-[rgb(var(--ui-brand-ink))] hover:underline"
            >
              {goal.name}
            </button>
          </div>
        </div>
        <span
          className="shrink-0 pt-0.5 font-editorial text-[26px] font-extrabold leading-none tracking-[-0.02em] ui-tnum"
          style={{ color: complete ? 'rgb(var(--ui-brand-ink))' : undefined }}
        >
          {Math.round(pct)}%
        </span>
      </div>

      {/* amounts */}
      <div className="relative mt-[18px] flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-content-secondary ui-tnum">
        <span>
          <span className="font-editorial text-[17px] font-extrabold tracking-[-0.01em] text-content"><MaskedText text={formatCurrency(current)} /></span>
          <span className="text-content-muted"> of <MaskedText text={formatCurrency(target)} /></span>
        </span>
        {goal.isAutoTracked && (
          <span
            title={linkedNames ? `Tracked from: ${linkedNames}` : `${goal.accountIds.length} linked account${goal.accountIds.length === 1 ? '' : 's'}`}
            className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--ui-brand-ink))]"
          >
            Auto ({goal.accountIds.length} acct{goal.accountIds.length === 1 ? '' : 's'})
          </span>
        )}
      </div>

      {/* progress bar — each terminal state intentionally distinct */}
      <div className="relative mt-3">
        {complete ? (
          <div className="h-2.5 overflow-hidden rounded-full bg-canvas-sunken">
            <div
              className="g-shine relative h-full w-full rounded-full"
              style={{ background: 'linear-gradient(90deg, var(--ui-viz-1), rgb(var(--ui-brand)))' }}
            />
          </div>
        ) : notStarted ? (
          // 0% — "alive but empty": faint accent dashes + a starter nub, never a flat invisible bar.
          <div className="relative h-2.5 overflow-hidden rounded-full bg-canvas-sunken" style={{ color: accent }}>
            <div
              className="absolute inset-0 opacity-[0.16]"
              style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0 5px, transparent 5px 11px)' }}
            />
            <div className="absolute inset-y-0 left-0 w-3.5 rounded-full" style={{ background: 'currentColor' }} />
          </div>
        ) : (
          <div className="h-2.5 overflow-hidden rounded-full bg-canvas-sunken">
            <div
              className="h-full rounded-full"
              style={{ width: `${pct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 60%, transparent), ${accent})` }}
            />
          </div>
        )}
      </div>

      {/* meta — real state + real target date only (no fabricated pace/ETA) */}
      <div className="relative mt-3.5 flex flex-wrap items-center gap-2.5">
        {complete ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.05em] text-[rgb(var(--ui-brand-ink))]">
              <Check className="h-3 w-3" strokeWidth={3} /> Funded 🎉
            </span>
            <span className="text-[12.5px] font-semibold text-content-muted ui-tnum">
              {exceeded ? `${formatCurrency(surplus)} over target` : 'Fully funded'}
            </span>
          </>
        ) : notStarted ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-canvas-sunken px-2.5 py-1 text-[12.5px] font-bold text-content-secondary">
              <Sparkles className="h-3 w-3" /> Just getting started
            </span>
            {eta && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-content-muted">
                <Clock className="h-3.5 w-3.5 text-content-faint" /> {eta}
              </span>
            )}
          </>
        ) : (
          <>
            <span className="text-[12.5px] font-bold text-content-secondary ui-tnum">{formatCurrency(remaining)} to go</span>
            {eta && (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-content-muted">
                <Clock className="h-3.5 w-3.5 text-content-faint" /> {eta}
              </span>
            )}
          </>
        )}
        {goal.monthlyContribution && parseFloat(goal.monthlyContribution) > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-content-muted ui-tnum">
            <Repeat className="h-3.5 w-3.5 text-content-faint" />
            {formatCurrency(parseFloat(goal.monthlyContribution))}/mo planned
          </span>
        )}
      </div>

      {/* footer actions — every button does what it says: reallocate opens the
          chat with the redirect question; set-plan deep-links to the edit form */}
      <div className="relative mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {complete ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReallocate(goal); }}
            className="inline-flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-ui-sm bg-brand-soft px-3.5 text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] transition-[box-shadow] hover:shadow-ui-sm sm:flex-none"
          >
            <RotateCw className="h-4 w-4" />
            Reallocate surplus
          </button>
        ) : !(goal.monthlyContribution && parseFloat(goal.monthlyContribution) > 0) ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSetPlan(goal.id); }}
            className="inline-flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-ui-sm bg-brand-soft px-3.5 text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] transition-[box-shadow] hover:shadow-ui-sm sm:flex-none"
          >
            <Plus className="h-4 w-4" />
            Plan monthly contribution
          </button>
        ) : null}
        <span className="hidden flex-1 sm:block" />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(goal.id); }}
          className="group/link inline-flex min-h-touch items-center gap-1.5 rounded-ui-sm px-2.5 text-[13.5px] font-bold text-content-secondary transition-colors hover:bg-brand-softer hover:text-[rgb(var(--ui-brand-ink))]"
        >
          View goal
          <ChevronRight className="h-4 w-4 transition-transform group-hover/link:translate-x-0.5" />
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Add-goal tile
// ---------------------------------------------------------------------------

function AddGoalTile({ index }: { index: number }) {
  return (
    <Link
      href="/goals/new"
      aria-label="Set up another goal"
      className="g-rise group flex min-h-[150px] flex-col items-center justify-center gap-1 self-start rounded-ui-xl border-[1.5px] border-dashed border-line-strong bg-canvas-sunken p-6 text-center transition-[background,border-color,box-shadow] hover:border-brand hover:bg-brand-soft hover:shadow-ui-sm"
      style={{ animationDelay: `${0.04 * index}s` }}
    >
      <span className="mb-1.5 grid h-[50px] w-[50px] place-items-center rounded-ui-lg bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-brand-fg">
        <Plus className="h-6 w-6" />
      </span>
      <span className="font-editorial text-[16px] font-bold tracking-[-0.01em] text-content">Set up another goal</span>
      <span className="max-w-[24ch] text-[13px] font-semibold text-content-muted">
        Pick a preset (emergency, home, travel) or start from scratch.
      </span>
    </Link>
  );
}
