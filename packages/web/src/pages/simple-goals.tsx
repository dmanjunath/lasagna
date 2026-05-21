import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { SimpleShell } from '../components/layout/simple-shell';

interface Goal {
  id: string;
  name: string;
  description: string | null;
  targetAmount: string;
  currentAmount: string;
  deadline: string | null;
  category: string;
  status: string;
  icon: string | null;
  linkedAccountId: string | null;
  completedAt: string | null;
}

const fmtUsd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const fmtTarget = (d: string | null) => {
  if (!d) return null;
  return new Date(d).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

const fmtCompleted = (d: string | null) => {
  if (!d) return null;
  return new Date(d).toLocaleString('en-US', { month: 'short', year: 'numeric' });
};

export function SimpleGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    api
      .getGoals()
      .then((d) => setGoals(d.goals))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  const active = goals.filter((g) => g.status === 'active');
  const completed = goals.filter((g) => g.status === 'completed');

  return (
    <SimpleShell title="Goals" activeTab="goals">
      {/* Add goal CTA */}
      <button
        onClick={() => setShowAdd(true)}
        className="w-full rounded-2xl bg-text text-white py-3.5 text-sm font-medium mb-6 min-h-[44px]"
      >
        + Add a goal
      </button>

      {/* Active goals */}
      {loading ? (
        <div className="rounded-2xl bg-bg-elevated border border-rule p-5 mb-3 animate-pulse h-32" />
      ) : active.length === 0 && completed.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {active.length > 0 && (
            <>
              <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mb-3">
                In progress
              </h3>
              <div className="space-y-3 mb-6">
                {active.map((g) => (
                  <GoalCard key={g.id} goal={g} onChange={refresh} />
                ))}
              </div>
            </>
          )}
          {completed.length > 0 && (
            <>
              <h3 className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium mb-3">
                Finished 🎉
              </h3>
              <div className="space-y-3">
                {completed.map((g) => (
                  <article
                    key={g.id}
                    className="rounded-2xl bg-bg-elevated border border-rule p-4 shadow-sm opacity-75"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-xl">{g.icon || '✓'}</div>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{g.name}</div>
                        <div className="text-xs text-text-muted">
                          Finished {fmtCompleted(g.completedAt) || '—'}
                        </div>
                      </div>
                      <div className="text-success text-lg">✓</div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {showAdd && <AddGoalSheet onClose={() => setShowAdd(false)} onCreated={refresh} />}
    </SimpleShell>
  );
}

function GoalCard({ goal, onChange }: { goal: Goal; onChange: () => void }) {
  const current = parseFloat(goal.currentAmount);
  const target = parseFloat(goal.targetAmount);
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const hit = current >= target && target > 0;

  async function markDone() {
    await api.updateGoal(goal.id, { status: 'completed' });
    onChange();
  }

  async function deleteGoal() {
    if (!confirm(`Delete "${goal.name}"? This can't be undone.`)) return;
    await api.deleteGoal(goal.id);
    onChange();
  }

  return (
    <article
      className={`rounded-2xl border p-5 shadow-sm ${
        hit ? 'bg-success/10 border-success/40' : 'bg-bg-elevated border-rule'
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="text-2xl">{goal.icon || '🎯'}</div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-serif font-medium leading-tight">{goal.name}</div>
          {goal.description && (
            <div className="text-xs text-text-muted mt-1">{goal.description}</div>
          )}
        </div>
        <div className="text-sm font-medium tabular-nums shrink-0">{progress}%</div>
      </div>
      <div className="h-2 rounded-full bg-bg overflow-hidden mb-2">
        <div className={`h-full ${hit ? 'bg-success' : 'bg-text'}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="flex items-center justify-between text-xs text-text-muted tabular-nums">
        <span>
          {fmtUsd(current)} of {fmtUsd(target)}
        </span>
        <span>{goal.deadline ? `Target: ${fmtTarget(goal.deadline)}` : goal.linkedAccountId ? 'Linked to account' : ''}</span>
      </div>

      {hit ? (
        <button
          onClick={markDone}
          className="w-full mt-4 rounded-xl bg-success text-white py-3 text-sm font-medium"
        >
          🎉 You hit your target — mark done
        </button>
      ) : (
        <details className="mt-3">
          <summary className="text-xs text-text-muted underline cursor-pointer select-none py-1.5 -my-1.5">
            Update progress
          </summary>
          <UpdateProgress goal={goal} onChange={onChange} />
        </details>
      )}

      <div className="mt-3 pt-3 border-t border-rule/60 flex items-center justify-end">
        <button
          onClick={deleteGoal}
          className="text-xs text-text-muted hover:text-accent underline py-2 -my-2"
        >
          Delete goal
        </button>
      </div>
    </article>
  );
}

function UpdateProgress({ goal, onChange }: { goal: Goal; onChange: () => void }) {
  const [amount, setAmount] = useState(goal.currentAmount);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateGoal(goal.id, { currentAmount: parseFloat(amount) });
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function markDone() {
    setSaving(true);
    try {
      await api.updateGoal(goal.id, { status: 'completed' });
      onChange();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">Saved so far</span>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="flex-1 text-sm rounded-lg bg-bg border border-rule px-3 py-1.5 tabular-nums focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex-1 rounded-lg bg-text text-white py-2 text-xs font-medium disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={markDone}
          disabled={saving}
          className="rounded-lg bg-bg border border-rule text-text-secondary px-3 py-2 text-xs font-medium"
        >
          Mark done
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-bg-elevated border border-rule p-6 text-center">
      <div className="text-3xl mb-2">🌱</div>
      <div className="text-base font-serif font-medium">Start with one small goal.</div>
      <p className="text-sm text-text-muted mt-2">
        An emergency fund of $1,000 is a great place to start.
      </p>
    </div>
  );
}

function AddGoalSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [icon, setIcon] = useState('🎯');
  const [saving, setSaving] = useState(false);

  const presets = ['🛟', '✈️', '🏠', '🚗', '🎓', '💍', '🎯'];

  async function submit() {
    if (!name || !target) return;
    setSaving(true);
    try {
      await api.createGoal({
        name,
        description: description || undefined,
        targetAmount: parseFloat(target),
        deadline: deadline || undefined,
        icon,
      });
      onCreated();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button onClick={onClose} className="fixed inset-0 bg-black/50 z-40 animate-overlay-in" aria-label="Cancel" />
      <div className="fixed bottom-0 inset-x-0 max-w-md mx-auto bg-bg rounded-t-3xl shadow-2xl z-50 p-5 pb-8 animate-slide-up">
        <div className="grid place-items-center mb-2">
          <div className="w-10 h-1 rounded-full bg-rule" />
        </div>
        <div className="text-lg font-serif font-medium mb-4">Add a goal</div>

        <label className="block text-xs text-text-muted mb-1">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Emergency fund"
          className="w-full mb-3 text-sm rounded-lg bg-bg-elevated border border-rule px-3 py-2.5 focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
        />

        <label className="block text-xs text-text-muted mb-1">What's it for? (optional)</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="3 months of expenses set aside"
          className="w-full mb-3 text-sm rounded-lg bg-bg-elevated border border-rule px-3 py-2.5 focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
        />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Target amount</label>
            <input
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="5000"
              className="w-full text-sm rounded-lg bg-bg-elevated border border-rule px-3 py-2.5 tabular-nums focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Target date</label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full text-sm rounded-lg bg-bg-elevated border border-rule px-3 py-2.5 focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
            />
          </div>
        </div>

        <label className="block text-xs text-text-muted mb-1">Icon</label>
        <div className="flex flex-wrap gap-2 mb-5">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setIcon(p)}
              className={`w-10 h-10 rounded-lg grid place-items-center text-lg ${
                icon === p ? 'bg-text text-white' : 'bg-bg-elevated border border-rule'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={saving || !name || !target}
            className="flex-1 rounded-xl bg-text text-white py-3 text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create goal'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-bg-elevated border border-rule text-text-secondary px-4 py-3 text-sm font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
