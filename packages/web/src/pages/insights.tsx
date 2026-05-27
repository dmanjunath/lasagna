import { useState } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, RefreshCw, Zap } from 'lucide-react';
import { useInsights } from '../hooks/useInsights';
import { useChatStore } from '../lib/chat-store';
import { formatRelativeTime } from '../lib/utils';
import { LegalDisclaimer } from '../components/common/legal-disclaimer';
import {
  Page,
  PageHeader,
  Section,
  Button,
  Pill,
  Eyebrow,
  EmptyState,
  StatStrip,
  Lede,
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
    hint: 'Critical or high-impact actions — address these first',
    pillTone: 'sauce',
  },
  this_week: {
    label: 'This week',
    hint: 'Meaningful improvements worth acting on soon',
    pillTone: 'cheese',
  },
  watch: {
    label: 'Watch',
    hint: 'Keep an eye on these — no urgent action needed yet',
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
}: ActionRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { openChat } = useChatStore();

  return (
    <li className="ins-row">
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

              <div className="ins-row__callout">
                <Eyebrow style={{ marginBottom: 6 }}>Do this next</Eyebrow>
                <p className="ds-body" style={{ color: 'var(--lf-ink)', margin: 0 }}>
                  {title}
                </p>
              </div>

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
                  variant="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss();
                  }}
                  style={{ marginLeft: 'auto' }}
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
  const { openChat } = useChatStore();

  const { insights, lastActionsGeneratedAt, isLoading, dismiss, refresh } = useInsights();

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

  const handleDismiss = async (id: string) => {
    setDismissed((prev) => new Set([...prev, id]));
    await dismiss(id);
  };

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
  const thisWeekCount = grouped.this_week.length;
  const watchCount = grouped.watch.length;
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

  return (
    <Page>
      <PageHeader
        eyebrow={!isLoading ? `${doNowCount} urgent · ${thisWeekCount} this week` : 'Loading'}
        title="Actions"
        actions={
          <Button
            variant="primary"
            onClick={() => openChat('Can you explain my top financial actions and why they matter?')}
          >
            Walk me through this →
          </Button>
        }
      />

      <LegalDisclaimer variant="insights" />

      {!isLoading && totalCount > 0 && (
        <div style={{ marginBottom: 32 }}>
          <Lede>
            <Lede.Num>{totalCount}</Lede.Num> action{totalCount === 1 ? '' : 's'} for you today.
            {doNowCount > 0 && (
              <>
                {' '}
                <Lede.Num tone="neg">{doNowCount}</Lede.Num>{' '}
                {doNowCount === 1 ? 'is' : 'are'} time-sensitive
                {topAction && (
                  <>
                    {' — start with '}
                    <Lede.Num highlight>{topAction.title}</Lede.Num>
                  </>
                )}
              </>
            )}
            .
          </Lede>
        </div>
      )}

      {!isLoading && totalCount > 0 && (
        <StatStrip
          className="ins-stats"
          items={[
            {
              label: 'Total',
              value: <span className="ds-num">{totalCount}</span>,
              sub: 'active actions',
            },
            {
              label: 'Do now',
              value: <span className="ds-num">{doNowCount}</span>,
              sub: 'high priority',
              tone: 'neg',
            },
            {
              label: 'This week',
              value: <span className="ds-num">{thisWeekCount}</span>,
              sub: <span style={{ color: 'var(--lf-cheese)' }}>important</span>,
            },
            {
              label: 'Watch',
              value: <span className="ds-num">{watchCount}</span>,
              sub: 'keep an eye on',
              tone: 'pos',
            },
          ]}
        />
      )}

      {/* Filter pills + refresh meta */}
      {!isLoading && insights.length > 0 && (
        <Section
          actions={
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
          }
        >
          <div className="ins-filter-pills">
            {FILTER_PILLS.map((pill) => {
              const active = activeFilter === pill.value;
              return (
                <Button
                  key={pill.label}
                  variant={active ? 'ink' : 'ghost'}
                  size="sm"
                  onClick={() => setActiveFilter(pill.value)}
                >
                  {pill.label}
                </Button>
              );
            })}
          </div>
        </Section>
      )}

      {refreshError && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: '10px 14px',
            background: 'rgba(196, 70, 41, 0.08)',
            border: '1px solid var(--lf-sauce)',
            borderRadius: 10,
            color: 'var(--lf-sauce)',
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {refreshError}
        </div>
      )}

      {/* Empty / generate state */}
      {!isLoading && insights.length === 0 && (
        <EmptyState
          icon={<Zap size={32} />}
          title="No actions yet"
          body="Generate personalized actions based on your financial data."
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

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .ins-stats { margin: 0 0 40px; }

        .ins-filter-pills {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .ins-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .ins-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .ins-list--dim { opacity: 0.7; }

        .ins-row {
          border-top: 1px solid var(--lf-rule);
        }
        .ins-row:first-child { border-top: 1px solid var(--lf-ink); }
        .ins-row:last-child { border-bottom: 1px solid var(--lf-rule); }

        .ins-row__btn {
          display: flex;
          align-items: center;
          gap: 14px;
          width: 100%;
          background: none;
          border: 0;
          padding: 16px 0;
          text-align: left;
          cursor: pointer;
          color: inherit;
        }
        .ins-row__btn:hover .ins-row__title { color: var(--lf-sauce); }
        .ins-row__title {
          flex: 1;
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: 19px;
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
          padding: 4px 0 20px 0;
        }
        .ins-row__callout {
          background: var(--lf-cream);
          border: 1px solid var(--lf-rule);
          border-radius: 10px;
          padding: 12px 14px;
          margin-bottom: 14px;
          max-width: 62ch;
        }
        .ins-row__actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }

        @media (max-width: 640px) {
          .ins-row__title { font-size: 17px; }
        }
      `}</style>
    </Page>
  );
}
