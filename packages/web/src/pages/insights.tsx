import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, CheckCircle2, Check, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useInsights } from '../hooks/useInsights';
import { useActionLifecycle } from '../hooks/useActionLifecycle';
import { actionArea, areaKey, groupByArea } from '../lib/action-destination';
import { formatRelativeTime } from '../lib/utils';
import { toActionRow } from '../lib/action-rows';
import { Button, PageMeta, PageMetaItem, PageMetaSkeleton, Skeleton, SegmentedControl, EmptyState } from '../components/uikit';
import { PageTitle } from '../components/ds/PageTitle';
import { ActionItem } from '../components/common/action-item';
import { UndoToast } from '../components/common/undo-toast';

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
// Main page
// ---------------------------------------------------------------------------

export function Insights() {
  const [activeFilter, setActiveFilter] = useState<FilterValue>(ALL_FILTER);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const { insights, lastActionsGeneratedAt, isLoading: insightsLoading, refresh } = useInsights();
  const lifecycle = useActionLifecycle();

  const REFRESH_COOLDOWN_MS = 3 * 60 * 60 * 1000;
  const msSinceLastGen = lastActionsGeneratedAt
    ? Date.now() - lastActionsGeneratedAt.getTime()
    : Infinity;
  const refreshReady = msSinceLastGen >= REFRESH_COOLDOWN_MS;
  const isLoading = insightsLoading;

  /**
   * The one refresh control in the app, and it redoes BOTH producers.
   *
   * The detected savings are throttled on their own marker, six hours against
   * this button's three, so a refusal there is expected and must not stop the
   * written actions from regenerating.
   */
  const handleRefresh = async () => {
    if (!refreshReady) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      await api.refreshSpendCuts().catch(() => {});
      await refresh();
    } catch {
      setRefreshError("Couldn't refresh actions right now. Please try again later.");
    } finally {
      setRefreshing(false);
    }
  };

  // One model for both producers, so the row below does not have to know which
  // workflow wrote it.
  const activeInsights = useMemo(
    () => insights.map(toActionRow).filter((r) => !lifecycle.hidden.has(r.id)),
    [insights, lifecycle.hidden],
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

  return (
    <div
      ref={lifecycle.rootRef}
      tabIndex={-1}
      className="mx-auto max-w-[1160px] px-3 sm:px-11 pt-4 md:pt-9 pb-6 sm:pb-28 text-content focus:outline-none"
    >
      {/* ════════ Header ════════ */}
      <header className="flex items-start justify-between gap-6 flex-wrap animate-fade-in">
        <div>
          <PageTitle className="tracking-[-0.03em]">Actions</PageTitle>
          <PageMeta className="mt-0 md:mt-1.5">
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
              // `primary` rather than a ghost wearing four override classes:
              // ghost's own `hover:text-content` outlived the override, so
              // hovering turned the label and icon near-black on the mint pill.
              // This variant IS the brand-soft pill.
              variant="primary"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || !refreshReady}
              title={!refreshReady ? 'Actions refresh once every 3 hours' : undefined}
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
              {band.actions.map((row) => {
                const area = actionArea(row.type, row.category);
                return (
                  <ActionItem
                    key={row.id}
                    full
                    rowId={row.id}
                    title={row.title}
                    tag={(row.type ?? row.category ?? 'general').toUpperCase()}
                    // The label is dropped when a page filter is on and every
                    // row on screen is already that page, so the tag would
                    // repeat the chip above it once per row. The tone stays.
                    area={
                      activeFilter === ALL_FILTER
                        ? { label: area.label, tone: area.tone }
                        : { tone: area.tone }
                    }
                    description={row.description}
                    impact={row.impact ?? ''}
                    impactColor={row.impactColor}
                    chatPrompt={row.chatPrompt}
                    evidence={row.evidence ?? undefined}
                    amount={row.amount ?? undefined}
                    // Whether this row's figure is money back. A row where it is
                    // not prints its own words in the pill rather than a
                    // money-shaped label that would read as a saving.
                    handsMoneyBack={row.handsMoneyBack}
                    effort={row.effort ?? undefined}
                    transactions={row.transactions}
                    txnCount={row.txnCount}
                    txnScope={row.txnScope ?? undefined}
                    // The server's drill where there is one, or the page this
                    // action is about. The catch-all area has no page, and
                    // "Open Overview" used to navigate nowhere.
                    destination={
                      row.drill ??
                      (area.link ? { label: `Open ${area.label}`, href: area.link } : undefined)
                    }
                    onComplete={() => lifecycle.act(row.id, 'completed')}
                    onSnooze={() => lifecycle.act(row.id, 'snoozed')}
                    onDismiss={() => lifecycle.act(row.id, 'dismissed')}
                  />
                );
              })}
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

      <UndoToast
        ref={lifecycle.undoRef}
        message={lifecycle.message}
        failure={lifecycle.failure}
        onUndo={lifecycle.undo}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
