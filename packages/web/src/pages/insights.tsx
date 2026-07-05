import { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import {
  RefreshCw,
  CheckCircle2,
  Check,
  ChevronDown,
  Sparkles,
  ArrowRight,
  Receipt,
  Flame,
  TrendingUp,
  PiggyBank,
  CreditCard,
  Target,
} from 'lucide-react';
import { api } from '../lib/api';
import { useInsights } from '../hooks/useInsights';
import { useChatStore } from '../lib/chat-store';
import { formatRelativeTime } from '../lib/utils';
import { LegalDisclaimer } from '../components/common/legal-disclaimer';
import { Button, Skeleton, SegmentedControl, EmptyState } from '../components/uikit';

// ---------------------------------------------------------------------------
// Urgency → display group mapping (faithful to the API's urgency field)
// ---------------------------------------------------------------------------

type UrgencyGroup = 'do_now' | 'this_week' | 'watch';

const URGENCY_GROUP: Record<string, UrgencyGroup> = {
  critical: 'do_now',
  high: 'do_now',
  medium: 'this_week',
  low: 'watch',
};

const URGENCY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const GROUP_ORDER: UrgencyGroup[] = ['do_now', 'this_week', 'watch'];

const GROUP_META: Record<
  UrgencyGroup,
  { label: string; note: string; flag: string }
> = {
  do_now: {
    label: 'Do now',
    note: 'High urgency — biggest impact first',
    flag: 'rgb(var(--ui-negative))',
  },
  this_week: {
    label: 'This week',
    note: 'Worth setting aside time for',
    flag: 'rgb(var(--ui-caution))',
  },
  watch: {
    label: 'Keep an eye on',
    note: 'No rush — just on the radar',
    flag: 'rgb(var(--ui-content-faint))',
  },
};

// ---------------------------------------------------------------------------
// Category (type) → tag, accent bar, icon, page link, friendly label
// ---------------------------------------------------------------------------

type CatStyle = {
  label: string;
  icon: typeof Receipt;
  /** soft tag background + text color */
  tagBg: string;
  tagFg: string;
  /** left accent bar color */
  bar: string;
  /** destination page for the primary action */
  link: string;
};

const CATEGORY: Record<string, CatStyle> = {
  tax: {
    label: 'Taxes',
    icon: Receipt,
    tagBg: 'var(--ui-caution-soft)',
    tagFg: 'rgb(var(--ui-caution))',
    bar: 'var(--ui-viz-3)',
    link: '/tax',
  },
  debt: {
    label: 'Debt',
    icon: Flame,
    tagBg: 'var(--ui-negative-soft)',
    tagFg: 'rgb(var(--ui-negative))',
    bar: 'var(--ui-viz-4)',
    link: '/debt',
  },
  portfolio: {
    label: 'Investing',
    icon: TrendingUp,
    tagBg: 'var(--ui-info-soft)',
    tagFg: 'rgb(var(--ui-info))',
    bar: 'var(--ui-viz-2)',
    link: '/portfolio',
  },
  retirement: {
    label: 'Retirement',
    icon: Target,
    tagBg: 'var(--ui-brand-soft)',
    tagFg: 'rgb(var(--ui-brand))',
    bar: 'rgb(var(--ui-brand))',
    link: '/retirement',
  },
  savings: {
    label: 'Savings',
    icon: PiggyBank,
    tagBg: 'var(--ui-brand-soft)',
    tagFg: 'rgb(var(--ui-brand))',
    bar: 'rgb(var(--ui-brand))',
    link: '/goals',
  },
  spending: {
    label: 'Spending',
    icon: CreditCard,
    tagBg: 'var(--ui-canvas-sunken)',
    tagFg: 'rgb(var(--ui-content-secondary))',
    bar: 'rgb(var(--ui-content-faint))',
    link: '/spending',
  },
  behavioral: {
    label: 'Spending',
    icon: CreditCard,
    tagBg: 'var(--ui-canvas-sunken)',
    tagFg: 'rgb(var(--ui-content-secondary))',
    bar: 'rgb(var(--ui-content-faint))',
    link: '/spending',
  },
  general: {
    label: 'Overview',
    icon: Sparkles,
    tagBg: 'var(--ui-canvas-sunken)',
    tagFg: 'rgb(var(--ui-content-secondary))',
    bar: 'rgb(var(--ui-content-faint))',
    link: '/',
  },
};

function catFor(type: string | null, category: string | null): CatStyle {
  return CATEGORY[type ?? ''] ?? CATEGORY[category ?? ''] ?? CATEGORY.general;
}

// impactColor (red / amber / green) → impact value color
function impactColorVar(color: string | null): string {
  if (color === 'red') return 'rgb(var(--ui-negative))';
  if (color === 'amber') return 'rgb(var(--ui-caution))';
  return 'rgb(var(--ui-positive))';
}
function impactSoftVar(color: string | null): string {
  if (color === 'red') return 'var(--ui-negative-soft)';
  if (color === 'amber') return 'var(--ui-caution-soft)';
  return 'var(--ui-positive-soft)';
}

// ---------------------------------------------------------------------------
// Category filters (mockup: All / Taxes / Debt / Investing / Spending).
// Only the filters with real matching insights are rendered.
// ---------------------------------------------------------------------------

type FilterValue = 'all' | 'tax' | 'debt' | 'investing' | 'spending';

const FILTER_TYPES: Record<Exclude<FilterValue, 'all'>, string[]> = {
  tax: ['tax'],
  debt: ['debt'],
  investing: ['portfolio', 'retirement', 'savings'],
  spending: ['spending', 'behavioral'],
};

const FILTER_LABELS: Record<FilterValue, string> = {
  all: 'All',
  tax: 'Taxes',
  debt: 'Debt',
  investing: 'Investing',
  spending: 'Spending',
};

// ---------------------------------------------------------------------------
// Action card — the locked home "three moves" anatomy, Bright actions skin
// ---------------------------------------------------------------------------

interface ActionCardProps {
  index: number;
  type: string | null;
  category: string | null;
  title: string;
  description: string;
  impact: string | null;
  impactColor: string | null;
  chatPrompt: string;
  calm?: boolean;
  onPrimary: () => void;
  onAsk: () => void;
  onSkip: () => void;
}

function ActionCard({
  index,
  type,
  category,
  title,
  description,
  impact,
  impactColor,
  chatPrompt,
  calm = false,
  onPrimary,
  onAsk,
  onSkip,
}: ActionCardProps) {
  void chatPrompt;
  const cat = catFor(type, category);
  const Icon = cat.icon;
  // Mobile-only accordion — same behavior as common/action-item.tsx.
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 6) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => { if (!expanded) setExpanded(true); }}
      className={`relative overflow-hidden rounded-ui-lg p-[20px_18px] sm:p-[22px_24px] transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 ${
        calm
          ? 'border border-dashed border-line bg-transparent hover:bg-panel hover:border-solid hover:shadow-ui-sm'
          : 'border border-line bg-panel shadow-ui-sm hover:shadow-ui-md'
      } ${expanded ? '' : 'max-sm:cursor-pointer'}`}
    >
      {/* left accent bar */}
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: cat.bar }} aria-hidden />

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide details' : 'Show details'}
        className="sm:hidden absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-ui-md text-content-faint"
      >
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <div className="flex items-start sm:items-center gap-5 flex-wrap sm:flex-nowrap">
        <div className="flex-1 min-w-0 max-sm:pr-8">
          <span className="inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-full text-[11px] font-extrabold uppercase tracking-[0.05em] mb-3 bg-canvas-sunken text-content-muted">
            <Icon className="h-3 w-3" />
            {cat.label}
          </span>
          <h3 className="font-editorial text-[18px] sm:text-[20px] font-bold leading-[1.2] tracking-[-0.018em] text-content">
            {title}
          </h3>
          <p className={`mt-2 text-[14px] leading-[1.5] text-content-secondary line-clamp-2 max-w-[52ch] ${expanded ? '' : 'max-sm:hidden'}`}>
            {description}
          </p>
        </div>

        {/* right-aligned impact — vertically centered, auto-width, tinted by impactColor.
            On mobile it reflows below a hairline. (Matches home's impact placement.) */}
        {impact && (
          <div className={`w-full sm:w-auto mt-3.5 sm:mt-0 pt-3.5 sm:pt-0 border-t sm:border-t-0 border-line shrink-0 ${expanded ? '' : 'max-sm:hidden'}`}>
            <span
              className="inline-flex items-center gap-1.5 rounded-ui-md px-2.5 py-1.5 font-editorial text-[14.5px] font-extrabold leading-[1.25] tracking-[-0.01em] ui-tnum whitespace-nowrap"
              style={{ background: impactSoftVar(impactColor), color: impactColorVar(impactColor) }}
            >
              {impact}
            </span>
          </div>
        )}
      </div>

      <div className={`flex items-center gap-2 mt-5 flex-wrap ${expanded ? '' : 'max-sm:hidden'}`}>
        <Button size="sm" onClick={onPrimary} trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
          Open {cat.label}
        </Button>

        <button
          type="button"
          onClick={onAsk}
          className="touch-target inline-flex items-center gap-1.5 h-9 px-3 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-brand-softer hover:text-brand transition-colors group"
        >
          <Sparkles className="h-[15px] w-[15px]" />
          Ask Lasagna about this
          <ArrowRight className="h-[14px] w-[14px] transition-transform group-hover:translate-x-0.5" />
        </button>

        <span className="hidden sm:block flex-1 min-w-[8px]" aria-hidden />

        <button
          type="button"
          onClick={onSkip}
          className="touch-target h-9 px-3.5 rounded-ui-md text-[13px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
        >
          Skip
        </button>
      </div>
    </motion.article>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Insights() {
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all');
  const [, navigate] = useLocation();
  const { openChat } = useChatStore();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Pending dismissal awaiting the undo window. No restore endpoint exists, so
  // "undo" works by deferring the (one-way) server dismiss until the window
  // elapses — until then nothing has been committed and we can simply reverse.
  const [pendingUndo, setPendingUndo] = useState<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUndoRef = useRef<string | null>(null);

  const { insights, lastActionsGeneratedAt, isLoading, refresh } = useInsights();

  const UNDO_WINDOW_MS = 6000;
  const REFRESH_COOLDOWN_MS = 3 * 60 * 60 * 1000;
  const msSinceLastGen = lastActionsGeneratedAt
    ? Date.now() - lastActionsGeneratedAt.getTime()
    : Infinity;
  const refreshReady = msSinceLastGen >= REFRESH_COOLDOWN_MS;

  const handleRefresh = async () => {
    if (!refreshReady) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refresh();
    } catch {
      setRefreshError("Couldn't refresh actions right now. Please try again later.");
    } finally {
      setRefreshing(false);
    }
  };

  const setPending = (id: string | null) => {
    pendingUndoRef.current = id;
    setPendingUndo(id);
  };

  const handleDismiss = (id: string) => {
    // Flush any in-flight dismissal first so its server commit isn't lost when
    // a second action is dismissed before the previous window elapses.
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      if (pendingUndoRef.current) api.dismissInsight(pendingUndoRef.current).catch(() => {});
    }
    setDismissed((prev) => new Set([...prev, id]));
    setPending(id);
    undoTimerRef.current = setTimeout(() => {
      api.dismissInsight(id).catch(() => {});
      undoTimerRef.current = null;
      setPending(null);
    }, UNDO_WINDOW_MS);
  };

  const handleUndo = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const id = pendingUndoRef.current;
    if (id) {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
    setPending(null);
  };

  // On unmount, commit any pending dismissal so it isn't silently dropped.
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        if (pendingUndoRef.current) api.dismissInsight(pendingUndoRef.current).catch(() => {});
      }
    };
  }, []);

  const activeInsights = useMemo(
    () => insights.filter((i) => !dismissed.has(i.id)),
    [insights, dismissed],
  );

  // Which category filters actually have data → only render those.
  const availableFilters = useMemo<FilterValue[]>(() => {
    const present = new Set(
      activeInsights.map((i) => (i.type ?? i.category ?? 'general')),
    );
    const order: Exclude<FilterValue, 'all'>[] = ['tax', 'debt', 'investing', 'spending'];
    const some = order.filter((f) => FILTER_TYPES[f].some((t) => present.has(t)));
    return some.length > 1 ? ['all', ...some] : [];
  }, [activeInsights]);

  // Keep the active filter valid if the data shifts under it.
  useEffect(() => {
    if (activeFilter !== 'all' && !availableFilters.includes(activeFilter)) {
      setActiveFilter('all');
    }
  }, [availableFilters, activeFilter]);

  // Apply the category filter, then bucket by urgency.
  const filteredInsights = useMemo(() => {
    if (activeFilter === 'all') return activeInsights;
    const types = FILTER_TYPES[activeFilter];
    return activeInsights.filter((i) => types.includes(i.type ?? i.category ?? ''));
  }, [activeInsights, activeFilter]);

  // Header status counts — recomputed from the currently-filtered set so the
  // line stays in sync when a category filter is active.
  const statusCounts = useMemo(() => {
    let now = 0;
    let week = 0;
    let watch = 0;
    for (const i of filteredInsights) {
      const g = URGENCY_GROUP[i.urgency] ?? 'watch';
      if (g === 'do_now') now++;
      else if (g === 'this_week') week++;
      else watch++;
    }
    return { now, week, watch };
  }, [filteredInsights]);

  const grouped = useMemo(() => {
    const acc: Record<UrgencyGroup, typeof filteredInsights> = { do_now: [], this_week: [], watch: [] };
    for (const i of filteredInsights) {
      (acc[URGENCY_GROUP[i.urgency] ?? 'watch']).push(i);
    }
    for (const g of GROUP_ORDER) {
      acc[g].sort((a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0));
    }
    return acc;
  }, [filteredInsights]);

  const totalActive = activeInsights.length;

  const askAbout = (title: string, description: string, chatPrompt: string) =>
    openChat(
      `Walk me through this action:\n\nTitle: ${title}\nDescription: ${description}\n\n${chatPrompt}`,
    );

  return (
    <div className="mx-auto max-w-[1160px] px-3 sm:px-11 pt-4 sm:pt-9 pb-6 sm:pb-28 text-content">
      {/* ════════ Header ════════ */}
      <header className="flex items-start justify-between gap-6 flex-wrap animate-fade-in">
        <div>
          <span className="inline-flex items-center gap-2.5 mb-3">
            <span
              className="w-[7px] h-[7px] rounded-full bg-[rgb(var(--ui-accent))]"
              style={{ boxShadow: '0 0 0 4px var(--ui-accent-soft)' }}
            />
            <span className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-content-muted">
              Your queue
            </span>
          </span>
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.03em] text-content">
            Actions
          </h1>
          {!isLoading && totalActive > 0 && (
            <p className="mt-2 flex items-center gap-2.5 flex-wrap text-[14px] font-semibold text-content-secondary">
              <span>
                <b className="font-extrabold text-content ui-tnum">{statusCounts.now}</b> worth doing now
              </span>
              {statusCounts.week > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-content-faint" aria-hidden />
                  <span>
                    <b className="font-extrabold text-content ui-tnum">{statusCounts.week}</b> this week
                  </span>
                </>
              )}
              {statusCounts.watch > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-content-faint" aria-hidden />
                  <span>
                    <b className="font-extrabold text-content ui-tnum">{statusCounts.watch}</b> to keep an eye on
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        {!isLoading && (
          <div className="flex flex-col items-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || !refreshReady}
              title={!refreshReady ? 'Actions refresh once every 3 hours' : undefined}
              className="bg-brand-soft text-[rgb(var(--ui-brand-ink))] hover:bg-brand-soft hover:-translate-y-px hover:shadow-ui-sm font-bold"
              leadingIcon={
                <RefreshCw
                  className="h-[15px] w-[15px]"
                  style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }}
                />
              }
            >
              {refreshing ? 'Generating…' : 'Generate'}
            </Button>
            {lastActionsGeneratedAt && (
              <span className="text-[12px] font-semibold text-content-muted">
                Updated {formatRelativeTime(lastActionsGeneratedAt)}
              </span>
            )}
          </div>
        )}
      </header>

      {/* ════════ Loading skeleton ════════ */}
      {isLoading && (
        <div className="mt-8" aria-hidden>
          <div className="flex gap-2 mb-8">
            {['w-[60px]', 'w-[78px]', 'w-[70px]', 'w-[96px]'].map((w, i) => (
              <Skeleton key={i} className={`h-11 rounded-full ${w}`} />
            ))}
          </div>
          {[2, 3].map((count, s) => (
            <div key={s} className="mb-9">
              <Skeleton className="h-5 w-44 mb-4" />
              <div className="flex flex-col gap-3.5">
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} className="rounded-ui-lg border border-line bg-panel shadow-ui-sm p-6">
                    <Skeleton className="h-[26px] w-24 rounded-full" />
                    <Skeleton className="mt-3 h-5 w-2/3" />
                    <Skeleton className="mt-2 h-4 w-full" />
                    <Skeleton className="mt-4 h-9 w-36 rounded-ui-md" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════ Category filter — shared SegmentedControl ════════ */}
      {!isLoading && availableFilters.length > 1 && (
        <div className="mt-7 -mx-3 sm:mx-0 px-3 sm:px-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden animate-fade-in">
          <SegmentedControl<FilterValue>
            aria-label="Filter actions by area"
            tone="brand"
            // Lives in a horizontal scroller — keep intrinsic width so many
            // filter segments scroll instead of squishing to fit the screen.
            stretch={false}
            value={activeFilter}
            onChange={setActiveFilter}
            options={availableFilters.map((f) => ({ value: f, label: FILTER_LABELS[f] }))}
          />
        </div>
      )}

      {/* refresh error */}
      {refreshError && (
        <div
          role="alert"
          className="mt-5 rounded-ui-md px-3.5 py-2.5 text-[13px] leading-snug"
          style={{
            background: 'var(--ui-negative-soft)',
            border: '1px solid rgb(var(--ui-negative))',
            color: 'rgb(var(--ui-negative))',
          }}
        >
          {refreshError}
        </div>
      )}

      {/* ════════ Empty states ════════ */}
      {!isLoading && totalActive === 0 && (
        lastActionsGeneratedAt ? (
          <EmptyState
            className="mt-8"
            icon={<CheckCircle2 className="h-7 w-7" />}
            title="You're all caught up"
            description="No open actions right now. We'll surface new ones as your accounts, spending, and goals change."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing || !refreshReady}
                title={!refreshReady ? 'Actions refresh once every 3 hours' : undefined}
                leadingIcon={
                  <RefreshCw
                    className="h-4 w-4"
                    style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }}
                  />
                }
              >
                {refreshing ? 'Refreshing…' : 'Check for new actions'}
              </Button>
            }
          />
        ) : (
          <EmptyState
            className="mt-8"
            icon={<Sparkles className="h-7 w-7" />}
            title="No actions yet"
            description="Generate a personalized set of actions from your accounts, spending, and goals."
            action={
              <Button
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing || !refreshReady}
                title={!refreshReady ? 'Actions refresh once every 3 hours' : undefined}
              >
                {refreshing ? 'Generating…' : 'Generate actions'}
              </Button>
            }
          />
        )
      )}

      {/* ════════ Urgency groups ════════ */}
      {!isLoading &&
        totalActive > 0 &&
        GROUP_ORDER.map((group) => {
          const items = grouped[group];
          if (!items.length) return null;
          const meta = GROUP_META[group];
          return (
            <section key={group} className="mt-9 first:mt-8">
              <div className="flex items-center gap-3">
                <span
                  className="w-[9px] h-[9px] rounded-full shrink-0"
                  style={{ background: meta.flag, boxShadow: `0 0 0 4px color-mix(in srgb, ${meta.flag} 18%, transparent)` }}
                  aria-hidden
                />
                <h2 className="font-editorial text-[19px] font-bold tracking-[-0.02em] text-content">
                  {meta.label}
                </h2>
                <span className="text-[12px] font-extrabold px-2.5 py-0.5 rounded-full bg-canvas-sunken text-content-muted ui-tnum">
                  {items.length}
                </span>
                <span className="hidden sm:block text-[12.5px] font-semibold text-content-muted">
                  {meta.note}
                </span>
                <span className="flex-1 h-px bg-hairline min-w-[12px]" aria-hidden />
              </div>

              <div className="mt-4 flex flex-col gap-3.5">
                {items.map((insight, idx) => {
                  const cat = catFor(insight.type, insight.category);
                  return (
                    <ActionCard
                      key={insight.id}
                      index={idx}
                      type={insight.type}
                      category={insight.category}
                      title={insight.title}
                      description={insight.description}
                      impact={insight.impact}
                      impactColor={insight.impactColor}
                      chatPrompt={insight.chatPrompt ?? insight.title}
                      calm={group === 'watch'}
                      onPrimary={() => navigate(cat.link)}
                      onAsk={() =>
                        askAbout(insight.title, insight.description, insight.chatPrompt ?? insight.title)
                      }
                      onSkip={() => handleDismiss(insight.id)}
                    />
                  );
                })}
              </div>
            </section>
          );
        })}

      {/* ════════ All caught up — closing seal ════════ */}
      {!isLoading && totalActive > 0 && activeFilter === 'all' && (
        <section
          className="mt-7 px-6 py-8 rounded-ui-xl border border-dashed border-line flex flex-col items-center text-center gap-2.5"
          style={{ background: 'linear-gradient(180deg, var(--ui-brand-softer), transparent 80%)' }}
        >
          <span
            className="w-[50px] h-[50px] rounded-ui-md grid place-items-center text-brand-fg"
            style={{
              background: 'linear-gradient(145deg, var(--ui-viz-1), rgb(var(--ui-brand)))',
              boxShadow: '0 8px 22px color-mix(in srgb, rgb(var(--ui-brand)) 30%, transparent)',
            }}
          >
            <Check className="h-[26px] w-[26px]" strokeWidth={2.6} />
          </span>
          <h3 className="font-editorial text-[19px] font-bold tracking-[-0.02em] text-content">
            That's everything for now
          </h3>
          <p className="max-w-[42ch] text-[13.5px] font-semibold text-content-muted">
            Clear these and you're all caught up. Lasagna checks your accounts daily and surfaces the next
            move when it matters.
          </p>
        </section>
      )}

      {/* legal disclaimer footnote */}
      <div className="mt-8 pt-5 border-t border-hairline">
        <LegalDisclaimer variant="insights" />
      </div>

      {/* ════════ Undo affordance ════════ */}
      <AnimatePresence>
        {pendingUndo && (
          <motion.div
            initial={{ opacity: 0, x: '-50%', y: 12 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%', y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            className="fixed bottom-6 left-1/2 z-[60] flex items-center gap-4 px-[18px] py-3 rounded-ui-md shadow-ui-md text-[14px]"
            style={{ background: 'rgb(var(--ui-content))', color: 'rgb(var(--ui-panel))' }}
          >
            <span className="font-semibold">Action skipped</span>
            <button
              type="button"
              onClick={handleUndo}
              className="font-bold underline underline-offset-[3px]"
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
