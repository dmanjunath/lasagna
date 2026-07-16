import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Check, ChevronLeft, Clock, Sparkles, Wallet, Flag, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Eyebrow, EmptyState, Skeleton, Field, Input, SegmentedControl } from '../components/uikit';
import { useConfirm, TrendChart, filterByRange, type Range, type TrendPoint } from '../components/ds';
import { formatCurrency, goalColor, iconFor, toggleId, AccountPicker, InstitutionIcon } from './goal-shared';
import { hapticSuccess } from '../lib/haptics';

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
  accountIds: string[];
  isAutoTracked: boolean;
  completedAt: string | null;
  createdAt: string;
}

interface Balance {
  accountId: string;
  name: string;
  type: string;
  mask: string | null;
  institutionId: string | null;
  institutionName: string | null;
  balance: string | null;
  available: string | null;
  currency: string;
  asOf: string | null;
}

interface LinkedAccount {
  id: string;
  name: string;
  type: string;
  mask: string | null;
  institutionId: string | null;
  institutionName: string | null;
  balance: string | null;
  asOf: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanizeType(type: string): string {
  if (type === 'depository') return 'Cash';
  if (type === 'investment') return 'Investments';
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A far-off deadline in raw days ("1268 days left") is hard to reconcile with
// years — express it in the largest natural unit instead.
function humanizeDaysLeft(days: number): string {
  if (days <= 0) return 'Past deadline';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} left`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months left`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0 ? `${years} year${years === 1 ? '' : 's'} left` : `${years} yr ${rem} mo left`;
}

// "Mark complete" is a manual archive action — it only makes sense once a goal
// has real progress. Below this we hide it (a $0 / just-started goal shouldn't
// offer "complete"); a goal that's already Reached hides it too (see render).
const MARK_COMPLETE_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SavingsGoal() {
  const [, params] = useRoute('/plans/savings/:id');
  const goalId = params?.id || '';
  const [, setLocation] = useLocation();
  const confirm = useConfirm();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [history, setHistory] = useState<TrendPoint[]>([]);
  const [histRange, setHistRange] = useState<Range>('All');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Linked-accounts editor
  const [editingAccounts, setEditingAccounts] = useState(false);
  const [draftAccountIds, setDraftAccountIds] = useState<string[]>([]);
  const [savingAccounts, setSavingAccounts] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const accountsPanelRef = useRef<HTMLDivElement>(null);

  // Edit-goal form
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTarget, setEditTarget] = useState('');
  const [editMonthly, setEditMonthly] = useState('');
  const [editDeadline, setEditDeadline] = useState('');
  const [editCurrent, setEditCurrent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editPanelRef = useRef<HTMLDivElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);

  // Status actions (mark complete / reactivate / delete)
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ goals }, { balances: bals }, { history: hist }] = await Promise.all([
        api.getGoals(),
        api.getBalances(),
        // History failing shouldn't take down the page — chart just hides.
        api.getGoalHistory(goalId).catch(() => ({ history: [] as TrendPoint[] })),
      ]);
      const found = goals.find((g) => g.id === goalId);
      if (!found) {
        setNotFound(true);
        return;
      }
      setGoal(found);
      setBalances(bals);
      setHistory(hist);
      setLoadError(false);
    } catch {
      // A fetch failure is NOT "goal not found" — telling the user their money
      // goal was deleted over a network blip destroys trust. Offer a retry.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    load();
  }, [load]);

  // When the Edit form opens it mounts well below the fold — scroll it into
  // view and focus its first field so the click has a visible effect.
  useEffect(() => {
    if (!editing) return;
    editPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    editNameRef.current?.focus();
  }, [editing]);

  // Same for the Manage-accounts editor.
  useEffect(() => {
    if (!editingAccounts) return;
    accountsPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    accountsPanelRef.current?.querySelector<HTMLElement>('button, input')?.focus();
  }, [editingAccounts]);

  // ?edit=1 deep-link (goal cards' "Plan monthly contribution") — open the
  // edit form once the goal has loaded, then strip the param.
  const editParamHandled = useRef(false);
  useEffect(() => {
    if (!goal || editParamHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('edit')) {
      editParamHandled.current = true;
      window.history.replaceState({}, '', window.location.pathname);
      openEdit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1040px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
        <Skeleton className="h-4 w-24" />
        <div className="mt-4 flex items-center gap-3.5">
          <Skeleton className="h-[54px] w-[54px] rounded-[16px]" />
          <div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-8 w-56" />
          </div>
        </div>
        <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
          <div className="flex flex-col gap-7 lg:flex-row lg:justify-between">
            <div className="flex-1">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-3 h-11 w-72" />
              <Skeleton className="mt-5 h-3 w-full rounded-full" />
            </div>
            <div className="flex gap-3.5">
              <Skeleton className="h-[86px] w-[120px] rounded-ui-lg" />
              <Skeleton className="h-[86px] w-[120px] rounded-ui-lg" />
            </div>
          </div>
        </div>
        <div className="mt-8 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-12 w-full rounded-ui-md" />
          <Skeleton className="mt-2.5 h-12 w-full rounded-ui-md" />
        </div>
      </div>
    );
  }

  if (loadError && !goal) {
    return (
      <div className="mx-auto max-w-[1040px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="Couldn't load this goal"
          description="Something went wrong fetching it — your goal is still here. Check your connection and try again."
          action={
            <Button onClick={() => { setLoading(true); setLoadError(false); load(); }}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  if (notFound || !goal) {
    return (
      <div className="mx-auto max-w-[1040px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
        <EmptyState
          icon={<Sparkles className="h-6 w-6" />}
          title="Goal not found"
          description="We couldn't find this goal. It may have been deleted."
          action={<Button onClick={() => setLocation('/goals')}>Back to goals</Button>}
        />
      </div>
    );
  }

  const target = parseFloat(goal.targetAmount);
  const current = parseFloat(goal.currentAmount);
  const pct = target > 0 ? (current / target) * 100 : 0;
  const barPct = Math.min(100, Math.max(0, pct));
  const complete = current >= target && target > 0;
  const remaining = Math.max(0, target - current);
  const surplus = current - target;
  const notStarted = current <= 0;
  const accent = complete ? 'rgb(var(--ui-brand))' : goalColor(goal.category, goal.name);
  const categoryLabel = goal.category ? goal.category.replace(/_/g, ' ') : 'savings';

  const isArchived = goal.status === 'completed';

  // Deadline labels — an archived goal doesn't get nagged about its deadline.
  let deadlineMonth: string | null = null;
  let deadlineCountdown: string | null = null;
  let deadlineDaysLeft: number | null = null;
  if (goal.deadline) {
    deadlineMonth = new Date(goal.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    if (!isArchived) {
      deadlineDaysLeft = Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      deadlineCountdown = humanizeDaysLeft(deadlineDaysLeft);
    }
  }

  // Pace — turn the plan (or the deadline) into a monthly number the user can
  // act on. With a plan set: project when the goal lands at that rate. Without
  // one but with a deadline: what monthly amount would hit it.
  const monthlyPlan = goal.monthlyContribution ? parseFloat(goal.monthlyContribution) : 0;
  let paceLine: string | null = null;
  if (goal.status === 'active' && !complete && !notStarted && remaining > 0) {
    if (monthlyPlan > 0) {
      const monthsNeeded = Math.ceil(remaining / monthlyPlan);
      const eta = new Date();
      eta.setMonth(eta.getMonth() + monthsNeeded);
      const etaMonth = eta.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      if (goal.deadline && deadlineDaysLeft !== null && deadlineDaysLeft > 0) {
        paceLine = eta.getTime() <= new Date(goal.deadline).getTime()
          ? `${formatCurrency(monthlyPlan)}/mo planned — on track for ${deadlineMonth}`
          : `${formatCurrency(monthlyPlan)}/mo planned — on pace for ${etaMonth}, behind your ${deadlineMonth} target`;
      } else {
        paceLine = `${formatCurrency(monthlyPlan)}/mo planned — on pace for ${etaMonth}`;
      }
    } else if (deadlineDaysLeft !== null && deadlineDaysLeft > 0) {
      const monthsLeft = Math.max(1, Math.round(deadlineDaysLeft / 30.44));
      paceLine = `about ${formatCurrency(Math.ceil(remaining / monthsLeft))}/mo would hit ${deadlineMonth}`;
    }
  }

  // Linked accounts for this goal
  const linkedAccounts: LinkedAccount[] = balances
    .filter((b) => goal.accountIds.includes(b.accountId))
    .map((b) => ({
      id: b.accountId, name: b.name, type: b.type, mask: b.mask, balance: b.balance, asOf: b.asOf,
      institutionId: b.institutionId, institutionName: b.institutionName,
    }));

  // Fundable accounts feed the picker
  const fundableAccounts = balances
    .filter((b) => b.type === 'depository' || b.type === 'investment')
    .map((b) => ({
      id: b.accountId, name: b.name, mask: b.mask, type: b.type, balance: b.balance,
      institutionId: b.institutionId, institutionName: b.institutionName,
    }));

  // -- Status actions ---------------------------------------------------------

  const markComplete = async () => {
    // Confirm before archiving — this is the top primary button (first thumb
    // target on mobile) and it removes the goal from the active grid.
    const ok = await confirm({
      title: `Mark "${goal.name}" complete?`,
      body: complete
        ? 'It moves to your completed list as a finished goal. You can reactivate it anytime.'
        : `It's at ${Math.round(pct)}% and will be archived at its current amount. You can reactivate it anytime.`,
      confirmLabel: 'Mark complete',
    });
    if (!ok) return;
    setActionPending(true);
    setActionError(null);
    try {
      await api.updateGoal(goal.id, { status: 'completed' });
      hapticSuccess();
      await load();
    } catch {
      setActionError('Could not update this goal. Please try again.');
    } finally {
      setActionPending(false);
    }
  };

  const reactivate = async () => {
    // A still-funded goal would flip to active and immediately read "Reached".
    // Confirm before reopening so the state isn't incoherent.
    if (complete) {
      const ok = await confirm({
        title: 'Reopen this goal?',
        body: "It's still fully funded, so it will show as reached until its balance drops or you raise the target.",
        confirmLabel: 'Reopen goal',
      });
      if (!ok) return;
    }
    setActionPending(true);
    setActionError(null);
    try {
      await api.updateGoal(goal.id, { status: 'active' });
      await load();
    } catch {
      setActionError('Could not update this goal. Please try again.');
    } finally {
      setActionPending(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete "${goal.name}"?`,
      body: 'This permanently removes the goal. Linked accounts are not affected.',
      confirmLabel: 'Delete goal',
      destructive: true,
    });
    if (!ok) return;
    setActionPending(true);
    setActionError(null);
    try {
      await api.deleteGoal(goal.id);
      setLocation('/goals');
    } catch {
      setActionError('Could not delete this goal. Please try again.');
      setActionPending(false);
    }
  };

  // -- Linked-accounts editor -------------------------------------------------

  const openAccountsEditor = () => {
    setDraftAccountIds(goal.accountIds);
    setAccountsError(null);
    setEditingAccounts(true);
  };

  const saveAccounts = async () => {
    // Overwrite guard: linking accounts onto a manually-tracked goal replaces
    // the hand-entered amount with the accounts' live balances.
    const wasManual = goal.accountIds.length === 0 && current > 0;
    if (wasManual && draftAccountIds.length > 0) {
      const ok = await confirm({
        title: 'Replace manual amount?',
        body: 'Linking accounts will track this goal from their balances and replace the amount you entered.',
        confirmLabel: 'Link accounts',
      });
      if (!ok) return;
    }
    setSavingAccounts(true);
    setAccountsError(null);
    try {
      await api.updateGoal(goal.id, { accountIds: draftAccountIds });
      await load();
      setEditingAccounts(false);
    } catch {
      setAccountsError('Could not update accounts. Please try again.');
    } finally {
      setSavingAccounts(false);
    }
  };

  // -- Edit-goal form ---------------------------------------------------------

  const openEdit = () => {
    setEditName(goal.name);
    setEditTarget(goal.targetAmount);
    setEditMonthly(goal.monthlyContribution ?? '');
    setEditDeadline(goal.deadline ? goal.deadline.slice(0, 10) : '');
    setEditCurrent(goal.currentAmount);
    setEditError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editName || !editTarget) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const payload: Parameters<typeof api.updateGoal>[1] = {
        name: editName,
        targetAmount: parseFloat(editTarget),
        monthlyContribution: editMonthly === '' ? null : parseFloat(editMonthly),
        deadline: editDeadline || undefined,
      };
      if (!goal.isAutoTracked) payload.currentAmount = parseFloat(editCurrent);
      await api.updateGoal(goal.id, payload);
      await load();
      setEditing(false);
    } catch {
      setEditError('Could not save changes. Please try again.');
    } finally {
      setSavingEdit(false);
    }
  };

  // -- Render -----------------------------------------------------------------

  // Satellite stat tiles for the hero — real data only. To-go/surplus always,
  // target date only when a deadline exists, tracking source always.
  const trackingLabel = goal.isAutoTracked ? 'Auto' : 'Manual';
  const trackingCaption = goal.isAutoTracked
    ? `from ${goal.accountIds.length} account${goal.accountIds.length === 1 ? '' : 's'}`
    : 'manual entry';

  return (
    <div className="mx-auto max-w-[1040px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      <style>{`
        .sg-shine::after {
          content: ""; position: absolute; inset: 0; border-radius: 999px;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
          transform: translateX(-100%); animation: sgshine 2.8s ease-in-out 1s infinite;
        }
        @keyframes sgshine { 0% { transform: translateX(-100%) } 55%, 100% { transform: translateX(220%) } }
        .sg-rise { opacity: 0; transform: translateY(12px); animation: sgrise 0.5s cubic-bezier(0.22,1,0.36,1) forwards; }
        @keyframes sgrise { to { opacity: 1; transform: none } }
        @media (prefers-reduced-motion: reduce) {
          .sg-shine::after { animation: none }
          .sg-rise { animation: none; opacity: 1; transform: none }
        }
      `}</style>

      {/* ── Back — desktop only; mobile gets the top-bar back button ── */}
      <button
        type="button"
        onClick={() => setLocation('/goals')}
        className="ui-focus -ml-2 hidden min-h-touch items-center gap-1 rounded-ui-sm px-2 text-[13.5px] font-bold text-content-muted transition-colors hover:text-content sm:inline-flex"
      >
        <ChevronLeft className="h-4 w-4" /> Back to goals
      </button>

      {/* ── Header ── */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3.5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-[16px] text-white"
            style={{ background: accent, boxShadow: 'var(--ui-shadow-sm), inset 0 1px 0 rgba(255,255,255,0.3)' }}
          >
            {iconFor(goal.icon, 27)}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-content-muted">
              <span className="truncate">{categoryLabel}</span>
              {goal.status === 'completed' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] text-[rgb(var(--ui-brand-ink))]">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} /> Completed
                </span>
              )}
            </div>
            <h1 className="mt-0.5 font-editorial text-[26px] sm:text-[32px] font-bold leading-[1.05] tracking-[-0.024em] text-content">
              {goal.name}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Reached goals NEED this — it's the only path into the archive.
              Partially-funded goals keep it from the halfway mark. */}
          {goal.status === 'active' && (complete || pct >= MARK_COMPLETE_THRESHOLD) && (
            <Button variant="primary" size="sm" disabled={actionPending} onClick={markComplete}>
              {actionPending ? '…' : 'Mark complete'}
            </Button>
          )}
          {goal.status === 'completed' && (
            <Button variant="secondary" size="sm" disabled={actionPending} onClick={reactivate}>
              {actionPending ? '…' : 'Reactivate'}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={openEdit}>Edit</Button>
        </div>
      </header>

      {actionError && (
        <p className="mt-3 text-[12.5px] font-semibold text-negative" role="status" aria-live="polite">
          {actionError}
        </p>
      )}

      {/* ── Progress hero ── */}
      <section
        className="sg-rise relative mt-6 overflow-hidden rounded-ui-xl border bg-panel shadow-ui-sm p-6 sm:p-7"
        style={{ borderColor: complete ? 'color-mix(in srgb, rgb(var(--ui-brand)) 34%, var(--ui-hairline))' : 'var(--ui-hairline)' }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: complete
              ? 'radial-gradient(120% 95% at 100% 0%, var(--ui-brand-soft), transparent 58%),' +
                'radial-gradient(90% 80% at 0% 10%, var(--ui-brand-softer), transparent 60%)'
              : 'radial-gradient(120% 90% at 100% 0%, var(--ui-info-soft), transparent 56%),' +
                'radial-gradient(90% 80% at 0% 10%, var(--ui-brand-softer), transparent 60%)',
          }}
        />
        <div className="relative flex flex-col gap-7 lg:flex-row lg:items-stretch lg:justify-between">
          {/* left — headline + bar */}
          <div className="min-w-0 flex-1">
            <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
              Saved toward goal
            </span>
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="font-editorial text-[34px] sm:text-[46px] font-extrabold leading-none tracking-[-0.03em] ui-tnum">
                {formatCurrency(current)}{' '}
                <span className="text-[0.48em] font-bold text-content-muted">of {formatCurrency(target)}</span>
              </div>
              {complete ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3.5 py-1.5 font-editorial text-[15px] font-extrabold text-[rgb(var(--ui-brand-ink))]">
                  <Check className="h-4 w-4" strokeWidth={3} /> Reached
                </span>
              ) : (
                <span className="font-editorial text-[26px] sm:text-[30px] font-extrabold leading-none tracking-[-0.02em] text-content-secondary ui-tnum">
                  {Math.round(pct)}%
                </span>
              )}
            </div>

            {/* progress bar — each terminal state intentionally distinct */}
            <div className="mt-5">
              {complete ? (
                <div className="h-3 overflow-hidden rounded-full bg-canvas-sunken">
                  <div
                    className="sg-shine relative h-full w-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, var(--ui-viz-1), rgb(var(--ui-brand)))' }}
                  />
                </div>
              ) : notStarted ? (
                <div className="relative h-3 overflow-hidden rounded-full bg-canvas-sunken" style={{ color: accent }}>
                  <div
                    className="absolute inset-0 opacity-[0.16]"
                    style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0 5px, transparent 5px 11px)' }}
                  />
                  <div className="absolute inset-y-0 left-0 w-4 rounded-full" style={{ background: 'currentColor' }} />
                </div>
              ) : (
                <div className="h-3 overflow-hidden rounded-full bg-canvas-sunken">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${barPct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 60%, transparent), ${accent})` }}
                  />
                </div>
              )}
            </div>

            {/* status line — real state only */}
            <div className="mt-3.5 text-[13.5px] font-semibold text-content-secondary ui-tnum">
              {isArchived && !complete ? (
                <span>
                  Marked complete{goal.completedAt ? ` on ${new Date(goal.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''} —{' '}
                  <span className="font-bold text-content">{formatCurrency(current)}</span> saved
                </span>
              ) : complete ? (
                <span className="inline-flex items-center gap-1.5 font-bold text-content">
                  <Sparkles className="h-4 w-4 text-brand" />
                  {surplus >= 1 ? `${formatCurrency(surplus)} over target — nicely done` : 'Fully funded — nicely done'}
                </span>
              ) : notStarted ? (
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-content-faint" /> Not started yet — link an account or edit the amount to get going
                </span>
              ) : paceLine ? (
                <span>{paceLine}</span>
              ) : (
                <span><span className="font-bold text-content">{formatCurrency(remaining)}</span> left to reach your target</span>
              )}
            </div>
          </div>

          {/* right — satellite stat tiles; content-sized, centered against the
              headline block instead of stretched to its full height */}
          <div className="grid grid-cols-2 gap-3 sm:auto-cols-[minmax(128px,1fr)] sm:grid-flow-col lg:flex lg:shrink-0 lg:items-center">
            <StatTile
              label={complete ? 'Over target' : isArchived ? 'Saved' : 'To go'}
              value={
                complete
                  ? (surplus >= 1 ? formatCurrency(surplus) : 'On target')
                  : isArchived
                    ? formatCurrency(current)
                    : formatCurrency(remaining)
              }
              caption={complete ? 'above your goal' : isArchived ? `of ${formatCurrency(target)} target` : `of ${formatCurrency(target)}`}
              icon={<Flag className="h-3.5 w-3.5" />}
              accent={complete}
            />
            {deadlineMonth ? (
              <StatTile
                label="Target date"
                value={deadlineMonth}
                caption={deadlineCountdown ?? undefined}
                icon={<Clock className="h-3.5 w-3.5" />}
              />
            ) : (
              <AddTargetTile onClick={openEdit} />
            )}
            <StatTile
              label="Tracking"
              value={trackingLabel}
              caption={trackingCaption}
              icon={<Wallet className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
      </section>

      {/* ── Progress over time ── */}
      {history.length >= 2 && (
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
                style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
                aria-hidden
              />
              <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em]">Progress</h2>
            </div>
            <SegmentedControl
              size="sm"
              stretch={false}
              aria-label="History range"
              value={histRange}
              onChange={setHistRange}
              options={[
                { value: '1M', label: '1M' },
                { value: '6M', label: '6M' },
                { value: '1Y', label: '1Y' },
                { value: 'All', label: 'All' },
              ]}
            />
          </div>
          <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-2 py-4 sm:px-4">
            <TrendChart
              points={(() => {
                const filtered = filterByRange(history, histRange);
                // A too-narrow range (goal younger than the window) falls back
                // to the full series rather than an empty chart.
                return filtered.length >= 2 ? filtered : history;
              })()}
              range={histRange}
            />
          </div>
        </section>
      )}

      {/* ── Linked accounts ── */}
      <section className="mt-8">
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span
              className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
              aria-hidden
            />
            <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em]">Linked accounts</h2>
            {linkedAccounts.length > 0 && (
              <span className="text-[12.5px] font-semibold text-content-muted">· {linkedAccounts.length} linked</span>
            )}
          </div>
          {!editingAccounts && (
            <Button variant="secondary" size="sm" onClick={openAccountsEditor}>Manage accounts</Button>
          )}
        </div>

        {editingAccounts ? (
          <div ref={accountsPanelRef} className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-6">
            <Eyebrow>Linked accounts</Eyebrow>
            <p className="mt-1.5 mb-4 text-[12.5px] text-content-muted">
              Linked accounts auto-track this goal from their live balances. Remove all to track it manually.
            </p>
            {fundableAccounts.length > 0 ? (
              <AccountPicker
                accounts={fundableAccounts}
                selected={draftAccountIds}
                onToggle={(id) => setDraftAccountIds((prev) => toggleId(prev, id))}
              />
            ) : (
              <p className="text-[12.5px] text-content-muted">No fundable accounts available.</p>
            )}
            <div className="mt-5 flex gap-2.5">
              <Button variant="primary" size="sm" loading={savingAccounts} disabled={savingAccounts} onClick={saveAccounts}>
                {savingAccounts ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" size="sm" disabled={savingAccounts} onClick={() => setEditingAccounts(false)}>
                Cancel
              </Button>
            </div>
            {accountsError && (
              <p className="mt-2.5 text-[12.5px] font-semibold text-negative" role="status" aria-live="polite">{accountsError}</p>
            )}
          </div>
        ) : linkedAccounts.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm">
            {linkedAccounts.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3.5 border-t border-line px-4 py-3.5 transition-colors first:border-t-0 last:rounded-b-ui-xl hover:bg-brand-softer sm:px-5"
              >
                <InstitutionIcon
                  institutionId={row.institutionId}
                  institutionName={row.institutionName}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-bold leading-tight">
                    {row.name}
                    {row.mask && <span className="font-medium text-content-muted ui-tnum"> ••{row.mask}</span>}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-content-muted">
                    {humanizeType(row.type)}
                    <span className="mx-1 text-content-faint">·</span>
                    updated {shortDate(row.asOf)}
                  </div>
                </div>
                <span className="shrink-0 font-editorial text-[15px] font-extrabold tracking-[-0.015em] ui-tnum">
                  {formatCurrency(parseFloat(row.balance ?? '0'))}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3.5 rounded-ui-xl border border-dashed border-line-strong bg-canvas-sunken/40 px-5 py-6">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ui-md bg-canvas-sunken text-content-muted">
              <Wallet className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-content">Tracked manually</p>
              <p className="mt-0.5 text-[12.5px] text-content-muted">
                Not linked to any accounts. Link one to auto-track progress, or edit the amount by hand.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Edit goal ── */}
      {editing && (
        <section ref={editPanelRef} className="mt-8">
          <div className="flex items-center gap-2.5">
            <span
              className="h-[7px] w-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
              aria-hidden
            />
            <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em]">Edit goal</h2>
          </div>
          <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm px-3.5 py-4 sm:p-7">
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <Field label="Goal name">
                <Input
                  ref={editNameRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </Field>
              <Field label="Target amount">
                <Input
                  type="number"
                  value={editTarget}
                  onChange={(e) => setEditTarget(e.target.value)}
                  className="ui-tnum"
                  leadingIcon={<span className="text-[13px]">$</span>}
                />
              </Field>
              <Field label="Planned monthly contribution (optional)">
                <Input
                  type="number"
                  value={editMonthly}
                  onChange={(e) => setEditMonthly(e.target.value)}
                  placeholder="500"
                  className="ui-tnum"
                  leadingIcon={<span className="text-[13px]">$</span>}
                />
              </Field>
              <Field label="Target date">
                <Input
                  type="date"
                  value={editDeadline}
                  onChange={(e) => setEditDeadline(e.target.value)}
                />
              </Field>
              {!goal.isAutoTracked && (
                <Field label="Current amount">
                  <Input
                    type="number"
                    value={editCurrent}
                    onChange={(e) => setEditCurrent(e.target.value)}
                    className="ui-tnum"
                    leadingIcon={<span className="text-[13px]">$</span>}
                  />
                </Field>
              )}
            </div>
            {goal.isAutoTracked && (
              <p className="mt-3.5 text-[12px] text-content-muted">
                This goal auto-tracks from its linked accounts, so the current amount can't be edited here.
              </p>
            )}
            <div className="mt-5 flex gap-2.5">
              <Button
                variant="primary"
                size="sm"
                loading={savingEdit}
                disabled={!editName || !editTarget || savingEdit}
                onClick={saveEdit}
              >
                {savingEdit ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="ghost" size="sm" disabled={savingEdit} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
            {editError && (
              <p className="mt-2.5 text-[12.5px] font-semibold text-negative" role="status" aria-live="polite">{editError}</p>
            )}
          </div>
        </section>
      )}

      {/* ── Danger zone ── */}
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-[12.5px] text-content-muted">
          Deleting removes this goal permanently. Your linked accounts are not affected.
        </p>
        <button
          type="button"
          disabled={actionPending}
          onClick={handleDelete}
          className="ui-focus inline-flex min-h-touch items-center gap-1.5 rounded-ui-md px-3 text-[13px] font-bold text-negative transition-colors hover:bg-negative-soft disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {actionPending ? 'Working…' : 'Delete goal'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatTile — satellite figure in the hero (label · value · caption).
// ---------------------------------------------------------------------------

function StatTile({
  label, value, caption, icon, accent,
}: {
  label: string;
  value: string;
  caption?: string;
  icon?: ReactElement;
  accent?: boolean;
}) {
  return (
    <div className="min-w-[112px] rounded-ui-lg border border-line bg-panel/70 shadow-ui-sm p-3.5 backdrop-blur-sm lg:flex-1">
      <div className="flex items-center gap-1.5 whitespace-nowrap text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">
        {icon && <span className="text-content-faint">{icon}</span>}
        {label}
      </div>
      <div
        className="mt-1.5 font-editorial text-[19px] sm:text-[22px] font-extrabold leading-none tracking-[-0.02em] ui-tnum"
        style={accent ? { color: 'rgb(var(--ui-brand-ink))' } : undefined}
      >
        {value}
      </div>
      {caption && <div className="mt-1.5 truncate text-[11.5px] font-semibold text-content-muted ui-tnum">{caption}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddTargetTile — placeholder in the hero's stat row when a goal has no target
// date, so the row stays symmetric (3 tiles) instead of trailing a gap. Opens
// the edit form where the date can be set.
// ---------------------------------------------------------------------------

function AddTargetTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ui-focus min-w-[112px] rounded-ui-lg border border-dashed border-line-strong bg-panel/40 p-3.5 text-left backdrop-blur-sm transition-colors hover:border-[rgb(var(--ui-accent))]/50 hover:bg-[var(--ui-accent-softer)] lg:flex-1"
    >
      <div className="flex items-center gap-1.5 whitespace-nowrap text-[10.5px] font-bold uppercase tracking-[0.1em] text-content-muted">
        <Clock className="h-3.5 w-3.5 text-content-faint" />
        Target date
      </div>
      <div className="mt-1.5 font-editorial text-[19px] sm:text-[22px] font-extrabold leading-none tracking-[-0.02em] text-[rgb(var(--ui-accent-ink))]">
        Set a date
      </div>
      <div className="mt-1.5 truncate text-[11.5px] font-semibold text-content-muted">add a deadline</div>
    </button>
  );
}
