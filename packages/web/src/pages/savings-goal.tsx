import { useState, useEffect, useCallback, useRef } from 'react';
import { useRoute, useLocation } from 'wouter';
import { Check, ChevronLeft } from 'lucide-react';
import { api } from '../lib/api';
import {
  Page,
  PageHeader,
  Section,
  Card,
  Button,
  Eyebrow,
  DataTable,
  useConfirm,
  SkeletonLine,
  SkeletonBlock,
} from '../components/ds';
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
      <Page>
        <Section>
          <Card>
            <SkeletonLine width="40%" height={28} style={{ marginBottom: 16 }} />
            <SkeletonBlock height={13} style={{ marginBottom: 16 }} />
            <SkeletonLine width="30%" height={14} />
          </Card>
        </Section>
        <Section>
          <Card>
            <SkeletonBlock height={120} />
          </Card>
        </Section>
      </Page>
    );
  }

  if (notFound || !goal) {
    return (
      <Page>
        <PageHeader title="Goal not found" eyebrow="savings" />
        <Section>
          <Card>
            <p style={{ margin: '0 0 16px', color: 'var(--lf-muted)', fontFamily: "'Geist', system-ui, sans-serif" }}>
              We couldn't find this goal. It may have been deleted.
            </p>
            <Button variant="ink" onClick={() => setLocation('/goals')}>Back to goals</Button>
          </Card>
        </Section>
      </Page>
    );
  }

  const target = parseFloat(goal.targetAmount);
  const current = parseFloat(goal.currentAmount);
  const pct = target > 0 ? (current / target) * 100 : 0;
  const barPct = Math.min(100, pct);
  const complete = current >= target && target > 0;
  const remaining = Math.max(0, target - current);
  const color = goalColor(goal.category);
  const categoryLabel = goal.category ? goal.category.replace(/_/g, ' ') : 'savings';

  // Deadline labels
  let deadlineMonth: string | null = null;
  let deadlineCountdown: string | null = null;
  if (goal.deadline) {
    deadlineMonth = new Date(goal.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
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

  const headerActions = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button variant="ghost" onClick={openEdit}>Edit</Button>
      {goal.status === 'active' && (
        <Button variant="ink" disabled={actionPending} onClick={markComplete}>
          {actionPending ? '…' : 'Mark complete'}
        </Button>
      )}
      {goal.status === 'completed' && (
        <Button variant="ghost" disabled={actionPending} onClick={reactivate}>
          {actionPending ? '…' : 'Reactivate'}
        </Button>
      )}
      <Button variant="ghost" className="sg-delete" disabled={actionPending} onClick={handleDelete}>
        {actionPending ? '…' : 'Delete'}
      </Button>
    </div>
  );

  return (
    <Page>
      <style>{`
        .sg-back {
          display: inline-flex; align-items: center; gap: 4px;
          margin-bottom: 12px;
        }
        .sg-delete:hover { color: var(--lf-sauce); }

        /* ── Progress hero ── */
        .sg-hero {
          display: flex; flex-direction: column; gap: 18px;
        }
        .sg-hero__top {
          display: flex; align-items: flex-end; justify-content: space-between;
          gap: 20px; flex-wrap: wrap;
        }
        .sg-hero__amount {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 600;
          font-size: clamp(28px, 4vw, 40px);
          line-height: 1.0;
          letter-spacing: -0.025em;
          color: var(--lf-ink);
          font-variant-numeric: tabular-nums;
        }
        .sg-hero__amount-target {
          color: var(--lf-muted);
          font-weight: 400;
          font-size: 0.55em;
        }
        .sg-hero__pct {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 600;
          font-size: clamp(28px, 4vw, 36px);
          letter-spacing: -0.02em;
          color: var(--lf-ink);
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .sg-hero__pct--complete {
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 16px; font-weight: 600; letter-spacing: 0.01em;
          color: var(--lf-basil);
          background: color-mix(in srgb, var(--lf-basil) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--lf-basil) 30%, transparent);
          border-radius: 999px; padding: 7px 16px;
        }
        .sg-hero__bar {
          height: 13px;
          background: var(--lf-rule-soft);
          border-radius: 999px;
          overflow: hidden;
        }
        .sg-hero__bar > div {
          height: 100%; border-radius: 999px;
          transition: width 0.6s cubic-bezier(0.16,1,0.3,1);
        }
        .sg-hero__meta {
          display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px;
          color: var(--lf-muted);
          font-variant-numeric: tabular-nums;
        }
        .sg-hero__meta strong {
          color: var(--lf-ink); font-weight: 600;
        }
        .sg-hero__meta-sep { opacity: 0.4; }
        .sg-hero__auto {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px; font-weight: 500;
          color: var(--lf-ink-soft);
          background: color-mix(in srgb, var(--lf-basil) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--lf-basil) 24%, transparent);
          border-radius: 999px; padding: 3px 10px;
          align-self: flex-start;
        }
        .sg-hero__auto-caption {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px; color: var(--lf-muted);
          margin: 0;
        }

        /* ── Forms ── */
        .sg-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
        }
        .sg-field { display: flex; flex-direction: column; gap: 6px; }
        .sg-help {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px; color: var(--lf-muted);
          margin: 8px 0 0;
        }
        .sg-error {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px; color: var(--lf-sauce);
          margin: 10px 0 0;
        }
      `}</style>

      <Button variant="ghost" className="sg-back" onClick={() => setLocation('/goals')} icon={<ChevronLeft size={16} />}>
        Back
      </Button>

      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color, display: 'inline-flex' }}>{iconFor(goal.icon, 24)}</span>
            {goal.name}
          </span>
        }
        eyebrow={categoryLabel}
        actions={headerActions}
      />

      {actionError && (
        <p className="sg-error" role="status" aria-live="polite" style={{ marginTop: 0 }}>
          {actionError}
        </p>
      )}

      {/* ── Progress hero ── */}
      <Section>
        <Card>
          <div className="sg-hero">
            <div className="sg-hero__top">
              <div className="sg-hero__amount">
                {formatCurrency(current)}
                <span className="sg-hero__amount-target"> / {formatCurrency(target)}</span>
              </div>
              {complete ? (
                <span className="sg-hero__pct sg-hero__pct--complete">
                  <Check size={18} /> Reached
                </span>
              ) : (
                <span className="sg-hero__pct">{Math.round(pct)}%</span>
              )}
            </div>

            <div className="sg-hero__bar">
              {complete ? (
                <div style={{ width: '100%', background: 'var(--lf-basil)' }} />
              ) : barPct > 0 ? (
                <div style={{ width: `${barPct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, transparent), ${color})` }} />
              ) : (
                <div style={{ width: 8, background: color }} />
              )}
            </div>

            <div className="sg-hero__meta">
              {[
                complete
                  ? <span><strong>Reached</strong></span>
                  : <span><strong>{formatCurrency(remaining)}</strong> to go</span>,
                deadlineMonth ? <span>Target: {deadlineMonth}</span> : null,
                // Countdown is incoherent on a reached goal — suppress it.
                !complete && deadlineCountdown ? <span>{deadlineCountdown}</span> : null,
              ]
                .filter(Boolean)
                .map((item, i) => (
                  <span key={i} style={{ display: 'contents' }}>
                    {i > 0 && <span className="sg-hero__meta-sep">·</span>}
                    {item}
                  </span>
                ))}
            </div>

            {goal.isAutoTracked && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span
                  className="sg-hero__auto"
                  title={
                    linkedAccounts.length > 0
                      ? `Tracked from: ${linkedAccounts.map((a) => a.name).join(', ')}`
                      : undefined
                  }
                >
                  Auto · {goal.accountIds.length} account{goal.accountIds.length === 1 ? '' : 's'}
                </span>
                <p className="sg-hero__auto-caption">
                  Progress is tracked automatically from the linked accounts below.
                </p>
              </div>
            )}
          </div>
        </Card>
      </Section>

      {/* ── Linked accounts ── */}
      <Section
        title="Linked accounts"
        eyebrow={`${linkedAccounts.length} linked`}
        actions={
          !editingAccounts ? (
            <Button variant="ghost" onClick={openAccountsEditor}>Manage accounts</Button>
          ) : undefined
        }
      >
        {editingAccounts ? (
          <div ref={accountsPanelRef}>
          <Card>
            <Eyebrow>Linked accounts</Eyebrow>
            <p className="sg-help" style={{ marginTop: 4, marginBottom: 12 }}>
              Remove all accounts to track this goal manually.
            </p>
            {fundableAccounts.length > 0 ? (
              <AccountChips
                accounts={fundableAccounts}
                selected={draftAccountIds}
                onToggle={(id) => setDraftAccountIds((prev) => toggleId(prev, id))}
              />
            ) : (
              <p className="sg-help" style={{ margin: 0 }}>No fundable accounts available.</p>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Button variant="ink" disabled={savingAccounts} onClick={saveAccounts}>
                {savingAccounts ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" disabled={savingAccounts} onClick={() => setEditingAccounts(false)}>
                Cancel
              </Button>
            </div>
            {accountsError && <p className="sg-error" role="status" aria-live="polite">{accountsError}</p>}
          </Card>
          </div>
        ) : (
          <DataTable<LinkedAccount>
            columns={[
              {
                key: 'name',
                header: 'Name',
                cell: (row) => (
                  <span>
                    {row.name}
                    {row.mask && <span style={{ color: 'var(--lf-muted)' }}> ••{row.mask}</span>}
                  </span>
                ),
              },
              { key: 'type', header: 'Type', cell: (row) => humanizeType(row.type) },
              {
                key: 'balance',
                header: 'Balance',
                num: true,
                cell: (row) => formatCurrency(parseFloat(row.balance ?? '0')),
              },
              { key: 'asOf', header: 'Updated', muted: true, cell: (row) => shortDate(row.asOf) },
            ]}
            rows={linkedAccounts}
            rowKey={(row) => row.id}
            emptyMessage="Not linked to any accounts — this goal's amount is tracked manually."
          />
        )}
      </Section>

      {/* ── Edit goal ── */}
      {editing && (
        <div ref={editPanelRef}>
        <Section title="Edit goal">
          <Card>
            <div className="sg-form-grid">
              <label className="sg-field">
                <Eyebrow>Goal name</Eyebrow>
                <input
                  ref={editNameRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label className="sg-field">
                <Eyebrow>Target amount</Eyebrow>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--lf-muted)', fontSize: 13, pointerEvents: 'none',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>$</span>
                  <input
                    type="number"
                    value={editTarget}
                    onChange={(e) => setEditTarget(e.target.value)}
                    className="ds-num"
                    style={{ ...inputStyle, paddingLeft: 24 }}
                  />
                </div>
              </label>
              <label className="sg-field">
                <Eyebrow>Target date</Eyebrow>
                <input
                  type="date"
                  value={editDeadline}
                  onChange={(e) => setEditDeadline(e.target.value)}
                  style={inputStyle}
                />
              </label>
              {!goal.isAutoTracked && (
                <label className="sg-field">
                  <Eyebrow>Current amount</Eyebrow>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                      color: 'var(--lf-muted)', fontSize: 13, pointerEvents: 'none',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>$</span>
                    <input
                      type="number"
                      value={editCurrent}
                      onChange={(e) => setEditCurrent(e.target.value)}
                      className="ds-num"
                      style={{ ...inputStyle, paddingLeft: 24 }}
                    />
                  </div>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Button variant="ink" disabled={!editName || !editTarget || savingEdit} onClick={saveEdit}>
                {savingEdit ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="ghost" disabled={savingEdit} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
            {editError && <p className="sg-error" role="status" aria-live="polite">{editError}</p>}
          </Card>
        </Section>
        </div>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Local style helpers
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--lf-cream)',
  border: '1px solid var(--lf-rule)',
  borderRadius: 8,
  // 16px prevents iOS Safari auto-zoom on focus
  fontSize: 16,
  color: 'var(--lf-ink)',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
