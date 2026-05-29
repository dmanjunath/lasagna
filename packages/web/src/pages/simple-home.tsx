import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Lightbulb, Calendar, MessageSquare } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useInsights } from '../hooks/useInsights';
import { api } from '../lib/api';
import {
  Page,
  PageHeader,
  Section,
  Card,
  Button,
  Eyebrow,
  CompositionRibbon,
  Lede,
} from '../components/ds';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Goal {
  id: string;
  name: string;
  description?: string | null;
  targetAmount: string;
  currentAmount: string;
  deadline: string | null;
  icon: string | null;
  status: string;
}

interface InsightLike {
  id: string;
  title: string;
  description: string;
  urgency: string;
}

interface BillCard {
  id: string;
  name: string;
  amount: number;
  dueDate: Date;
  daysAway: number;
  accountId: string | null;
}

interface LevelStep {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  description: string;
  status: string;
  progress: number;
  action: string;
  detail: string;
  current: number | null;
  target: number | null;
}

interface NetBreakdown {
  cash: number;
  cashCount: number;
  investments: number;
  investmentsCount: number;
  /** real_estate + alternative — collectively "other assets". */
  assets: number;
  assetsCount: number;
  realEstateValue: number;
  alternativeValue: number;
  debts: number;
  debtsCount: number;
  netWorth: number;
}

/**
 * Label for the "other assets" segment depends on what's in it. If the user
 * only has real estate (most common), call it "Property". If only alts,
 * "Alternatives". If both, "Other assets".
 */
function assetsLabel(b: NetBreakdown): string {
  if (b.realEstateValue > 0 && b.alternativeValue > 0) return 'Other assets';
  if (b.realEstateValue > 0) return 'Property';
  return 'Alternatives';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtUsd = (n: number, frac = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: frac, minimumFractionDigits: frac });

function formatMoneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

const formatDateLong = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

function formatRel(when: string | Date): string {
  const t = when instanceof Date ? when.getTime() : new Date(when).getTime();
  const ms = Date.now() - t;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SimpleHome() {
  const { user, tenant } = useAuth();
  const [, setLocation] = useLocation();
  const { insights, reload: reloadInsights, lastActionsGeneratedAt } = useInsights();
  const [breakdown, setBreakdown] = useState<NetBreakdown | null>(null);
  const [accountsById, setAccountsById] = useState<Map<string, { name: string; balance: number }>>(new Map());
  const [goals, setGoals] = useState<Goal[]>([]);
  const [nwHistory, setNwHistory] = useState<{ date: string; value: number }[]>([]);
  const [upcomingBill, setUpcomingBill] = useState<BillCard | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [currentStep, setCurrentStep] = useState<LevelStep | null>(null);
  const [levelLoading, setLevelLoading] = useState(true);

  const firstName =
    user?.name?.split(' ')[0] ||
    tenant?.name?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'there';

  const loadPriorities = useCallback(() => {
    return api
      .getPriorities()
      .then(({ steps, currentStepId }) => {
        const found = steps.find((s) => s.id === currentStepId) ?? steps[0];
        if (found) {
          setCurrentStep({
            id: found.id,
            order: found.order,
            title: found.title,
            subtitle: found.subtitle,
            description: found.description,
            status: found.status,
            progress: found.progress,
            action: found.action,
            detail: found.detail,
            current: found.current,
            target: found.target,
          });
        } else {
          setCurrentStep(null);
        }
      })
      .catch(() => setCurrentStep(null));
  }, []);

  useEffect(() => {
    const BIG_CATEGORIES = new Set(['housing', 'debt_payment', 'transportation', 'insurance', 'utilities']);
    const BILL_MIN_AMOUNT = 200;

    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as any[] })),
      api.getGoals().catch(() => ({ goals: [] })),
      loadPriorities().finally(() => setLevelLoading(false)),
      api.getRecurring().catch(() => ({ recurring: [] as any[] })),
      api.getNetWorthHistory().catch(() => ({ history: [] as { date: string; value: number }[] })),
    ]).then(([balanceData, goalsData, , recurringData, historyData]) => {
      setNwHistory(historyData.history || []);
      const next: NetBreakdown = {
        cash: 0, cashCount: 0,
        investments: 0, investmentsCount: 0,
        assets: 0, assetsCount: 0,
        realEstateValue: 0, alternativeValue: 0,
        debts: 0, debtsCount: 0,
        netWorth: 0,
      };
      const map = new Map<string, { name: string; balance: number }>();
      for (const b of balanceData.balances) {
        const v = parseFloat(b.balance ?? '0');
        map.set(b.accountId, { name: b.name, balance: Number.isNaN(v) ? 0 : v });
        if (Number.isNaN(v)) continue;
        if (b.type === 'depository') { next.cash += v; next.cashCount++; }
        else if (b.type === 'investment') { next.investments += v; next.investmentsCount++; }
        else if (b.type === 'real_estate') { next.assets += v; next.assetsCount++; next.realEstateValue += v; }
        else if (b.type === 'alternative') { next.assets += v; next.assetsCount++; next.alternativeValue += v; }
        else if (b.type === 'credit' || b.type === 'loan') { next.debts += Math.abs(v); next.debtsCount++; }
      }
      next.netWorth = next.cash + next.investments + next.assets - next.debts;
      setBreakdown(next);
      setAccountsById(map);

      setGoals(goalsData.goals as Goal[]);

      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const upcoming = (recurringData.recurring || [])
        .filter((r: any) => r.nextDueDate && BIG_CATEGORIES.has(r.category))
        .map((r: any) => ({
          id: r.id,
          name: r.name,
          amount: parseFloat(r.amount),
          dueDate: new Date(r.nextDueDate!),
          accountId: r.accountId,
        }))
        .filter((r: any) => r.amount >= BILL_MIN_AMOUNT)
        .filter((r: any) => {
          const ms = r.dueDate.getTime() - now;
          return ms >= -24 * 60 * 60 * 1000 && ms <= sevenDays;
        })
        .sort((a: any, b: any) => a.dueDate.getTime() - b.dueDate.getTime())[0];
      if (upcoming) {
        const daysAway = Math.round((upcoming.dueDate.getTime() - now) / (24 * 60 * 60 * 1000));
        setUpcomingBill({ ...upcoming, daysAway });
      }
    });
  }, [loadPriorities]);

  function submitAsk(e?: React.FormEvent) {
    e?.preventDefault();
    const text = askDraft.trim();
    setAskDraft('');
    setLocation(text ? `/chat?prompt=${encodeURIComponent(text)}` : '/chat');
  }

  // ── Ranked insights ──────────────────────────────────────────────────────
  const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const ranked = [...insights].sort(
    (a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0),
  );
  const sideActions = ranked.slice(0, 2);
  const sideIds = new Set(sideActions.map((a) => a.id));
  const dykInsights = ranked.filter((i) => !sideIds.has(i.id)).slice(0, 5);

  const topGoal = goals.find((g) => g.status === 'active');
  const goalProgress = topGoal
    ? Math.min(100, Math.round((parseFloat(topGoal.currentAmount) / parseFloat(topGoal.targetAmount)) * 100))
    : null;

  const monthDelta = useMemo(() => {
    if (nwHistory.length < 2) return null;
    const last = nwHistory[nwHistory.length - 1].value;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const prior = [...nwHistory].reverse().find((p) => new Date(p.date).getTime() <= cutoff);
    if (!prior) return null;
    return last - prior.value;
  }, [nwHistory]);

  const suggestedPrompts = useMemo(() => {
    const prompts: string[] = [];
    if (breakdown) {
      if (breakdown.debts > 0 && breakdown.investments > 0)
        prompts.push(`Should I pay off ${formatMoneyShort(breakdown.debts)} in debt or keep investing?`);
      else if (breakdown.debts > 0)
        prompts.push(`Fastest way to pay off ${formatMoneyShort(breakdown.debts)} in debt?`);
      if (breakdown.investments > 0)
        prompts.push(`Can I retire on ${formatMoneyShort(breakdown.investments)}?`);
    }
    if (topGoal) prompts.push(`How can I reach ${topGoal.name} faster?`);
    if (currentStep) prompts.push(`Help me with: ${currentStep.title}`);
    if (prompts.length < 2) prompts.push('What should I focus on first?');
    if (prompts.length < 3) prompts.push('Am I on track for retirement?');
    return prompts.slice(0, 3);
  }, [breakdown, topGoal, currentStep]);

  return (
    <Page>
      {/* Masthead — date eyebrow, greeting (chat is now a full section below) */}
      <PageHeader
        eyebrow={formatDateLong(new Date())}
        title={<>Good morning, {firstName}.</>}
      />

      {/* Editorial lede — directly addresses the user with inline tabular numbers */}
      {breakdown && (
        <div style={{ marginBottom: 40 }}>
          <Lede>
            You're worth{' '}
            <Lede.Num>{fmtUsd(breakdown.netWorth)}</Lede.Num>
            {monthDelta !== null && (
              <>
                {' — '}
                <Lede.Num tone={monthDelta >= 0 ? 'pos' : 'neg'}>
                  {monthDelta >= 0 ? '↑' : '↓'} {fmtUsd(Math.abs(monthDelta))}
                </Lede.Num>{' '}this month
              </>
            )}.
            {currentStep && (
              <>
                {' '}Today, focus on{' '}
                <Lede.Num highlight>{currentStep.title}</Lede.Num>.
              </>
            )}
          </Lede>
        </div>
      )}

      {/* Composition ribbon — money status first; AskHero follows */}
      {breakdown && (breakdown.cash > 0 || breakdown.investments > 0 || breakdown.assets > 0 || breakdown.debts > 0) && (() => {
        const totalAccounts = breakdown.cashCount + breakdown.investmentsCount + breakdown.assetsCount + breakdown.debtsCount;
        return (
          <Section>
            <CompositionRibbon
              leadDelta={totalAccounts > 0 ? `${totalAccounts} account${totalAccounts === 1 ? '' : 's'}` : undefined}
              segments={[
                ...(breakdown.cash > 0 ? [{ label: 'Cash', value: breakdown.cash, color: 'var(--lf-basil)' }] : []),
                ...(breakdown.investments > 0 ? [{ label: 'Investments', value: breakdown.investments, color: 'var(--lf-cheese)' }] : []),
                ...(breakdown.assets > 0 ? [{ label: assetsLabel(breakdown), value: breakdown.assets, color: 'var(--lf-crust)' }] : []),
                ...(breakdown.debts > 0 ? [{ label: 'Debt', value: breakdown.debts, color: 'var(--lf-sauce)', negative: true }] : []),
              ]}
            />
          </Section>
        );
      })()}

      {/* Ask Lasagna — full-width editorial hero with composer + contextual prompts */}
      <AskHero
        value={askDraft}
        onChange={setAskDraft}
        onSubmit={submitAsk}
        prompts={suggestedPrompts}
        onPick={(q) => setLocation(`/chat?prompt=${encodeURIComponent(q)}`)}
      />

      {/* Today's focus — unified editorial article (no separate Section header
          above it; the article carries its own eyebrow/title/actions) */}
      {levelLoading ? (
        <div className="ds-focus-wrap"><div style={{ height: 140 }} className="animate-pulse" /></div>
      ) : currentStep ? (
        <FocusEditorial
          step={currentStep}
          onDone={async () => {
            if (!currentStep) return;
            try { await api.completePriorityStep(currentStep.id, true); } catch {}
            await loadPriorities();
          }}
          onHelp={() => {
            if (!currentStep) return;
            const prompt = `Help me with: ${currentStep.title}. ${currentStep.subtitle ?? ''}`.trim();
            setLocation(`/chat?prompt=${encodeURIComponent(prompt)}`);
          }}
        />
      ) : sideActions.length > 0 ? (
        <ActionEditorial
          insight={sideActions[0]}
          onDone={async (id) => {
            try { await api.actOnInsight(id); } catch {}
            await reloadInsights();
          }}
        />
      ) : (
        <div className="ds-focus-wrap">
          <Card variant="ghost">
            <Eyebrow>Get started</Eyebrow>
            <h3 className="ds-h2" style={{ marginTop: 8 }}>Set up your financial profile</h3>
            <p className="ds-body" style={{ marginTop: 8, marginBottom: 16 }}>
              Tell us the basics and we'll show you exactly what to do next.
            </p>
            <Button variant="ink" onClick={() => setLocation('/profile')}>Get started →</Button>
          </Card>
        </div>
      )}

      {/* Two-column body */}
      <div className="ds-home-twocol">
        {/* Did you know feed */}
        {dykInsights.length > 0 && (
          <Section
            title="Did you know"
            eyebrow={lastActionsGeneratedAt ? `Updated ${formatRel(lastActionsGeneratedAt)}` : undefined}
            actions={<Link href="/insights" className="ds-btn ds-btn--link" aria-label="More insights">→</Link>}
          >
            <ul className="ds-home-feed">
              {dykInsights.map((ins) => (
                <li key={ins.id}>
                  <Link href={`/insights?id=${ins.id}`} className="ds-home-feed__link">
                    <div className="ds-home-feed__bullet">
                      <Lightbulb size={14} className="text-cheese" />
                    </div>
                    <div className="ds-home-feed__body">
                      <div className="ds-home-feed__title">{ins.title}</div>
                      {ins.description && (
                        <p className="ds-home-feed__desc">{ins.description}</p>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Marginalia: goal + bill (ask moved to a prominent hero above) */}
        <aside className="ds-home-aside">
          {topGoal && goalProgress !== null && (
            <MarginaliaGoal goal={topGoal} progress={goalProgress} />
          )}

          {upcomingBill && (
            <MarginaliaBill bill={upcomingBill} account={upcomingBill.accountId ? accountsById.get(upcomingBill.accountId) ?? null : null} />
          )}
        </aside>
      </div>

      {/* Local layout helpers — page-specific grid only, no typography tokens */}
      <style>{`
        .ds-home-stats { margin: 32px 0 56px; }
        .ds-home-twocol {
          display: grid;
          grid-template-columns: 1fr;
          gap: 40px;
        }
        @media (min-width: 1024px) {
          .ds-home-twocol {
            grid-template-columns: minmax(0, 1fr) 320px;
            align-items: start;
            gap: 56px;
          }
        }
        .ds-home-feed {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .ds-home-feed li {
          padding: 18px 0;
          border-top: 1px solid var(--lf-rule);
        }
        .ds-home-feed li:first-child { border-top: 0; padding-top: 0; }
        .ds-home-feed li:last-child { padding-bottom: 0; }
        .ds-home-feed__link {
          display: flex;
          gap: 14px;
          text-decoration: none;
          color: inherit;
        }
        .ds-home-feed__link:hover .ds-home-feed__title { color: var(--lf-sauce); }
        .ds-home-feed__bullet {
          width: 28px; height: 28px;
          border-radius: 4px;
          background: var(--lf-cream);
          display: grid; place-items: center;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .ds-home-feed__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 17px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.3;
          transition: color 0.15s;
        }
        .ds-home-feed__desc {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          line-height: 1.5;
          color: var(--lf-muted);
          margin: 6px 0 0;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .ds-home-aside {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
      `}</style>
    </Page>
  );
}

// ─── Focus editorial (level) ───────────────────────────────────────────────

function FocusEditorial({
  step,
  onDone,
  onHelp,
}: {
  step: LevelStep;
  onDone: () => void | Promise<void>;
  onHelp: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const isComplete = step.status === 'complete';
  const progress = Math.max(0, Math.min(100, Math.round(step.progress || 0)));
  const hasProgress = !isComplete && progress > 0;
  const progressDetail =
    step.current != null && step.target != null
      ? `${formatMoneyShort(step.current)} of ${formatMoneyShort(step.target)}`
      : null;
  const body = step.description || step.subtitle;

  return (
    <article className="ds-focus">
      <div className="ds-focus__eyebrow">
        Today's focus <span aria-hidden="true">·</span> Level {step.order} of 12
      </div>
      <h2 className="ds-focus__title">{step.title}</h2>
      {body && <p className="ds-focus__body">{body}</p>}
      {step.action && (
        <p className="ds-focus__nextstep">
          <span className="ds-focus__nextstep-label">Next step.</span>{' '}
          {step.action}
        </p>
      )}
      {hasProgress && (
        <div className="ds-focus__progress">
          <div className="ds-focus__progress-meta">
            <span className="ds-focus__progress-label">Progress</span>
            <span className="ds-caption ds-num">
              {progress}%{progressDetail ? ` · ${progressDetail}` : ''}
            </span>
          </div>
          <div className="ds-focus__progress-bar">
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      <div className="ds-focus__footer">
        <div className="ds-focus__actions">
          <Button
            variant="ink"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onDone(); } finally { setBusy(false); } }}
          >
            {busy ? '…' : 'Mark done ✓'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onHelp}>
            Walk me through this →
          </Button>
        </div>
        <Link href="/insights" className="ds-focus__all">All actions →</Link>
      </div>
      <style>{`
        .ds-focus {
          padding: 28px 0 8px;
          border-top: 3px solid var(--lf-ink);
          margin-bottom: 56px;
        }
        .ds-focus__eyebrow {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-weight: 600;
          color: var(--lf-sauce);
          margin-bottom: 14px;
        }
        .ds-focus__eyebrow > span {
          color: var(--lf-muted);
          margin: 0 6px;
        }
        .ds-focus__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 500;
          font-size: clamp(30px, 4.5vw, 44px);
          line-height: 1.05;
          letter-spacing: -0.015em;
          color: var(--lf-ink);
          margin: 0 0 18px;
        }
        .ds-focus__body {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 15px;
          line-height: 1.6;
          color: var(--lf-ink-soft);
          max-width: 60ch;
          margin: 0 0 18px;
        }
        .ds-focus__nextstep {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.55;
          color: var(--lf-ink-soft);
          background: var(--lf-cream);
          border-left: 3px solid var(--lf-cheese);
          padding: 12px 14px;
          border-radius: 0 8px 8px 0;
          margin: 0 0 22px;
          max-width: 60ch;
        }
        .ds-focus__nextstep-label {
          color: var(--lf-ink);
          font-weight: 600;
        }
        .ds-focus__progress { margin-bottom: 22px; max-width: 480px; }
        .ds-focus__progress-meta {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 8px;
        }
        .ds-focus__progress-label {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-weight: 600;
          color: var(--lf-muted);
        }
        .ds-focus__progress-bar {
          height: 6px;
          background: var(--lf-cream-deep);
          border-radius: 3px;
          overflow: hidden;
        }
        .ds-focus__progress-bar > div {
          height: 100%;
          background: var(--lf-cheese);
          border-radius: 3px;
          transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .ds-focus__footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 4px;
        }
        .ds-focus__actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .ds-focus__all {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--lf-muted);
          text-decoration: none;
          padding: 8px 0;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
        }
        .ds-focus__all:hover { color: var(--lf-sauce); }
      `}</style>
    </article>
  );
}

// ─── Action editorial (used when no level step is present) ─────────────────

function ActionEditorial({
  insight,
  onDone,
}: {
  insight: InsightLike;
  onDone: (id: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const urgencyLabel =
    insight.urgency === 'critical' || insight.urgency === 'high' ? 'High priority' :
    insight.urgency === 'medium' ? 'This week' : 'Watch';
  return (
    <article className="ds-focus">
      <div className="ds-focus__eyebrow">
        Today's focus <span aria-hidden="true">·</span> {urgencyLabel}
      </div>
      <h2 className="ds-focus__title">{insight.title}</h2>
      {insight.description && <p className="ds-focus__body">{insight.description}</p>}
      <div className="ds-focus__footer">
        <div className="ds-focus__actions">
          <Button
            variant="ink"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onDone(insight.id); } finally { setBusy(false); } }}
          >
            {busy ? '…' : 'Mark done ✓'}
          </Button>
          <Link href={`/insights?id=${insight.id}`}>
            <Button variant="ghost">Open →</Button>
          </Link>
        </div>
        <Link href="/insights" className="ds-focus__all">All actions →</Link>
      </div>
    </article>
  );
}

// ─── Marginalia (right column) ─────────────────────────────────────────────

function MarginaliaGoal({ goal, progress }: { goal: Goal; progress: number }) {
  return (
    <div className="ds-margin">
      <Eyebrow>Active goal</Eyebrow>
      <div className="ds-margin__title">{goal.name}</div>
      <div className="ds-margin__bar">
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="ds-margin__meta">
        <span className="ds-num">{fmtUsd(parseFloat(goal.currentAmount))} / {fmtUsd(parseFloat(goal.targetAmount))}</span>
        <Link href="/goals" className="ds-btn ds-btn--link">Open →</Link>
      </div>
      <style>{`
        .ds-margin { border-top: 1px solid var(--lf-ink); padding-top: 20px; }
        .ds-margin__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 22px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.2;
          margin: 10px 0 16px;
        }
        .ds-margin__bar {
          height: 4px;
          background: var(--lf-cream-deep);
          border-radius: 2px;
          overflow: hidden;
          margin-bottom: 10px;
        }
        .ds-margin__bar > div {
          height: 100%;
          background: var(--lf-basil);
          border-radius: 2px;
        }
        .ds-margin__meta {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          font-size: 12px;
          color: var(--lf-muted);
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </div>
  );
}

function MarginaliaBill({ bill, account }: { bill: BillCard; account: { name: string; balance: number } | null }) {
  const when = bill.daysAway <= 0 ? 'today' : bill.daysAway === 1 ? 'tomorrow' : `in ${bill.daysAway} days`;
  const covered = account ? account.balance >= bill.amount : null;
  return (
    <div className="ds-margin">
      <Eyebrow><Calendar size={11} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />Coming up</Eyebrow>
      <div className="ds-margin__title" style={{ fontSize: 18 }}>
        {bill.name} · <span className="ds-num">{fmtUsd(bill.amount)}</span>
      </div>
      <p className="ds-margin__desc">
        Due {when}
        {account && (
          <>
            {' '}from {account.name}.{' '}
            {covered
              ? <>You're covered — balance <span className="ds-num">{fmtUsd(account.balance)}</span>.</>
              : <span className="ds-neg">Balance <span className="ds-num">{fmtUsd(account.balance)}</span> may not cover.</span>}
          </>
        )}
      </p>
      <style>{`
        .ds-margin__desc {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          line-height: 1.55;
          color: var(--lf-muted);
          margin: 0;
        }
      `}</style>
    </div>
  );
}

// ─── Ask Lasagna hero ──────────────────────────────────────────────────────
// Lasagna's signature feature is chat — surface it prominently as an
// editorial centerpiece, not a sidebar widget. The input is large; suggested
// questions render below as serif headlines (hairline-separated) like
// "today's questions" in a magazine.

function AskHero({
  value, onChange, onSubmit, prompts, onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  prompts: string[];
  onPick: (q: string) => void;
}) {
  return (
    <section className="ds-askhero" aria-labelledby="ds-askhero-title">
      <div className="ds-askhero__head">
        <MessageSquare size={20} className="ds-askhero__icon" />
        <div>
          <h2 id="ds-askhero-title" className="ds-askhero__title">
            Ask Lasagna anything.
          </h2>
          <p className="ds-askhero__sub">
            Lasagna sees your accounts, goals, and history.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="ds-askhero__form">
        <div className="ds-askhero__box">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Ask anything…"
            className="ds-askhero__input"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="ds-askhero__submit"
            aria-label="Send question"
          >
            Ask <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>

      {prompts.length > 0 && (
        <ul className="ds-askhero__prompts">
          {prompts.map((q) => (
            <li key={q}>
              <button type="button" onClick={() => onPick(q)} className="ds-askhero__prompt">
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}

      <style>{`
        .ds-askhero {
          position: relative;
          background: var(--lf-cream);
          border: 1px solid var(--lf-rule);
          border-top: 3px solid var(--lf-sauce);
          border-radius: 14px;
          padding: 28px clamp(20px, 3vw, 32px) 24px;
          margin-bottom: 48px;
        }
        .ds-askhero__head {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 20px;
        }
        .ds-askhero__icon {
          flex-shrink: 0;
          padding: 8px;
          background: var(--lf-sauce);
          color: var(--lf-paper);
          border-radius: 10px;
          width: 36px;
          height: 36px;
        }
        .ds-askhero__title {
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 500;
          font-size: clamp(24px, 3.4vw, 32px);
          line-height: 1.1;
          letter-spacing: -0.015em;
          color: var(--lf-ink);
          margin: 0;
        }
        .ds-askhero__sub {
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 13px;
          color: var(--lf-ink-soft);
          margin: 6px 0 0;
        }
        .ds-askhero__form { margin: 0 0 16px; }
        .ds-askhero__box {
          display: flex;
          align-items: stretch;
          background: var(--lf-paper);
          border: 1px solid var(--lf-rule);
          border-radius: 10px;
          transition: border-color 0.15s, box-shadow 0.15s;
          overflow: hidden;
        }
        .ds-askhero__box:focus-within {
          border-color: var(--lf-sauce);
          box-shadow: 0 0 0 3px rgba(201,84,58,0.12);
        }
        .ds-askhero__input {
          flex: 1;
          background: transparent;
          border: 0;
          outline: 0;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 15px;
          color: var(--lf-ink);
          padding: 14px 18px;
          min-width: 0;
        }
        .ds-askhero__input::placeholder { color: var(--lf-muted); }
        .ds-askhero__submit {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--lf-sauce);
          color: var(--lf-paper);
          border: 0;
          padding: 0 22px;
          font-family: 'Geist', system-ui, sans-serif;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .ds-askhero__submit:hover:not(:disabled) { background: var(--lf-sauce-deep); }
        .ds-askhero__submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .ds-askhero__prompts {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
        }
        .ds-askhero__prompts li {
          border-top: 1px solid var(--lf-rule-soft);
        }
        .ds-askhero__prompt {
          width: 100%;
          background: none;
          border: 0;
          padding: 14px 0;
          min-height: 44px;
          text-align: left;
          cursor: pointer;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: var(--lf-ink-soft);
          line-height: 1.4;
          transition: color 0.15s;
          /* Single line, ellipsis if too long — keeps every row uniform */
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ds-askhero__prompt:hover { color: var(--lf-sauce); }
      `}</style>
    </section>
  );
}
