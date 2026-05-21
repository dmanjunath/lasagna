import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Wallet, TrendingUp, CreditCard, Target, Lightbulb, Sunrise } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useInsights } from '../hooks/useInsights';
import { api } from '../lib/api';
import { SimpleShell } from '../components/layout/simple-shell';

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

// Layer color ramp — red → green across 12 levels of the financial journey.
// Mirrors the palette used by /financial-level so the two views feel like
// the same thing at different depths.
const LAYER_COLORS = [
  '#B83B3B', '#C25030', '#C46425', '#B87A1E', '#8B7A22', '#5E7A28',
  '#3D7A35', '#2D7040', '#25664A', '#1E5C50', '#185248', '#134840',
];
const layerColor = (order: number) => LAYER_COLORS[order - 1] ?? '#7A5C3F';

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

/**
 * Side-scroll "what to do next" carousel. The first card (when available) is
 * the Level hero — your position on the financial journey + the one action to
 * advance it. Subsequent cards are tactical insights ("today's items"). One
 * gesture (swipe), one decision (tap a card), no thinking required.
 */
function NextStepsCarousel({
  step,
  actions,
  onLevelDone,
  onLevelHelp,
  onDone,
}: {
  step: LevelStep | null;
  actions: InsightLike[];
  onLevelDone: () => void | Promise<void>;
  onLevelHelp: () => void;
  onDone: (id: string) => void | Promise<void>;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const cardCount = (step ? 1 : 0) + actions.length;

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || cardCount < 2) return;
    const onScroll = () => {
      const card = el.querySelector<HTMLElement>('[data-card]');
      if (!card) return;
      const w = card.offsetWidth + 12;
      const idx = Math.round(el.scrollLeft / w);
      setActiveIdx(Math.min(cardCount - 1, Math.max(0, idx)));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [cardCount]);

  const single = cardCount === 1;

  return (
    <div className="mb-4">
      <div
        ref={scrollerRef}
        // `items-stretch` ensures any height delta between LevelCard and
        // InsightCard fills the same row so the snap-mandatory scroller still
        // lands cleanly card-by-card. We intentionally let cards grow tall
        // enough to fit their full content rather than clipping.
        className={`flex gap-3 items-stretch max-h-[320px] ${single ? '' : 'overflow-x-auto snap-x snap-mandatory scrollbar-none'}`}
        style={single ? {} : { scrollbarWidth: 'none' }}
        // Keyboard nav: ←/→ scrolls one card. Carousel is now a real
        // listbox-like control instead of "swipe or nothing".
        role={cardCount > 1 ? 'region' : undefined}
        aria-label={cardCount > 1 ? 'What to do next' : undefined}
        tabIndex={cardCount > 1 ? 0 : undefined}
        onKeyDown={(e) => {
          if (cardCount < 2) return;
          const el = scrollerRef.current;
          if (!el) return;
          const card = el.querySelector<HTMLElement>('[data-card]');
          if (!card) return;
          const w = card.offsetWidth + 12;
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            el.scrollBy({ left: w, behavior: 'smooth' });
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            el.scrollBy({ left: -w, behavior: 'smooth' });
          }
        }}
      >
        {step && (
          <LevelCard key="__level" step={step} onDone={onLevelDone} onHelp={onLevelHelp} />
        )}
        {actions.map((a) => (
          <InsightCard key={a.id} insight={a} onDone={onDone} />
        ))}
      </div>
      {cardCount > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3" aria-hidden="true">
          {Array.from({ length: cardCount }).map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === activeIdx ? 'w-6 bg-accent' : 'w-2 bg-text/40'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Carousel card #1 — strategic. Where you are on the journey + what to do next.
 * Visually matches the insight cards (same gradient surface, same eyebrow color,
 * same dark primary CTA) so the carousel reads as a single coherent stack. The
 * layer color is preserved as the only badge/progress accent — that's the
 * "where you are" cue.
 */
function LevelCard({
  step,
  onDone,
  onHelp,
}: {
  step: LevelStep;
  onDone: () => void | Promise<void>;
  onHelp: () => void;
}) {
  const color = layerColor(step.order);
  const isComplete = step.status === 'complete';
  const progress = Math.max(0, Math.min(100, Math.round(step.progress || 0)));
  const hasProgress = !isComplete && progress > 0;
  const progressDetail =
    step.current != null && step.target != null
      ? `${formatMoney(step.current)} of ${formatMoney(step.target)}`
      : null;
  // Show the longest meaningful explainer available — `description` is the
  // "why this matters" copy; subtitle is the shorter framing. The
  // action/detail strings are intentionally not rendered as a separate
  // paragraph: when they're concrete ("Contribute $X to a Roth") they
  // duplicate information the description already covers, and when they're
  // generic ("Review and mark complete when done.") they restate the Done
  // button. Either way the body is the body — keep it unclamped so the user
  // sees the full "why this matters" without a tap-to-expand.
  const body = step.description || step.subtitle;

  return (
    <section
      data-card
      className="snap-center shrink-0 w-full rounded-2xl bg-gradient-to-br from-cheese/15 to-accent/10 border border-cheese/40 p-5 flex flex-col"
    >
      <h2 className="text-[22px] font-serif font-medium leading-[1.2]">{step.title}</h2>
      {body && (
        <p className="text-sm text-text-secondary mt-3 leading-relaxed line-clamp-4">
          {body}
        </p>
      )}
      {hasProgress && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between mb-1.5 tabular-nums">
            <span className="text-[10px] uppercase tracking-[0.16em] text-text-muted font-medium">
              Progress
            </span>
            <span className="text-xs font-medium" style={{ color }}>
              {progress}%{progressDetail ? ` · ${progressDetail}` : ''}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-bg/60 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress}%`, background: color }}
            />
          </div>
        </div>
      )}
      <div className="flex gap-2 mt-auto pt-5">
        <button
          onClick={() => void onDone()}
          className="flex-1 rounded-xl bg-text text-white py-3 text-sm font-medium min-h-[44px]"
        >
          Done ✓
        </button>
        <button
          onClick={onHelp}
          className="flex-1 rounded-xl bg-bg border border-rule text-text py-3 text-sm font-medium min-h-[44px]"
        >
          Help me with this
        </button>
      </div>
    </section>
  );
}

/**
 * Carousel card #2+ — tactical. A single insight ("today's items") with
 * explicit Done / Help-me CTAs. Description is rendered unclamped — the
 * "Did you know" feed clamps for a denser list view, but the carousel card
 * has the room to show the full reasoning so the user doesn't have to tap
 * into a detail view just to see the second half of a sentence.
 */
function InsightCard({
  insight,
  onDone,
}: {
  insight: InsightLike;
  onDone: (id: string) => void | Promise<void>;
}) {
  return (
    <section
      data-card
      className="snap-center shrink-0 w-full rounded-2xl bg-gradient-to-br from-cheese/15 to-accent/10 border border-cheese/40 p-5 flex flex-col"
    >
      <h2 className="text-[22px] font-serif font-medium leading-[1.2]">{insight.title}</h2>
      {insight.description && (
        <p className="text-sm text-text-secondary mt-3 leading-relaxed line-clamp-4">
          {insight.description}
        </p>
      )}
      <div className="flex gap-2 mt-auto pt-5">
        <button
          onClick={() => void onDone(insight.id)}
          className="flex-1 rounded-xl bg-text text-white py-3 text-sm font-medium min-h-[44px]"
        >
          Done ✓
        </button>
        <Link
          href={`/s/action?id=${insight.id}`}
          className="flex-1 rounded-xl bg-bg border border-rule text-text py-3 text-sm font-medium text-center min-h-[44px] flex items-center justify-center"
        >
          Help me with this
        </Link>
      </div>
    </section>
  );
}

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return `$${Math.round(abs)}`;
}

interface NetBreakdown {
  cash: number;
  cashCount: number;
  investments: number;
  investmentsCount: number;
  debts: number;
  debtsCount: number;
  netWorth: number;
}

export function SimpleHome() {
  const { user, tenant } = useAuth();
  const [, setLocation] = useLocation();
  const { insights, reload: reloadInsights } = useInsights();
  const [breakdown, setBreakdown] = useState<NetBreakdown | null>(null);
  const [accountsById, setAccountsById] = useState<Map<string, { name: string; balance: number }>>(
    new Map(),
  );
  const [goals, setGoals] = useState<Goal[]>([]);
  const [upcomingBill, setUpcomingBill] = useState<BillCard | null>(null);
  const [askDraft, setAskDraft] = useState('');
  // The user's current step on the financial-level journey. This drives the
  // hero — "you are at Layer N, here's what to do next" — and is the single
  // most important thing the Home page conveys.
  const [currentStep, setCurrentStep] = useState<LevelStep | null>(null);
  const [levelLoading, setLevelLoading] = useState(true);

  const firstName =
    (user?.name?.split(' ')[0]) ||
    (tenant?.name?.split(' ')[0]) ||
    user?.email?.split('@')[0] ||
    'there';

  // Refetch the user's current priority step. Called on mount and again
  // after they tap Done on the Level card so we re-render with the next
  // step without doing a full `window.location.reload()` (which loses
  // carousel position + scroll position + remounts every other section).
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

    // Fire all fetches in parallel for fast first paint
    Promise.all([
      api.getBalances().catch(() => ({ balances: [] as any[] })),
      api.getGoals().catch(() => ({ goals: [] })),
      loadPriorities().finally(() => setLevelLoading(false)),
      api.getRecurring().catch(() => ({ recurring: [] as any[] })),
    ]).then(([balanceData, goalsData, , recurringData]) => {
      // Balances → net worth breakdown
      const next: NetBreakdown = {
        cash: 0, cashCount: 0,
        investments: 0, investmentsCount: 0,
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
        else if (b.type === 'credit' || b.type === 'loan') { next.debts += v; next.debtsCount++; }
      }
      next.netWorth = next.cash + next.investments - next.debts;
      setBreakdown(next);
      setAccountsById(map);

      // Goals
      setGoals(goalsData.goals as Goal[]);

      // Upcoming bill
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
    setLocation(text ? `/s/chat?prompt=${encodeURIComponent(text)}` : '/s/chat');
  }

  // Top urgency-ranked insights for the carousel (after the level card).
  // "Did you know" feed below catches everything not in the carousel.
  const URGENCY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const ranked = [...insights].sort(
    (a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0),
  );
  const carouselActions = ranked.slice(0, 3);
  const carouselIds = new Set(carouselActions.map((a) => a.id));
  const dykInsights = ranked.filter((i) => !carouselIds.has(i.id)).slice(0, 3);

  const topGoal = goals.find((g) => g.status === 'active');
  const goalProgress = topGoal
    ? Math.min(100, Math.round((parseFloat(topGoal.currentAmount) / parseFloat(topGoal.targetAmount)) * 100))
    : null;

  // Context-aware suggested prompts based on user's actual financial state
  const suggestedPrompts = useMemo(() => {
    const prompts: string[] = [];
    if (breakdown) {
      const nw = breakdown.netWorth;
      if (breakdown.debts > 0 && breakdown.investments > 0)
        prompts.push(`Should I pay off my $${formatMoney(breakdown.debts).slice(1)} in debt or keep investing?`);
      else if (breakdown.debts > 0)
        prompts.push(`What's the fastest way to pay off $${formatMoney(breakdown.debts).slice(1)} in debt?`);
      if (breakdown.investments > 0)
        prompts.push(`Can I retire on $${formatMoney(breakdown.investments).slice(1)} in investments?`);
      if (nw > 0 && breakdown.cash > 0) {
        const cashPct = Math.round((breakdown.cash / nw) * 100);
        if (cashPct > 30)
          prompts.push(`Is ${cashPct}% cash too much? Should I invest more?`);
      }
    }
    if (topGoal)
      prompts.push(`How can I reach my ${topGoal.name} goal faster?`);
    if (currentStep)
      prompts.push(`Help me with: ${currentStep.title}`);
    // Fallbacks if we couldn't build enough context-aware ones
    if (prompts.length < 2) prompts.push('What should I focus on first?');
    if (prompts.length < 3) prompts.push('Am I on track for retirement?');
    return prompts.slice(0, 3);
  }, [breakdown, topGoal, currentStep]);

  return (
    <SimpleShell title="Home" activeTab="home">
      {/* Greeting — uses the same display size as other page H1s so the
          Simple-mode type ramp is consistent across Home/Money/Chat/Goals. */}
      <div className="mb-5">
        <h1 className="text-[28px] font-serif font-medium leading-[1.15]">
          Hey {firstName}
        </h1>
        <p className="text-sm text-text-muted mt-1.5">Here's what to focus on next.</p>
      </div>

      {/* "What to do next" — a swipeable stack starting with your current
          layer on the financial journey, followed by today's tactical items.
          One swipe gesture, one decision per card. */}
      {levelLoading ? (
        <div className="rounded-2xl bg-bg-elevated border border-rule p-5 mb-4 animate-pulse h-48" />
      ) : currentStep || carouselActions.length > 0 ? (
        <NextStepsCarousel
          step={currentStep}
          actions={carouselActions}
          onLevelDone={async () => {
            if (!currentStep) return;
            try {
              await api.completePriorityStep(currentStep.id, true);
            } catch {
              // Non-fatal — refetch anyway so the user isn't stuck on a card
              // that already acknowledged completion.
            }
            // Refetch instead of full reload — preserves carousel scroll
            // position and avoids remounting Ask Anything / breakdown / DYK.
            await loadPriorities();
          }}
          onLevelHelp={() => {
            if (!currentStep) return;
            const prompt = `Help me with: ${currentStep.title}. ${currentStep.subtitle ?? ''}`.trim();
            setLocation(`/s/chat?prompt=${encodeURIComponent(prompt)}`);
          }}
          onDone={async (id) => {
            try {
              await api.actOnInsight(id);
            } catch {
              // Non-fatal — refetch will reconcile if the action stuck.
            }
            // Refetch instead of full reload — keeps carousel/page scroll
            // position. The acted-on insight drops out of the next /insights
            // payload, so the user sees the card disappear in place.
            await reloadInsights();
          }}
        />
      ) : (
        <section className="rounded-2xl bg-bg-elevated border border-rule p-5 mb-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium font-mono mb-2">
            Your next step
          </div>
          <h2 className="text-xl font-serif font-medium">Set up your financial profile.</h2>
          <p className="text-sm text-text-muted mt-2">
            Tell us your basics and we'll show you exactly what to do next.
          </p>
          <button
            onClick={() => setLocation('/profile')}
            className="mt-4 rounded-xl bg-text text-white px-4 py-2.5 text-sm font-medium"
          >
            Get started →
          </button>
        </section>
      )}

      {/* Ask anything — real input that navigates to chat with the prompt */}
      <section className="rounded-2xl bg-bg-elevated border border-rule p-5 mb-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium font-mono mb-3">
          Ask anything
        </div>
        <form
          onSubmit={submitAsk}
          className="flex items-center gap-2 rounded-xl bg-bg border border-rule pl-4 pr-1.5 py-1.5 focus-within:border-accent/60 transition"
        >
          <input
            type="text"
            value={askDraft}
            onChange={(e) => setAskDraft(e.target.value)}
            placeholder={suggestedPrompts[0] ? `Try: "${suggestedPrompts[0]}"` : 'Ask anything about your finances…'}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder-text-muted/70"
          />
          <button
            type="submit"
            disabled={!askDraft.trim()}
            className="rounded-full bg-text text-white w-9 h-9 grid place-items-center text-sm disabled:opacity-30 shrink-0"
            aria-label="Ask"
          >
            ↑
          </button>
        </form>
        <div className="flex flex-wrap gap-2 mt-3">
          {suggestedPrompts.map((q) => (
            <button
              key={q}
              onClick={() => setLocation(`/s/chat?prompt=${encodeURIComponent(q)}`)}
              // `border border-transparent` reserves the 1px on every state
              // so the pill doesn't jump 2px on hover (was `hover:border` which
              // added borders that the layout had to absorb).
              className="text-xs px-3 py-1.5 bg-bg rounded-full text-text-secondary border border-transparent hover:border-rule transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      {/* Feed */}
      <div className="space-y-3">
        {upcomingBill && (() => {
          const acct = upcomingBill.accountId ? accountsById.get(upcomingBill.accountId) : null;
          return (
            <article className="rounded-2xl bg-bg-elevated border border-rule p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="text-xl">📅</div>
                <div className="flex-1">
                  <div className="text-xs text-text-muted">Heads up</div>
                  <div className="text-sm font-medium mt-1">
                    {upcomingBill.name} due {upcomingBill.daysAway <= 0
                      ? 'today'
                      : upcomingBill.daysAway === 1
                        ? 'tomorrow'
                        : `in ${upcomingBill.daysAway} days`}
                    {' — '}
                    <span className="tabular-nums">
                      {upcomingBill.amount.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  </div>
                  {acct && (
                    <div className="text-xs text-text-muted mt-1 tabular-nums">
                      Pulls from <strong className="text-text-secondary">{acct.name}</strong>
                      {' · '}
                      balance{' '}
                      {acct.balance.toLocaleString('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      })}
                      . {acct.balance >= upcomingBill.amount ? "You're good." : 'Heads up — may not cover this.'}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })()}

        {/* Net worth breakdown — Cash / Investments / Debts → Net worth.
            Tapping anywhere jumps to /s/money for the full account list. */}
        {breakdown && (
          <Link
            href="/s/money"
            className="block rounded-2xl bg-bg-elevated border border-rule shadow-sm overflow-hidden hover:border-accent/30 transition"
          >
            <div className="px-4 pt-4 pb-2 flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <Sunrise size={14} className="text-text-muted" />
                <span className="text-[11px] uppercase tracking-[0.16em] text-text-muted font-medium font-mono">
                  This morning
                </span>
              </div>
              <span className="text-[11px] text-text-secondary underline">See all →</span>
            </div>
            {breakdown.cashCount > 0 && (
              <BreakdownLine
                icon={<Wallet size={16} className="text-text-muted" />}
                label="Cash"
                sublabel={`${breakdown.cashCount} account${breakdown.cashCount === 1 ? '' : 's'}`}
                amount={breakdown.cash}
              />
            )}
            {breakdown.investmentsCount > 0 && (
              <BreakdownLine
                icon={<TrendingUp size={16} className="text-text-muted" />}
                label="Investments"
                sublabel={`${breakdown.investmentsCount} account${breakdown.investmentsCount === 1 ? '' : 's'}`}
                amount={breakdown.investments}
              />
            )}
            {breakdown.debtsCount > 0 && (
              <BreakdownLine
                icon={<CreditCard size={16} className="text-text-muted" />}
                label="Debts"
                sublabel={`${breakdown.debtsCount} account${breakdown.debtsCount === 1 ? '' : 's'}`}
                amount={-breakdown.debts}
                negative
              />
            )}
            <div className="flex items-center justify-between px-4 py-3 bg-bg/40 border-t border-rule/60">
              <div className="text-sm font-semibold">Net worth</div>
              <div className="text-sm font-semibold tabular-nums">
                {breakdown.netWorth.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 0,
                })}
              </div>
            </div>
          </Link>
        )}

        {/* Top goal */}
        {topGoal && goalProgress !== null && (
          <Link
            href="/s/goals"
            className="block rounded-2xl bg-bg-elevated border border-rule p-4 hover:border-accent/30 transition"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-bg grid place-items-center shrink-0">
                <Target size={16} className="text-accent" />
              </div>
              <div className="flex-1">
                <div className="text-xs text-text-muted font-mono uppercase tracking-wider">Goal</div>
                <div className="text-sm font-medium mt-1">
                  {topGoal.name} — {goalProgress}% there
                </div>
                <div className="mt-2 h-2 rounded-full bg-bg overflow-hidden">
                  <div className="h-full bg-success" style={{ width: `${goalProgress}%` }} />
                </div>
                <div className="text-xs text-text-muted mt-2 tabular-nums">
                  ${parseFloat(topGoal.currentAmount).toLocaleString()} of $
                  {parseFloat(topGoal.targetAmount).toLocaleString()}
                </div>
              </div>
            </div>
          </Link>
        )}

        {/* Other insights — anything not already in the top carousel */}
        {dykInsights.map((ins) => (
          <Link
            key={ins.id}
            href={`/s/action?id=${ins.id}`}
            className="block rounded-2xl bg-bg-elevated border border-rule p-4 hover:border-accent/30 transition"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-bg grid place-items-center shrink-0">
                <Lightbulb size={16} className="text-cheese" />
              </div>
              <div className="flex-1">
                <div className="text-xs text-text-muted font-mono uppercase tracking-wider">Did you know</div>
                <div className="text-sm font-medium mt-1">{ins.title}</div>
                {ins.description && (
                  // Clamp to 3 lines — DYK is a feed-row preview (tap the row
                  // to read the full action), but 2 lines was cutting most
                  // insights mid-sentence ("of…") which is worse than no
                  // preview. The full content lives at /s/action?id=…
                  <div className="text-xs text-text-muted mt-1 line-clamp-3">
                    {ins.description}
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </SimpleShell>
  );
}

function BreakdownLine({
  icon,
  label,
  sublabel,
  amount,
  negative,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  amount: number;
  negative?: boolean;
}) {
  const display =
    amount < 0
      ? `−${Math.abs(amount).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
      : amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-rule/60">
      <div className="w-8 h-8 rounded-lg bg-bg grid place-items-center shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-text-muted">{sublabel}</div>
      </div>
      <div className={`text-sm font-medium tabular-nums ${negative ? 'text-text-secondary' : ''}`}>
        {display}
      </div>
    </div>
  );
}
