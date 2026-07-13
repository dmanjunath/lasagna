import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Check, Target, ArrowRight, ChevronRight, Clock, Sparkles, RotateCw, Repeat } from 'lucide-react';
import { api } from '../lib/api';
import { useChatStore } from '../lib/chat-store';
import { PageActions } from '../components/common/page-actions';
import { Button, EmptyState, Eyebrow, Field, Input, Skeleton } from '../components/uikit';
import { formatCurrency, iconFor, toggleId, AccountPicker, IconKey } from './goal-shared';

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const GOAL_PRESETS: Array<{ name: string; category: string; icon: IconKey; suggestedTarget: number }> = [
  { name: 'Emergency Fund', category: 'emergency_fund', icon: 'shield', suggestedTarget: 25000 },
  { name: 'Home Purchase', category: 'home_purchase', icon: 'home', suggestedTarget: 80000 },
  { name: 'Vacation / Travel', category: 'vacation', icon: 'plane', suggestedTarget: 5000 },
  { name: 'Vehicle Purchase', category: 'car', icon: 'car', suggestedTarget: 30000 },
  { name: 'Wedding Fund', category: 'wedding', icon: 'heart', suggestedTarget: 30000 },
  { name: 'Education / 529', category: 'education', icon: 'graduationCap', suggestedTarget: 50000 },
  { name: 'Home Repair', category: 'home_repair', icon: 'wrench', suggestedTarget: 15000 },
  { name: 'Major Purchase', category: 'major_purchase', icon: 'sparkles', suggestedTarget: 10000 },
  { name: 'Life Event', category: 'life_event', icon: 'sparkles', suggestedTarget: 10000 },
  { name: 'Retirement', category: 'retirement', icon: 'palmtree', suggestedTarget: 1000000 },
  { name: 'Debt Payoff', category: 'debt_payoff', icon: 'creditCard', suggestedTarget: 20000 },
  { name: 'General Savings', category: 'savings', icon: 'wallet', suggestedTarget: 10000 },
];

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
  status: string;
  icon: string | null;
  createdAt: string;
  accountIds: string[];
  isAutoTracked: boolean;
}

interface Account {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  balance: string | null;
  institutionId: string | null;
  institutionName: string | null;
}

// ---------------------------------------------------------------------------
// Bright accent per category — mirrors the redesign mockup's --b-viz mapping.
// Returns a CSS color string (a viz token, or the brand green for safety nets)
// so light/dark adapt automatically and goals stay visually distinct.
// ---------------------------------------------------------------------------

function goalAccent(category: string, name = ''): string {
  // Category strings are coarse (a "New car fund" is stored as category
  // "savings"), so fold the goal name in too — keeps each goal's accent
  // matched to its real intent rather than the generic-savings fallback.
  const c = `${category ?? ''} ${name}`.toLowerCase();
  if (c.includes('emergency') || c.includes('safety')) return 'rgb(var(--ui-brand))';
  if (c.includes('home') || c.includes('house') || c.includes('down_payment')) return 'var(--ui-viz-2)';
  if (c.includes('retire')) return 'var(--ui-viz-1)';
  if (c.includes('educat') || c.includes('529')) return 'var(--ui-viz-6)';
  if (c.includes('travel') || c.includes('vacation') || c.includes('relocation')) return 'var(--ui-viz-5)';
  if (c.includes('car') || c.includes('vehicle') || c.includes('transport')) return 'var(--ui-viz-3)';
  if (c.includes('wedding') || c.includes('life')) return 'var(--ui-viz-4)';
  if (c.includes('debt')) return 'var(--ui-viz-7)';
  if (c.includes('repair') || c.includes('major')) return 'var(--ui-viz-3)';
  return 'var(--ui-viz-2)';
}

// Real target date → a short "Target Mon YYYY" line. The API has a deadline but
// no monthly-pace / projected-ETA, so we surface the actual target date only —
// never a fabricated finish projection.
function targetDateLabel(deadline: string | null): string | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < Date.now()) return 'Past target date';
  return `Target ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Goals() {
  const [, setLocation] = useLocation();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newMonthly, setNewMonthly] = useState('');
  const [newIcon, setNewIcon] = useState<string>('target');
  const [newDeadline, setNewDeadline] = useState('');
  const [newCategory, setNewCategory] = useState('savings');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [newAccountIds, setNewAccountIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const createPanelRef = useRef<HTMLDivElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const { openChat } = useChatStore();

  // The "Suggested" tiles at the page bottom open this panel at the top of the
  // page — without this the click looks dead. Scroll it into view and focus
  // the name field (mirrors the detail page's edit panel behavior).
  useEffect(() => {
    if (!showCreate) return;
    const t = setTimeout(() => {
      createPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      createNameRef.current?.focus({ preventScroll: true });
    }, 80);
    return () => clearTimeout(t);
  }, [showCreate]);

  useEffect(() => {
    api.getGoals()
      .then(({ goals }) => setGoals(goals))
      .catch(console.error)
      .finally(() => setLoading(false));
    api.getBalances()
      .then(({ balances }) => setAccounts(
        balances
          // Only liquid, fundable accounts can back a savings goal. Liabilities
          // (credit/loan) would track debt, and illiquid assets (real_estate,
          // alternative) would slam progress to 100% instantly — drop both.
          .filter(b => b.type === 'depository' || b.type === 'investment')
          .map(b => ({
            id: b.accountId, name: b.name, mask: b.mask, type: b.type, balance: b.balance,
            institutionId: b.institutionId, institutionName: b.institutionName,
          }))
      ))
      .catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!newName || !newTarget) return;
    setCreating(true);
    setFormError(null);
    try {
      await api.createGoal({
        name: newName,
        targetAmount: parseFloat(newTarget),
        monthlyContribution: newMonthly ? parseFloat(newMonthly) : undefined,
        deadline: newDeadline || undefined,
        category: newCategory,
        icon: newIcon,
        accountIds: newAccountIds,
      });
      const { goals: fresh } = await api.getGoals();
      setGoals(fresh);
      setShowCreate(false);
      setNewName('');
      setNewTarget('');
      setNewMonthly('');
      setNewIcon('target');
      setNewDeadline('');
      setNewCategory('savings');
      setNewAccountIds([]);
    } catch (err) {
      console.error(err);
      setFormError('Could not create goal. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const selectPreset = (preset: typeof GOAL_PRESETS[0]) => {
    setNewIcon(preset.icon);
    setNewCategory(preset.category);
    // Presets are a starting point, not a reset — never clobber what the user
    // already typed.
    if (!newName.trim()) setNewName(preset.name);
    if (!newTarget) setNewTarget(String(preset.suggestedTarget));
  };

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
      `then recommend how to best reallocate that monthly amount — and why.`,
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
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span><b className="font-extrabold text-content">{inProgressCount}</b> active</span>
      {fundedCount > 0 && (
        <>
          <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
          <span><b className="font-extrabold text-content">{fundedCount}</b> funded</span>
        </>
      )}
      <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
      <span><b className="font-extrabold text-content">{activeGoals.length}</b> goal{activeGoals.length === 1 ? '' : 's'} tracked</span>
      {completedGoals.length > 0 && (
        <>
          <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
          <span><b className="font-extrabold text-content">{completedGoals.length}</b> complete</span>
        </>
      )}
    </span>
  );

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
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
      <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-in">
        <div className="min-w-0">
          <h1 className="font-editorial text-[28px] sm:text-[36px] font-bold leading-[1.02] tracking-[-0.028em] text-content">
            Goals
          </h1>
          {summaryLine && (
            <p className="mt-2 text-[14.5px] font-semibold text-content-muted">{summaryLine}</p>
          )}
        </div>
        {!isDemo && (
          <Button onClick={() => setShowCreate(v => !v)} leadingIcon={<Plus className="h-4 w-4" />}>
            New goal
          </Button>
        )}
      </header>

      {/* ════════ Create goal panel ════════ */}
      <AnimatePresence>
        {showCreate && !isDemo && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div
              ref={createPanelRef}
              className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setShowCreate(false); return; }
                const t = e.target as HTMLInputElement;
                if (e.key === 'Enter' && t.tagName === 'INPUT' && t.type !== 'search') {
                  e.preventDefault();
                  if (newName && parseFloat(newTarget) > 0 && !creating) handleCreate();
                }
              }}
            >
              <Eyebrow>New goal</Eyebrow>
              <h3 className="mt-1.5 mb-5 font-editorial text-[20px] font-bold tracking-[-0.018em]">
                What are you saving for?
              </h3>

              <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                <Field label="Goal name">
                  <div className="flex gap-2">
                    <div
                      aria-label="Icon"
                      className="grid w-14 shrink-0 place-items-center rounded-ui-md border border-line-strong bg-canvas-sunken text-content-secondary"
                    >
                      {iconFor(newIcon, 20)}
                    </div>
                    <Input
                      ref={createNameRef}
                      type="text"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Emergency Fund"
                    />
                  </div>
                </Field>
                <Field label="Target amount">
                  <Input
                    type="number"
                    value={newTarget}
                    onChange={e => setNewTarget(e.target.value)}
                    placeholder="25000"
                    className="ui-tnum"
                    leadingIcon={<span className="text-[13px]">$</span>}
                  />
                </Field>
                <Field label="Planned monthly contribution (optional)">
                  <Input
                    type="number"
                    value={newMonthly}
                    onChange={e => setNewMonthly(e.target.value)}
                    placeholder="500"
                    className="ui-tnum"
                    leadingIcon={<span className="text-[13px]">$</span>}
                  />
                </Field>
                <Field label="Target date (optional)">
                  <Input type="date" value={newDeadline} onChange={e => setNewDeadline(e.target.value)} />
                </Field>
              </div>

              {/* Category chips — optional quick-start */}
              <div className="mb-5">
                <Eyebrow className="text-content-muted">Category (optional)</Eyebrow>
                <div className="goals-presets" style={{ marginTop: 8 }}>
                  {GOAL_PRESETS.map((preset) => {
                    const active = newCategory === preset.category;
                    const color = goalAccent(preset.category);
                    return (
                      <button
                        key={preset.category}
                        onClick={() => selectPreset(preset)}
                        className="goals-preset"
                        style={{
                          borderColor: active ? color : 'var(--ui-line)',
                          color: active ? color : 'rgb(var(--ui-content-muted))',
                          display: 'inline-flex', alignItems: 'center', gap: 8,
                        }}
                      >
                        {iconFor(preset.icon, 14)}
                        <span>{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accounts — linking ≥1 makes the goal auto-track its balance */}
              {accounts.length > 0 && (
                <div className="mb-5">
                  <Eyebrow className="text-content-muted">Accounts (optional)</Eyebrow>
                  <p className="mt-1 mb-2 text-[12px] text-content-muted">
                    Linked accounts auto-track this goal's progress.
                  </p>
                  <AccountPicker
                    accounts={accounts}
                    selected={newAccountIds}
                    onToggle={(id) => setNewAccountIds(prev => toggleId(prev, id))}
                  />
                </div>
              )}

              {newTarget !== '' && !(parseFloat(newTarget) > 0) && (
                <p className="mb-3 text-[12px] font-semibold text-negative">Target amount must be greater than zero.</p>
              )}
              <div className="flex gap-2.5">
                <Button disabled={!newName || !(parseFloat(newTarget) > 0) || creating} loading={creating} onClick={handleCreate}>
                  {creating ? 'Creating…' : 'Create goal'}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
              {formError && (
                <p className="mt-2.5 text-[12px] font-semibold text-negative" role="status" aria-live="polite">{formError}</p>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

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
        activeGoals.length === 0 && !showCreate ? (
          <div className="mt-8">
            <EmptyState
              icon={<Target className="h-8 w-8" />}
              title="No goals yet"
              description="Setting financial goals is the first step toward achieving them. Create a goal to start tracking your progress."
              action={!isDemo ? (
                <Button onClick={() => setShowCreate(true)} leadingIcon={<Plus className="h-4 w-4" />}>
                  Create your first goal
                </Button>
              ) : undefined}
            />
          </div>
        ) : activeGoals.length > 0 ? (
          <>
            <div className="mt-9 flex items-center gap-2.5">
              <span
                className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
                style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
                aria-hidden
              />
              <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Your goals</span>
            </div>
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
              {!isDemo && <AddGoalTile onClick={() => setShowCreate(true)} index={activeGoals.length} />}
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
                <button
                  key={preset.category}
                  type="button"
                  onClick={() => { selectPreset(preset); setShowCreate(true); }}
                  aria-label={`Add ${preset.name} goal · suggested target ${formatCurrency(preset.suggestedTarget)}`}
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
                    <span className="text-[11.5px] font-semibold text-content-muted ui-tnum">
                      suggested {formatCurrency(preset.suggestedTarget)}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-content-muted transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-brand" />
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ════════ Completed archive ════════ */}
      {!loading && (
        <section className="mt-12">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-[18px] font-semibold text-content">Completed</h2>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-content-muted">
              {completedGoals.length > 0 ? `${completedGoals.length} archived` : 'archive'}
            </span>
          </div>
          {completedGoals.length > 0 ? (
            <ul className="mt-3">
              {completedGoals.map((goal) => {
                // Honest archive: show what was actually saved, and only claim
                // "reached" when the goal really hit its target.
                const saved = parseFloat(goal.currentAmount);
                const tgt = parseFloat(goal.targetAmount);
                const reached = tgt > 0 && saved >= tgt;
                const closedPct = tgt > 0 ? Math.round((saved / tgt) * 100) : 0;
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
                        {reached ? 'reached' : `completed at ${closedPct}%`}
                        {goal.category && <> · {goal.category.replace(/_/g, ' ')}</>}
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
          ) : (
            <div className="mt-3 flex items-center gap-3 border-t border-line py-3.5 opacity-70">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-ui-sm bg-canvas-sunken text-content-muted">
                <Target className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-content-muted">No completed goals yet</span>
                <span className="text-[11.5px] font-semibold text-content-muted">finished goals will land here as a record</span>
              </span>
            </div>
          )}
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
          {formatCurrency(totalSaved)}{' '}
          <span className="text-[0.55em] font-bold text-content-muted">of {formatCurrency(totalTarget)}</span>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-canvas-sunken">
          <div
            className="g-shine relative h-full rounded-full"
            style={{ width: `${Math.max(pct, 2)}%`, background: 'linear-gradient(90deg, var(--ui-viz-1), rgb(var(--ui-brand)))' }}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="font-editorial text-[13px] font-extrabold text-[rgb(var(--ui-brand-ink))] ui-tnum">{pct}% of all targets</span>
          <span className="text-[12.5px] font-semibold text-content-muted ui-tnum">{formatCurrency(remaining)} to go</span>
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

  return (
    <article
      className="g-rise group relative flex flex-col overflow-hidden rounded-ui-xl border bg-panel shadow-ui-sm p-6 sm:p-[22px_24px] transition-[box-shadow,border-color] hover:shadow-ui-md"
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
          <div className="text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-content-muted">
            {goal.category ? goal.category.replace(/_/g, ' ') : 'Savings goal'}
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-editorial text-[18.5px] font-bold leading-[1.2] tracking-[-0.018em]">
            {complete && (
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-brand text-white">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            )}
            {/* The title is the card's open affordance (whole-card click caused
                cursor flicker on macOS) — underline on hover signals it. */}
            <button
              type="button"
              onClick={() => onOpen(goal.id)}
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
          <span className="font-editorial text-[17px] font-extrabold tracking-[-0.01em] text-content">{formatCurrency(current)}</span>
          <span className="text-content-muted"> of {formatCurrency(target)}</span>
        </span>
        {goal.isAutoTracked && (
          <span
            title={linkedNames ? `Tracked from: ${linkedNames}` : `${goal.accountIds.length} linked account${goal.accountIds.length === 1 ? '' : 's'}`}
            className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--ui-brand-ink))]"
          >
            Auto · {goal.accountIds.length} acct{goal.accountIds.length === 1 ? '' : 's'}
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
            onClick={() => onReallocate(goal)}
            className="inline-flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-ui-sm bg-brand-soft px-3.5 text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] transition-[box-shadow] hover:shadow-ui-sm sm:flex-none"
          >
            <RotateCw className="h-4 w-4" />
            Reallocate surplus
          </button>
        ) : !(goal.monthlyContribution && parseFloat(goal.monthlyContribution) > 0) ? (
          <button
            type="button"
            onClick={() => onSetPlan(goal.id)}
            className="inline-flex min-h-touch flex-1 items-center justify-center gap-1.5 rounded-ui-sm bg-brand-soft px-3.5 text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] transition-[box-shadow] hover:shadow-ui-sm sm:flex-none"
          >
            <Plus className="h-4 w-4" />
            Plan monthly contribution
          </button>
        ) : null}
        <span className="hidden flex-1 sm:block" />
        <button
          type="button"
          onClick={() => onOpen(goal.id)}
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

function AddGoalTile({ onClick, index }: { onClick: () => void; index: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Set up another goal"
      className="g-rise group flex min-h-[150px] flex-col items-center justify-center gap-1 self-start rounded-ui-xl border-[1.5px] border-dashed border-line-strong bg-canvas-sunken p-6 text-center transition-[background,border-color,box-shadow] hover:border-brand hover:bg-brand-soft hover:shadow-ui-sm"
      style={{ animationDelay: `${0.04 * index}s` }}
    >
      <span className="mb-1.5 grid h-[50px] w-[50px] place-items-center rounded-ui-lg bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-brand-fg">
        <Plus className="h-6 w-6" />
      </span>
      <span className="font-editorial text-[16px] font-bold tracking-[-0.01em] text-content">Set up another goal</span>
      <span className="max-w-[24ch] text-[13px] font-semibold text-content-muted">
        Pick a preset — emergency, home, travel — or start from scratch.
      </span>
    </button>
  );
}
