import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, ChevronRight, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useInsights } from '../hooks/useInsights';
import { api, type FinancialPath } from '../lib/api';
import { useChatStore } from '../lib/chat-store';
import { Button, Skeleton, useToast } from '../components/uikit';
import { ActionItem } from '../components/common/action-item';
import { levelStateOf, SegmentedRail, LegendSwatch } from '../components/common/level-rail';

// Shared style for "go to this page" affordances on the home page, so every page
// link reads as the same soft-brand button as the hero's Open Money.
const pageLinkCls =
  'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-ui-md text-[13.5px] font-bold text-[rgb(var(--ui-brand-ink))] bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm transition-[transform,box-shadow]';
import { smoothLinePath, niceTicks, pickXLabels, formatShortMoney, tickDecimals } from '../components/ds/TrendChart';
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
  kind: string;
  title: string;
  subtitle: string;
  description: string;
  status: string;
  progress: number;
  action: string;
  current: number | null;
  target: number | null;
}

interface MonthFlow {
  spending: number;
  income: number;
  net: number;
  /** Spend through the same day of the previous month, for the trend line. */
  prevSpending: number | null;
  topCats: { id: string; name: string; total: number; pct: number }[];
}

interface RecentTxn {
  id: string;
  name: string;
  date: string;
  amount: number;
  pending: boolean;
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

const formatDateShort = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function greetingForHour(h: number) {
  if (h < 5) return 'Good evening'; // overnight reads as late night, not morning
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
      {positive ? '+' : '−'}{fmtUsd(Math.abs(delta))}{suffix ? ` (${suffix})` : ''}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SimpleHome() {
  const { user, tenant } = useAuth();
  const [, setLocation] = useLocation();
  const { openChat } = useChatStore();
  const toast = useToast();
  const { insights, refresh: refreshInsights, dismiss, isLoading: insightsLoading } = useInsights();
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [breakdown, setBreakdown] = useState<NetBreakdown | null>(null);
  const [accountsById, setAccountsById] = useState<Map<string, { name: string; balance: number }>>(new Map());
  const [goals, setGoals] = useState<Goal[]>([]);
  const [nwHistory, setNwHistory] = useState<{ date: string; value: number }[]>([]);
  const [upcomingBill, setUpcomingBill] = useState<BillCard | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [currentStep, setCurrentStep] = useState<LevelStep | null>(null);
  const [levelSteps, setLevelSteps] = useState<{ id: string; order: number; title: string; status: string }[]>([]);
  const [levelCurrentId, setLevelCurrentId] = useState<string>('');
  const [levelLoading, setLevelLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [monthFlow, setMonthFlow] = useState<MonthFlow | null>(null);
  const [recentTxns, setRecentTxns] = useState<RecentTxn[]>([]);
  const [sideLoading, setSideLoading] = useState(true);

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

  // The same endpoint /financial-level reads, and the server's own answer for
  // where this person stands. Home used to run off a second endpoint with a
  // second idea of "you are here", which is two things that can disagree about
  // one fact. There is now one.
  const applyPath = useCallback((path: FinancialPath) => {
    const { steps, currentStepId } = path;
    const found = steps.find((s) => s.id === currentStepId) ?? steps[0];
    setCurrentStep(
      found
        ? {
            id: found.id,
            order: found.order,
            kind: found.kind,
            title: found.title,
            subtitle: found.subtitle,
            description: found.description,
            status: found.status,
            progress: found.progress,
            action: found.action,
            current: found.current,
            target: found.target,
          }
        : null,
    );
    setLevelSteps(steps.map((s) => ({ id: s.id, order: s.order, title: s.title, status: s.status })));
    setLevelCurrentId(currentStepId);
  }, []);

  const loadPath = useCallback(() => {
    return api
      .getFinancialPath()
      .then(applyPath)
      .catch(() => { setCurrentStep(null); setLevelSteps([]); });
  }, [applyPath]);

  const markCurrentStep = useCallback(
    async (status: 'done' | 'not_applicable' | 'pending') => {
      const step = currentStep;
      if (!step) return;
      try {
        applyPath(await api.markPathStep(step.id, status));
        // Both marks move the card on to a different step, so without this the
        // one they acted on is off the screen, unnamed, with no way back. The
        // step card on /financial-level says the same thing the same way.
        if (status !== 'pending') {
          toast({
            title:
              status === 'done'
                ? `${step.title} is done`
                : `${step.title} is off your path`,
            duration: 8000,
            // The uikit button, not a text link. Home moves the card on to the
            // next step, so once this toast expires there is no way back to the
            // one they just acted on at all, and it has to be a target a thumb
            // can hit. The negative margin cancels the button's own padding, so
            // the label lines up under the title rather than sitting indented.
            description: (
              <Button
                size="sm"
                variant="ghost"
                className="-ml-3.5"
                onClick={() => {
                  void api.markPathStep(step.id, 'pending').then(applyPath).catch(() => loadPath());
                }}
              >
                {status === 'done' ? 'Undo' : 'Put back'}
              </Button>
            ),
          });
        }
      } catch {
        toast({ tone: 'negative', title: "Couldn't update this step. Try again." });
        await loadPath();
      }
    },
    [applyPath, currentStep, loadPath, toast],
  );

  useEffect(() => {
    const BIG_CATEGORIES = new Set(['housing', 'debt_payment', 'transportation', 'insurance', 'utilities']);
    const BILL_MIN_AMOUNT = 200;

    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as any[] })),
      api.getGoals().catch(() => ({ goals: [] })),
      loadPath().finally(() => setLevelLoading(false)),
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
        // Effective balance = raw with the user's invert override applied, matching
        // the server's net-worth math. Skip accounts excluded from net worth so the
        // headline reconciles with the graph and the Money page.
        const v = b.effectiveBalance ?? (b.invertBalance ? -1 : 1) * parseFloat(b.balance ?? '0');
        map.set(b.accountId, { name: b.name, balance: Number.isNaN(v) ? 0 : v });
        if (Number.isNaN(v) || b.excludeFromNetWorth) continue;
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
  }, [loadPath]);

  // Side rail: month-to-date spending/cash-flow plus the latest transactions.
  useEffect(() => {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
    // Same point last month — clamp the day for short months.
    const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    const prevStart = `${prevMonthLastDay.getFullYear()}-${pad2(prevMonthLastDay.getMonth() + 1)}-01`;
    const prevSameDay = new Date(
      prevMonthLastDay.getFullYear(),
      prevMonthLastDay.getMonth(),
      Math.min(now.getDate(), prevMonthLastDay.getDate()),
    );

    Promise.all([
      api.getSpendingSummary({ startDate: monthStart, endDate: `${ymd(now)}T23:59:59` }).catch(() => null),
      api.getSpendingSummary({ startDate: prevStart, endDate: `${ymd(prevSameDay)}T23:59:59` }).catch(() => null),
      api.getTransactions({ limit: 4 }).catch(() => ({ transactions: [] as any[] })),
    ])
      .then(([cur, prev, txns]) => {
        if (cur) {
          const topCats = cur.categories
            .filter((c) => c.groupType === 'expense' && c.total > 0)
            .sort((a, b) => b.total - a.total)
            .slice(0, 3)
            .map((c) => ({
              id: c.id,
              name: c.name,
              total: c.total,
              pct: cur.totalSpending > 0 ? (c.total / cur.totalSpending) * 100 : 0,
            }));
          setMonthFlow({
            spending: cur.totalSpending,
            income: cur.totalIncome,
            net: cur.netCashFlow,
            prevSpending: prev ? prev.totalSpending : null,
            topCats,
          });
        }
        setRecentTxns(
          (txns.transactions || []).map((t: any) => ({
            id: t.id,
            name: t.merchantName || t.name,
            date: t.date,
            amount: parseFloat(t.amount),
            pending: !!t.pending,
          })),
        );
      })
      .finally(() => setSideLoading(false));
  }, []);

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
  // Three money moves — the top-ranked actions. The level step now lives in its
  // own section below, so it no longer takes a slot here.
  const sideActions = ranked.slice(0, 3);

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

  const moveCount = sideActions.length;

  return (
    <div className="cq-inline mx-auto max-w-[1180px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* Greeting */}
      <header className="animate-fade-in">
        <h1 className="font-editorial text-[26px] sm:text-[33px] font-bold leading-[1.05] tracking-[-0.025em] text-content">
          {greeting}, {firstName} <span className="inline-block origin-[70%_70%]">👋</span>
        </h1>
      </header>

      {/* First-paint skeleton — reserves the hero + grid footprint. */}
      {loading && !breakdown && (
        <div className="mt-7 home-hero-grid gap-7 items-start">
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

      {/* ════════ MAIN GRID — 2/3 (HERO + ACTIONS) + 1/3 (CHART/CHAT/GOALS) ════════
          Container-query grid: two columns only when the left column can hold
          the one-line net-worth equation — otherwise the aside wraps under. */}
      {breakdown && (
        <div className="mt-7 home-hero-grid gap-7 items-start">

          {/* ░░░░ LEFT COLUMN (2/3) — net-worth hero + the action queue ░░░░ */}
          <div className="min-w-0 flex flex-col">
            {hasComposition && (
              <div className="mb-7">
                <NetWorthBreakdown
                  breakdown={breakdown}
                  monthDelta={monthDelta}
                  onOpenMoney={() => setLocation('/money')}
                />
              </div>
            )}

            {/* The money moves — accordion action rows, consistent with every
                other page. */}
            <Card className="p-6 sm:p-7">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-editorial text-[21px] sm:text-[22px] font-bold leading-[1.1] tracking-[-0.02em]">
                    {moveCount > 1 ? `${moveCount} moves to make today` : 'Your next move'}
                  </h2>
                  <p className="mt-1 text-[13.5px] font-medium text-content-muted">
                    Lined up biggest-impact first: quick wins for your wealth.
                  </p>
                </div>
                <Link href="/insights" className={`shrink-0 ${pageLinkCls}`}>View all<ArrowRight className="h-4 w-4" /></Link>
              </div>

              {insightsLoading ? (
                <div className="mt-6 flex flex-col gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 rounded-ui-md border border-line bg-panel shadow-ui-sm pl-4 pr-2 py-2.5">
                      <Skeleton className="h-6 w-6 shrink-0 rounded-ui-sm" />
                      <Skeleton className="h-4 flex-1 max-w-[16rem]" />
                      <Skeleton className="h-5 w-16 rounded-ui-sm" />
                    </div>
                  ))}
                </div>
              ) : sideActions.length > 0 ? (
                <div className="mt-6 flex flex-col gap-2">
                  {sideActions.map((a) => (
                    <ActionItem
                      key={a.id}
                      title={a.title}
                      tag={(a.type ?? a.category ?? 'general').toUpperCase()}
                      description={a.description}
                      impact={a.impact ?? ''}
                      impactColor={(a.impactColor as 'green' | 'amber' | 'red') ?? 'amber'}
                      chatPrompt={a.chatPrompt ?? a.title}
                      onDismiss={() => dismiss(a.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-6 rounded-ui-lg border border-dashed border-line-strong bg-panel p-5 flex items-center justify-between gap-4 flex-wrap">
                  <span className="text-[13.5px] text-content-muted">Get personalized actions based on your finances.</span>
                  <Button
                    size="sm"
                    disabled={generatingInsights}
                    onClick={async () => {
                      setGeneratingInsights(true);
                      try { await refreshInsights(); } finally { setGeneratingInsights(false); }
                    }}
                  >
                    {generatingInsights ? 'Generating…' : 'Generate actions'}
                  </Button>
                </div>
              )}
            </Card>

            {/* Financial level — pulled out of the moves queue into its own section. */}
            <LevelSection
              className="mt-7"
              step={currentStep}
              steps={levelSteps}
              currentStepId={levelCurrentId}
              loading={levelLoading}
              onHelp={() => {
                if (!currentStep) return;
                const prompt = `Help me with: ${currentStep.title}. ${currentStep.subtitle ?? ''}`.trim();
                openChat(prompt);
              }}
              onDid={() => markCurrentStep('done')}
              onSetAside={() => markCurrentStep('not_applicable')}
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
            {sideLoading ? (
              <>
                <Skeleton className="h-[180px] w-full rounded-ui-xl" />
                <Skeleton className="h-[150px] w-full rounded-ui-xl" />
                <Skeleton className="h-[210px] w-full rounded-ui-xl" />
              </>
            ) : (
              <>
                {monthFlow && <SpendingPulse flow={monthFlow} />}
                {monthFlow && <CashFlowPulse flow={monthFlow} />}
                <RecentActivity txns={recentTxns} />
              </>
            )}
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
        <span className="text-[13px] font-semibold text-content-muted">{title}</span>
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
              title={`${s.label}, ${pct}%`}
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
              <span className="text-[12px] font-semibold text-content-muted">{pct}%, {s.count} account{s.count === 1 ? '' : 's'}</span>
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

  // One-line guarantee for the equation: measure its natural width at full
  // size and set --nws (a 0..1 type-scale) so it always fits the card. The
  // inline delta chip is dropped first — it buys ~115px before any shrink.
  const eqRef = useRef<HTMLDivElement>(null);
  const [eqFit, setEqFit] = useState({ scale: 1, hideChip: false });
  useLayoutEffect(() => {
    const row = eqRef.current;
    if (!row) return;
    const measure = () => {
      // Force full size + chip visible for a clean natural-width reading.
      row.style.setProperty('--nws', '1');
      row.classList.remove('nw-eq--tight');
      const avail = row.clientWidth;
      const natural = row.scrollWidth;
      let next = { scale: 1, hideChip: false };
      if (avail > 0 && natural > avail) {
        const chip = row.querySelector('.nw-chip > *');
        const chipW = chip ? chip.getBoundingClientRect().width + 10 : 0;
        const noChip = Math.max(1, natural - chipW);
        next = { scale: Math.min(1, (avail / noChip) * 0.99), hideChip: chipW > 0 };
      }
      // Apply imperatively (state equality may skip the re-render)…
      row.style.setProperty('--nws', String(next.scale));
      row.classList.toggle('nw-eq--tight', next.hideChip);
      // …and mirror into state so React re-renders keep the same values.
      setEqFit((prev) => (prev.scale === next.scale && prev.hideChip === next.hideChip ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [assetTotal, breakdown.debts, breakdown.netWorth, monthDelta]);

  return (
    <Card className="cq-inline relative overflow-hidden p-6 sm:p-7 animate-fade-in" >
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
            Your Net Worth across {assetAccounts + breakdown.debtsCount} connected account{assetAccounts + breakdown.debtsCount === 1 ? '' : 's'}.
          </p>
        </div>
        <button
          onClick={onOpenMoney}
          className={`self-start shrink-0 ${pageLinkCls}`}
        >
          Open Money <ArrowRight className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mt-6">
        {/* Mobile: statement rows fill the width (label left, value right); the
            rule marks net worth as the own − owe total. Desktop keeps the
            single-line equation below. */}
        <div className="nw-statement">
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

        {/* Assets − Debt = Net worth — always ONE line on desktop. Labels stay
            short ("Assets"/"Debt" — the composition headers below carry the
            own/owe phrasing); type size comes from the --nws scale set by the
            measuring effect above, so up to 9-digit values fit without
            wrapping. Font sizes/gaps live in index.css (.nw-* rules). */}
        <div
          ref={eqRef}
          className={`nw-equation items-end${eqFit.hideChip ? ' nw-eq--tight' : ''}`}
          style={{ '--nws': String(eqFit.scale) } as React.CSSProperties}
        >
          {/* ASSETS — no min-w-0 anywhere in the row: items must hold their
              natural width so the measuring effect reads a true scrollWidth. */}
          <div>
            <div className="nw-label font-extrabold uppercase tracking-[0.1em] text-content-muted">Assets</div>
            <div className="nw-num mt-1 font-editorial font-extrabold tracking-[-0.02em] leading-none ui-tnum">
              {fmtUsd(assetTotal)}
            </div>
          </div>

          {/* DEBT — coral, minus already implied by the operator */}
          <div className="nw-opgroup flex items-end">
            <div aria-hidden className="nw-op pb-[4px] font-editorial font-semibold leading-none text-content-faint">−</div>
            <div>
              <div className="nw-label font-extrabold uppercase tracking-[0.1em]" style={{ color: 'rgb(var(--ui-negative))' }}>Debt</div>
              <div
                className="nw-num mt-1 font-editorial font-extrabold tracking-[-0.02em] leading-none ui-tnum"
                style={{ color: 'rgb(var(--ui-negative))' }}
              >
                {fmtUsd(breakdown.debts)}
              </div>
            </div>
          </div>

          {/* NET WORTH — the confident payoff; same label+number structure as
              Assets/Debt so all three numbers share a baseline under items-end. */}
          <div className="nw-opgroup flex items-end">
            <div aria-hidden className="nw-op pb-[4px] font-editorial font-semibold leading-none text-content-faint">=</div>
            <div>
              <div className="nw-label font-extrabold uppercase tracking-[0.1em] text-brand">Net worth</div>
              <div className="mt-1 flex items-end gap-x-2.5">
                <span className="nw-num nw-num--total font-editorial font-extrabold tracking-[-0.03em] leading-none text-brand ui-tnum">
                  {fmtUsd(breakdown.netWorth)}
                </span>
                {monthDelta !== null && (
                  <span className="nw-chip">
                    <DeltaChip delta={monthDelta} suffix="30d" />
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Composition — what you own vs what you owe, itemized and stacked
            so the card stays narrow. Each: a proportional bar + legend. */}
        <div className="mt-7 pt-6 border-t border-line grid grid-cols-1 gap-y-7">
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

// ─── Financial level section ────────────────────────────────────────────────────

/** The financial-level standing, echoing the /financial-level hero (a level
 *  ladder), so it reads as its own thing — not another action card. */
function LevelSection({
  step, steps, currentStepId, loading, className = '',
  onHelp, onDid, onSetAside, onSetupProfile,
}: {
  step: LevelStep | null;
  steps: { id: string; order: number; title: string; status: string }[];
  currentStepId: string;
  loading: boolean;
  className?: string;
  onHelp: () => void;
  onDid: () => void | Promise<void>;
  onSetAside: () => void | Promise<void>;
  onSetupProfile: () => void;
}) {
  // Which mark is in flight. Calling a step done reopens the order, which takes
  // as long as a model call, so the control has to say it is working.
  const [busy, setBusy] = useState<null | 'done' | 'not_applicable'>(null);
  const working = busy !== null;

  const shell = (children: React.ReactNode) => (
    <section className={`relative rounded-ui-xl border border-line bg-panel shadow-ui-sm p-6 sm:p-7 ${className}`}>
      <div
        className="pointer-events-none absolute inset-0 rounded-ui-xl"
        style={{ background: 'radial-gradient(95% 80% at 0% 8%, var(--ui-brand-softer), transparent 60%)' }}
        aria-hidden
      />
      <div className="relative">{children}</div>
    </section>
  );

  const heading = (
    <div className="flex items-center justify-between gap-4">
      <h2 className="font-editorial text-[21px] sm:text-[22px] font-bold leading-[1.1] tracking-[-0.02em]">
        Your financial level
      </h2>
      <Link href="/financial-level" className={`shrink-0 ${pageLinkCls}`}>
        View all<ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );

  if (loading) {
    return shell(
      <>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-4 h-12 w-28" />
        <Skeleton className="mt-3 h-4 w-3/4" />
        <Skeleton className="mt-5 h-10 w-full rounded-ui-md" />
        <Skeleton className="mt-5 h-9 w-28 rounded-ui-md" />
      </>
    );
  }

  if (!step) {
    return shell(
      <>
        {heading}
        <p className="mt-2 mb-4 text-[14px] leading-relaxed text-content-secondary max-w-[52ch]">
          Tell us the basics and we'll map your next level and exactly what to do to reach it.
        </p>
        <Button size="sm" onClick={onSetupProfile} trailingIcon={<ArrowRight className="h-4 w-4" />}>
          Set up your profile
        </Button>
      </>
    );
  }

  // The same steps, the same "you are here" and the same length /financial-level
  // renders, because both came out of the one response the server built.
  const states = steps.map((s) => levelStateOf(s, currentStepId));
  const railLabels = steps.map((s) => `Step ${s.order}: ${s.title}`);
  const total = steps.length || 1;
  const doneCount = states.filter((s) => s === 'done').length;
  const futureCount = states.filter((s) => s === 'future').length;
  const allComplete = doneCount === total;
  const isComplete = step.status === 'complete';
  const pct = Math.max(0, Math.min(100, Math.round(step.progress || 0)));
  const detail =
    step.current == null || step.target == null || !(step.target > 0)
      ? null
      // A savings rate is a flow, not a balance — see financial-level.tsx.
      : step.kind === 'savings-rate'
        ? `${formatMoneyShort(step.current)} of ${formatMoneyShort(step.target)} a month`
        : `${formatMoneyShort(step.current)} saved of ${formatMoneyShort(step.target)} target`;

  return shell(
    <>
      {heading}

      {/* Standing — a big level numeral beside the honest segmented ladder */}
      <div className="mt-4 grid gap-5 sm:gap-8 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] sm:items-center">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5">
            <span className="font-editorial text-[46px] sm:text-[54px] font-extrabold leading-[0.85] tracking-[-0.03em] text-[rgb(var(--ui-brand-ink))] ui-tnum">
              {allComplete ? total : step.order}
            </span>
            <span className="font-editorial text-[16px] font-bold text-content-muted ui-tnum">of {total}</span>
          </div>
          {/* Only the all-done line lives here. The step's own card below
              already names the step, and repeating the title verbatim two
              lines above it said the same thing twice. */}
          {allComplete && (
            <p className="mt-2.5 text-[14px] font-medium leading-[1.5] text-content-secondary max-w-[42ch]">
              Every layer of the stack is cleared.
            </p>
          )}
        </div>

        {steps.length > 0 && (
          <div className="min-w-0 w-full">
            <SegmentedRail states={states} labels={railLabels} />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                <LegendSwatch state="done" />{doneCount} done
              </span>
              {!allComplete && (
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                  <LegendSwatch state="current" />You are here
                </span>
              )}
              {futureCount > 0 && (
                <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-content-muted">
                  <LegendSwatch state="future" />{futureCount} ahead
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Current level focus — what to do next, kept from the level flow */}
      {!allComplete && (
        <div className="mt-6 pt-5 border-t border-line">
          <h3 className="font-editorial text-[16px] font-bold tracking-[-0.015em]">{step.title}</h3>
          {step.subtitle && (
            <p className="mt-1 text-[13px] leading-[1.4] text-content-muted max-w-[60ch]">{step.subtitle}</p>
          )}
          {step.description && (
            <p className="mt-1.5 text-[14px] leading-[1.5] text-content-secondary max-w-[60ch]">{step.description}</p>
          )}
          {!isComplete && pct > 0 && (
            <div className="mt-3.5 max-w-[440px]">
              <Track pct={pct} color="rgb(var(--ui-brand))" />
              {detail && <div className="mt-2 text-[12px] font-semibold text-content-muted ui-tnum">{detail}</div>}
            </div>
          )}
          {/* The same four words for the same four actions the step card on
              /financial-level offers, because they are the same actions and two
              vocabularies for one thing read as two features. */}
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <Button size="sm" disabled={working} onClick={onHelp} trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
              Walk me through this
            </Button>
            {/* Only where a tick decides anything. A step the figures measure
                completes itself off the balance behind it, so this button used
                to accept the press, spend a reorder, and change nothing. */}
            {step.target === null && (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === 'done'}
                disabled={working}
                leadingIcon={<Check className="h-3.5 w-3.5" />}
                onClick={async () => { setBusy('done'); try { await onDid(); } finally { setBusy(null); } }}
              >
                Mark done
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'not_applicable'}
              disabled={working}
              onClick={async () => {
                setBusy('not_applicable');
                try { await onSetAside(); } finally { setBusy(null); }
              }}
            >
              Not applicable to me
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── 30-day net-worth chart — pixel-true, styled like the Money page chart ──────

const NW_CHART_H = 200;
const NW_CHART_M = { top: 14, right: 12, bottom: 30, left: 66 };

function NetWorthChart({
  history, monthDelta, netWorth,
}: {
  history: { date: string; value: number }[];
  monthDelta: number | null;
  netWorth: number;
}) {
  const points = useMemo(() => {
    if (history.length < 2) return [];
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let pts = history.filter((p) => new Date(p.date).getTime() >= cutoff);
    if (pts.length < 2) pts = history.slice(-31);
    return pts;
  }, [history]);
  const hasChart = points.length >= 2;

  // Pixel-true width — the viewBox matches the rendered width so strokes and
  // text stay at native size whether the card is in the rail or full-width.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartW, setChartW] = useState(320);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setChartW(el.clientWidth || 320);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasChart]);

  const innerW = chartW - NW_CHART_M.left - NW_CHART_M.right;
  const innerH = NW_CHART_H - NW_CHART_M.top - NW_CHART_M.bottom;

  const { yMin, yMax, yTicks } = useMemo(() => {
    if (!hasChart) return { yMin: 0, yMax: 1, yTicks: [] as number[] };
    const values = points.map((p) => p.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = (rawMax - rawMin) * 0.08 || Math.abs(rawMax) * 0.08 || 1;
    return { yMin: rawMin - pad, yMax: rawMax + pad, yTicks: niceTicks(rawMin - pad, rawMax + pad, 4) };
  }, [points, hasChart]);

  const xAt = (i: number) => NW_CHART_M.left + (i / Math.max(1, points.length - 1)) * innerW;
  const yAt = (v: number) => NW_CHART_M.top + innerH - ((v - yMin) / Math.max(0.0001, yMax - yMin)) * innerH;

  const xy = useMemo<Array<[number, number]>>(
    () => points.map((p, i) => [xAt(i), yAt(p.value)]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, chartW, yMin, yMax],
  );
  const linePath = useMemo(() => smoothLinePath(xy), [xy]);
  const baseY = (NW_CHART_M.top + innerH).toFixed(2);
  const areaPath = linePath
    ? `${linePath} L ${xAt(points.length - 1).toFixed(2)} ${baseY} L ${xAt(0).toFixed(2)} ${baseY} Z`
    : '';
  const xLabels = useMemo(() => (hasChart ? pickXLabels(points, '1M') : []), [points, hasChart]);

  const down = (monthDelta ?? 0) < 0;
  const chipColor = down ? 'rgb(var(--ui-negative))' : 'rgb(var(--ui-positive))';
  const pctChange = monthDelta != null && netWorth !== 0
    ? (monthDelta / (netWorth - monthDelta)) * 100
    : null;

  // Hover crosshair — snaps to the nearest data point (mouse/touch only;
  // chart stays fully readable without hover and for keyboard users).
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const pointerToIdx = (clientX: number): number | null => {
    const root = wrapRef.current;
    if (!root || points.length === 0) return null;
    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const localX = (clientX - rect.left) * (chartW / rect.width);
    const ratio = (localX - NW_CHART_M.left) / Math.max(1, innerW);
    return Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
  };
  const hovered = hoverIdx !== null && points[hoverIdx]
    ? { ...points[hoverIdx], x: xAt(hoverIdx), y: yAt(points[hoverIdx].value) }
    : null;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-editorial text-[16px] font-bold tracking-[-0.012em]">Net worth, last 30 days</div>
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
              color: chipColor,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              {down ? <path d="M12 17 5 9h14z" /> : <path d="M12 7l7 8H5z" />}
            </svg>
            {down ? '−' : '+'}{Math.abs(pctChange).toFixed(1)}%
          </span>
        )}
      </div>

      {hasChart ? (
        <div ref={wrapRef} className="relative mt-3 select-none">
          <svg
            viewBox={`0 0 ${chartW} ${NW_CHART_H}`}
            role="img"
            aria-label="Net worth over the last 30 days"
            className="block w-full"
            style={{ pointerEvents: 'none' }}
          >
            <defs>
              <linearGradient id="nwHomeArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity="0.24" />
                <stop offset="55%" stopColor="var(--ui-viz-2)" stopOpacity="0.07" />
                <stop offset="100%" stopColor="var(--ui-viz-2)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="nwHomeLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--ui-viz-2)" stopOpacity="0.85" />
                <stop offset="100%" stopColor="var(--ui-viz-2)" />
              </linearGradient>
            </defs>

            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={NW_CHART_M.left} y1={yAt(t)} x2={chartW - NW_CHART_M.right} y2={yAt(t)}
                  stroke="var(--ui-hairline)" strokeWidth={1} strokeDasharray="2 5"
                />
                <text
                  x={NW_CHART_M.left - 10} y={yAt(t)} dy="0.32em" textAnchor="end"
                  fill="rgb(var(--ui-content-faint))"
                  style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatShortMoney(t, tickDecimals(yTicks))}
                </text>
              </g>
            ))}

            <path d={areaPath} fill="url(#nwHomeArea)" />
            <path
              d={linePath} fill="none" stroke="url(#nwHomeLine)"
              strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
            />

            {!hovered && (
              <>
                <circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].value)} r={11} fill="var(--ui-viz-2)" fillOpacity={0.12} />
                <circle cx={xAt(points.length - 1)} cy={yAt(points[points.length - 1].value)} r={5.5} fill="var(--ui-viz-2)" stroke="rgb(var(--ui-panel))" strokeWidth={3} />
              </>
            )}
            {hovered && (
              <g>
                <line x1={hovered.x} y1={NW_CHART_M.top} x2={hovered.x} y2={NW_CHART_M.top + innerH} stroke="rgb(var(--ui-content-muted))" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 4" />
                <circle cx={hovered.x} cy={hovered.y} r={14} fill="var(--ui-viz-2)" fillOpacity={0.16} />
                <circle cx={hovered.x} cy={hovered.y} r={5.5} fill="var(--ui-viz-2)" stroke="rgb(var(--ui-panel))" strokeWidth={3} />
              </g>
            )}

            {xLabels.map(({ idx, label }) => (
              <text
                key={`${idx}-${label}`} x={xAt(idx)} y={NW_CHART_H - 8} textAnchor="middle"
                fill="rgb(var(--ui-content-muted))"
                style={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}
              >
                {label}
              </text>
            ))}
          </svg>

          {/* Tooltip — pixel coordinates track the hovered point directly */}
          {hovered && (
            <div
              className="pointer-events-none absolute z-10 rounded-ui-md border border-line bg-panel-raised px-2.5 py-1.5 shadow-ui-md whitespace-nowrap"
              style={{
                left: hovered.x,
                top: hovered.y,
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
            style={{ touchAction: 'pan-y', cursor: 'crosshair' }}
            onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setHoverIdx(pointerToIdx(e.clientX)); }}
            onPointerMove={(e) => { if (e.pointerType === 'touch' && e.buttons === 0) return; setHoverIdx(pointerToIdx(e.clientX)); }}
            onPointerLeave={() => setHoverIdx(null)}
            onPointerCancel={() => setHoverIdx(null)}
          />
        </div>
      ) : (
        <div className="mt-4 h-[150px] grid place-items-center text-[13px] text-content-muted">
          Not enough history yet. Check back in a few days.
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
        <span className="text-[15px] font-semibold text-content">Ask Lasagna</span>
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
        <div className="text-[15px] font-semibold text-content mb-2">Goals</div>
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
        <div className="text-[15px] font-semibold text-content mb-2.5">Goals</div>
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
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold text-content">Goals</div>
        <Link href="/goals" className={`shrink-0 ${pageLinkCls}`}>View all<ArrowRight className="h-4 w-4" /></Link>
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
                    ? 'Fully funded. Surplus ready to reallocate 🎉'
                    : notStarted
                      ? 'Not started yet. Kick it off anytime.'
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

// ─── Spending pulse — month-to-date total + top categories ──────────────────────

const SPEND_VIZ = ['var(--ui-viz-1)', 'var(--ui-viz-2)', 'var(--ui-viz-3)'];

function SpendingPulse({ flow }: { flow: MonthFlow }) {
  const pctVsPrev =
    flow.prevSpending != null && flow.prevSpending > 0
      ? ((flow.spending - flow.prevSpending) / flow.prevSpending) * 100
      : null;
  const up = (pctVsPrev ?? 0) > 0;

  return (
    <Card className="p-[22px]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold text-content">Spending this month</div>
        <Link href="/spending" className={`shrink-0 ${pageLinkCls}`}>View all<ArrowRight className="h-4 w-4" /></Link>
      </div>
      <div className="mt-3 flex items-end gap-x-2.5 gap-y-1 flex-wrap">
        <span className="font-editorial text-[27px] font-extrabold tracking-[-0.02em] leading-none ui-tnum">{fmtUsd(flow.spending)}</span>
        {pctVsPrev != null && (
          <span
            className="text-[12px] font-bold ui-tnum"
            style={{ color: up ? 'rgb(var(--ui-negative))' : 'rgb(var(--ui-positive))' }}
          >
            {up ? '↑' : '↓'} {Math.abs(pctVsPrev).toFixed(0)}% vs this point last month
          </span>
        )}
      </div>
      {flow.topCats.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          {flow.topCats.map((c, i) => (
            <div key={c.id}>
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className="font-bold truncate">{c.name}</span>
                <span className="font-semibold text-content-muted ui-tnum shrink-0">{fmtUsd(c.total)}</span>
              </div>
              <div className="mt-1.5">
                <Track pct={c.pct} color={SPEND_VIZ[i % SPEND_VIZ.length]} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-content-muted">No spending yet this month.</p>
      )}
    </Card>
  );
}

// ─── Cash flow pulse — money in vs out this month ────────────────────────────────

function CashFlowPulse({ flow }: { flow: MonthFlow }) {
  const positive = flow.net >= 0;
  const hasFlow = flow.income > 0 || flow.spending > 0;

  return (
    <Card className="p-[22px]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold text-content">Cash flow this month</div>
        <Link href="/spending" className={`shrink-0 ${pageLinkCls}`}>Details<ArrowRight className="h-4 w-4" /></Link>
      </div>
      {hasFlow ? (
        <>
          <div
            className="mt-3.5 flex gap-[2px] h-[10px] rounded-full overflow-hidden"
            role="img"
            aria-label={`In ${fmtUsd(flow.income)}, out ${fmtUsd(flow.spending)}`}
          >
            <div className="h-full" style={{ flexGrow: flow.income, minWidth: flow.income > 0 ? 4 : 0, background: 'rgb(var(--ui-positive))' }} />
            <div className="h-full" style={{ flexGrow: flow.spending, minWidth: flow.spending > 0 ? 4 : 0, background: 'var(--ui-viz-4)' }} />
          </div>
          <div className="mt-3 flex flex-col gap-1.5 text-[13px] ui-tnum">
            <div className="flex items-baseline justify-between">
              <span className="font-bold text-content-secondary">In</span>
              <span className="font-extrabold" style={{ color: 'rgb(var(--ui-positive))' }}>+{fmtUsd(flow.income)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="font-bold text-content-secondary">Out</span>
              <span className="font-extrabold" style={{ color: 'rgb(var(--ui-negative))' }}>−{fmtUsd(flow.spending)}</span>
            </div>
            <div className="mt-1 pt-2 border-t border-line flex items-baseline justify-between">
              <span className="font-bold">Net</span>
              <span
                className="font-editorial text-[15px] font-extrabold"
                style={{ color: positive ? 'rgb(var(--ui-positive))' : 'rgb(var(--ui-negative))' }}
              >
                {positive ? '+' : '−'}{fmtUsd(Math.abs(flow.net))}
              </span>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-content-muted">No activity yet this month.</p>
      )}
    </Card>
  );
}

// ─── Recent activity — the latest transactions ───────────────────────────────────

function RecentActivity({ txns }: { txns: RecentTxn[] }) {
  return (
    <Card className="p-[22px]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[15px] font-semibold text-content">Recent activity</div>
        <Link href="/transactions" className={`shrink-0 ${pageLinkCls}`}>View all<ArrowRight className="h-4 w-4" /></Link>
      </div>
      {txns.length === 0 ? (
        <p className="mt-3 text-[13px] text-content-muted">No transactions yet.</p>
      ) : (
        <ul>
          {txns.map((t) => {
            const income = t.amount < 0;
            return (
              <li key={t.id} className="mt-3.5 first:mt-3 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-bold truncate">{t.name}</div>
                  <div className="mt-0.5 text-[11.5px] font-semibold text-content-muted">
                    {formatDateShort(new Date(`${t.date.slice(0, 10)}T00:00:00`))}
                    {t.pending ? ', pending' : ''}
                  </div>
                </div>
                <span
                  className="text-[13.5px] font-extrabold ui-tnum shrink-0"
                  style={income ? { color: 'rgb(var(--ui-positive))' } : undefined}
                >
                  {income ? `+${fmtUsd(Math.abs(t.amount), 2)}` : fmtUsd(t.amount, 2)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
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
        {bill.name} <span className="ui-tnum">{fmtUsd(bill.amount)}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">
        Due {when}
        {account && (
          <>
            {' '}from {account.name}.{' '}
            {covered ? (
              <>You're covered. The balance is <span className="ui-tnum">{fmtUsd(account.balance)}</span>.</>
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
