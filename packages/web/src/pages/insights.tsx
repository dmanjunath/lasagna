import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'wouter';
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
  X,
} from 'lucide-react';
import { api, type FinancialPath } from '../lib/api';
import { useInsights } from '../hooks/useInsights';
import { useChatStore } from '../lib/chat-store';
import { actionArea } from '../lib/action-destination';
import { formatRelativeTime } from '../lib/utils';
import { Badge, Button, PageMeta, PageMetaItem, PageMetaSkeleton, Skeleton, SegmentedControl, EmptyState } from '../components/uikit';

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

// ---------------------------------------------------------------------------
// Category (type) → tag, accent bar, icon. Where an action OPENS lives in
// lib/action-destination, because a step's panel on the path opens the same
// action and the two must agree.
// ---------------------------------------------------------------------------

type CatStyle = {
  icon: typeof Receipt;
  /** soft tag background + text color */
  tagBg: string;
  tagFg: string;
  /** left accent bar color */
  bar: string;
};

const CATEGORY: Record<string, CatStyle> = {
  tax: {
    icon: Receipt,
    tagBg: 'var(--ui-caution-soft)',
    tagFg: 'rgb(var(--ui-caution))',
    bar: 'var(--ui-viz-3)',
  },
  debt: {
    icon: Flame,
    tagBg: 'var(--ui-negative-soft)',
    tagFg: 'rgb(var(--ui-negative))',
    bar: 'var(--ui-viz-4)',
  },
  portfolio: {
    icon: TrendingUp,
    tagBg: 'var(--ui-info-soft)',
    tagFg: 'rgb(var(--ui-info))',
    bar: 'var(--ui-viz-2)',
  },
  retirement: {
    icon: Target,
    tagBg: 'var(--ui-brand-soft)',
    tagFg: 'rgb(var(--ui-brand))',
    bar: 'rgb(var(--ui-brand))',
  },
  savings: {
    icon: PiggyBank,
    tagBg: 'var(--ui-brand-soft)',
    tagFg: 'rgb(var(--ui-brand))',
    bar: 'rgb(var(--ui-brand))',
  },
  spending: {
    icon: CreditCard,
    tagBg: 'var(--ui-canvas-sunken)',
    tagFg: 'rgb(var(--ui-content-secondary))',
    bar: 'rgb(var(--ui-content-faint))',
  },
  behavioral: {
    icon: CreditCard,
    tagBg: 'var(--ui-canvas-sunken)',
    tagFg: 'rgb(var(--ui-content-secondary))',
    bar: 'rgb(var(--ui-content-faint))',
  },
  general: {
    icon: Sparkles,
    tagBg: 'var(--ui-canvas-sunken)',
    tagFg: 'rgb(var(--ui-content-secondary))',
    bar: 'rgb(var(--ui-content-faint))',
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

// Shared skin for the Dense + Accordion (collapsed) row so the two are
// pixel-identical.
function denseArticleCls(calm: boolean): string {
  return `relative overflow-hidden rounded-ui-md transition-[box-shadow,border-color] ${
    calm
      ? 'border border-dashed border-line bg-transparent hover:bg-panel hover:border-solid hover:shadow-ui-sm'
      : 'border border-line bg-panel shadow-ui-sm hover:border-line-strong hover:shadow-ui-md'
  }`;
}

// Shared dense row. `onTitle` is the row's primary click: Open (Dense) or
// toggle (Accordion). The chat + skip buttons behave the same in both.
function InsightsDenseRow({
  cat,
  Icon,
  title,
  impact,
  impactColor,
  onTitle,
  onAsk,
  onSkip,
  hideActions,
  expandable,
  expanded,
}: {
  cat: CatStyle;
  Icon: typeof Receipt;
  title: string;
  impact: string | null;
  impactColor: string | null;
  onTitle: () => void;
  onAsk: () => void;
  onSkip: () => void;
  hideActions?: boolean;
  expandable?: boolean;
  expanded?: boolean;
}) {
  // Accordion rows expand for detail, so on phones the title wraps to two lines
  // and the per-row icons drop out (they live in the opened body), leaving the
  // chevron. Plain dense rows keep their inline icons.
  const hideOnMobile = expandable ? 'max-sm:hidden' : '';
  return (
    <div className="flex items-center gap-3 pl-4 pr-2 py-2.5">
      <span className="grid place-items-center h-6 w-6 shrink-0 rounded-ui-sm bg-canvas-sunken text-content-muted" aria-hidden>
        <Icon className="h-3.5 w-3.5" />
      </span>

      <button
        type="button"
        onClick={onTitle}
        className="flex-1 min-w-0 flex items-center gap-1.5 text-left group/title"
      >
        <span className="min-w-0 text-[14px] font-semibold leading-tight text-content">{title}</span>
        {/* Dense navigates (→); Accordion toggles, so it shows no title arrow. */}
        {!expandable && (
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-content-faint transition-transform group-hover/title:translate-x-0.5" />
        )}
      </button>

      {impact && (
        <span
          className="hidden sm:inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[12.5px] font-bold leading-none ui-tnum whitespace-nowrap"
          style={{ background: impactSoftVar(impactColor), color: impactColorVar(impactColor) }}
        >
          {impact}
        </span>
      )}

      {/* Collapsed only — when open these move to dedicated labeled buttons. */}
      {!hideActions && (
        <>
          <button
            type="button"
            aria-label="Ask Lasagna about this"
            onClick={onAsk}
            className={`touch-target grid h-8 w-8 shrink-0 place-items-center rounded-ui-md text-brand hover:bg-brand-softer transition-colors ${hideOnMobile}`}
          >
            <Sparkles className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label="Skip"
            onClick={onSkip}
            className={`touch-target grid h-8 w-8 shrink-0 place-items-center rounded-ui-md text-content-faint hover:bg-canvas-sunken hover:text-content transition-colors ${hideOnMobile}`}
          >
            <X className="h-4 w-4" />
          </button>
        </>
      )}

      {/* Accordion affordance — points down to expand, flips up when open. */}
      {expandable && (
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-content-faint transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      )}
    </div>
  );
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
  const area = actionArea(type, category);
  const [expanded, setExpanded] = useState(false);

  // One accordion row per action: a collapsed row that toggles the details
  // underneath.
  return (
      <motion.article
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: Math.min(index, 6) * 0.05, ease: [0.22, 1, 0.36, 1] }}
        className={denseArticleCls(calm)}
      >
        <span className="absolute left-0 top-0 bottom-0 w-1" style={{ background: cat.bar }} aria-hidden />
        <InsightsDenseRow
          cat={cat}
          Icon={Icon}
          title={title}
          impact={impact}
          impactColor={impactColor}
          onTitle={() => setExpanded((v) => !v)}
          onAsk={onAsk}
          onSkip={onSkip}
          hideActions={expanded}
          expandable
          expanded={expanded}
        />

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{ overflow: 'hidden' }}
            >
              <div className="px-4 pb-3">
                <p className="text-[13px] leading-[1.5] text-content-secondary">
                  {description}
                </p>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <Button size="sm" onClick={onPrimary} trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                    Open {area.label}
                  </Button>
                  <button
                    type="button"
                    onClick={onAsk}
                    className="touch-target inline-flex items-center gap-1.5 h-8 px-2.5 rounded-ui-md text-[12.5px] font-semibold text-content-muted hover:bg-brand-softer hover:text-brand transition-colors group"
                  >
                    <Sparkles className="h-[14px] w-[14px]" />
                    Ask Lasagna about this
                    <ArrowRight className="h-[14px] w-[14px] transition-transform group-hover:translate-x-0.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onSkip}
                    className="touch-target h-8 px-3 rounded-ui-md text-[12.5px] font-semibold text-content-muted hover:bg-canvas-sunken hover:text-content-secondary transition-colors"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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

  const { insights, lastActionsGeneratedAt, isLoading: insightsLoading, refresh } = useInsights();

  // The plan the actions hang off. Read from the path itself so the numbers and
  // titles here are the ones /financial-level shows, rather than a second
  // reckoning of the same steps. A path that will not load leaves the list
  // ungrouped rather than empty.
  const [pathSteps, setPathSteps] = useState<FinancialPath['steps']>([]);
  const [currentStepId, setCurrentStepId] = useState('');
  // Whether the answer is in, either way. The list waits for it: rendering
  // before the path lands shows a flat feed that then reshuffles itself into
  // the plan, which is the page changing its mind in front of the reader.
  const [pathSettled, setPathSettled] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .getFinancialPath()
      .then((p) => {
        if (!live) return;
        setPathSteps(p.steps);
        setCurrentStepId(p.currentStepId);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setPathSettled(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const UNDO_WINDOW_MS = 6000;
  const REFRESH_COOLDOWN_MS = 3 * 60 * 60 * 1000;
  const msSinceLastGen = lastActionsGeneratedAt
    ? Date.now() - lastActionsGeneratedAt.getTime()
    : Infinity;
  const refreshReady = msSinceLastGen >= REFRESH_COOLDOWN_MS;
  const isLoading = insightsLoading || !pathSettled;

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

  // The actions under the step each one serves, in path order, then the ones
  // the path has no step for. Urgency decides the order WITHIN a step and
  // nothing else, which is the whole change: a critical action six steps out
  // used to sit above the step the person is standing on.
  //
  // The step numbers and titles come from the path itself rather than from the
  // actions, so this page counts steps exactly as /financial-level and home do.
  // A key naming no step on the path lands in the trailing group, which is also
  // what happens when there is no path at all: then nothing is grouped and the
  // list reads flat, with no heading over it.
  const grouped = useMemo(() => {
    const byKey = new Map<string, typeof filteredInsights>();
    const unattached: typeof filteredInsights = [];
    const onPath = new Set(pathSteps.map((s) => s.id));
    for (const i of filteredInsights) {
      if (i.pathStepKey && onPath.has(i.pathStepKey)) {
        const list = byKey.get(i.pathStepKey) ?? [];
        list.push(i);
        byKey.set(i.pathStepKey, list);
      } else {
        unattached.push(i);
      }
    }
    const byUrgency = (a: (typeof filteredInsights)[number], b: (typeof filteredInsights)[number]) =>
      (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0);

    const groups: Array<{
      key: string | null;
      step: number | null;
      title: string;
      current: boolean;
      items: typeof filteredInsights;
    }> = [];
    for (const step of pathSteps) {
      const items = byKey.get(step.id);
      if (!items?.length) continue;
      groups.push({
        key: step.id,
        step: step.order,
        title: step.title,
        current: step.id === currentStepId,
        items: [...items].sort(byUrgency),
      });
    }
    if (unattached.length > 0) {
      groups.push({
        key: null,
        step: null,
        // Named for what it is. These are not lesser actions, they are the ones
        // the path has no step for, and hiding them would drop real advice.
        //
        // Empty when it would head the WHOLE list, which is a heading that
        // groups nothing: there is no path, or nothing on the path has drawn an
        // action yet — the state every existing list is in until it is next
        // generated. Saying "not tied to a step" over every action a person has
        // reads as a verdict on the list rather than as one group of it.
        title: groups.length > 0 ? 'Not tied to a step' : '',
        current: false,
        items: [...unattached].sort(byUrgency),
      });
    }
    return groups;
  }, [filteredInsights, pathSteps, currentStepId]);

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
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.03em] text-content">
            Actions
          </h1>
          <PageMeta>
            {isLoading ? (
              <PageMetaSkeleton widths={['w-[120px]', 'w-[72px]', 'w-[124px]']} />
            ) : (
              totalActive > 0 && (
                <>
                  {statusCounts.now > 0 && (
                    <PageMetaItem tone="brand" className="ui-tnum">{statusCounts.now} worth doing now</PageMetaItem>
                  )}
                  {statusCounts.week > 0 && (
                    <PageMetaItem className="ui-tnum">{statusCounts.week} this week</PageMetaItem>
                  )}
                  {statusCounts.watch > 0 && (
                    <PageMetaItem className="ui-tnum">{statusCounts.watch} to keep an eye on</PageMetaItem>
                  )}
                </>
              )
            )}
          </PageMeta>
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

      {/* ════════ The path, step by step ════════ */}
      {!isLoading &&
        totalActive > 0 &&
        grouped.map((group) => (
          <section key={group.key ?? 'unattached'} className="mt-9 first:mt-8">
            {group.title !== '' && (
              <div className="flex items-center gap-3">
                {/* The step's own number, as /financial-level counts them. The
                    trailing group carries none because there is no step: its
                    actions are real advice the path has no rung for, so its
                    heading is indented to where the others' titles start. */}
                {group.step !== null && (
                  <span
                    className="grid place-items-center h-6 w-6 shrink-0 rounded-full bg-brand-soft text-[12px] font-extrabold text-[rgb(var(--ui-brand-ink))] ui-tnum"
                    aria-hidden
                  >
                    {group.step}
                  </span>
                )}
                <h2
                  className={`font-editorial text-[19px] font-bold tracking-[-0.02em] text-content ${
                    group.step === null ? 'pl-9' : ''
                  }`}
                >
                  {/* The number is drawn, not read: it is the one thing this
                      grouping adds, so it has to reach a screen reader too. */}
                  {group.step !== null && <span className="sr-only">Step {group.step}, </span>}
                  {/* A heading naming a step of the path opens that step. It
                      read as the plan and went nowhere otherwise. */}
                  {group.key ? (
                    <Link
                      href={`/financial-level?step=${encodeURIComponent(group.key)}`}
                      className="ui-focus rounded-ui-sm hover:text-brand transition-colors"
                    >
                      {group.title}
                    </Link>
                  ) : (
                    group.title
                  )}
                </h2>
                {group.current && (
                  <Badge tone="brand">
                    You are here
                  </Badge>
                )}
                {/* bg-line, not bg-hairline: there is no `hairline` colour key,
                    so that class resolved to transparent and the rule never
                    drew. `line` IS --ui-hairline. */}
                <span className="flex-1 h-px bg-line min-w-[12px]" aria-hidden />
              </div>
            )}

            <div className={`flex flex-col gap-2 ${group.title === '' ? '' : 'mt-4'}`}>
              {group.items.map((insight, idx) => (
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
                  calm={insight.urgency === 'low'}
                  onPrimary={() => navigate(actionArea(insight.type, insight.category).link)}
                  onAsk={() =>
                    askAbout(insight.title, insight.description, insight.chatPrompt ?? insight.title)
                  }
                  onSkip={() => handleDismiss(insight.id)}
                />
              ))}
            </div>
          </section>
        ))}

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
