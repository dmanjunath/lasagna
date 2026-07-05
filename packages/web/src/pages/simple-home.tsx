import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, ChevronRight, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useInsights } from '../hooks/useInsights';
import { api } from '../lib/api';
import { useChatStore } from '../lib/chat-store';
import { Button, Skeleton } from '../components/uikit';
import { formatCurrency, goalColor, iconFor } from './goal-shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Goal {
  id: string;
  name: string;
  description?: string | null;
  targetAmount: string;
  currentAmount: string;
  deadline: string | null;
  icon: string | null;
  category: string;
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
  creditCards: number;
  creditCardsCount: number;
  loans: number;
  loansCount: number;
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
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

const formatDateShort = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function greetingForHour(h: number) {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Small presentational primitives (Bright --ui-* tokens) ────────────────────

/** A rounded progress track with a colored fill. */
function Track({ pct, color, shine = false }: { pct: number; color: string; shine?: boolean }) {
  return (
    <div className="h-[9px] rounded-full bg-canvas-sunken overflow-hidden">
      <div
        className="h-full rounded-full relative"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: color,
          boxShadow: shine ? 'inset 0 1px 0 rgba(255,255,255,0.4)' : undefined,
        }}
      />
    </div>
  );
}

/** Net-worth 30-day delta chip — sign + arrow + tinted color (never color-only). */
function DeltaChip({ delta, suffix }: { delta: number; suffix?: string }) {
  const positive = delta >= 0;
  return (
    <span
      className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-[13px] font-bold ui-tnum whitespace-nowrap shrink-0"
      style={{
        background: positive ? 'var(--ui-positive-soft)' : 'var(--ui-negative-soft)',
        color: positive ? 'rgb(var(--ui-positive))' : 'rgb(var(--ui-negative))',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        {positive ? <path d="M12 7l7 8H5z" /> : <path d="M12 17 5 9h14z" />}
      </svg>
      {positive ? '+' : '−'}{fmtUsd(Math.abs(delta))}{suffix ? ` · ${suffix}` : ''}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SimpleHome() {
  const { user, tenant } = useAuth();
  const [, setLocation] = useLocation();
  const { openChat } = useChatStore();
  const { insights, reload: reloadInsights, refresh: refreshInsights } = useInsights();
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [breakdown, setBreakdown] = useState<NetBreakdown | null>(null);
  const [accountsById, setAccountsById] = useState<Map<string, { name: string; balance: number }>>(new Map());
  const [goals, setGoals] = useState<Goal[]>([]);
  const [nwHistory, setNwHistory] = useState<{ date: string; value: number }[]>([]);
  const [upcomingBill, setUpcomingBill] = useState<BillCard | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [currentStep, setCurrentStep] = useState<LevelStep | null>(null);
  const [levelLoading, setLevelLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const firstName =
    user?.name?.split(' ')[0] ||
    tenant?.name?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'there';

  const [greeting, setGreeting] = useState(() => greetingForHour(new Date().getHours()));
  useEffect(() => {
    const update = () => setGreeting(greetingForHour(new Date().getHours()));
    update();
    const id = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

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
        creditCards: 0, creditCardsCount: 0,
        loans: 0, loansCount: 0,
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
        else if (b.type === 'credit') { next.debts += Math.abs(v); next.debtsCount++; next.creditCards += Math.abs(v); next.creditCardsCount++; }
        else if (b.type === 'loan') { next.debts += Math.abs(v); next.debtsCount++; next.loans += Math.abs(v); next.loansCount++; }
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
    }).finally(() => setLoading(false));
  }, [loadPriorities]);

  function submitAsk(e?: React.FormEvent) {
    e?.preventDefault();
    const text = askDraft.trim();
    setAskDraft('');
    openChat(text || undefined);
  }

  // ── Ranked insights ──────────────────────────────────────────────────────
  const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const ranked = [...insights].sort(
    (a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0),
  );
  // Three moves total: the priority step (when present) takes one slot.
  const sideActions = currentStep ? ranked.slice(0, 2) : ranked.slice(0, 3);

  const topGoal = goals.find((g) => g.status === 'active');

  const monthDelta = useMemo(() => {
    if (nwHistory.length < 2) return null;
    const last = nwHistory[nwHistory.length - 1].value;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const prior = [...nwHistory].reverse().find((p) => new Date(p.date).getTime() <= cutoff);
    if (!prior) return null;
    return last - prior.value;
  }, [nwHistory]);

  const suggestedPrompts = useMemo(() => {
    const shortUsd = (n: number) => {
      const abs = Math.abs(n);
      if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
      if (abs >= 1_000) return `$${Math.round(abs / 1_000)}k`;
      return `$${Math.round(abs)}`;
    };
    const prompts: string[] = [];
    if (breakdown && breakdown.debts > 0) {
      prompts.push(`Pay off ${shortUsd(breakdown.debts)} faster?`);
    }
    if (topGoal) {
      const target = parseFloat(topGoal.targetAmount);
      const current = parseFloat(topGoal.currentAmount || '0');
      const remaining = Math.max(0, target - current);
      const label = (topGoal.name || 'goal').split(' ').slice(0, 2).join(' ').toLowerCase();
      if (target > 0) {
        prompts.push(
          remaining > 0
            ? `Fastest path to ${shortUsd(remaining)}?`
            : `What's next after my ${label}?`
        );
      }
    }
    if (breakdown && breakdown.netWorth > 0) {
      prompts.push(`Retire at 65 on ${shortUsd(breakdown.netWorth)}?`);
    }
    prompts.push('Tax-loss harvest this year?');
    prompts.push('My safe withdrawal rate?');
    return prompts.slice(0, 3);
  }, [breakdown, topGoal]);

  const hasComposition =
    breakdown && (breakdown.cash > 0 || breakdown.investments > 0 || breakdown.assets > 0 || breakdown.debts > 0);

  const moveCount = (currentStep ? 1 : 0) + sideActions.length;

  return (
    <div className="mx-auto max-w-[1180px] px-3 sm:px-11 pt-3 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* Greeting */}
      <header className="animate-fade-in">
        <h1 className="font-editorial text-[26px] sm:text-[33px] font-bold leading-[1.05] tracking-[-0.025em] text-content">
          {greeting}, {firstName} <span className="inline-block origin-[70%_70%]">👋</span>
        </h1>
        <p className="mt-1.5 text-[14px] font-medium text-content-muted">
          {formatDateLong(new Date())} · here's what's worth a look
        </p>
      </header>

      {/* First-paint skeleton — reserves the hero + grid footprint. */}
      {loading && !breakdown && (
        <div className="mt-7 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-7 items-start">
          <div className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="mt-5 h-8 w-full rounded-[11px]" />
            <Skeleton className="mt-3 h-3 w-2/3" />
            <Skeleton className="mt-8 h-8 w-32 rounded-[11px]" />
            <Skeleton className="mt-6 h-16 w-full rounded-ui-lg" />
          </div>
          <div className="flex flex-col gap-[18px]">
            <Skeleton className="h-[230px] w-full rounded-ui-xl" />
            <Skeleton className="h-[160px] w-full rounded-ui-xl" />
          </div>
        </div>
      )}

      {/* ════════ ROW 1 — FULL-WIDTH NET-WORTH HERO ════════ */}
      {breakdown && hasComposition && (
        <div className="mt-7">
          <NetWorthBreakdown
            breakdown={breakdown}
            monthDelta={monthDelta}
            onOpenMoney={() => setLocation('/money')}
          />
        </div>
      )}

      {/* ════════ ROW 2 — 2/3 (ACTIONS) + 1/3 (CHART/CHAT/GOALS) GRID ════════ */}
      {breakdown && (
        <div className="mt-7 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-7 items-start">

          {/* ░░░░ LEFT COLUMN (2/3) — the action queue ░░░░ */}
          <div className="min-w-0 flex flex-col">
            {/* Today — three moves */}
            <div className="flex items-center gap-3.5 flex-wrap">
              <span className="inline-flex items-center gap-2.5">
                <span
                  className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
                  style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
                />
                <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">Today</span>
              </span>
              <div>
                <h2 className="font-editorial text-[24px] sm:text-[28px] font-bold leading-[1.05] tracking-[-0.025em]">
                  {moveCount > 1 ? `${moveCount} moves to make today` : 'Your next move'}
                </h2>
                <p className="mt-1 text-[14px] font-medium text-content-muted">
                  Lined up biggest-impact first — quick wins for your wealth.
                </p>
              </div>
            </div>

            <MovesQueue
              step={currentStep}
              actions={sideActions}
              levelLoading={levelLoading}
              generating={generatingInsights}
              onOpenInsight={(id) => setLocation(`/insights?id=${id}`)}
              onGenerateActions={async () => {
                setGeneratingInsights(true);
                try { await refreshInsights(); } finally { setGeneratingInsights(false); }
              }}
              onStepComplete={async () => {
                if (!currentStep) return;
                try { await api.completePriorityStep(currentStep.id, true); } catch {}
                await loadPriorities();
              }}
              onStepSkip={async () => {
                if (!currentStep) return;
                try { await api.skipPriorityStep(currentStep.id, true); } catch {}
                await loadPriorities();
              }}
              onStepUnskip={async () => {
                if (!currentStep) return;
                try { await api.skipPriorityStep(currentStep.id, false); } catch {}
                await loadPriorities();
              }}
              onStepHelp={() => {
                if (!currentStep) return;
                const prompt = `Help me with: ${currentStep.title}. ${currentStep.subtitle ?? ''}`.trim();
                openChat(prompt);
              }}
              onActionDone={async (id) => {
                try { await api.actOnInsight(id); } catch {}
                await reloadInsights();
              }}
              onSetupProfile={() => setLocation('/profile')}
            />
          </div>

          {/* ░░░░ RIGHT COLUMN (1/3) ░░░░ */}
          <aside className="min-w-0 flex flex-col gap-[18px]">
            <NetWorthChart history={nwHistory} monthDelta={monthDelta} netWorth={breakdown.netWorth} />
            <AskComposer
              value={askDraft}
              onChange={setAskDraft}
              onSubmit={submitAsk}
              prompts={suggestedPrompts}
              onPick={(q) => openChat(q)}
            />
            <GoalsRail goals={goals} loading={loading} />
          </aside>
        </div>
      )}

      {/* Upcoming bill — a single marginalia note when one is due soon */}
      {upcomingBill && (
        <MarginaliaBill
          bill={upcomingBill}
          account={upcomingBill.accountId ? accountsById.get(upcomingBill.accountId) ?? null : null}
        />
      )}
    </div>
  );
}

// ─── Card shell ────────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-ui-xl border border-line bg-panel shadow-ui-sm ${className}`}>
      {children}
    </section>
  );
}

// ─── Net-worth breakdown — vertical assets / debt equation ──────────────────────

type CompSegment = { key: string; label: string; value: number; count: number; color: string };

/** One "What you own / owe" column: a proportional stacked bar + name·value·% legend. */
function CompositionColumn({
  title, accountCount, segments, total, ariaLabel,
}: {
  title: string;
  accountCount: number;
  segments: CompSegment[];
  total: number;
  ariaLabel: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-content-muted">{title}</span>
        <span className="text-[12px] font-semibold text-content-muted">{accountCount} account{accountCount === 1 ? '' : 's'}</span>
      </div>
      <div
        className="flex gap-[2px] h-[10px] rounded-full overflow-hidden"
        style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.32)' }}
        role="img"
        aria-label={ariaLabel}
      >
        {segments.map((s) => {
          const pct = Math.round((s.value / (total || 1)) * 100);
          return (
            <div
              key={s.key}
              className="h-full"
              style={{ flexGrow: s.value, minWidth: 4, background: s.color }}
              title={`${s.label} · ${pct}%`}
            />
          );
        })}
      </div>
      {/* legend — name · value · % */}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 ui-tnum">
        {segments.map((s) => {
          const pct = Math.round((s.value / (total || 1)) * 100);
          return (
            <span key={s.key} className="inline-flex items-center gap-2 text-[13px]">
              <span className="w-[9px] h-[9px] rounded-[3px] shrink-0" style={{ background: s.color }} />
              <span className="font-bold">{s.label}</span>
              <span className="font-editorial font-extrabold tracking-[-0.01em]">{fmtUsd(s.value)}</span>
              <span className="text-[12px] font-semibold text-content-muted">{pct}% · {s.count} acct{s.count === 1 ? '' : 's'}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function NetWorthBreakdown({
  breakdown, monthDelta, onOpenMoney,
}: {
  breakdown: NetBreakdown;
  monthDelta: number | null;
  onOpenMoney: () => void;
}) {
  const assetTotal = breakdown.cash + breakdown.investments + breakdown.assets;
  const assetAccounts = breakdown.cashCount + breakdown.investmentsCount + breakdown.assetsCount;

  // Assets stacked-bar segments (Cash · Investments · Property) — proportional.
  const segments = [
    breakdown.cash > 0 && { key: 'cash', label: 'Cash', value: breakdown.cash, count: breakdown.cashCount, color: 'var(--ui-viz-1)' },
    breakdown.investments > 0 && { key: 'inv', label: 'Investments', value: breakdown.investments, count: breakdown.investmentsCount, color: 'var(--ui-viz-2)' },
    breakdown.assets > 0 && { key: 'prop', label: assetsLabel(breakdown), value: breakdown.assets, count: breakdown.assetsCount, color: 'var(--ui-viz-5)' },
  ].filter(Boolean) as CompSegment[];

  // Debt stacked-bar segments (Credit cards · Loans) — warm/coral, reads as liability.
  const debtSegments = [
    breakdown.creditCards > 0 && { key: 'cc', label: 'Credit cards', value: breakdown.creditCards, count: breakdown.creditCardsCount, color: '#F97316' },
    breakdown.loans > 0 && { key: 'loans', label: 'Loans', value: breakdown.loans, count: breakdown.loansCount, color: 'var(--ui-viz-4)' },
  ].filter(Boolean) as CompSegment[];

  return (
    <Card className="relative overflow-hidden p-6 sm:p-7 animate-fade-in" >
      {/* atmospheric wash */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 100% 0%, var(--ui-info-soft), transparent 56%),' +
            'radial-gradient(90% 70% at 0% 8%, var(--ui-accent-softer), transparent 60%)',
        }}
      />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2 className="font-editorial text-[21px] sm:text-[22px] font-bold tracking-[-0.02em]">Where your wealth stands</h2>
          <p className="mt-1 text-[13.5px] font-medium text-content-muted max-w-[52ch]">
            What you own, minus what you owe — across {assetAccounts + breakdown.debtsCount} connected account{assetAccounts + breakdown.debtsCount === 1 ? '' : 's'}.
          </p>
        </div>
        <button
          onClick={onOpenMoney}
          className="self-start shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-ui-md text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow]"
        >
          Open Money <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mt-6">
        {/* Mobile: statement rows fill the width (label left, value right); the
            rule marks net worth as the own − owe total. Desktop keeps the
            single-line equation below. */}
        <div className="sm:hidden">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-content-muted">Assets</span>
            <span className="font-editorial text-[26px] font-extrabold tracking-[-0.02em] leading-none ui-tnum">{fmtUsd(assetTotal)}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'rgb(var(--ui-negative))' }}>Debt</span>
            <span className="font-editorial text-[26px] font-extrabold tracking-[-0.02em] leading-none ui-tnum" style={{ color: 'rgb(var(--ui-negative))' }}>{fmtUsd(breakdown.debts)}</span>
          </div>
          <div className="mt-3 pt-3 border-t border-line flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-brand">Net worth</span>
            <span className="font-editorial text-[31px] font-extrabold tracking-[-0.03em] leading-none text-brand ui-tnum">{fmtUsd(breakdown.netWorth)}</span>
          </div>
          {monthDelta !== null && (
            <div className="mt-2 flex justify-end">
              <DeltaChip delta={monthDelta} suffix="30d" />
            </div>
          )}
        </div>

        {/* Assets − Debt = Net worth — one horizontal line on desktop */}
        <div className="hidden sm:flex sm:items-end gap-x-6 lg:gap-x-9 sm:flex-wrap">
          {/* ASSETS */}
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-content-muted">Assets · what you own</div>
            <div className="mt-1 font-editorial text-[27px] sm:text-[30px] font-extrabold tracking-[-0.02em] leading-none ui-tnum">
              {fmtUsd(assetTotal)}
            </div>
          </div>

          <div aria-hidden className="hidden sm:block pb-[4px] font-editorial font-semibold text-[24px] sm:text-[26px] leading-none text-content-faint">−</div>

          {/* DEBT — coral, minus already implied by the operator */}
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em]" style={{ color: 'rgb(var(--ui-negative))' }}>Debt · what you owe</div>
            <div
              className="mt-1 font-editorial text-[27px] sm:text-[30px] font-extrabold tracking-[-0.02em] leading-none ui-tnum"
              style={{ color: 'rgb(var(--ui-negative))' }}
            >
              {fmtUsd(breakdown.debts)}
            </div>
          </div>

          <div aria-hidden className="hidden sm:block pb-[4px] font-editorial font-semibold text-[24px] sm:text-[26px] leading-none text-content-faint">=</div>

          {/* NET WORTH — the confident payoff; same label+number structure as
              Assets/Debt so all three numbers share a baseline under items-end. */}
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-brand">Net worth</div>
            <div className="mt-1 flex items-end gap-x-2.5 gap-y-2 flex-wrap">
              <span className="font-editorial text-[30px] sm:text-[34px] font-extrabold tracking-[-0.03em] leading-none text-brand ui-tnum">
                {fmtUsd(breakdown.netWorth)}
              </span>
              {monthDelta !== null && <DeltaChip delta={monthDelta} suffix="30d" />}
            </div>
          </div>
        </div>

        {/* Composition — what you own vs what you owe, itemized side by side
            on desktop (stacked on mobile). Each: a proportional bar + legend. */}
        <div className="mt-7 pt-6 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-7">
          <CompositionColumn
            title="What you own"
            accountCount={assetAccounts}
            segments={segments}
            total={assetTotal}
            ariaLabel="Assets composition bar"
          />
          <CompositionColumn
            title="What you owe"
            accountCount={breakdown.debtsCount}
            segments={debtSegments}
            total={breakdown.debts}
            ariaLabel="Debt composition bar"
          />
        </div>
      </div>
    </Card>
  );
}

// ─── Three moves queue ──────────────────────────────────────────────────────────

const ACCENT = {
  brand: { text: 'rgb(var(--ui-accent-ink))', bar: 'rgb(var(--ui-accent))', soft: 'var(--ui-accent-soft)', border: 'var(--ui-accent-soft)' },
  negative: { text: 'rgb(var(--ui-negative))', bar: 'var(--ui-viz-4)', soft: 'var(--ui-negative-soft)', border: 'var(--ui-negative-soft)' },
  caution: { text: 'rgb(var(--ui-caution))', bar: 'var(--ui-viz-3)', soft: 'var(--ui-caution-soft)', border: 'var(--ui-caution-soft)' },
} as const;

type AccentKey = keyof typeof ACCENT;

function urgencyAccent(urgency: string): { accent: AccentKey; label: string } {
  if (urgency === 'critical' || urgency === 'high') return { accent: 'negative', label: 'High priority' };
  if (urgency === 'medium') return { accent: 'caution', label: 'Worth doing' };
  return { accent: 'brand', label: 'When you can' };
}

/** One numbered move card with the timeline node. */
function MoveCard({
  node, accent, tag, tagIcon, title, why, impactVal, impactLab, progress, progressDetail, footer,
}: {
  node: React.ReactNode;
  accent: AccentKey;
  tag: string;
  tagIcon?: React.ReactNode;
  title: string;
  why?: React.ReactNode;
  impactVal?: string;
  impactLab?: string;
  progress?: number;
  progressDetail?: string | null;
  footer: React.ReactNode;
}) {
  const a = ACCENT[accent];
  return (
    <article className="relative pl-[50px]">
      {/* timeline node */}
      <div
        className="absolute left-0 top-[22px] w-10 h-10 rounded-[13px] grid place-items-center font-editorial font-extrabold text-[17px] bg-panel shadow-ui-sm z-[2]"
        style={{ color: a.text, border: `2px solid ${a.border}` }}
      >
        {node}
      </div>
      <div className="relative overflow-hidden rounded-ui-lg border border-line bg-panel shadow-ui-sm p-[18px_20px] sm:p-[22px_24px] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-ui-md">
        <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: a.bar }} />
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-5">
          <div className="flex-1 min-w-0">
            <span
              className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-[11px] font-extrabold uppercase tracking-[0.05em] mb-3"
              style={{ background: a.soft, color: a.text }}
            >
              {tagIcon}{tag}
            </span>
            <h3 className="font-editorial text-[18px] sm:text-[20px] font-bold leading-[1.2] tracking-[-0.018em]">{title}</h3>
            {why && <p className="mt-2 text-[14px] leading-[1.5] text-content-secondary line-clamp-3 max-w-[50ch]">{why}</p>}
          </div>
          {impactVal && (
            <div className="w-full sm:w-auto flex items-baseline gap-1.5 sm:block border-t border-line pt-2.5 sm:border-t-0 sm:pt-0 text-left sm:text-right shrink-0 sm:pl-2.5 sm:min-w-[88px]">
              <div className="font-editorial text-[22px] sm:text-[27px] font-extrabold tracking-[-0.02em] leading-none ui-tnum" style={{ color: a.text }}>
                {impactVal}
              </div>
              {impactLab && <div className="text-[12px] font-semibold text-content-muted sm:mt-1.5">{impactLab}</div>}
            </div>
          )}
        </div>
        {progress != null && progress > 0 && (
          <div className="mt-3.5">
            <Track pct={progress} color="rgb(var(--ui-brand))" />
            {progressDetail && <div className="mt-2 text-[12px] font-semibold text-content-muted ui-tnum">{progressDetail}</div>}
          </div>
        )}
        <div className="flex items-center gap-2 mt-4 flex-wrap">{footer}</div>
      </div>
    </article>
  );
}

function MovesQueue({
  step, actions, levelLoading, generating,
  onOpenInsight, onGenerateActions,
  onStepComplete, onStepSkip, onStepUnskip, onStepHelp, onActionDone, onSetupProfile,
}: {
  step: LevelStep | null;
  actions: InsightLike[];
  levelLoading: boolean;
  generating: boolean;
  onOpenInsight: (id: string) => void;
  onGenerateActions: () => void | Promise<void>;
  onStepComplete: () => void | Promise<void>;
  onStepSkip: () => void | Promise<void>;
  onStepUnskip: () => void | Promise<void>;
  onStepHelp: () => void;
  onActionDone: (id: string) => void | Promise<void>;
  onSetupProfile: () => void;
}) {
  const [stepBusy, setStepBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [justSkipped, setJustSkipped] = useState(false);

  if (levelLoading) {
    return (
      <div className="mt-6 relative pl-[50px] flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-ui-lg border border-line bg-panel shadow-ui-sm p-6">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="mt-3 h-5 w-3/4" />
            <Skeleton className="mt-2 h-4 w-full" />
            <Skeleton className="mt-4 h-9 w-32 rounded-ui-md" />
          </div>
        ))}
      </div>
    );
  }

  // Nothing at all → onboarding affordance.
  if (!step && actions.length === 0) {
    return (
      <div className="mt-6">
        <Card className="p-6 sm:p-7">
          <h3 className="font-editorial text-[20px] font-bold tracking-[-0.018em]">Set up your financial profile</h3>
          <p className="mt-2 mb-4 text-[14px] leading-relaxed text-content-secondary">
            Tell us the basics and we'll show you exactly what to do next.
          </p>
          <Button size="sm" onClick={onSetupProfile} trailingIcon={<ArrowRight className="h-4 w-4" />}>
            Get started
          </Button>
        </Card>
      </div>
    );
  }

  const isStepComplete = step?.status === 'complete';
  const stepProgress = step ? Math.max(0, Math.min(100, Math.round(step.progress || 0))) : 0;
  const stepDetail =
    step?.current != null && step?.target != null
      ? `${formatMoneyShort(step.current)} of ${formatMoneyShort(step.target)}`
      : null;

  return (
    <div className="mt-6 relative">
      {/* connecting rail */}
      <div
        className="absolute left-[19px] top-[30px] bottom-[28px] w-[2.5px] rounded-full"
        style={{ background: 'linear-gradient(180deg, var(--ui-line), var(--ui-hairline) 86%, transparent)' }}
      />
      <div className="relative flex flex-col gap-4">
        {step && (
          <MoveCard
            node="1"
            accent="brand"
            tag={`Level ${step.order}`}
            tagIcon={<Check className="h-3 w-3" />}
            title={step.title}
            why={step.description || step.subtitle}
            impactVal={isStepComplete ? '✓' : `${stepProgress}%`}
            impactLab={isStepComplete ? 'complete' : 'progress'}
            progress={isStepComplete ? 0 : stepProgress}
            progressDetail={stepDetail}
            footer={
              <>
                <Button size="sm" disabled={stepBusy} onClick={onStepHelp} trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                  Start
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={stepBusy}
                  onClick={async () => {
                    setStepBusy(true);
                    try { await onStepComplete(); } finally { setStepBusy(false); }
                  }}
                >
                  {stepBusy ? '…' : 'I did it'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={stepBusy}
                  onClick={async () => {
                    setStepBusy(true);
                    try {
                      await onStepSkip();
                      setJustSkipped(true);
                      setTimeout(() => setJustSkipped(false), 4000);
                    } finally { setStepBusy(false); }
                  }}
                >
                  Skip
                </Button>
                {justSkipped && (
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-content-secondary underline underline-offset-2 hover:text-brand"
                    onClick={async () => {
                      setStepBusy(true);
                      try { await onStepUnskip(); setJustSkipped(false); } finally { setStepBusy(false); }
                    }}
                  >
                    Skipped · Undo
                  </button>
                )}
              </>
            }
          />
        )}

        {actions.map((a, i) => {
          const { accent, label } = urgencyAccent(a.urgency);
          const busy = actionBusy === a.id;
          return (
            <MoveCard
              key={a.id}
              node={String((step ? 1 : 0) + i + 1)}
              accent={accent}
              tag={label}
              title={a.title}
              why={a.description}
              footer={
                <>
                  <Button size="sm" onClick={() => onOpenInsight(a.id)} trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                    View details
                  </Button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setActionBusy(a.id);
                      try { await onActionDone(a.id); } finally { setActionBusy(null); }
                    }}
                    className="h-9 px-3.5 rounded-ui-md text-[13px] font-semibold text-content-secondary hover:bg-brand-softer hover:text-content transition-colors disabled:opacity-60"
                  >
                    {busy ? '…' : 'I did it'}
                  </button>
                </>
              }
            />
          );
        })}

        {/* No insights yet → generate affordance (keeps the queue useful). */}
        {actions.length === 0 && step && (
          <div className="relative pl-[50px]">
            <div
              className="absolute left-0 top-[18px] w-10 h-10 rounded-[13px] grid place-items-center bg-panel shadow-ui-sm z-[2] text-content-muted"
              style={{ border: '2px solid var(--ui-hairline)' }}
            >
              <Sparkles className="h-[18px] w-[18px]" />
            </div>
            <div className="rounded-ui-lg border border-dashed border-line-strong bg-panel p-5 flex items-center justify-between gap-4 flex-wrap">
              <span className="text-[13.5px] text-content-muted">Want more? Get personalized actions based on your finances.</span>
              <Button size="sm" disabled={generating} onClick={onGenerateActions}>
                {generating ? 'Generating…' : 'Generate actions'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 30-day net-worth chart (real axes) ─────────────────────────────────────────

function NetWorthChart({
  history, monthDelta, netWorth,
}: {
  history: { date: string; value: number }[];
  monthDelta: number | null;
  netWorth: number;
}) {
  const VB_W = 340, VB_H = 210;
  const chart = useMemo(() => {
    if (history.length < 2) return null;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let pts = history.filter((p) => new Date(p.date).getTime() >= cutoff);
    if (pts.length < 2) pts = history.slice(-31);

    const values = pts.map((p) => p.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.12;
    min -= pad; max += pad;

    // plot area inside the 340×210 viewBox
    const X0 = 40, X1 = 330, Y0 = 16, Y1 = 180;
    const sx = (i: number) => X0 + (i / (pts.length - 1)) * (X1 - X0);
    const sy = (v: number) => Y1 - ((v - min) / (max - min)) * (Y1 - Y0);

    const coords = pts.map((p, i) => ({ x: sx(i), y: sy(p.value), value: p.value, date: p.date }));
    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const area = `${line} L${X1},${Y1} L${X0},${Y1} Z`;

    // Y gridlines (4 ticks)
    const yTicks = [0, 1, 2, 3].map((k) => {
      const v = max - (k / 3) * (max - min);
      return { y: Y0 + (k / 3) * (Y1 - Y0), label: formatMoneyShort(v) };
    });

    return {
      line, area, coords,
      lastX: sx(pts.length - 1), lastY: sy(pts[pts.length - 1].value),
      yTicks,
      firstDate: formatDateShort(new Date(pts[0].date)),
      lastDate: formatDateShort(new Date(pts[pts.length - 1].date)),
      X0, X1, Y0, Y1,
    };
  }, [history]);

  const down = (monthDelta ?? 0) < 0;
  const stroke = down ? 'rgb(var(--ui-negative))' : 'rgb(var(--ui-positive))';
  const pctChange = monthDelta != null && netWorth !== 0
    ? (monthDelta / (netWorth - monthDelta)) * 100
    : null;

  // Hover crosshair — snaps to the nearest data point (mouse/touch only;
  // chart stays fully readable without hover and for keyboard users).
  const svgRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const pointerToIdx = (clientX: number): number | null => {
    const root = svgRef.current;
    if (!root || !chart || chart.coords.length === 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const vbX = ((clientX - rect.left) / rect.width) * VB_W;
    const ratio = (vbX - chart.X0) / Math.max(1, chart.X1 - chart.X0);
    return Math.min(chart.coords.length - 1, Math.max(0, Math.round(ratio * (chart.coords.length - 1))));
  };
  const hovered = chart && hoverIdx !== null ? chart.coords[hoverIdx] : null;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-editorial text-[16px] font-bold tracking-[-0.012em]">Net worth · last 30 days</div>
          <div className="mt-0.5 text-[12px] font-semibold text-content-muted">
            {monthDelta != null
              ? `${monthDelta < 0 ? 'Down' : 'Up'} ${fmtUsd(Math.abs(monthDelta))} this month`
              : 'Tracking your trend'}
          </div>
        </div>
        {pctChange != null && (
          <span
            className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-full text-[12px] font-bold ui-tnum"
            style={{
              background: down ? 'var(--ui-negative-soft)' : 'var(--ui-positive-soft)',
              color: stroke,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {down ? <path d="M12 17 5 9h14z" /> : <path d="M12 7l7 8H5z" />}
            </svg>
            {down ? '−' : '+'}{Math.abs(pctChange).toFixed(1)}%
          </span>
        )}
      </div>

      {chart ? (
        <div ref={svgRef} className="relative mt-4 select-none">
          <svg className="w-full h-auto overflow-visible block" viewBox="0 0 340 210" role="img" aria-label="Net worth over the last 30 days" style={{ pointerEvents: 'none' }}>
            <defs>
              <linearGradient id="nwArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={stroke} stopOpacity="0.20" />
                <stop offset="1" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Y axis + gridlines + labels */}
            <line x1={chart.X0} y1={chart.Y0} x2={chart.X0} y2={chart.Y1} stroke="var(--ui-line)" strokeWidth="1.2" />
            {chart.yTicks.map((t, i) => (
              <g key={i}>
                <line x1={chart.X0} y1={t.y} x2={chart.X1} y2={t.y} stroke="var(--ui-hairline)" strokeWidth="1" />
                <text x={chart.X0 - 5} y={t.y + 3} textAnchor="end" className="ui-tnum" fontSize="12" fontWeight="600" fill="rgb(var(--ui-content-muted))">{t.label}</text>
              </g>
            ))}
            <line x1={chart.X0} y1={chart.Y1} x2={chart.X1} y2={chart.Y1} stroke="var(--ui-line)" strokeWidth="1.2" />
            {/* trend */}
            <path d={chart.area} fill="url(#nwArea)" />
            <path d={chart.line} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            {/* hover crosshair + marker, else the trailing point */}
            {hovered ? (
              <g>
                <line x1={hovered.x} y1={chart.Y0} x2={hovered.x} y2={chart.Y1} stroke="rgb(var(--ui-content-muted))" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 4" />
                <circle cx={hovered.x} cy={hovered.y} r="7" fill={stroke} fillOpacity="0.18" />
                <circle cx={hovered.x} cy={hovered.y} r="4" fill={stroke} stroke="rgb(var(--ui-panel))" strokeWidth="2" />
              </g>
            ) : (
              <circle cx={chart.lastX} cy={chart.lastY} r="3.6" fill={stroke} />
            )}
            {/* X labels */}
            <text x={chart.X0} y="197" textAnchor="start" className="ui-tnum" fontSize="12" fontWeight="600" fill="rgb(var(--ui-content-muted))">{chart.firstDate}</text>
            <text x={chart.X1} y="197" textAnchor="end" className="ui-tnum" fontSize="12" fontWeight="600" fill="rgb(var(--ui-content-muted))">{chart.lastDate}</text>
          </svg>

          {/* Tooltip — positioned by viewBox percentage so it tracks the point across any width */}
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-ui-md border border-line bg-panel-raised px-2.5 py-1.5 shadow-ui-md whitespace-nowrap"
              style={{
                left: `${(hovered.x / VB_W) * 100}%`,
                top: `${(hovered.y / VB_H) * 100}%`,
                transform: 'translate(-50%, calc(-100% - 10px))',
              }}
            >
              <div className="text-[11px] font-semibold text-content-muted">
                {new Date(hovered.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
              <div className="text-[13.5px] font-extrabold text-content ui-tnum">{fmtUsd(hovered.value)}</div>
            </div>
          )}

          {/* Pointer overlay — snaps hover to the nearest x-domain point */}
          <div
            className="absolute inset-0"
            style={{ touchAction: 'none', cursor: 'crosshair' }}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
            onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
            onPointerLeave={() => setHoverIdx(null)}
            onPointerCancel={() => setHoverIdx(null)}
          />
        </div>
      ) : (
        <div className="mt-4 h-[150px] grid place-items-center text-[13px] text-content-muted">
          Not enough history yet — check back in a few days.
        </div>
      )}
    </Card>
  );
}

// ─── Ask Lasagna composer ───────────────────────────────────────────────────────

function AskComposer({
  value, onChange, onSubmit, prompts, onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  prompts: string[];
  onPick: (q: string) => void;
}) {
  return (
    <section
      className="relative overflow-hidden rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5"
      aria-label="Ask Lasagna"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(80% 130% at 0% 0%, var(--ui-accent-softer), transparent 58%),' +
            'radial-gradient(70% 130% at 100% 0%, var(--ui-info-soft), transparent 64%)',
        }}
      />
      <div className="relative mb-3 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--ui-accent-ink))]" aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted">Ask Lasagna</span>
      </div>
      <form onSubmit={onSubmit} className="relative">
        <label className="flex items-center gap-2 h-[52px] pl-4 pr-1.5 rounded-[14px] bg-canvas-sunken border-[1.5px] border-transparent focus-within:bg-panel focus-within:border-brand focus-within:ring-4 focus-within:ring-brand-soft transition-[background,border-color,box-shadow]">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Ask about your money…"
            className="flex-1 min-w-0 h-full bg-transparent outline-none text-[15px] font-semibold text-content placeholder:font-medium placeholder:text-content-muted"
            autoComplete="off"
            aria-label="Ask Lasagna a question"
          />
          <button
            type="submit"
            className="shrink-0 grid place-items-center w-10 h-10 rounded-full bg-brand-soft text-[rgb(var(--ui-brand-ink))] hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow]"
            aria-label="Ask Lasagna"
          >
            <ArrowRight className="h-[18px] w-[18px]" />
          </button>
        </label>
      </form>

      {prompts.length > 0 && (
        <div className="relative mt-3 flex flex-wrap gap-2">
          {prompts.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onPick(q)}
              className="inline-flex max-w-full items-center min-h-[36px] px-3.5 rounded-full bg-panel border border-line-strong text-[13px] font-semibold text-content-secondary hover:bg-brand-soft hover:border-transparent hover:text-brand active:scale-[0.98] transition-[background,color,border-color,transform]"
            >
              <span className="truncate">{q}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Goals rail ──────────────────────────────────────────────────────────────────

function GoalsRail({ goals, loading }: { goals: Goal[]; loading?: boolean }) {
  const active = goals.filter((g) => g.status === 'active');

  if (loading) {
    return (
      <Card className="p-[22px]">
        <div className="text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted mb-2">Goals</div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="mt-4">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-2.5 h-2 w-full rounded-full" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </Card>
    );
  }

  if (active.length === 0) {
    return (
      <Card className="p-[22px]">
        <div className="text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted mb-2.5">Goals</div>
        <p className="text-[14px] text-content-muted">
          No active goals yet.{' '}
          <Link href="/goals" className="font-semibold text-brand hover:underline">Set a savings goal →</Link>
        </p>
      </Card>
    );
  }

  const shown = active.slice(0, 4);

  return (
    <Card className="p-[22px]">
      <div className="flex items-baseline justify-between">
        <div className="text-[11px] font-bold uppercase tracking-[0.11em] text-content-muted">Goals</div>
        <Link href="/goals" className="text-[12.5px] font-semibold text-content-muted hover:text-brand transition-colors">View all</Link>
      </div>
      <ul>
        {shown.map((g) => {
          const target = parseFloat(g.targetAmount);
          const current = parseFloat(g.currentAmount);
          const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
          const reached = target > 0 && current >= target;
          const notStarted = current <= 0;
          const color = goalColor(g.category);
          return (
            <li
              key={g.id}
              className={reached ? 'mt-4 -mx-2.5 px-3 py-3.5 rounded-ui-md' : 'mt-[18px] first:mt-4'}
              style={reached ? { background: 'linear-gradient(135deg, var(--ui-brand-soft), transparent 70%)' } : undefined}
            >
              <Link href={`/plans/savings/${g.id}`} className="block no-underline text-inherit group">
                <div className="flex items-baseline justify-between gap-2.5">
                  <span className="flex items-center gap-2 min-w-0 text-[14px] font-bold">
                    {reached && (
                      <span className="w-4 h-4 rounded-full grid place-items-center text-white bg-brand shrink-0">
                        <Check className="h-[11px] w-[11px]" />
                      </span>
                    )}
                    <span className="truncate group-hover:text-brand transition-colors">{g.name}</span>
                  </span>
                  {reached ? (
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-brand bg-panel px-2 py-0.5 rounded-full shadow-ui-sm shrink-0">Funded</span>
                  ) : (
                    <span className="font-editorial text-[13px] font-extrabold text-content-muted shrink-0 ui-tnum">{Math.round(pct)}%</span>
                  )}
                </div>
                <div className="mt-2.5">
                  <Track
                    pct={reached ? 100 : Math.max(pct, notStarted ? 2 : pct)}
                    color={reached ? 'linear-gradient(90deg, var(--ui-viz-1), rgb(var(--ui-brand)))' : color}
                    shine={reached}
                  />
                </div>
                <div className="mt-2 text-[12px] font-semibold text-content-muted ui-tnum">
                  {reached
                    ? 'Fully funded — surplus ready to reallocate 🎉'
                    : notStarted
                      ? 'Not started yet — kick it off anytime'
                      : <>{formatCurrency(current)} of {formatCurrency(target)}</>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ─── Upcoming bill marginalia ────────────────────────────────────────────────────

function MarginaliaBill({ bill, account }: { bill: BillCard; account: { name: string; balance: number } | null }) {
  const when = bill.daysAway <= 0 ? 'today' : bill.daysAway === 1 ? 'tomorrow' : `in ${bill.daysAway} days`;
  const covered = account ? account.balance >= bill.amount : null;
  return (
    <Card className="mt-7 px-3.5 py-4 sm:p-6 max-w-[760px]">
      <div className="flex items-center gap-2 text-[15px] font-bold">
        <ChevronRight className="h-4 w-4 text-content-faint" />
        {bill.name} · <span className="ui-tnum">{fmtUsd(bill.amount)}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">
        Due {when}
        {account && (
          <>
            {' '}from {account.name}.{' '}
            {covered ? (
              <>You're covered — balance <span className="ui-tnum">{fmtUsd(account.balance)}</span>.</>
            ) : (
              <span style={{ color: 'rgb(var(--ui-negative))' }}>
                Balance <span className="ui-tnum">{fmtUsd(account.balance)}</span> may not cover.
              </span>
            )}
          </>
        )}
      </p>
    </Card>
  );
}
