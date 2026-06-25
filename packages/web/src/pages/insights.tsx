import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, RefreshCw, Zap, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useInsights } from '../hooks/useInsights';
import { useChatStore } from '../lib/chat-store';
import { formatRelativeTime } from '../lib/utils';
import { LegalDisclaimer } from '../components/common/legal-disclaimer';
import {
  Page,
  Section,
  Button,
  Pill,
  EmptyState,
} from '../components/ds';

// ---------------------------------------------------------------------------
// Urgency → display group mapping
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

const GROUP_META: Record<
  UrgencyGroup,
  { label: string; hint: string; pillTone: 'sauce' | 'cheese' | 'basil' }
> = {
  do_now: {
    label: 'Do now',
    hint: 'Address first',
    pillTone: 'sauce',
  },
  this_week: {
    label: 'This week',
    hint: 'Worth doing soon',
    pillTone: 'cheese',
  },
  watch: {
    label: 'Watch',
    hint: 'No rush',
    pillTone: 'basil',
  },
};

const GROUP_ORDER: UrgencyGroup[] = ['do_now', 'this_week', 'watch'];

// Filter pill definition
type FilterValue = null | 'do_now' | 'this_week' | 'watch' | 'completed';

const FILTER_PILLS: { label: string; value: FilterValue }[] = [
  { label: 'All', value: null },
  { label: 'High priority', value: 'do_now' },
  { label: 'Important', value: 'this_week' },
  { label: 'Watch', value: 'watch' },
  { label: 'Completed', value: 'completed' },
];

// ---------------------------------------------------------------------------
// Area chip → ds-Pill tone
// ---------------------------------------------------------------------------

function areaPillTone(type: string | null): 'sauce' | 'cheese' | 'basil' | 'cream' | 'ghost' {
  const t = (type ?? '').toLowerCase();
  if (t === 'spending' || t === 'behavioral') return 'sauce';
  if (t === 'debt') return 'cheese';
  if (t === 'tax' || t === 'portfolio') return 'basil';
  if (t === 'savings' || t === 'retirement') return 'cream';
  return 'ghost';
}

// Page links per area type
const PAGE_LINKS: Record<string, string> = {
  spending: '/spending',
  behavioral: '/spending',
  debt: '/debt',
  tax: '/tax',
  portfolio: '/portfolio',
  savings: '/goals',
  retirement: '/retirement',
  general: '/',
};

// ---------------------------------------------------------------------------
// Action row — editorial hairline-separated, expands inline
// ---------------------------------------------------------------------------

interface ActionRowProps {
  title: string;
  type: string | null;
  description: string;
  chatPrompt: string;
  onDismiss: () => void;
  onOpenArea?: () => void;
  areaLabel: string;
  defaultOpen?: boolean;
  priority?: 'do_now' | 'this_week' | 'watch';
}

function ActionRow({
  title,
  type,
  description,
  chatPrompt,
  onDismiss,
  onOpenArea,
  areaLabel,
  defaultOpen = false,
  priority = 'watch',
}: ActionRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { openChat } = useChatStore();

  return (
    <li className={`ins-row ins-row--${priority}${open ? ' ins-row--open' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ins-row__btn"
        aria-expanded={open}
      >
        <Pill tone={areaPillTone(type)}>{areaLabel}</Pill>
        <span className="ins-row__title">{title}</span>
        <ChevronDown
          size={16}
          className="ins-row__chev"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="ins-row__body">
              <p className="ds-body" style={{ margin: '0 0 14px', maxWidth: '62ch' }}>
                {description}
              </p>

              <div className="ins-row__actions">
                <Button
                  variant="ink"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openChat(
                      `Walk me through this insight:\n\nTitle: ${title}\nDescription: ${description}\n\n${chatPrompt}`
                    );
                  }}
                >
                  Walk me through this →
                </Button>

                {onOpenArea && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenArea();
                    }}
                  >
                    Open in {areaLabel}
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="ins-dismiss-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss();
                  }}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Insights() {
  const [activeFilter, setActiveFilter] = useState<FilterValue>(null);
  const [, navigate] = useLocation();
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

  const activeInsights = insights.filter((i) => !dismissed.has(i.id));
  const completedInsights = insights.filter((i) => dismissed.has(i.id));

  const grouped = GROUP_ORDER.reduce<
    Record<UrgencyGroup, typeof activeInsights>
  >(
    (acc, g) => {
      acc[g] = activeInsights.filter(
        (i) => (URGENCY_GROUP[i.urgency] ?? 'watch') === g
      );
      return acc;
    },
    { do_now: [], this_week: [], watch: [] }
  );

  const doNowCount = grouped.do_now.length;
  const totalCount = activeInsights.length;

  // Top action for the lede
  const topAction = [...activeInsights].sort(
    (a, b) => (URGENCY_RANK[b.urgency] ?? 0) - (URGENCY_RANK[a.urgency] ?? 0),
  )[0];

  const visibleGroups: UrgencyGroup[] =
    activeFilter === null
      ? GROUP_ORDER
      : activeFilter === 'completed'
      ? []
      : [activeFilter as UrgencyGroup];

  const showCompleted =
    activeFilter === null || activeFilter === 'completed';

  // Iter 8: ds-page-bar replaces the editorial PageHeader + Lede. Title is
  // always terse; the live action count rides the subtitle slot (inline on
  // desktop, dropped to a sub-row on mobile).
  const captionBits: string[] = [];
  if (!isLoading && totalCount > 0) {
    captionBits.push(`${totalCount} open`);
    if (doNowCount > 0) captionBits.push(`${doNowCount} urgent`);
  }
  const subtitleText = captionBits.length > 0 ? captionBits.join(' · ') : null;

  return (
    <Page>
      <header className="ds-page-bar">
        <div className="ds-page-bar__title-group">
          <h1 className="ds-page-bar__title">Actions</h1>
          {subtitleText && (
            <span className="ds-page-bar__subtitle">{subtitleText}</span>
          )}
        </div>
      </header>
      {subtitleText && (
        <div className="ds-page-bar__subtitle-mobile">{subtitleText}</div>
      )}

      <LegalDisclaimer variant="insights" />

      {/* Loading — shaped skeleton matching the toolbar + grouped feed so the
          first paint reserves the same space the loaded page consumes. */}
      {isLoading && (
        <div className="ins-skeleton" aria-hidden="true">
          <div className="ins-skeleton__toolbar">
            {[64, 92, 84, 64].map((w, i) => (
              <span key={i} className="ds-skeleton" style={{ height: 30, width: w, borderRadius: 999 }} />
            ))}
          </div>
          {[2, 3].map((count, s) => (
            <div className="ins-skeleton__section" key={s}>
              <span className="ds-skeleton" style={{ display: 'block', height: 10, width: 150, borderRadius: 4, marginBottom: 12 }} />
              <span className="ds-skeleton" style={{ display: 'block', height: 22, width: 110, borderRadius: 6, marginBottom: 16 }} />
              <ul className="ins-list">
                {Array.from({ length: count }).map((_, i) => (
                  <li key={i} className="ins-row ins-row--skeleton">
                    <div className="ins-row__btn" style={{ cursor: 'default' }}>
                      <span className="ds-skeleton" style={{ height: 20, width: 56, borderRadius: 999, flexShrink: 0 }} />
                      <span className="ds-skeleton" style={{ height: 16, width: `${[62, 74, 48][i % 3]}%`, borderRadius: 4 }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Filter pills + refresh meta — one aligned toolbar row */}
      {!isLoading && insights.length > 0 && (
        <div className="ins-toolbar">
          <div className="ins-filter-scroll">
            <div className="ins-filter-pills">
              {FILTER_PILLS.map((pill) => {
                const active = activeFilter === pill.value;
                return (
                  <Button
                    key={pill.label}
                    variant={active ? 'ink' : 'ghost'}
                    size="sm"
                    className="ins-filter-pill"
                    onClick={() => setActiveFilter(pill.value)}
                  >
                    {pill.label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="ins-meta">
            {lastActionsGeneratedAt && (
              <span className="ds-caption" style={{ whiteSpace: 'nowrap' }}>
                Updated {formatRelativeTime(lastActionsGeneratedAt)}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || !refreshReady}
              title={!refreshReady ? 'Actions refresh once every 3 hours' : undefined}
              icon={
                <RefreshCw
                  size={12}
                  style={{
                    animation: refreshing ? 'spin 1s linear infinite' : undefined,
                  }}
                />
              }
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>
      )}

      {refreshError && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: 'color-mix(in srgb, var(--lf-neg) 8%, transparent)',
            border: '1px solid var(--lf-neg)',
            borderRadius: 10,
            color: 'var(--lf-neg)',
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {refreshError}
        </div>
      )}

      {/* Empty state — adaptive. If we've never generated, invite the user to
          generate; if a run produced nothing, they're caught up. */}
      {!isLoading && insights.length === 0 && (
        lastActionsGeneratedAt ? (
          <EmptyState
            icon={<CheckCircle2 size={28} />}
            title="You're all caught up"
            body="No open actions right now. We'll surface new ones as your accounts, spending, and goals change."
            cta={
              <Button
                variant="ghost"
                onClick={handleRefresh}
                disabled={refreshing || !refreshReady}
                title={!refreshReady ? 'Actions refresh once every 3 hours' : undefined}
                icon={
                  <RefreshCw
                    size={14}
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
            icon={<Zap size={28} />}
            title="No actions yet"
            body="Generate a personalized set of actions from your accounts, spending, and goals."
            cta={
              <Button
                variant="ink"
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

      {/* Grouped action lists — each section renders rows as editorial articles */}
      {!isLoading &&
        visibleGroups.map((group) => {
          const items = grouped[group];
          if (!items.length) return null;
          const meta = GROUP_META[group];
          return (
            <motion.div
              key={group}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              <Section
                title={meta.label}
                eyebrow={`${items.length} ${items.length === 1 ? 'action' : 'actions'} · ${meta.hint}`}
              >
                <ul className="ins-list">
                  {items.map((insight, idx) => {
                    const insightType = insight.type ?? insight.category ?? 'general';
                    const contextLink = PAGE_LINKS[insightType];
                    const areaLabel = insightType.charAt(0).toUpperCase() + insightType.slice(1);

                    return (
                      <ActionRow
                        key={insight.id}
                        title={insight.title}
                        type={insight.type}
                        description={insight.description}
                        chatPrompt={insight.chatPrompt ?? insight.title}
                        areaLabel={areaLabel}
                        defaultOpen={idx === 0 && group === 'do_now'}
                        priority={group}
                        onDismiss={() => handleDismiss(insight.id)}
                        onOpenArea={
                          contextLink ? () => navigate(contextLink) : undefined
                        }
                      />
                    );
                  })}
                </ul>
              </Section>
            </motion.div>
          );
        })}

      {/* Completed / dismissed */}
      {!isLoading && showCompleted && completedInsights.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Section
            title="Completed"
            eyebrow={`${completedInsights.length} dismissed`}
          >
            <ul className="ins-list ins-list--dim">
              {completedInsights.map((insight) => {
                const insightType = insight.type ?? insight.category ?? 'general';
                const areaLabel =
                  insightType.charAt(0).toUpperCase() + insightType.slice(1);

                return (
                  <li key={insight.id} className="ins-row ins-row--done">
                    <div className="ins-row__btn" style={{ cursor: 'default' }}>
                      <Pill tone={areaPillTone(insight.type)}>{areaLabel}</Pill>
                      <span
                        className="ins-row__title"
                        style={{
                          color: 'var(--lf-muted)',
                          textDecoration: 'line-through',
                        }}
                      >
                        {insight.title}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        </motion.div>
      )}

      {/* Undo affordance — deferred server commit means a mis-tap is recoverable */}
      <AnimatePresence>
        {pendingUndo && (
          <motion.div
            initial={{ opacity: 0, x: '-50%', y: 12 }}
            animate={{ opacity: 1, x: '-50%', y: 0 }}
            exit={{ opacity: 0, x: '-50%', y: 12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            style={{
              position: 'fixed',
              bottom: 24,
              left: '50%',
              zIndex: 60,
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '12px 18px',
              background: 'var(--lf-ink)',
              color: 'var(--lf-paper)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-card)',
              fontSize: 14,
            }}
          >
            <span>Action dismissed</span>
            <button
              type="button"
              onClick={handleUndo}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                font: 'inherit',
                fontWeight: 600,
                color: 'var(--lf-paper)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                cursor: 'pointer',
              }}
            >
              Undo
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* Loading skeleton — mirrors the toolbar + grouped feed rhythm. */
        .ins-skeleton__toolbar {
          display: flex;
          gap: 8px;
          margin: 0 0 28px;
        }
        .ins-skeleton__section { margin-bottom: 28px; }
        .ins-skeleton__section:last-child { margin-bottom: 0; }
        .ins-row--skeleton { cursor: default; }
        @media (max-width: 640px) {
          .ins-skeleton__section { margin-bottom: 20px; }
        }

        /* Filter pills + meta share one vertically-centered row. */
        .ins-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin: 0 0 20px;
        }
        @media (max-width: 640px) {
          .ins-toolbar { flex-wrap: wrap; gap: 10px; }
          .ins-filter-scroll { flex: 1 1 100%; }
          .ins-meta { width: 100%; justify-content: flex-end; }
        }

        /* Header CTA: full width on mobile is overkill — shrink to sm sizing. */
        @media (max-width: 640px) {
          .ins-walk-cta {
            font-size: 13px;
            padding: 8px 12px;
          }
        }

        /* Filter pills: horizontally scroll on mobile rather than wrap. */
        .ins-filter-scroll {
          flex: 1;
          min-width: 0;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          margin: 0 -16px;
          padding: 0 16px;
          scrollbar-width: none;
        }
        .ins-filter-scroll::-webkit-scrollbar { display: none; }
        .ins-filter-pills {
          display: flex;
          gap: 8px;
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        .ins-filter-pill { flex-shrink: 0; }
        @media (min-width: 768px) {
          .ins-filter-scroll { overflow-x: visible; margin: 0; padding: 0; }
          .ins-filter-pills { flex-wrap: wrap; white-space: normal; }
        }

        /* Action row: push Dismiss to the right on desktop only — on mobile it
           wraps into the next row naturally. */
        @media (min-width: 768px) {
          .ins-row__actions .ins-dismiss-btn { margin-left: auto; }
        }
        .ins-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        /* Each action is its own card (matches the dashboard Card surface), in
           a simple gap stack — not a single hairline-row panel. */
        .ins-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .ins-list--dim { opacity: 0.7; }

        .ins-row {
          background: var(--lf-surface);
          border: 1px solid var(--lf-rule-neutral);
          border-radius: 12px;
          box-shadow: var(--shadow-card);
          overflow: hidden;
        }

        .ins-row__btn {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          background: none;
          border: 0;
          padding: 16px 18px;
          text-align: left;
          cursor: pointer;
          color: inherit;
        }
        .ins-row__btn:hover .ins-row__title { color: var(--lf-sauce); }
        .ins-row__title {
          flex: 1;
          font-family: 'Geist', system-ui, sans-serif;
          font-size: 16px;
          font-weight: 500;
          color: var(--lf-ink);
          line-height: 1.25;
          letter-spacing: -0.005em;
          transition: color 0.15s;
        }
        .ins-row__chev {
          color: var(--lf-muted);
          flex-shrink: 0;
          transition: transform 0.2s ease;
        }

        .ins-row__body {
          padding: 0 18px 18px;
        }
        .ins-row__actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        @media (max-width: 640px) {
          .ins-row__btn { padding: 16px 14px; }
          .ins-row__body { padding: 0 14px 18px; }
          /* Expanded action buttons meet the 44px touch minimum on mobile. */
          .ins-row__actions .ds-btn { min-height: 44px; }
        }
      `}</style>
    </Page>
  );
}
