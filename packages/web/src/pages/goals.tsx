import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Check, X, Trash2, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { PageActions } from '../components/common/page-actions';
import {
  Page,
  PageHeader,
  Section,
  Card,
  Button,
  Eyebrow,
  EmptyState,
  StatStrip,
  Lede,
  useConfirm,
} from '../components/ds';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Goal category → LasagnaFi color
// ---------------------------------------------------------------------------

function goalColor(category: string): string {
  const c = category?.toLowerCase() ?? '';
  if (c === 'home_purchase' || c === 'house' || c === 'home' || c.includes('down_payment') || c.includes('house')) return 'var(--lf-sauce)';
  if (c === 'emergency_fund' || c === 'safety' || c.includes('emergency')) return 'var(--lf-basil)';
  if (c === 'vacation' || c === 'travel' || c === 'relocation' || c.includes('travel') || c.includes('vacation')) return 'var(--lf-cheese)';
  if (c === 'car' || c === 'vehicle' || c === 'transport' || c.includes('car')) return 'var(--lf-crust)';
  if (c === 'wedding' || c === 'life_event' || c === 'life' || c.includes('wedding')) return 'var(--lf-burgundy)';
  if (c === 'home_repair' || c === 'major_purchase' || c.includes('repair') || c.includes('major')) return 'var(--lf-crust)';
  if (c === 'education' || c === 'retirement' || c.includes('education') || c.includes('retirement')) return 'var(--lf-noodle)';
  if (c === 'debt_payoff' || c.includes('debt')) return 'var(--lf-muted)';
  return 'var(--lf-muted)';
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const GOAL_PRESETS = [
  { name: 'Emergency Fund', category: 'emergency_fund', icon: '🛡️', suggestedTarget: 25000 },
  { name: 'Home Purchase', category: 'home_purchase', icon: '🏠', suggestedTarget: 80000 },
  { name: 'Vacation / Travel', category: 'vacation', icon: '✈️', suggestedTarget: 5000 },
  { name: 'Vehicle Purchase', category: 'car', icon: '🚗', suggestedTarget: 30000 },
  { name: 'Wedding Fund', category: 'wedding', icon: '💍', suggestedTarget: 30000 },
  { name: 'Education / 529', category: 'education', icon: '🎓', suggestedTarget: 50000 },
  { name: 'Home Repair', category: 'home_repair', icon: '🔧', suggestedTarget: 15000 },
  { name: 'Major Purchase', category: 'major_purchase', icon: '🛍️', suggestedTarget: 10000 },
  { name: 'Life Event', category: 'life_event', icon: '🎉', suggestedTarget: 10000 },
  { name: 'Retirement', category: 'retirement', icon: '🌴', suggestedTarget: 1000000 },
  { name: 'Debt Payoff', category: 'debt_payoff', icon: '💳', suggestedTarget: 20000 },
  { name: 'General Savings', category: 'savings', icon: '💰', suggestedTarget: 10000 },
];

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
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Goals() {
  const confirm = useConfirm();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  // Create form state
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newIcon, setNewIcon] = useState('🎯');
  const [newDeadline, setNewDeadline] = useState('');
  const [newCategory, setNewCategory] = useState('savings');

  useEffect(() => {
    api.getGoals()
      .then(({ goals }) => setGoals(goals))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!newName || !newTarget) return;
    setCreating(true);
    try {
      await api.createGoal({
        name: newName,
        targetAmount: parseFloat(newTarget),
        deadline: newDeadline || undefined,
        category: newCategory,
        icon: newIcon,
      });
      const { goals: fresh } = await api.getGoals();
      setGoals(fresh);
      setShowCreate(false);
      setNewName('');
      setNewTarget('');
      setNewIcon('🎯');
      setNewDeadline('');
      setNewCategory('savings');
    } catch (err) {
      console.error(err);
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateAmount = async (id: string) => {
    const amount = parseFloat(editAmount);
    if (isNaN(amount)) return;
    try {
      await api.updateGoal(id, { currentAmount: amount });
      setGoals(prev => prev.map(g => g.id === id ? { ...g, currentAmount: String(amount) } : g));
      setEditingId(null);
      setEditAmount('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    const goal = goals.find((g) => g.id === id);
    const ok = await confirm({
      title: goal ? `Delete "${goal.name}"?` : 'Delete this goal?',
      body: 'The goal and its progress history will be removed. Linked savings accounts are kept.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteGoal(id);
      setGoals(prev => prev.filter(g => g.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await api.updateGoal(id, { status: 'completed' });
      setGoals(prev => prev.map(g => g.id === id ? { ...g, status: 'completed' } : g));
    } catch (err) {
      console.error(err);
    }
  };

  const selectPreset = (preset: typeof GOAL_PRESETS[0]) => {
    setNewName(preset.name);
    setNewTarget(String(preset.suggestedTarget));
    setNewIcon(preset.icon);
    setNewCategory(preset.category);
  };

  const activeGoals = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'completed');

  const totalTarget = activeGoals.reduce((s, g) => s + parseFloat(g.targetAmount), 0);
  const totalSaved = activeGoals.reduce((s, g) => s + parseFloat(g.currentAmount), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;
  const avgPct = activeGoals.length > 0
    ? Math.round(
        activeGoals
          .map((g) => {
            const t = parseFloat(g.targetAmount);
            const c = parseFloat(g.currentAmount);
            return t > 0 ? Math.min(100, (c / t) * 100) : 0;
          })
          .reduce((s, v) => s + v, 0) / activeGoals.length,
      )
    : 0;

  const newGoalBtn = import.meta.env.VITE_DEMO_MODE !== 'true' ? (
    <Button variant="ink" onClick={() => setShowCreate(v => !v)} icon={<Plus size={14} />}>
      New goal
    </Button>
  ) : null;

  return (
    <Page>
      <style>{`
        .goals-feed { list-style: none; margin: 0; padding: 0; }
        .goals-feed li {
          padding: 22px 0;
          border-top: 1px solid var(--lf-rule);
        }
        .goals-feed li:last-child { padding-bottom: 0; }
        .goals-feed__row {
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr) auto;
          gap: 16px;
          align-items: start;
        }
        .goals-feed__icon {
          width: 44px; height: 44px;
          border-radius: 8px;
          display: grid; place-items: center;
          font-size: 22px;
          flex-shrink: 0;
        }
        .goals-feed__main { min-width: 0; }
        .goals-feed__head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 16px; margin-bottom: 8px;
        }
        .goals-feed__title {
          font-family: 'Instrument Serif', Georgia, serif;
          font-weight: 500;
          font-size: clamp(20px, 2.2vw, 26px);
          line-height: 1.15;
          color: var(--lf-ink);
          margin: 0;
          letter-spacing: -0.01em;
        }
        .goals-feed__amount {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 13px;
          color: var(--lf-ink-soft);
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }
        .goals-feed__bar {
          height: 4px;
          background: var(--lf-cream-deep);
          border-radius: 2px;
          overflow: hidden;
          margin: 10px 0 8px;
        }
        .goals-feed__bar > div { height: 100%; border-radius: 2px; transition: width 0.6s cubic-bezier(0.16,1,0.3,1); }
        .goals-feed__meta {
          display: flex; gap: 10px; align-items: baseline;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--lf-muted);
        }
        .goals-feed__meta-sep { opacity: 0.4; }
        .goals-feed__actions {
          display: flex; gap: 4px; flex-shrink: 0;
          align-items: flex-start; padding-top: 4px;
        }
        .goals-feed__iconbtn {
          display: flex; align-items: center; justify-content: center;
          min-width: 44px; min-height: 44px;
          width: 44px; height: 44px; border-radius: 6px;
          border: none; background: transparent;
          color: var(--lf-muted); cursor: pointer;
        }
        .goals-feed__iconbtn:hover { background: var(--lf-cream); color: var(--lf-ink); }
        .goals-feed__open {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 44px; min-height: 44px;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
          color: var(--lf-muted);
          background: transparent; border: none; cursor: pointer;
          padding: 0 6px;
          transition: color 0.15s;
        }
        .goals-feed__open:hover { color: var(--lf-sauce); }
        .goals-feed__amount-edit {
          height: 28px; padding: 0 8px; border-radius: 6px;
          border: 1px solid var(--lf-rule); background: var(--lf-cream);
          color: var(--lf-ink); font-size: 12px;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          width: 120px; outline: none;
        }
        .goals-strip { margin: 32px 0 48px; }
        @media (max-width: 640px) {
          .goals-strip { margin: 16px 0 20px; }
          .goals-feed li { padding: 16px 0; }
          .goals-feed__row {
            grid-template-columns: 36px minmax(0, 1fr) auto;
            gap: 12px;
          }
          .goals-feed__icon {
            width: 36px; height: 36px;
            font-size: 18px;
          }
        }
        .goals-presets {
          display: flex; flex-wrap: wrap; gap: 8px;
        }
        .goals-preset {
          padding: 6px 14px; border-radius: 20px;
          border: 1px solid var(--lf-rule);
          background: transparent; cursor: pointer;
          font-family: inherit; font-size: 13px; font-weight: 500;
          color: var(--lf-muted);
          transition: all 0.15s;
        }
        .goals-preset:hover { color: var(--lf-ink); }
      `}</style>

      <PageHeader
        eyebrow={!loading ? `${activeGoals.length} active · ${completedGoals.length} complete` : undefined}
        title="Goals"
        actions={newGoalBtn}
      />

      {/* Editorial lede */}
      {!loading && activeGoals.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Lede>
            You've saved{' '}
            <Lede.Num tone="pos">{formatCurrency(totalSaved)}</Lede.Num>
            {' '}of{' '}
            <Lede.Num>{formatCurrency(totalTarget)}</Lede.Num>
            {' '}across{' '}
            <Lede.Num highlight>{activeGoals.length} active</Lede.Num>
            {activeGoals.length === 1 ? ' goal' : ' goals'}
            {completedGoals.length > 0 && (
              <>
                , with <Lede.Num tone="pos">{completedGoals.length} complete</Lede.Num>
              </>
            )}.
          </Lede>
        </div>
      )}

      {/* Stat strip */}
      {!loading && activeGoals.length > 0 && (
        <StatStrip
          className="goals-strip"
          items={[
            { label: 'Saved', value: <span className="ds-num">{formatCurrency(totalSaved)}</span>, sub: 'across active', tone: 'pos' },
            { label: 'Total target', value: <span className="ds-num">{formatCurrency(totalTarget)}</span>, sub: `${overallPct}% reached` },
            { label: 'Active', value: <span className="ds-num">{activeGoals.length}</span>, sub: `${completedGoals.length} complete` },
            { label: 'Avg progress', value: <span className="ds-num">{avgPct}%</span>, sub: 'per goal' },
          ]}
        />
      )}

      {/* Savings insights */}
      <Section>
        <PageActions types="savings" />
      </Section>

      {/* Create goal panel — Card variant only when expanded */}
      <AnimatePresence>
        {showCreate && import.meta.env.VITE_DEMO_MODE !== 'true' && (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden', marginBottom: 40 }}
          >
            <Card>
              <Eyebrow>New goal</Eyebrow>
              <h3 className="ds-h3" style={{ marginTop: 6, marginBottom: 16 }}>What are you saving for?</h3>

              {/* Form-first: name, amount, date — primary fields */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 16,
                marginBottom: 20,
              }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Eyebrow>Goal name</Eyebrow>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={newIcon}
                      onChange={e => setNewIcon(e.target.value)}
                      maxLength={4}
                      aria-label="Icon"
                      style={{ ...inputStyle, width: 56, textAlign: 'center', flexShrink: 0 }}
                    />
                    <input
                      type="text"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. Emergency Fund"
                      style={inputStyle}
                    />
                  </div>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Eyebrow>Target amount</Eyebrow>
                  <div style={{ position: 'relative' }}>
                    <span style={{
                      position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                      color: 'var(--lf-muted)', fontSize: 13, pointerEvents: 'none',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}>$</span>
                    <input
                      type="number"
                      value={newTarget}
                      onChange={e => setNewTarget(e.target.value)}
                      placeholder="25000"
                      className="ds-num"
                      style={{ ...inputStyle, paddingLeft: 24 }}
                    />
                  </div>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Eyebrow>Target date (optional)</Eyebrow>
                  <input
                    type="date"
                    value={newDeadline}
                    onChange={e => setNewDeadline(e.target.value)}
                    style={inputStyle}
                  />
                </label>
              </div>

              {/* Category chips — now BELOW as optional quick-start */}
              <div style={{ marginBottom: 20 }}>
                <Eyebrow>Category (optional)</Eyebrow>
                <div className="goals-presets" style={{ marginTop: 8 }}>
                  {GOAL_PRESETS.map((preset) => {
                    const active = newCategory === preset.category;
                    const color = goalColor(preset.category);
                    return (
                      <button
                        key={preset.category}
                        onClick={() => selectPreset(preset)}
                        className="goals-preset"
                        style={{
                          borderColor: active ? color : 'var(--lf-rule)',
                          color: active ? color : 'var(--lf-muted)',
                        }}
                      >
                        {preset.icon} {preset.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <Button
                  variant="ink"
                  disabled={!newName || !newTarget || creating}
                  onClick={handleCreate}
                >
                  {creating ? 'Creating…' : 'Create goal'}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
              </div>
            </Card>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Active goals — editorial article list */}
      {!loading && (
        activeGoals.length === 0 && !showCreate ? (
          <Section>
            <EmptyState
              icon={<span style={{ fontSize: 40 }}>🎯</span>}
              title="No goals yet"
              body="Setting financial goals is the first step toward achieving them. Create a goal to start tracking your progress."
              cta={import.meta.env.VITE_DEMO_MODE !== 'true' ? (
                <Button variant="ink" onClick={() => setShowCreate(true)} icon={<Plus size={14} />}>
                  Create your first goal
                </Button>
              ) : undefined}
            />
          </Section>
        ) : activeGoals.length > 0 ? (
          <Section title="Active goals" eyebrow={`${activeGoals.length} in progress`}>
            <ul className="goals-feed">
              {activeGoals.map((goal) => {
                const target = parseFloat(goal.targetAmount);
                const current = parseFloat(goal.currentAmount);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                const remaining = Math.max(0, target - current);
                const color = goalColor(goal.category);

                let deadlineLabel: string | null = null;
                if (goal.deadline) {
                  const daysLeft = Math.ceil(
                    (new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                  );
                  deadlineLabel = daysLeft > 0 ? `${daysLeft}d left` : 'Past deadline';
                }

                return (
                  <li key={goal.id}>
                    <div className="goals-feed__row">
                      <div
                        className="goals-feed__icon"
                        style={{ background: color + '18', border: `1px solid ${color}30` }}
                      >
                        {goal.icon || '🎯'}
                      </div>
                      <div className="goals-feed__main">
                        <div className="goals-feed__head">
                          <h3 className="goals-feed__title">{goal.name}</h3>
                          {editingId === goal.id ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <input
                                type="number"
                                value={editAmount}
                                onChange={e => setEditAmount(e.target.value)}
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleUpdateAmount(goal.id)}
                                className="goals-feed__amount-edit ds-num"
                              />
                              <button onClick={() => handleUpdateAmount(goal.id)} className="goals-feed__iconbtn" style={{ color: 'var(--lf-basil)' }}>
                                <Check size={13} />
                              </button>
                              <button onClick={() => { setEditingId(null); setEditAmount(''); }} className="goals-feed__iconbtn">
                                <X size={13} />
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={
                                import.meta.env.VITE_DEMO_MODE !== 'true'
                                  ? () => { setEditingId(goal.id); setEditAmount(String(current)); }
                                  : undefined
                              }
                              className="goals-feed__amount"
                              style={{
                                background: 'transparent', border: 'none', padding: 0,
                                cursor: import.meta.env.VITE_DEMO_MODE !== 'true' ? 'text' : 'default',
                              }}
                            >
                              {formatCurrency(current)} <span style={{ color: 'var(--lf-muted)' }}>/ {formatCurrency(target)}</span>
                            </button>
                          )}
                        </div>

                        <div className="goals-feed__bar">
                          <div style={{ width: `${pct}%`, background: color }} />
                        </div>

                        <div className="goals-feed__meta">
                          <span style={{ color: pct >= 100 ? 'var(--lf-basil)' : color }}>
                            {Math.round(pct)}%
                          </span>
                          <span className="goals-feed__meta-sep">·</span>
                          <span>
                            {remaining > 0 ? `${formatCurrency(remaining)} to go` : 'Reached'}
                          </span>
                          {deadlineLabel && (
                            <>
                              <span className="goals-feed__meta-sep">·</span>
                              <span>{deadlineLabel}</span>
                            </>
                          )}
                          {goal.category && (
                            <>
                              <span className="goals-feed__meta-sep">·</span>
                              <span>{goal.category.replace(/_/g, ' ')}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="goals-feed__actions">
                        {import.meta.env.VITE_DEMO_MODE !== 'true' && pct >= 100 && (
                          <button onClick={() => handleComplete(goal.id)} title="Mark complete" className="goals-feed__iconbtn">
                            <Check size={14} />
                          </button>
                        )}
                        {import.meta.env.VITE_DEMO_MODE !== 'true' && (
                          <button onClick={() => handleDelete(goal.id)} title="Delete" className="goals-feed__iconbtn">
                            <Trash2 size={14} />
                          </button>
                        )}
                        <button
                          className="goals-feed__open"
                          aria-label="Open goal"
                          onClick={
                            import.meta.env.VITE_DEMO_MODE !== 'true'
                              ? () => { setEditingId(goal.id); setEditAmount(String(current)); }
                              : undefined
                          }
                        >
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null
      )}

      {/* Completed goals */}
      {completedGoals.length > 0 && (
        <Section title="Completed" eyebrow={`${completedGoals.length} reached`}>
          <ul className="goals-feed">
            {completedGoals.map((goal) => (
              <li key={goal.id}>
                <div className="goals-feed__row">
                  <div
                    className="goals-feed__icon"
                    style={{ background: 'rgba(90,107,63,0.15)', border: '1px solid rgba(90,107,63,0.30)' }}
                  >
                    {goal.icon || '🎯'}
                  </div>
                  <div className="goals-feed__main">
                    <div className="goals-feed__head">
                      <h3 className="goals-feed__title" style={{ textDecoration: 'line-through', color: 'var(--lf-muted)' }}>
                        {goal.name}
                      </h3>
                      <span className="goals-feed__amount">
                        {formatCurrency(parseFloat(goal.targetAmount))}
                      </span>
                    </div>
                    <div className="goals-feed__meta">
                      <span style={{ color: 'var(--lf-basil)' }}>Reached ✓</span>
                      {goal.category && (
                        <>
                          <span className="goals-feed__meta-sep">·</span>
                          <span>{goal.category.replace(/_/g, ' ')}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="goals-feed__actions" />
                </div>
              </li>
            ))}
          </ul>
        </Section>
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
