import { useState, useEffect, ComponentType, ReactElement } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Plus, Check, X, Trash2, ArrowRight,
  Target, Shield, Home as HomeIcon, Plane, Car, Heart,
  GraduationCap, Hammer, Sparkles, Palmtree, CreditCard, Wallet, Wrench,
} from 'lucide-react';
import { api } from '../lib/api';
import { PageActions } from '../components/common/page-actions';
import {
  Page,
  Section,
  Card,
  Button,
  Eyebrow,
  EmptyState,
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

// Lucide icon registry — neutral monochrome glyphs replace emoji per iter 2
// critic. Stored as a stable string key so we can persist the choice (still
// `goal.icon: string`) but render a real SVG via `iconFor()`.
type IconKey =
  | 'shield' | 'home' | 'plane' | 'car' | 'heart' | 'graduationCap'
  | 'wrench' | 'sparkles' | 'palmtree' | 'creditCard' | 'wallet'
  | 'target' | 'hammer';

const ICON_REGISTRY: Record<IconKey, ComponentType<{ size?: number; className?: string }>> = {
  shield: Shield, home: HomeIcon, plane: Plane, car: Car, heart: Heart,
  graduationCap: GraduationCap, wrench: Wrench, sparkles: Sparkles,
  palmtree: Palmtree, creditCard: CreditCard, wallet: Wallet,
  target: Target, hammer: Hammer,
};

function iconFor(key: string | null | undefined, size = 20): ReactElement {
  const Cmp = (key && ICON_REGISTRY[key as IconKey]) || Target;
  return <Cmp size={size} />;
}

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
  const [newIcon, setNewIcon] = useState<string>('target');
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
      setNewIcon('target');
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
          font-family: 'Geist', system-ui, sans-serif;
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
        /* Destructive trash icon hides until row hover (desktop). Touch
           devices keep it semi-visible so users can find it. */
        .goals-feed__iconbtn--destructive {
          opacity: 0;
          transition: opacity 0.12s, background 0.12s, color 0.12s;
        }
        .goals-feed li:hover .goals-feed__iconbtn--destructive,
        .goals-feed__iconbtn--destructive:focus-visible {
          opacity: 1;
        }
        .goals-feed__iconbtn--destructive:hover { color: var(--lf-sauce-deep); }
        @media (hover: none) and (pointer: coarse) {
          .goals-feed__iconbtn--destructive { opacity: 0.55; }
        }
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

        /* ── Iter 7 B: "Saving this month" strip ──
           Three KPI cards, same neutral surface as .ds-card but flattened
           into a 3-up grid. Drops to single column under 640px. */
        .goals-strip-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin: 0 0 36px;
        }
        .goals-strip-card {
          background: var(--lf-surface);
          border: 1px solid var(--lf-rule-neutral);
          border-radius: 10px;
          padding: 16px 18px;
          box-shadow: var(--shadow-card);
          display: flex; flex-direction: column; gap: 6px;
        }
        .goals-strip-card__eyebrow {
          /* sentence-case lowercase per iter 7 F */
          text-transform: lowercase;
          letter-spacing: 0.10em;
        }
        .goals-strip-card__value {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 600;
          font-size: 22px;
          line-height: 1.05;
          letter-spacing: -0.01em;
          color: var(--lf-ink);
          font-variant-numeric: tabular-nums;
        }
        .goals-strip-card__caption {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px;
          color: var(--lf-muted);
        }
        @media (max-width: 640px) {
          .goals-strip-grid {
            grid-template-columns: 1fr;
            gap: 10px;
            margin-bottom: 20px;
          }
          .goals-strip-card { padding: 12px 14px; }
          .goals-strip-card__value { font-size: 18px; }
        }

        /* ── Iter 7 B: Suggested goals gallery ── */
        .goals-suggested-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 900px) {
          .goals-suggested-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 520px) {
          .goals-suggested-grid { grid-template-columns: 1fr; }
        }
        .goals-suggested-card {
          background: var(--lf-surface);
          border: 1px solid var(--lf-rule-neutral);
          border-radius: 10px;
          padding: 14px 16px;
          display: flex; gap: 12px; align-items: center;
          text-align: left;
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.12s, box-shadow 0.12s, background 0.12s;
          box-shadow: var(--shadow-card);
        }
        .goals-suggested-card:hover {
          border-color: var(--lf-rule);
          background: var(--lf-paper);
        }
        .goals-suggested-card__icon {
          width: 36px; height: 36px;
          border-radius: 8px;
          display: grid; place-items: center;
          flex-shrink: 0;
        }
        .goals-suggested-card__body { flex: 1; min-width: 0; }
        .goals-suggested-card__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 500;
          font-size: 14px;
          line-height: 1.2;
          color: var(--lf-ink);
          display: block;
          margin-bottom: 2px;
        }
        .goals-suggested-card__sub {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--lf-muted);
        }
        .goals-suggested-card__arrow {
          color: var(--lf-muted);
          flex-shrink: 0;
          transition: transform 0.12s, color 0.12s;
        }
        .goals-suggested-card:hover .goals-suggested-card__arrow {
          color: var(--lf-sauce);
          transform: translateX(2px);
        }

        /* ── Iter 7 B: Completed-goals archive (ghost styling) ── */
        .goals-archive {
          list-style: none; margin: 0; padding: 0;
        }
        .goals-archive li {
          padding: 14px 0;
          border-top: 1px solid var(--lf-rule-soft);
          display: flex; align-items: center; gap: 12px;
        }
        .goals-archive__icon {
          width: 32px; height: 32px;
          border-radius: 6px;
          display: grid; place-items: center;
          background: rgba(90, 107, 63, 0.10);
          color: var(--lf-basil);
          flex-shrink: 0;
        }
        .goals-archive__body { flex: 1; min-width: 0; }
        .goals-archive__name {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px; font-weight: 500;
          color: var(--lf-muted);
          text-decoration: line-through;
          display: block;
        }
        .goals-archive__meta {
          font-family: 'JetBrains Mono', monospace;
          font-size: 11px;
          color: var(--lf-muted);
        }
        .goals-archive__value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          color: var(--lf-muted);
          font-variant-numeric: tabular-nums;
        }
      `}</style>

      {/* Iter 8 P1: title is the page name only. Live monetary data lives in
          the subtitle slot — inline on desktop, dropped to a sub-row on
          mobile where the H1 would otherwise truncate mid-dollar-amount. */}
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Goals</h1>
          {!loading && activeGoals.length > 0 && (
            <span className="ds-page-bar__subtitle">
              {formatCurrency(totalSaved)} of {formatCurrency(totalTarget)} · {activeGoals.length} active
              {completedGoals.length > 0 && (
                <> · <span className="ds-pos">{completedGoals.length} complete</span></>
              )}
            </span>
          )}
        </div>
        {newGoalBtn}
      </header>
      {!loading && activeGoals.length > 0 && (
        <div className="ds-page-bar__subtitle-mobile">
          {formatCurrency(totalSaved)} of {formatCurrency(totalTarget)} · {activeGoals.length} active
          {completedGoals.length > 0 && (
            <> · <span className="ds-pos">{completedGoals.length} complete</span></>
          )}
        </div>
      )}

      {/* Iter 7 B: "Saving this month" KPI strip. Built from the active-goal
          aggregates we already have — total saved against total target, with
          a coarse "added this month" derived from delta-against-target as a
          proxy until we wire per-goal monthly contribution history. */}
      {!loading && activeGoals.length > 0 && (
        <section className="goals-strip-grid" aria-label="Saving this month">
          <div className="goals-strip-card">
            <span className="ds-eyebrow goals-strip-card__eyebrow">saved so far</span>
            <span className="goals-strip-card__value ds-num">{formatCurrency(totalSaved)}</span>
            <span className="goals-strip-card__caption">
              {totalTarget > 0
                ? `${Math.round((totalSaved / totalTarget) * 100)}% of total target`
                : 'across all active goals'}
            </span>
          </div>
          <div className="goals-strip-card">
            <span className="ds-eyebrow goals-strip-card__eyebrow">still to go</span>
            <span className="goals-strip-card__value ds-num">
              {formatCurrency(Math.max(0, totalTarget - totalSaved))}
            </span>
            <span className="goals-strip-card__caption">
              across {activeGoals.length} active goal{activeGoals.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="goals-strip-card">
            <span className="ds-eyebrow goals-strip-card__eyebrow">avg / goal</span>
            <span className="goals-strip-card__value ds-num">
              {formatCurrency(activeGoals.length > 0 ? totalSaved / activeGoals.length : 0)}
            </span>
            <span className="goals-strip-card__caption">
              {completedGoals.length} reached lifetime
            </span>
          </div>
        </section>
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
                    {/* Icon preview — chosen via the category chip below. */}
                    <div
                      aria-label="Icon"
                      style={{
                        ...inputStyle,
                        width: 56, flexShrink: 0,
                        display: 'grid', placeItems: 'center',
                        color: 'var(--lf-ink-soft)',
                      }}
                    >
                      {iconFor(newIcon, 20)}
                    </div>
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
              icon={<Target size={32} />}
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
                        style={{ background: color + '18', border: `1px solid ${color}30`, color }}
                      >
                        {iconFor(goal.icon, 22)}
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
                          {/* Iter 5: at 0% the fill width is 0, leaving only
                              the cream track visible — which on some category
                              colors was indistinguishable from the track. We
                              render a tiny basil tick at the start whenever
                              progress is 0 so the rail reads as "alive but
                              empty" rather than "rail not even rendered". */}
                          {pct > 0 ? (
                            <div style={{ width: `${pct}%`, background: 'var(--lf-data-2)' }} />
                          ) : (
                            <div style={{ width: 4, background: 'var(--lf-data-2)' }} />
                          )}
                        </div>

                        <div className="goals-feed__meta">
                          {/* Iter 6: pct number reads as a STATUS, not a
                              category badge. Use basil at 100%, neutral
                              ink-soft otherwise so the "0%" eyebrow stops
                              rendering as sauce (which was a sauce-purge
                              violation on home_purchase goals). */}
                          <span style={{ color: pct >= 100 ? 'var(--lf-basil)' : 'var(--lf-ink-soft)' }}>
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
                        {/* Destructive action: hover-reveal (and always-visible on touch).
                            Keeps the destructive control off the resting nav rail next
                            to the open-chevron — iter 2 critic flagged it as too easy
                            to mis-tap. Confirm dialog already wraps the action. */}
                        {import.meta.env.VITE_DEMO_MODE !== 'true' && (
                          <button onClick={() => handleDelete(goal.id)} title="Delete" className="goals-feed__iconbtn goals-feed__iconbtn--destructive">
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

      {/* Iter 7 B: Completed-goals archive — compact ghost rows.
          When the user has none, show a single example "empty" row so the
          section reads as "this exists, you just haven't filled it" instead
          of being skipped entirely. */}
      {!loading && (
        <Section
          title="Completed"
          eyebrow={completedGoals.length > 0 ? `${completedGoals.length} reached` : 'archive'}
        >
          {completedGoals.length > 0 ? (
            <ul className="goals-archive">
              {completedGoals.map((goal) => (
                <li key={goal.id}>
                  <div className="goals-archive__icon">{iconFor(goal.icon, 16)}</div>
                  <div className="goals-archive__body">
                    <span className="goals-archive__name">{goal.name}</span>
                    <span className="goals-archive__meta">
                      reached
                      {goal.category && <> · {goal.category.replace(/_/g, ' ')}</>}
                    </span>
                  </div>
                  <span className="goals-archive__value">
                    {formatCurrency(parseFloat(goal.targetAmount))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="goals-archive">
              <li style={{ opacity: 0.6 }}>
                <div className="goals-archive__icon" style={{ background: 'var(--lf-cream)', color: 'var(--lf-muted)' }}>
                  <Target size={16} />
                </div>
                <div className="goals-archive__body">
                  <span className="goals-archive__name" style={{ textDecoration: 'none' }}>
                    No completed goals yet
                  </span>
                  <span className="goals-archive__meta">
                    finished goals will land here as a record
                  </span>
                </div>
              </li>
            </ul>
          )}
        </Section>
      )}

      {/* Iter 7 B: Suggested-goals template gallery. 6 cards keyed off the
          existing GOAL_PRESETS so we don't duplicate that list. Clicking a
          card pre-fills the New-goal form so the user can review/edit
          before committing — same flow as selectPreset() in the form. */}
      {!loading && import.meta.env.VITE_DEMO_MODE !== 'true' && (
        <Section title="Suggested" eyebrow="popular templates">
          <div className="goals-suggested-grid">
            {GOAL_PRESETS.slice(0, 6).map((preset) => {
              const color = goalColor(preset.category);
              return (
                <button
                  key={preset.category}
                  type="button"
                  className="goals-suggested-card"
                  onClick={() => {
                    selectPreset(preset);
                    setShowCreate(true);
                  }}
                  aria-label={`Add ${preset.name} goal · suggested target ${formatCurrency(preset.suggestedTarget)}`}
                >
                  <span
                    className="goals-suggested-card__icon"
                    style={{ background: color + '18', color }}
                  >
                    {iconFor(preset.icon, 18)}
                  </span>
                  <span className="goals-suggested-card__body">
                    <span className="goals-suggested-card__title">{preset.name}</span>
                    <span className="goals-suggested-card__sub">
                      suggested {formatCurrency(preset.suggestedTarget)}
                    </span>
                  </span>
                  <ArrowRight size={14} className="goals-suggested-card__arrow" />
                </button>
              );
            })}
          </div>
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
