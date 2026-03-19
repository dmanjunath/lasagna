import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check, X, Loader2, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { PageActions } from '../components/common/page-actions';

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
// Quick-add template presets
// ---------------------------------------------------------------------------

const QUICK_TEMPLATES = [
  { label: 'Home down payment', category: 'home_purchase', icon: '🏠', suggestedTarget: 80000 },
  { label: 'Emergency fund', category: 'emergency_fund', icon: '🛡️', suggestedTarget: 25000 },
  { label: 'Vacation / travel', category: 'vacation', icon: '✈️', suggestedTarget: 5000 },
  { label: 'Vehicle purchase', category: 'car', icon: '🚗', suggestedTarget: 30000 },
  { label: 'Wedding', category: 'wedding', icon: '💍', suggestedTarget: 30000 },
  { label: 'Education / 529', category: 'education', icon: '🎓', suggestedTarget: 50000 },
  { label: 'Home repair', category: 'home_repair', icon: '🔧', suggestedTarget: 15000 },
  { label: 'Major purchase', category: 'major_purchase', icon: '🛍️', suggestedTarget: 10000 },
  { label: 'Life event', category: 'life_event', icon: '🎉', suggestedTarget: 10000 },
  { label: 'Retirement', category: 'retirement', icon: '🌴', suggestedTarget: 1000000 },
  { label: 'General savings', category: 'savings', icon: '💰', suggestedTarget: 10000 },
];

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
// Shared style tokens
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: 'var(--lf-paper)',
  border: '1px solid var(--lf-rule)',
  borderRadius: 14,
};

const eyebrow: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--lf-muted)',
};

const serif: React.CSSProperties = {
  fontFamily: "'Instrument Serif', Georgia, serif",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Goals() {
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
    if (!confirm('Delete this goal?')) return;
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

  const selectTemplate = (t: typeof QUICK_TEMPLATES[0]) => {
    setNewName(t.label);
    setNewTarget(String(t.suggestedTarget));
    setNewIcon(t.icon);
    setNewCategory(t.category);
    setShowCreate(true);
  };

  const activeGoals = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'completed');

  const totalTarget = activeGoals.reduce((s, g) => s + parseFloat(g.targetAmount), 0);
  const totalSaved = activeGoals.reduce((s, g) => s + parseFloat(g.currentAmount), 0);
  const overallPct = totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0;

  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'clamp(16px, 4vw, 40px)',
        paddingBottom: 'clamp(80px, 12vw, 48px)',
        background: 'var(--lf-paper)',
        minHeight: '100%',
        maxWidth: 1100,
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Page header ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}
      >
        <div>
          <h1 style={{ ...serif, fontSize: 36, lineHeight: 1.1, color: 'var(--lf-ink)', margin: 0, fontWeight: 400 }}>
            Goals
          </h1>
          {!loading && (
            <div style={{ ...eyebrow, marginTop: 6 }}>
              {activeGoals.length} active · {completedGoals.length} complete
            </div>
          )}
        </div>
        {import.meta.env.VITE_DEMO_MODE !== 'true' && (
          <button
            onClick={() => setShowCreate(v => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', background: 'var(--lf-ink)', color: 'var(--lf-paper)',
              border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.04em', whiteSpace: 'nowrap',
            }}
          >
            <Plus size={14} />
            + New goal
          </button>
        )}
      </motion.div>

      {/* ── Hero ── */}
      {!loading && activeGoals.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          style={{
            background: 'var(--lf-ink)', color: 'var(--lf-paper)',
            borderRadius: 14, padding: 'clamp(20px, 4vw, 32px)', marginBottom: 20,
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 24,
          }}
        >
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-cheese)', marginBottom: 6 }}>Saved so far</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 48, lineHeight: 1, letterSpacing: '-0.02em' }}>{formatCurrency(totalSaved)}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 8 }}>of {formatCurrency(totalTarget)} target</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-cheese)', marginBottom: 6 }}>Overall progress</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 48, lineHeight: 1, letterSpacing: '-0.02em' }}>{overallPct}%</div>
            <div style={{ marginTop: 12, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2 }}>
              <div style={{ width: `${overallPct}%`, height: '100%', background: 'var(--lf-cheese)', borderRadius: 2, transition: 'width 0.5s' }} />
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: 'var(--lf-cheese)', marginBottom: 6 }}>Active goals</div>
            <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 48, lineHeight: 1, letterSpacing: '-0.02em' }}>{activeGoals.length}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: '#D4C6B0', marginTop: 8 }}>{completedGoals.length} completed</div>
          </div>
        </motion.div>
      )}

      <PageActions types="savings" />

      {/* ── Loading state ── */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '48px 0', color: 'var(--lf-muted)' }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 14 }}>Loading goals…</span>
        </div>
      ) : (
        <>
          {/* ── Create goal panel ── */}
          <AnimatePresence>
            {showCreate && import.meta.env.VITE_DEMO_MODE !== 'true' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ marginBottom: 32, overflow: 'hidden' }}
              >
                <div style={{ ...card, padding: 24 }}>
                  <div style={{ ...eyebrow, marginBottom: 16 }}>New goal</div>

                  {/* Quick presets */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ ...eyebrow, marginBottom: 10, fontSize: 13 }}>Quick start</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {GOAL_PRESETS.map((preset) => (
                        <button
                          key={preset.category}
                          onClick={() => selectPreset(preset)}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 20,
                            border: `1px solid ${newCategory === preset.category ? goalColor(preset.category) : 'var(--lf-rule)'}`,
                            background: newCategory === preset.category ? goalColor(preset.category) + '18' : 'transparent',
                            color: newCategory === preset.category ? goalColor(preset.category) : 'var(--lf-muted)',
                            fontSize: 13,
                            cursor: 'pointer',
                            fontWeight: 500,
                            transition: 'all 0.15s',
                          }}
                        >
                          {preset.icon} {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Form fields */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: 16,
                      marginBottom: 20,
                    }}
                  >
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ ...eyebrow, fontSize: 13 }}>Goal name</span>
                      <input
                        type="text"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="e.g. Emergency Fund"
                        style={inputStyle}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ ...eyebrow, fontSize: 13 }}>Target amount</span>
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
                          style={{ ...inputStyle, paddingLeft: 24 }}
                        />
                      </div>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ ...eyebrow, fontSize: 13 }}>Target date (optional)</span>
                      <input
                        type="date"
                        value={newDeadline}
                        onChange={e => setNewDeadline(e.target.value)}
                        style={inputStyle}
                      />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ ...eyebrow, fontSize: 13 }}>Icon</span>
                      <input
                        type="text"
                        value={newIcon}
                        onChange={e => setNewIcon(e.target.value)}
                        maxLength={4}
                        style={inputStyle}
                      />
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={handleCreate}
                      disabled={!newName || !newTarget || creating}
                      style={{
                        padding: '9px 20px',
                        background: 'var(--lf-ink)',
                        color: 'var(--lf-paper)',
                        border: 'none',
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: !newName || !newTarget || creating ? 'not-allowed' : 'pointer',
                        opacity: !newName || !newTarget || creating ? 0.5 : 1,
                      }}
                    >
                      {creating ? 'Creating…' : 'Create goal'}
                    </button>
                    <button
                      onClick={() => setShowCreate(false)}
                      style={{
                        padding: '9px 20px',
                        background: 'transparent',
                        color: 'var(--lf-muted)',
                        border: '1px solid var(--lf-rule)',
                        borderRadius: 8,
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Empty state ── */}
          {activeGoals.length === 0 && !showCreate ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                ...card,
                padding: '64px 32px',
                textAlign: 'center',
                marginBottom: 32,
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 16 }}>🎯</div>
              <div style={{ ...serif, fontSize: 22, color: 'var(--lf-ink)', marginBottom: 8 }}>
                No goals yet
              </div>
              <p style={{ fontSize: 14, color: 'var(--lf-muted)', maxWidth: 340, margin: '0 auto 24px' }}>
                Setting financial goals is the first step toward achieving them. Create a goal to start tracking your progress.
              </p>
              {import.meta.env.VITE_DEMO_MODE !== 'true' && (
                <button
                  onClick={() => setShowCreate(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 22px',
                    background: 'var(--lf-ink)',
                    color: 'var(--lf-paper)',
                    border: 'none',
                    borderRadius: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={14} />
                  Create your first goal
                </button>
              )}
            </motion.div>
          ) : (
            /* ── Active goals grid ── */
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
                marginBottom: 40,
              }}
            >
              {activeGoals.map((goal, i) => {
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
                  deadlineLabel = daysLeft > 0
                    ? `${daysLeft}d left`
                    : 'Past deadline';
                }

                return (
                  <motion.div
                    key={goal.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.35 }}
                    style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}
                  >
                    {/* Icon + name row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          background: color + '18',
                          border: `1.5px solid ${color}30`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 22,
                          flexShrink: 0,
                        }}
                      >
                        {goal.icon || '🎯'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...eyebrow, marginBottom: 3 }}>
                          {goal.category.replace(/_/g, ' ')}
                          {deadlineLabel && ` · ${deadlineLabel}`}
                        </div>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: 'var(--lf-ink)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {goal.name}
                        </div>
                      </div>
                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                        {import.meta.env.VITE_DEMO_MODE !== 'true' && pct >= 100 && (
                          <button
                            onClick={() => handleComplete(goal.id)}
                            title="Mark complete"
                            style={iconBtn}
                          >
                            <Check size={14} />
                          </button>
                        )}
                        {import.meta.env.VITE_DEMO_MODE !== 'true' && (
                          <button
                            onClick={() => handleDelete(goal.id)}
                            title="Delete"
                            style={{ ...iconBtn, color: 'var(--lf-muted)' }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Current amount (serif, clickable to edit) */}
                    {import.meta.env.VITE_DEMO_MODE !== 'true' && editingId === goal.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="number"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          placeholder={String(current)}
                          autoFocus
                          onKeyDown={e => e.key === 'Enter' && handleUpdateAmount(goal.id)}
                          style={{ ...inputStyle, width: 110, padding: '5px 10px', fontSize: 13 }}
                        />
                        <button
                          onClick={() => handleUpdateAmount(goal.id)}
                          style={{ ...iconBtn, color: 'var(--lf-basil)' }}
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditAmount(''); }}
                          style={iconBtn}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={
                          import.meta.env.VITE_DEMO_MODE !== 'true'
                            ? () => { setEditingId(goal.id); setEditAmount(String(current)); }
                            : undefined
                        }
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: import.meta.env.VITE_DEMO_MODE !== 'true' ? 'text' : 'default',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ ...serif, fontSize: 26, color: 'var(--lf-ink)', lineHeight: 1 }}>
                          {formatCurrency(current)}
                        </div>
                        <div style={{ ...eyebrow, fontSize: 13, marginTop: 3 }}>
                          of {formatCurrency(target)}
                        </div>
                      </button>
                    )}

                    {/* Progress bar */}
                    <div>
                      <div
                        style={{
                          height: 6,
                          background: 'var(--lf-cream-deep)',
                          borderRadius: 99,
                          overflow: 'hidden',
                        }}
                      >
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          style={{
                            height: '100%',
                            borderRadius: 99,
                            background: color,
                          }}
                        />
                      </div>
                    </div>

                    {/* Footer: pct + remaining */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          ...eyebrow,
                          fontSize: 13,
                          color: pct >= 100 ? 'var(--lf-basil)' : color,
                        }}
                      >
                        {Math.round(pct)}%
                      </span>
                      <span style={{ ...eyebrow, fontSize: 13 }}>
                        {remaining > 0
                          ? `${formatCurrency(remaining)} to go`
                          : 'Goal reached!'}
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* ── Completed goals ── */}
          {completedGoals.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              style={{ marginBottom: 32 }}
            >
              <div style={{ ...eyebrow, marginBottom: 14 }}>Completed</div>
              <div style={{ ...card, overflow: 'hidden' }}>
                {completedGoals.map((goal, i) => (
                  <div
                    key={goal.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 20px',
                      borderBottom: i < completedGoals.length - 1 ? '1px solid var(--lf-rule)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 7,
                          background: 'var(--lf-basil)18',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                        }}
                      >
                        {goal.icon || '🎯'}
                      </div>
                      <div>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: 'var(--lf-ink)',
                            textDecoration: 'line-through',
                          }}
                        >
                          {goal.name}
                        </span>
                        <span style={{ ...eyebrow, fontSize: 13, marginLeft: 8 }}>
                          {formatCurrency(parseFloat(goal.targetAmount))}
                        </span>
                      </div>
                    </div>
                    <Check size={16} style={{ color: 'var(--lf-basil)', flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Quick-add templates ── */}
          {import.meta.env.VITE_DEMO_MODE !== 'true' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
            >
              <div style={{ ...eyebrow, marginBottom: 14 }}>Quick-add templates</div>
              <div style={{ ...card, padding: '18px 20px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {QUICK_TEMPLATES.map(t => (
                    <button
                      key={t.label}
                      onClick={() => selectTemplate(t)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '7px 14px',
                        borderRadius: 20,
                        border: '1px solid var(--lf-rule)',
                        background: 'var(--lf-cream)',
                        color: 'var(--lf-ink)',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: 'pointer',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = goalColor(t.category);
                        (e.currentTarget as HTMLButtonElement).style.background = goalColor(t.category) + '12';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--lf-rule)';
                        (e.currentTarget as HTMLButtonElement).style.background = 'var(--lf-cream)';
                      }}
                    >
                      <span>{t.icon}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local style helpers
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'var(--lf-cream)',
  border: '1px solid var(--lf-rule)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--lf-ink)',
  outline: 'none',
  boxSizing: 'border-box',
};

const iconBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 7,
  border: 'none',
  background: 'transparent',
  color: 'var(--lf-muted)',
  cursor: 'pointer',
  transition: 'background 0.15s',
};
