import { useState, useEffect, useCallback, useRef } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Check, ChevronLeft, Clock, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Eyebrow, EmptyState, Skeleton } from '../components/uikit';
import { useConfirm } from '../components/ds';
import { formatCurrency, goalColor, iconFor, toggleId, AccountChips } from './goal-shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Goal {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
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
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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
      const [{ goals }, { balances: bals }] = await Promise.all([
        api.getGoals(),
        api.getBalances(),
      ]);
      const found = goals.find((g) => g.id === goalId);
      if (!found) {
        setNotFound(true);
        return;
      }
      setGoal(found);
      setBalances(bals);
    } catch {
      setNotFound(true);
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

  if (loading) {
    return (
      <div className="mx-auto max-w-[900px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
        <Skeleton className="h-4 w-16" />
        <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-10 w-72" />
          <Skeleton className="mt-5 h-2.5 w-full rounded-full" />
          <Skeleton className="mt-4 h-3 w-2/3" />
        </div>
        <div className="mt-6 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-4 h-12 w-full rounded-ui-md" />
          <Skeleton className="mt-2.5 h-12 w-full rounded-ui-md" />
        </div>
      </div>
    );
  }

  if (notFound || !goal) {
    return (
      <div className="mx-auto max-w-[900px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
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

  // Deadline labels
  let deadlineMonth: string | null = null;
  let deadlineCountdown: string | null = null;
  if (goal.deadline) {
    deadlineMonth = new Date(goal.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    const daysLeft = Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    deadlineCountdown = daysLeft > 0 ? `${daysLeft} days left` : 'Past deadline';
  }

  // Linked accounts for this goal
  const linkedAccounts: LinkedAccount[] = balances
    .filter((b) => goal.accountIds.includes(b.accountId))
    .map((b) => ({ id: b.accountId, name: b.name, type: b.type, mask: b.mask, balance: b.balance, asOf: b.asOf }));

  // Fundable accounts feed the chip editor
  const fundableAccounts = balances
    .filter((b) => b.type === 'depository' || b.type === 'investment')
    .map((b) => ({ id: b.accountId, name: b.name, mask: b.mask, type: b.type, balance: b.balance }));

  // -- Status actions ---------------------------------------------------------

  const markComplete = async () => {
    setActionPending(true);
    setActionError(null);
    try {
      await api.updateGoal(goal.id, { status: 'completed' });
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

  const inputClass =
    'w-full h-11 min-h-touch rounded-ui-md border border-line-strong bg-panel px-3.5 text-[16px] text-content ' +
    'shadow-ui-sm placeholder:text-content-faint outline-none transition-[border-color,box-shadow] ' +
    'focus:border-brand focus:shadow-[0_0_0_3px_var(--ui-brand-ring)]';

  return (
    <div className="mx-auto max-w-[900px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
      {/* ── Back ── */}
      <button
        type="button"
        onClick={() => setLocation('/goals')}
        className="ui-focus -ml-2 inline-flex min-h-touch items-center gap-1 rounded-ui-sm px-2 text-[13.5px] font-bold text-content-muted transition-colors hover:text-content"
      >
        <ChevronLeft className="h-4 w-4" /> Back to goals
      </button>

      {/* ── Header ── */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[15px] text-white"
            style={{ background: accent, boxShadow: 'var(--ui-shadow-sm), inset 0 1px 0 rgba(255,255,255,0.3)' }}
          >
            {iconFor(goal.icon, 26)}
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-content-muted">
              {categoryLabel}
            </div>
            <h1 className="mt-0.5 font-editorial text-[26px] sm:text-[32px] font-bold leading-[1.05] tracking-[-0.024em] text-content">
              {goal.name}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={openEdit}>Edit</Button>
          {goal.status === 'active' && (
            <Button variant="primary" size="sm" disabled={actionPending} onClick={markComplete}>
              {actionPending ? '…' : 'Mark complete'}
            </Button>
          )}
          {goal.status === 'completed' && (
            <Button variant="secondary" size="sm" disabled={actionPending} onClick={reactivate}>
              {actionPending ? '…' : 'Reactivate'}
            </Button>
          )}
          <Button variant="destructive" size="sm" disabled={actionPending} onClick={handleDelete}>
            {actionPending ? '…' : 'Delete'}
          </Button>
        </div>
      </header>

      {actionError && (
        <p className="mt-3 text-[12.5px] font-semibold text-negative" role="status" aria-live="polite">
          {actionError}
        </p>
      )}

      {/* ── Progress hero ── */}
      <section className="relative mt-6 overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 90% at 100% 0%, var(--ui-info-soft), transparent 56%),' +
              'radial-gradient(90% 80% at 0% 10%, var(--ui-brand-softer), transparent 60%)',
          }}
        />
        <div className="relative">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
                Saved toward goal
              </span>
              <div className="mt-2 font-editorial text-[32px] sm:text-[44px] font-extrabold leading-none tracking-[-0.03em] ui-tnum">
                {formatCurrency(current)}{' '}
                <span className="text-[0.5em] font-bold text-content-muted">of {formatCurrency(target)}</span>
              </div>
            </div>
            {complete ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3.5 py-1.5 font-editorial text-[15px] font-extrabold text-[rgb(var(--ui-brand-ink))]">
                <Check className="h-4 w-4" strokeWidth={3} /> Reached
              </span>
            ) : (
              <span className="shrink-0 font-editorial text-[30px] sm:text-[34px] font-extrabold leading-none tracking-[-0.02em] ui-tnum">
                {Math.round(pct)}%
              </span>
            )}
          </div>

          {/* progress bar — each terminal state intentionally distinct */}
          <div className="mt-5">
            {complete ? (
              <div className="h-2.5 overflow-hidden rounded-full bg-canvas-sunken">
                <div
                  className="h-full w-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, var(--ui-viz-1), rgb(var(--ui-brand)))' }}
                />
              </div>
            ) : notStarted ? (
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
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${barPct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${accent} 60%, transparent), ${accent})` }}
                />
              </div>
            )}
          </div>

          {/* meta — real state + real target date only */}
          <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] font-semibold text-content-secondary ui-tnum">
            {complete ? (
              <span className="font-bold text-content">
                {surplus >= 1 ? `${formatCurrency(surplus)} over target` : 'Fully funded'}
              </span>
            ) : (
              <span><span className="font-bold text-content">{formatCurrency(remaining)}</span> to go</span>
            )}
            {deadlineMonth && (
              <>
                <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
                <span className="inline-flex items-center gap-1.5 font-medium text-content-muted">
                  <Clock className="h-3.5 w-3.5 text-content-faint" /> Target {deadlineMonth}
                </span>
              </>
            )}
            {!complete && deadlineCountdown && (
              <>
                <span className="h-1 w-1 shrink-0 rounded-full bg-content-faint" aria-hidden />
                <span className="font-medium text-content-muted">{deadlineCountdown}</span>
              </>
            )}
          </div>

          {goal.isAutoTracked && (
            <div className="mt-4 flex flex-col gap-1.5">
              <span
                className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-bold text-[rgb(var(--ui-brand-ink))]"
                title={
                  linkedAccounts.length > 0
                    ? `Tracked from: ${linkedAccounts.map((a) => a.name).join(', ')}`
                    : undefined
                }
              >
                Auto · {goal.accountIds.length} account{goal.accountIds.length === 1 ? '' : 's'}
              </span>
              <p className="text-[12px] text-content-muted">
                Progress is tracked automatically from the linked accounts below.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Linked accounts ── */}
      <section className="mt-8">
        <div className="flex items-end justify-between gap-4">
          <div className="flex items-baseline gap-2.5">
            <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em]">Linked accounts</h2>
            {linkedAccounts.length > 0 && (
              <span className="text-[12.5px] font-semibold text-content-muted">{linkedAccounts.length} linked</span>
            )}
          </div>
          {!editingAccounts && (
            <Button variant="secondary" size="sm" onClick={openAccountsEditor}>Manage accounts</Button>
          )}
        </div>

        {editingAccounts ? (
          <div ref={accountsPanelRef} className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5 sm:p-6">
            <Eyebrow>Linked accounts</Eyebrow>
            <p className="mt-1.5 mb-4 text-[12.5px] text-content-muted">
              Remove all accounts to track this goal manually.
            </p>
            {fundableAccounts.length > 0 ? (
              <AccountChips
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
                className="flex items-center gap-3.5 border-t border-line px-4 py-3.5 first:border-t-0 sm:px-5"
              >
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
          <div className="mt-4 rounded-ui-xl border border-dashed border-line-strong bg-canvas-sunken/40 px-5 py-6 text-center">
            <p className="text-[13.5px] text-content-muted">
              Not linked to any accounts — this goal's amount is tracked manually.
            </p>
          </div>
        )}
      </section>

      {/* ── Edit goal ── */}
      {editing && (
        <section ref={editPanelRef} className="mt-8">
          <h2 className="font-editorial text-[19px] font-bold tracking-[-0.018em]">Edit goal</h2>
          <div className="mt-4 rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5 sm:p-7">
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label className="space-y-1.5">
                <span className="block text-[13px] font-medium text-content-secondary">Goal name</span>
                <input
                  ref={editNameRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="space-y-1.5">
                <span className="block text-[13px] font-medium text-content-secondary">Target amount</span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-content-muted">$</span>
                  <input
                    type="number"
                    value={editTarget}
                    onChange={(e) => setEditTarget(e.target.value)}
                    className={`${inputClass} pl-7 ui-tnum`}
                  />
                </div>
              </label>
              <label className="space-y-1.5">
                <span className="block text-[13px] font-medium text-content-secondary">Target date</span>
                <input
                  type="date"
                  value={editDeadline}
                  onChange={(e) => setEditDeadline(e.target.value)}
                  className={inputClass}
                />
              </label>
              {!goal.isAutoTracked && (
                <label className="space-y-1.5">
                  <span className="block text-[13px] font-medium text-content-secondary">Current amount</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-content-muted">$</span>
                    <input
                      type="number"
                      value={editCurrent}
                      onChange={(e) => setEditCurrent(e.target.value)}
                      className={`${inputClass} pl-7 ui-tnum`}
                    />
                  </div>
                </label>
              )}
            </div>
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
    </div>
  );
}
