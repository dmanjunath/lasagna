import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Target, Trash2, Check, X, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { PageActions } from '../components/common/page-actions';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const GOAL_PRESETS = [
  { name: 'Emergency Fund', category: 'emergency_fund', icon: '🛡️', suggestedTarget: 25000 },
  { name: 'House Down Payment', category: 'house', icon: '🏠', suggestedTarget: 80000 },
  { name: 'Vacation Fund', category: 'vacation', icon: '✈️', suggestedTarget: 5000 },
  { name: 'New Car', category: 'car', icon: '🚗', suggestedTarget: 30000 },
  { name: 'Education Fund', category: 'education', icon: '🎓', suggestedTarget: 50000 },
  { name: 'Retirement', category: 'retirement', icon: '🌴', suggestedTarget: 1000000 },
  { name: 'Debt Payoff', category: 'debt_payoff', icon: '💳', suggestedTarget: 20000 },
  { name: 'Wedding Fund', category: 'wedding', icon: '💍', suggestedTarget: 30000 },
];

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

  const activeGoals = goals.filter(g => g.status === 'active');
  const completedGoals = goals.filter(g => g.status === 'completed');

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-4 md:p-6 lg:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl md:text-3xl font-medium tracking-tight">Financial Goals</h2>
            <p className="text-sm text-text-secondary mt-1">Track progress toward what matters most</p>
          </div>
          {import.meta.env.VITE_DEMO_MODE !== "true" && (
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-accent text-bg font-semibold text-sm rounded-xl hover:bg-accent/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Goal
            </button>
          )}
        </div>
      </motion.div>

      <PageActions types="savings" />

      {loading ? (
        <div className="flex items-center gap-2 text-text-secondary py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading goals...</span>
        </div>
      ) : (
        <>
          {/* Create Goal Modal */}
          <AnimatePresence>
            {showCreate && import.meta.env.VITE_DEMO_MODE !== "true" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6 overflow-hidden"
              >
                <div className="bg-bg-elevated border border-border rounded-xl p-5">
                  <h3 className="text-lg font-semibold mb-4">Create a Goal</h3>

                  {/* Quick presets */}
                  <div className="mb-4">
                    <p className="text-xs text-text-secondary mb-2 uppercase tracking-wider font-semibold">Quick Start</p>
                    <div className="flex flex-wrap gap-2">
                      {GOAL_PRESETS.map((preset) => (
                        <button
                          key={preset.category}
                          onClick={() => selectPreset(preset)}
                          className={cn(
                            'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                            newCategory === preset.category
                              ? 'border-accent/40 bg-accent/10 text-accent'
                              : 'border-border text-text-secondary hover:border-accent/20'
                          )}
                        >
                          {preset.icon} {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">Goal Name</label>
                      <input
                        type="text"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="e.g. Emergency Fund"
                        className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">Target Amount</label>
                      <input
                        type="number"
                        value={newTarget}
                        onChange={e => setNewTarget(e.target.value)}
                        placeholder="25000"
                        className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">Target Date (optional)</label>
                      <input
                        type="date"
                        value={newDeadline}
                        onChange={e => setNewDeadline(e.target.value)}
                        className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-text-secondary mb-1 block">Icon</label>
                      <input
                        type="text"
                        value={newIcon}
                        onChange={e => setNewIcon(e.target.value)}
                        className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm focus:outline-none focus:border-accent"
                        maxLength={4}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleCreate}
                      disabled={!newName || !newTarget || creating}
                      className="px-4 py-2 bg-accent text-bg font-semibold text-sm rounded-lg hover:bg-accent/90 transition-colors disabled:opacity-50"
                    >
                      {creating ? 'Creating...' : 'Create Goal'}
                    </button>
                    <button
                      onClick={() => setShowCreate(false)}
                      className="px-4 py-2 text-text-secondary text-sm rounded-lg hover:bg-bg-surface transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Active Goals */}
          {activeGoals.length === 0 && !showCreate ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-16"
            >
              <Target className="w-12 h-12 text-text-secondary mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No goals yet</h3>
              <p className="text-text-secondary text-sm mb-4 max-w-md mx-auto">
                Setting financial goals is the first step toward achieving them.
                Create a goal to start tracking your progress.
              </p>
              {import.meta.env.VITE_DEMO_MODE !== "true" && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-accent text-bg font-semibold text-sm rounded-xl hover:bg-accent/90 transition-colors"
                >
                  <Plus className="w-4 h-4" /> Create Your First Goal
                </button>
              )}
            </motion.div>
          ) : (
            <div className="space-y-4">
              {activeGoals.map((goal, i) => {
                const target = parseFloat(goal.targetAmount);
                const current = parseFloat(goal.currentAmount);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                const remaining = Math.max(0, target - current);

                let daysLeft: number | null = null;
                if (goal.deadline) {
                  daysLeft = Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                }

                return (
                  <motion.div
                    key={goal.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.3 }}
                    className="bg-bg-elevated border border-border rounded-xl p-5"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{goal.icon || '🎯'}</span>
                        <div>
                          <h3 className="font-semibold">{goal.name}</h3>
                          <p className="text-xs text-text-secondary">
                            {remaining > 0 ? `${formatCurrency(remaining)} to go` : 'Goal reached!'}
                            {daysLeft !== null && daysLeft > 0 && ` · ${daysLeft} days left`}
                            {daysLeft !== null && daysLeft <= 0 && ' · Past deadline'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {import.meta.env.VITE_DEMO_MODE !== "true" && pct >= 100 ? (
                          <button onClick={() => handleComplete(goal.id)} className="p-1.5 rounded-lg hover:bg-success/10 text-success transition-colors" title="Mark complete">
                            <Check className="w-4 h-4" />
                          </button>
                        ) : null}
                        {import.meta.env.VITE_DEMO_MODE !== "true" && (
                          <button onClick={() => handleDelete(goal.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-text-secondary hover:text-danger transition-colors" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-2">
                      <div className="h-3 bg-border rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{
                            backgroundColor: pct >= 100 ? '#22c55e' : pct >= 75 ? '#84cc16' : pct >= 50 ? '#f59e0b' : '#6366f1',
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {import.meta.env.VITE_DEMO_MODE !== "true" && editingId === goal.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={editAmount}
                              onChange={e => setEditAmount(e.target.value)}
                              placeholder={String(current)}
                              className="w-28 px-2 py-1 bg-bg-surface border border-border rounded text-sm focus:outline-none focus:border-accent"
                              autoFocus
                              onKeyDown={e => e.key === 'Enter' && handleUpdateAmount(goal.id)}
                            />
                            <button onClick={() => handleUpdateAmount(goal.id)} className="p-1 rounded hover:bg-accent/10 text-accent">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => { setEditingId(null); setEditAmount(''); }} className="p-1 rounded hover:bg-danger/10 text-text-secondary">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : import.meta.env.VITE_DEMO_MODE !== "true" ? (
                          <button
                            onClick={() => { setEditingId(goal.id); setEditAmount(String(current)); }}
                            className="text-sm font-semibold tabular-nums hover:text-accent transition-colors"
                          >
                            {formatCurrency(current)}
                          </button>
                        ) : (
                          <span className="text-sm font-semibold tabular-nums">
                            {formatCurrency(current)}
                          </span>
                        )}
                        <span className="text-xs text-text-secondary">of {formatCurrency(target)}</span>
                      </div>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: pct >= 100 ? '#22c55e' : undefined }}>
                        {Math.round(pct)}%
                      </span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Completed Goals */}
          {completedGoals.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm uppercase tracking-wider text-text-secondary font-semibold mb-4">Completed</h3>
              <div className="space-y-2">
                {completedGoals.map((goal) => (
                  <div key={goal.id} className="bg-bg-elevated border border-border rounded-xl p-4 opacity-60 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{goal.icon || '🎯'}</span>
                      <div>
                        <span className="font-medium text-sm line-through">{goal.name}</span>
                        <span className="text-xs text-text-secondary ml-2">{formatCurrency(parseFloat(goal.targetAmount))}</span>
                      </div>
                    </div>
                    <Check className="w-4 h-4 text-success" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
