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
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { useInsights } from '../hooks/useInsights';
import { useChatStore } from '../lib/chat-store';
import { actionArea, areaKey, groupByArea, TONE_STYLE, type AreaTone } from '../lib/action-destination';
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

/**
 * The urgency bands in the order they are read, and what each is called.
 *
 * The wording matches the counts in the page heading, so the line saying "3
 * worth doing now" names the same band as the heading over those three.
 */
const URGENCY_ORDER: Array<{ key: UrgencyGroup; title: string }> = [
  { key: 'do_now', title: 'Worth doing now' },
  { key: 'this_week', title: 'Worth doing in the next month' },
  { key: 'watch', title: 'Keep an eye on' },
];

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

/**
 * A filter is a page, named by the link that page lives at, or 'all'.
 *
 * Keyed on the SAME resolution the row's tag uses, so the chip and the tag can
 * never disagree. The old filter had its own type lists and folded portfolio,
 * retirement and savings into one "Investing" chip, so picking Investing
 * returned rows tagged Retirement and Savings, which read as the filter being
 * broken.
 */
type FilterValue = string;
const ALL_FILTER = 'all';

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
  showArea: boolean;
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

// Shared dense row. The row that wraps it owns the click; this draws only what
// the row shows when it is closed.
function InsightsDenseRow({
  cat,
  Icon,
  title,
  area,
  showArea,
  impact,
  impactColor,
  onAsk,
  onSkip,
  expandable,
  expanded,
}: {
  cat: CatStyle;
  Icon: typeof Receipt;
  title: string;
  /** The page this action is about, named and toned. Its tone is the row's one
   *  colour, worn by the edge and both pills alike. Undefined when a page
   *  filter is on and every row on screen is already that page. */
  area: { label: string; tone: AreaTone };
  /** False when a page filter is on and every row on screen is that page, so
   *  the tag would repeat the chip above it once per row. */
  showArea: boolean;
  impact: string | null;
  impactColor: string | null;
  onAsk: () => void;
  onSkip: () => void;
  expandable?: boolean;
  expanded?: boolean;
}) {
  // Accordion rows expand for detail, so on phones the title wraps to two lines
  // and the per-row icons drop out (they live in the opened body), leaving the
  // chevron. Plain dense rows keep their inline icons.
  return (
    <div className="flex items-center gap-3 pl-4 pr-2 py-2.5">
      {/* The chip wears the row's colour, as it does on home. Flat sunken grey
          measured 1.12:1 against the card and read as a hole. */}
      <span
        className="grid place-items-center h-6 w-6 shrink-0 rounded-ui-sm"
        style={{ background: TONE_STYLE[area.tone].soft, color: TONE_STYLE[area.tone].ink }}
        aria-hidden
      >
        <Icon className="h-3.5 w-3.5" />
      </span>

      <div className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
        <span className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-tight text-content">{title}</h3>
          {/* The page and the figure sit together, in one fill and one shape,
              so they read as a pair rather than as two unrelated chips at
              opposite ends of the row. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {showArea && (
              <span
                className="inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[12.5px] font-bold leading-none"
                style={{ background: TONE_STYLE[area.tone].soft, color: TONE_STYLE[area.tone].ink }}
              >
                {area.label}
              </span>
            )}
            {impact && (
              // No `whitespace-nowrap`: the card clips its overflow, so a long
              // figure was guillotined mid-word on a phone rather than wrapping.
              <span
                className="inline-flex items-center rounded-ui-sm px-2 py-0.5 text-[12.5px] font-bold leading-none ui-tnum"
                style={{ background: TONE_STYLE[area.tone].soft, color: TONE_STYLE[area.tone].ink }}
              >
                {impact}
              </span>
            )}
          </span>
        </span>
        {/* Dense navigates (→); Accordion toggles, so it shows no title arrow. */}
        {!expandable && (
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-content-faint" />
        )}
      </div>


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
  showArea,
  onPrimary,
  onAsk,
  onSkip,
}: ActionCardProps) {
  void chatPrompt;
  const cat = catFor(type, category);
  const Icon = cat.icon;
  const area = actionArea(type, category);
  const hasDestination = area.link !== null;
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
        {/* The edge wears the row's colour, the same one the two pills wear. */}
        <span
          className="absolute left-0 top-0 bottom-0 w-1"
          style={{ background: TONE_STYLE[area.tone].solid }}
          aria-hidden
        />
        {/* The whole row toggles, as it does on home. The chevron used to sit
            outside the only clickable element, so the row's one visible
            affordance did nothing when clicked. */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          // Without this the name is the row's whole text content, so a screen
          // reader read "…back to normalSpending$14,047 spike" as one word.
          aria-label={title}
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v); }
          }}
          // Inset ring: the article clips overflow, so an outward ring vanishes.
          className="cursor-pointer rounded-ui-md focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ui-brand-ring)]"
        >
        <InsightsDenseRow
          cat={cat}
          Icon={Icon}
          title={title}
          area={area}
          showArea={showArea}
          impact={impact}
          impactColor={impactColor}
          onAsk={onAsk}
          onSkip={onSkip}
          expandable
          expanded={expanded}
        />
        </div>

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
              {/* Aligned to the title, not to the icon, so the body hangs under
                the row it belongs to. Capped to a readable measure: it ran ~130
                characters a line at 1280 with nothing to stop it. */}
            <div className="pl-[52px] pr-4 pb-3">
                <p className="max-w-[70ch] text-[13px] leading-[1.5] text-content-secondary">
                  {description}
                </p>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  {/* Only offered when the area has a page behind it. The
                      catch-all has none, and "Open Overview" navigated to the
                      page the reader was already standing on. */}
                  {hasDestination && (
                    <Button size="sm" onClick={onPrimary} trailingIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                      Open {area.label}
                    </Button>
                  )}
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
  const [activeFilter, setActiveFilter] = useState<FilterValue>(ALL_FILTER);
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

  const UNDO_WINDOW_MS = 6000;
  const REFRESH_COOLDOWN_MS = 3 * 60 * 60 * 1000;
  const msSinceLastGen = lastActionsGeneratedAt
    ? Date.now() - lastActionsGeneratedAt.getTime()
    : Infinity;
  const refreshReady = msSinceLastGen >= REFRESH_COOLDOWN_MS;
  const isLoading = insightsLoading;

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

  // Only the pages that actually have an action, in the canonical page order.
  // One chip is not a filter, so the row is dropped entirely below two.
  const availableFilters = useMemo(() => {
    const groups = groupByArea(activeInsights);
    return groups.length > 1
      ? [{ value: ALL_FILTER, label: 'All' }, ...groups.map((g) => ({ value: areaKey(g), label: g.label }))]
      : [];
  }, [activeInsights]);

  // Keep the active filter valid if the data shifts under it.
  useEffect(() => {
    if (activeFilter !== ALL_FILTER && !availableFilters.some((f) => f.value === activeFilter)) {
      setActiveFilter(ALL_FILTER);
    }
  }, [availableFilters, activeFilter]);

  // Apply the page filter, then bucket by urgency.
  const filteredInsights = useMemo(() => {
    if (activeFilter === ALL_FILTER) return activeInsights;
    return activeInsights.filter(
      (i) => areaKey(actionArea(i.type, i.category)) === activeFilter,
    );
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

  // Grouped by how pressing it is, and by nothing else.
  //
  // The page an action is about is named on the row and drives the filter above,
  // so grouping by it as well split one short list into several shorter ones and
  // said the same word twice on every row. Urgency is the order somebody works a
  // list in, so it is the only division the page makes.
  //
  // Grouping used to be by the step of the path each action served, which placed
  // an action by whether the path happened to have a rung for it rather than by
  // when it is worth doing.
  const grouped = useMemo(() => {
    const byUrgency = new Map<UrgencyGroup, typeof filteredInsights>();
    for (const i of filteredInsights) {
      const g = URGENCY_GROUP[i.urgency] ?? 'watch';
      const list = byUrgency.get(g) ?? [];
      list.push(i);
      byUrgency.set(g, list);
    }
    return URGENCY_ORDER.flatMap(({ key, title }) => {
      const items = byUrgency.get(key);
      if (!items?.length) return [];
      // `critical` leads `high` where both land in "worth doing now".
      const actions = [...items].sort(
        (a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0),
      );
      return [{ key, title, actions }];
    });
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
          <h1 className="font-editorial text-[28px] sm:text-[34px] font-bold leading-[1.02] tracking-[-0.03em] text-content">
            Actions
          </h1>
          <PageMeta>
            {/* The per-band counts used to be listed here, word for word the
                same as the three headings a few hundred pixels below. They sit
                on those headings now, where the rows they count are. */}
            {isLoading ? (
              <PageMetaSkeleton widths={['w-[150px]']} />
            ) : (
              totalActive > 0 && (
                <PageMetaItem className="ui-tnum">
                  {totalActive === 1 ? '1 open action' : `${totalActive} open actions`}
                </PageMetaItem>
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
          {/* Mirrors the real 62px row, so the list does not jump when it lands. */}
          {[2, 3].map((count, s) => (
            <div key={s} className="mb-9">
              <Skeleton className="h-5 w-44 mb-4" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: count }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-ui-md border border-line bg-panel shadow-ui-sm pl-4 pr-2 py-2.5">
                    <Skeleton className="h-6 w-6 shrink-0 rounded-ui-sm" />
                    <div className="flex-1 min-w-0">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="mt-1.5 h-5 w-40 rounded-ui-sm" />
                    </div>
                    <Skeleton className="h-4 w-4 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ════════ Category filter — shared SegmentedControl ════════ */}
      {/* The mask fades the clipped edge, so a rail wider than the phone reads
          as more-to-scroll rather than as a chip cut in half. */}
      {!isLoading && availableFilters.length > 1 && (
        <div
          className="mt-7 -mx-3 sm:mx-0 px-3 sm:px-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden animate-fade-in [mask-image:linear-gradient(to_right,transparent_0,#000_12px,#000_calc(100%-24px),transparent_100%)] sm:[mask-image:none]"
        >
          <SegmentedControl<FilterValue>
            aria-label="Filter actions by area"
            tone="brand"
            // Lives in a horizontal scroller — keep intrinsic width so many
            // filter segments scroll instead of squishing to fit the screen.
            stretch={false}
            value={activeFilter}
            onChange={setActiveFilter}
            options={availableFilters}
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

      {/* ════════ By when each one is worth doing ════════ */}
      {!isLoading &&
        totalActive > 0 &&
        grouped.map((band) => (
          <section key={band.key} className="mt-9 first:mt-8">
            <div className="flex items-center gap-3">
              <h2 className="font-editorial text-[19px] font-bold tracking-[-0.02em] text-content">
                {band.title}
              </h2>
              <span className="shrink-0 text-[13px] font-semibold text-content-muted ui-tnum">
                {band.actions.length}
              </span>
              {/* bg-line, not bg-hairline: there is no `hairline` colour key,
                  so that class resolved to transparent and the rule never
                  drew. `line` IS --ui-hairline. */}
              <span className="flex-1 h-px bg-line min-w-[12px]" aria-hidden />
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {band.actions.map((insight, idx) => (
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
                  showArea={activeFilter === ALL_FILTER}
                  onPrimary={() => {
                    const { link } = actionArea(insight.type, insight.category);
                    if (link) navigate(link);
                  }}
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
      {!isLoading && totalActive > 0 && activeFilter === ALL_FILTER && (
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
