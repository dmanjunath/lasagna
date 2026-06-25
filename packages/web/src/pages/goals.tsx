import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, Check, Target, ArrowRight, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { PageActions } from '../components/common/page-actions';
import {
  Page,
  Section,
  Card,
  Button,
  Eyebrow,
  EmptyState,
  SkeletonLine,
} from '../components/ds';
import { formatCurrency, goalColor, iconFor, toggleId, AccountChips, IconKey } from './goal-shared';

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
  deadline: string | null;
  category: string;
  status: string;
  icon: string | null;
  createdAt: string;
  accountIds: string[];
  isAutoTracked: boolean;
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
  const [newIcon, setNewIcon] = useState<string>('target');
  const [newDeadline, setNewDeadline] = useState('');
  const [newCategory, setNewCategory] = useState('savings');
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; mask: string | null; type: string; balance: string | null }>>([]);
  const [newAccountIds, setNewAccountIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

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
          .map(b => ({ id: b.accountId, name: b.name, mask: b.mask, type: b.type, balance: b.balance }))
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
        .goals-feed { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
        .goals-feed li {
          background: var(--lf-surface);
          border: 1px solid var(--lf-rule-neutral);
          border-radius: 12px;
          box-shadow: var(--shadow-card);
          padding: 18px 20px;
          cursor: pointer;
          transition: box-shadow 0.18s ease, transform 0.18s ease;
        }
        .goals-feed li:hover {
          box-shadow: var(--shadow-card-hover);
          transform: translateY(-1px);
        }
        .goals-feed li:focus-visible {
          outline: 2px solid var(--lf-rule);
          outline-offset: 2px;
        }
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
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 15px;
          font-weight: 500;
          color: var(--lf-ink);
          flex-shrink: 0;
          font-variant-numeric: tabular-nums;
          display: inline-flex; align-items: center; gap: 8px;
        }
        /* Iter 9: progress is the hero of each row — a thick, legible rail
           with a clear track and a category-colored gradient fill. */
        .goals-feed__bar {
          height: 10px;
          background: var(--lf-rule-soft);
          border-radius: 999px;
          overflow: hidden;
          margin: 14px 0 10px;
        }
        .goals-feed__bar > div { height: 100%; border-radius: 999px; transition: width 0.6s cubic-bezier(0.16,1,0.3,1); }
        .goals-feed__meta {
          display: flex; gap: 10px; align-items: baseline;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px; letter-spacing: 0.02em;
          color: var(--lf-muted);
          font-variant-numeric: tabular-nums;
        }
        .goals-feed__meta-sep { opacity: 0.4; }
        /* Percentage is the key metric — render it large and confident. */
        .goals-feed__pct {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 600;
          font-size: 17px;
          letter-spacing: -0.01em;
          color: var(--lf-ink);
          font-variant-numeric: tabular-nums;
        }
        /* 100% complete: a strong basil "Reached" badge that reads obviously
           different from an in-progress row. */
        .goals-feed__complete {
          display: inline-flex; align-items: center; gap: 5px;
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 600; font-size: 13px; letter-spacing: 0.02em;
          color: var(--lf-basil);
          background: color-mix(in srgb, var(--lf-basil) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--lf-basil) 30%, transparent);
          border-radius: 999px; padding: 2px 10px;
        }
        .goals-feed__actions {
          display: flex; flex-shrink: 0;
          align-items: center; align-self: stretch;
        }
        /* Open affordance — the whole row is clickable; the chevron signals it. */
        .goals-feed__open {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px;
          color: var(--lf-muted); flex-shrink: 0;
          transition: color 0.15s, transform 0.15s;
        }
        .goals-feed li:hover .goals-feed__open { color: var(--lf-sauce); transform: translateX(2px); }

        /* Reached / exceeded goals are a distinct surface — faint basil wash +
           green-tinted hairline so a completed row reads as "done" at a glance,
           not just another neutral card. */
        .goals-feed li.is-complete {
          border-color: color-mix(in srgb, var(--lf-basil) 32%, var(--lf-rule-neutral));
          background:
            linear-gradient(180deg,
              color-mix(in srgb, var(--lf-basil) 6%, var(--lf-surface)),
              color-mix(in srgb, var(--lf-basil) 3%, var(--lf-surface)));
        }
        /* Check seal on the icon — the second cue that a goal landed. */
        .goals-feed__icon { position: relative; }
        .goals-feed__icon-check {
          position: absolute; right: -5px; bottom: -5px;
          width: 18px; height: 18px; border-radius: 999px;
          background: var(--lf-basil); color: var(--lf-paper);
          display: grid; place-items: center;
          border: 2px solid var(--lf-surface);
          box-shadow: 0 1px 2px rgba(15,23,42,0.08);
        }
        /* Exceeded → solid (filled) badge; outlined "Reached" stays calmer.
           The filled fill is the louder, "you beat it" signal. */
        .goals-feed__complete--exceeded {
          color: var(--lf-paper);
          background: var(--lf-basil);
          border-color: var(--lf-basil);
        }
        /* Skeleton rows reuse the feed shell but stay inert. */
        .goals-feed li.is-skeleton { cursor: default; }
        .goals-feed li.is-skeleton:hover { transform: none; box-shadow: var(--shadow-card); }
        @media (max-width: 640px) {
          .goals-feed li { padding: 16px; }
          .goals-feed__row {
            grid-template-columns: 36px minmax(0, 1fr) auto;
            gap: 12px;
          }
          .goals-feed__icon {
            width: 36px; height: 36px;
            font-size: 18px;
          }
          .goals-feed__head {
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
          }
        }

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
          font-size: 30px;
          line-height: 1.02;
          letter-spacing: -0.025em;
          color: var(--lf-ink);
          font-variant-numeric: tabular-nums;
        }
        /* Primary KPI (saved so far) carries the accent rule + largest value */
        .goals-strip-card:first-child {
          border-top: 2px solid var(--lf-sauce);
        }
        .goals-strip-card:first-child .goals-strip-card__value {
          color: var(--lf-sauce-deep);
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
        .goals-archive li[role="button"] { cursor: pointer; }
        .goals-archive li[role="button"]:hover .goals-archive__name { color: var(--lf-ink-soft); }
        .goals-archive li[role="button"]:focus-visible {
          outline: 2px solid var(--lf-rule);
          outline-offset: 2px;
        }
        .goals-archive__open {
          color: var(--lf-muted); flex-shrink: 0;
          transition: color 0.15s, transform 0.15s;
        }
        .goals-archive li[role="button"]:hover .goals-archive__open {
          color: var(--lf-sauce); transform: translateX(2px);
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
              {formatCurrency(totalTarget)} target · {activeGoals.length} active
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
          {formatCurrency(totalTarget)} target · {activeGoals.length} active
          {completedGoals.length > 0 && (
            <> · <span className="ds-pos">{completedGoals.length} complete</span></>
          )}
        </div>
      )}

      {/* Loading skeleton — matched outline: KPI strip + a few goal rows so
          first paint reserves the same space the loaded page consumes. */}
      {loading && (
        <>
          <div className="goals-strip-grid" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="goals-strip-card">
                <SkeletonLine width="42%" height={11} />
                <SkeletonLine width="70%" height={28} style={{ marginTop: 2 }} />
                <SkeletonLine width="56%" height={11} />
              </div>
            ))}
          </div>
          <ul className="goals-feed" aria-hidden="true">
            {[35, 68, 100].map((w, i) => (
              <li key={i} className="is-skeleton">
                <div className="goals-feed__row">
                  <span className="ds-skeleton goals-feed__icon" />
                  <div className="goals-feed__main">
                    <SkeletonLine width="46%" height={22} />
                    <div className="goals-feed__bar">
                      <div style={{ width: `${w}%`, background: 'var(--lf-rule)' }} />
                    </div>
                    <SkeletonLine width="34%" height={13} />
                  </div>
                  <div className="goals-feed__actions" />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Iter 7 B: "Saving this month" KPI strip. Built from the active-goal
          aggregates we already have — total saved against total target, with
          a coarse "added this month" derived from delta-against-target as a
          proxy until we wire per-goal monthly contribution history. */}
      {!loading && activeGoals.length > 0 && (
        <section className="goals-strip-grid" aria-label="Savings totals across all active goals">
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
              average saved per active goal
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

              {/* Accounts — linking ≥1 makes the goal auto-track its balance */}
              {accounts.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <Eyebrow>Accounts (optional)</Eyebrow>
                  <p style={{
                    margin: '4px 0 8px',
                    fontFamily: "'Geist', system-ui, sans-serif",
                    fontSize: 12,
                    color: 'var(--lf-muted)',
                  }}>
                    Linked accounts auto-track this goal's progress.
                  </p>
                  <AccountChips
                    accounts={accounts}
                    selected={newAccountIds}
                    onToggle={(id) => setNewAccountIds(prev => toggleId(prev, id))}
                  />
                </div>
              )}

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
              {formError && (
                <p style={{
                  margin: '10px 0 0',
                  fontFamily: "'Geist', system-ui, sans-serif",
                  fontSize: 12,
                  color: 'var(--lf-sauce)',
                }}>
                  {formError}
                </p>
              )}
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
          <Section title="Active goals" eyebrow={`${activeGoals.length} goal${activeGoals.length === 1 ? '' : 's'}`}>
            <ul className="goals-feed">
              {activeGoals.map((goal) => {
                const target = parseFloat(goal.targetAmount);
                const current = parseFloat(goal.currentAmount);
                const autoTracked = goal.isAutoTracked;
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                const remaining = Math.max(0, target - current);
                const surplus = current - target;
                const color = goalColor(goal.category);

                let deadlineLabel: string | null = null;
                if (goal.deadline) {
                  const daysLeft = Math.ceil(
                    (new Date(goal.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                  );
                  deadlineLabel = daysLeft > 0 ? `${daysLeft}d left` : 'Past deadline';
                }

                const complete = pct >= 100;
                // Over-target: landed AND a real dollar surplus past the goal.
                const exceeded = complete && surplus >= 1;
                const open = () => setLocation(`/plans/savings/${goal.id}`);

                return (
                  <li
                    key={goal.id}
                    className={complete ? 'is-complete' : undefined}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${goal.name}`}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                    }}
                  >
                    <div className="goals-feed__row">
                      <div
                        className="goals-feed__icon"
                        style={complete
                          ? { background: 'color-mix(in srgb, var(--lf-basil) 14%, transparent)', border: '1px solid color-mix(in srgb, var(--lf-basil) 30%, transparent)', color: 'var(--lf-basil)' }
                          : { background: `color-mix(in srgb, ${color} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`, color }}
                      >
                        {iconFor(goal.icon, 22)}
                        {complete && (
                          <span className="goals-feed__icon-check" aria-hidden="true">
                            <Check size={11} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="goals-feed__main">
                        <div className="goals-feed__head">
                          <h3 className="goals-feed__title">{goal.name}</h3>
                          <span className="goals-feed__amount" title={autoTracked ? 'Tracked from linked accounts' : undefined}>
                            <span>
                              {formatCurrency(current)} <span style={{ color: 'var(--lf-muted)', fontWeight: 400 }}>/ {formatCurrency(target)}</span>
                            </span>
                            {autoTracked && (
                              <span
                                title={`Tracked from: ${
                                  goal.accountIds
                                    .map(id => accounts.find(a => a.id === id)?.name)
                                    .filter(Boolean)
                                    .join(', ')
                                  || `${goal.accountIds.length} account${goal.accountIds.length === 1 ? '' : 's'}`
                                }`}
                                style={{
                                  fontFamily: "'Geist', system-ui, sans-serif",
                                  fontSize: 12, fontWeight: 500,
                                  color: 'var(--lf-ink-soft)',
                                  background: 'color-mix(in srgb, var(--lf-basil) 14%, transparent)',
                                  border: '1px solid color-mix(in srgb, var(--lf-basil) 24%, transparent)',
                                  borderRadius: 999, padding: '2px 8px',
                                }}>
                                Auto · {goal.accountIds.length} acct{goal.accountIds.length === 1 ? '' : 's'}
                              </span>
                            )}
                          </span>
                        </div>

                        <div className="goals-feed__bar">
                          {/* 100% fills basil (success); otherwise a category
                              gradient. At 0% we render a tiny tick so the rail
                              reads as "alive but empty" rather than absent. */}
                          {complete ? (
                            <div style={{ width: '100%', background: 'var(--lf-basil)' }} />
                          ) : pct > 0 ? (
                            <div style={{ width: `${pct}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, transparent), ${color})` }} />
                          ) : (
                            <div style={{ width: 8, background: color }} />
                          )}
                        </div>

                        <div className="goals-feed__meta">
                          {[
                            exceeded
                              ? <span className="goals-feed__complete goals-feed__complete--exceeded"><Check size={13} /> Exceeded</span>
                              : complete
                                ? <span className="goals-feed__complete"><Check size={13} /> Reached</span>
                                : <span className="goals-feed__pct">{Math.round(pct)}%</span>,
                            exceeded
                              ? <span>{formatCurrency(surplus)} over target</span>
                              : complete ? null : <span>{formatCurrency(remaining)} to go</span>,
                            deadlineLabel ? <span>{deadlineLabel}</span> : null,
                            goal.category ? <span>{goal.category.replace(/_/g, ' ')}</span> : null,
                          ]
                            .filter(Boolean)
                            .map((item, i) => (
                              <span key={i} style={{ display: 'contents' }}>
                                {i > 0 && <span className="goals-feed__meta-sep">·</span>}
                                {item}
                              </span>
                            ))}
                        </div>
                      </div>
                      <div className="goals-feed__actions">
                        <span className="goals-feed__open" aria-hidden="true">
                          <ChevronRight size={18} />
                        </span>
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
              {completedGoals.map((goal) => {
                const open = () => setLocation(`/plans/savings/${goal.id}`);
                return (
                  <li
                    key={goal.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${goal.name}`}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
                    }}
                  >
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
                    <ChevronRight size={16} className="goals-archive__open" aria-hidden="true" />
                  </li>
                );
              })}
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
        <Section title="Suggested">
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
                    style={{ background: `color-mix(in srgb, ${color} 10%, transparent)`, color }}
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
