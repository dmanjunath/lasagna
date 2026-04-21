import { useState } from 'react';
import { useLocation } from 'wouter';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, RefreshCw, Zap } from 'lucide-react';
import { useInsights } from '../hooks/useInsights';
import { useChatStore } from '../lib/chat-store';

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

const GROUP_META: Record<
  UrgencyGroup,
  { label: string; hint: string; color: string }
> = {
  do_now: {
    label: 'High priority',
    hint: 'Critical or high-impact actions — address these first',
    color: 'var(--lf-sauce)',
  },
  this_week: {
    label: 'Important',
    hint: 'Meaningful improvements worth acting on soon',
    color: 'var(--lf-cheese)',
  },
  watch: {
    label: 'Watch',
    hint: 'Keep an eye on these — no urgent action needed yet',
    color: 'var(--lf-basil)',
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
// Area chip color
// ---------------------------------------------------------------------------

function areaChipStyle(type: string | null): React.CSSProperties {
  const t = (type ?? '').toLowerCase();
  let bg = 'var(--lf-muted)';
  let color = 'var(--lf-paper)';

  if (t === 'spending' || t === 'behavioral') {
    bg = 'var(--lf-sauce)';
  } else if (t === 'debt') {
    bg = 'var(--lf-cheese)';
    color = 'var(--lf-ink)';
  } else if (t === 'tax' || t === 'portfolio') {
    bg = 'var(--lf-basil)';
  } else if (t === 'savings' || t === 'retirement') {
    bg = 'var(--lf-noodle)';
    color = 'var(--lf-ink)';
  }

  return {
    display: 'inline-block',
    background: bg,
    color,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    padding: '2px 8px',
    borderRadius: 4,
    lineHeight: '18px',
  };
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
// Expandable action card
// ---------------------------------------------------------------------------

interface ActionCardProps {
  title: string;
  type: string | null;
  description: string;
  chatPrompt: string;
  onDismiss: () => void;
  onOpenArea?: () => void;
  areaLabel: string;
  defaultOpen?: boolean;
}

function ActionCard({
  title,
  type,
  description,
  chatPrompt,
  onDismiss,
  onOpenArea,
  areaLabel,
  defaultOpen = false,
}: ActionCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const { openChat } = useChatStore();

  return (
    <div
      style={{
        background: 'var(--lf-paper)',
        border: '1px solid var(--lf-rule)',
        borderRadius: 14,
        overflow: 'hidden',
        marginBottom: 8,
      }}
    >
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '14px 16px',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {/* Area chip */}
        <span style={areaChipStyle(type)}>{areaLabel}</span>

        {/* Title */}
        <span
          style={{
            flex: 1,
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: 16,
            letterSpacing: '0.04em',
            color: 'var(--lf-ink)',
            lineHeight: 1.3,
          }}
        >
          {title}
        </span>

        {/* DATA-NEEDED: impact dollar amount not available on insight object */}

        {/* Chevron */}
        <ChevronDown
          size={16}
          style={{
            color: 'var(--lf-muted)',
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>

      {/* Expanded body */}
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
            <div
              style={{
                padding: '0 16px 16px',
                borderTop: '1px solid var(--lf-rule)',
              }}
            >
              {/* Rationale */}
              <p
                style={{
                  fontSize: 14,
                  color: 'var(--lf-muted)',
                  lineHeight: 1.6,
                  margin: '14px 0 12px',
                }}
              >
                {description}
              </p>

              {/* "Do this next" box */}
              <div
                style={{
                  background: 'var(--lf-cream)',
                  border: '1px solid var(--lf-rule)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 14,
                }}
              >
                <p
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--lf-muted)',
                    marginBottom: 6,
                  }}
                >
                  Do this next
                </p>
                {/* DATA-NEEDED: specific step text not on insight; using title as placeholder */}
                <p
                  style={{
                    fontSize: 14,
                    color: 'var(--lf-ink)',
                    lineHeight: 1.5,
                    margin: 0,
                  }}
                >
                  {title}
                </p>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openChat(chatPrompt);
                  }}
                  style={{
                    padding: '8px 14px',
                    background: 'var(--lf-ink)',
                    color: 'var(--lf-paper)',
                    border: 'none',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                >
                  Ask LasagnaFi →
                </button>

                {onOpenArea && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenArea();
                    }}
                    style={{
                      padding: '8px 14px',
                      background: 'none',
                      color: 'var(--lf-ink)',
                      border: '1px solid var(--lf-rule)',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      lineHeight: 1,
                    }}
                  >
                    Open in {areaLabel}
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss();
                  }}
                  style={{
                    marginLeft: 'auto',
                    padding: '8px 14px',
                    background: 'none',
                    color: 'var(--lf-muted)',
                    border: '1px solid var(--lf-rule)',
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: 'pointer',
                    lineHeight: 1,
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Urgency section header
// ---------------------------------------------------------------------------

function UrgencyHeader({
  group,
  count,
}: {
  group: UrgencyGroup;
  count: number;
}) {
  const meta = GROUP_META[group];
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
      {/* Colored dot */}
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: meta.color,
          flexShrink: 0,
          position: 'relative',
          top: -1,
        }}
      />
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--lf-ink)',
          fontWeight: 600,
        }}
      >
        {meta.label}
      </span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          color: 'var(--lf-muted)',
        }}
      >
        {count}
      </span>
      <span
        style={{
          fontSize: 13,
          color: 'var(--lf-muted)',
          marginLeft: 2,
        }}
      >
        {meta.hint}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function Insights() {
  const [activeFilter, setActiveFilter] = useState<FilterValue>(null);
  const [, navigate] = useLocation();
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const { openChat } = useChatStore();

  // Fetch all insights unfiltered — we handle grouping locally
  const { insights, isLoading, dismiss, refresh } = useInsights();

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const handleDismiss = async (id: string) => {
    setDismissed((prev) => new Set([...prev, id]));
    await dismiss(id);
  };

  // Separate active vs dismissed
  const activeInsights = insights.filter((i) => !dismissed.has(i.id));
  const completedInsights = insights.filter((i) => dismissed.has(i.id));

  // Group active insights by urgency group
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

  // Determine which groups/items to show based on active filter
  const visibleGroups: UrgencyGroup[] =
    activeFilter === null
      ? GROUP_ORDER
      : activeFilter === 'completed'
      ? []
      : [activeFilter as UrgencyGroup];

  const showCompleted =
    activeFilter === null || activeFilter === 'completed';

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--lf-paper)' }} className="scrollbar-thin">
    <style>{`
      @media (max-width: 480px) {
        .insights-hero-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 16px !important; }
        .insights-hero-grid > div { border-left: none !important; padding: 8px !important; }
      }
    `}</style>
    <div
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: 'clamp(16px, 4vw, 40px)',
        paddingBottom: 'clamp(80px, 12vw, 48px)',
      }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 36,
              fontWeight: 400,
              color: 'var(--lf-ink)',
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Actions
          </h1>
          {!isLoading && (
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--lf-muted)',
                margin: '6px 0 0',
              }}
            >
              {doNowCount} urgent · {thisWeekCount} this week
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => openChat('Can you explain my top financial actions and why they matter?')}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--lf-muted)',
            background: 'none',
            border: '1px solid var(--lf-rule)',
            borderRadius: 8,
            padding: '6px 12px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Ask LasagnaFi →
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Dark hero card — summary grid                                        */}
      {/* ------------------------------------------------------------------ */}
      {!isLoading && totalCount > 0 && (
        <div
          className="insights-hero-grid"
          style={{
            background: 'var(--lf-ink)',
            color: 'var(--lf-paper)',
            borderRadius: 14,
            padding: '24px',
            marginBottom: 24,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 0,
          }}
        >
          {/* Total */}
          <div style={{ textAlign: 'center', padding: '0 12px' }}>
            <p
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 52,
                fontWeight: 400,
                lineHeight: 1,
                margin: '0 0 4px',
                color: 'var(--lf-paper)',
              }}
            >
              {totalCount}
            </p>
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                margin: 0,
              }}
            >
              Total
            </p>
          </div>

          {/* Do now */}
          <div
            style={{
              textAlign: 'center',
              padding: '0 12px',
              borderLeft: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <p
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 52,
                fontWeight: 400,
                lineHeight: 1,
                margin: '0 0 4px',
                color: 'var(--lf-sauce)',
              }}
            >
              {doNowCount}
            </p>
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                margin: 0,
              }}
            >
              Do now
            </p>
          </div>

          {/* This week */}
          <div
            style={{
              textAlign: 'center',
              padding: '0 12px',
              borderLeft: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <p
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 52,
                fontWeight: 400,
                lineHeight: 1,
                margin: '0 0 4px',
                color: 'var(--lf-cheese)',
              }}
            >
              {thisWeekCount}
            </p>
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                margin: 0,
              }}
            >
              This week
            </p>
          </div>

          {/* Watch */}
          <div
            style={{
              textAlign: 'center',
              padding: '0 12px',
              borderLeft: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <p
              style={{
                fontFamily: "'Instrument Serif', Georgia, serif",
                fontSize: 52,
                fontWeight: 400,
                lineHeight: 1,
                margin: '0 0 4px',
                color: 'var(--lf-basil)',
              }}
            >
              {watchCount}
            </p>
            <p
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.45)',
                margin: 0,
              }}
            >
              Watch
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Filter pills                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 2,
          marginBottom: 24,
          scrollbarWidth: 'none',
        }}
      >
        {FILTER_PILLS.map((pill) => {
          const active = activeFilter === pill.value;
          return (
            <button
              key={pill.label}
              type="button"
              onClick={() => setActiveFilter(pill.value)}
              style={{
                flexShrink: 0,
                padding: '6px 14px',
                borderRadius: 100,
                border: active
                  ? '1px solid var(--lf-ink)'
                  : '1px solid var(--lf-rule)',
                background: active ? 'var(--lf-ink)' : 'var(--lf-paper)',
                color: active ? 'var(--lf-paper)' : 'var(--lf-muted)',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {pill.label}
            </button>
          );
        })}

        {/* Spacer + Refresh button */}
        <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              border: '1px solid var(--lf-rule)',
              borderRadius: 100,
              background: 'none',
              color: 'var(--lf-muted)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? 0.5 : 1,
            }}
          >
            <RefreshCw
              size={12}
              style={{
                animation: refreshing ? 'spin 1s linear infinite' : undefined,
              }}
            />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Loading state                                                        */}
      {/* ------------------------------------------------------------------ */}
      {isLoading && (
        <div
          style={{
            textAlign: 'center',
            padding: '64px 0',
            color: 'var(--lf-muted)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
          }}
        >
          Loading actions…
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Empty / generate state                                               */}
      {/* ------------------------------------------------------------------ */}
      {!isLoading && insights.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '64px 24px',
          }}
        >
          <Zap
            size={32}
            style={{ color: 'var(--lf-muted)', margin: '0 auto 16px' }}
          />
          <p
            style={{
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 22,
              color: 'var(--lf-ink)',
              marginBottom: 8,
            }}
          >
            No actions yet.
          </p>
          <p
            style={{
              fontSize: 14,
              color: 'var(--lf-muted)',
              marginBottom: 20,
            }}
          >
            Generate personalized actions based on your financial data.
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              padding: '10px 20px',
              background: 'var(--lf-ink)',
              color: 'var(--lf-paper)',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 500,
              cursor: refreshing ? 'not-allowed' : 'pointer',
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? 'Generating…' : 'Generate insights'}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Grouped action list                                                  */}
      {/* ------------------------------------------------------------------ */}
      {!isLoading &&
        visibleGroups.map((group) => {
          const items = grouped[group];
          if (!items.length) return null;
          return (
            <motion.section
              key={group}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              style={{ marginBottom: 32 }}
            >
              <UrgencyHeader group={group} count={items.length} />
              {items.map((insight, idx) => {
                const insightType = insight.type ?? insight.category ?? 'general';
                const contextLink = PAGE_LINKS[insightType];
                const areaLabel = insightType.charAt(0).toUpperCase() + insightType.slice(1);

                return (
                  <ActionCard
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
            </motion.section>
          );
        })}

      {/* ------------------------------------------------------------------ */}
      {/* Completed / dismissed group                                          */}
      {/* ------------------------------------------------------------------ */}
      {!isLoading && showCompleted && completedInsights.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          style={{ marginBottom: 32 }}
        >
          {/* Completed header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--lf-muted)',
                flexShrink: 0,
                position: 'relative',
                top: -1,
              }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--lf-muted)',
                fontWeight: 600,
              }}
            >
              Completed
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                color: 'var(--lf-muted)',
              }}
            >
              {completedInsights.length}
            </span>
          </div>

          {completedInsights.map((insight) => {
            const insightType = insight.type ?? insight.category ?? 'general';
            const areaLabel =
              insightType.charAt(0).toUpperCase() + insightType.slice(1);

            return (
              <div
                key={insight.id}
                style={{
                  background: 'var(--lf-cream)',
                  border: '1px solid var(--lf-rule)',
                  borderRadius: 14,
                  padding: '12px 16px',
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  opacity: 0.6,
                }}
              >
                <span style={areaChipStyle(insight.type)}>{areaLabel}</span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 14,
                    color: 'var(--lf-muted)',
                    textDecoration: 'line-through',
                  }}
                >
                  {insight.title}
                </span>
              </div>
            );
          })}
        </motion.section>
      )}

      {/* Spin keyframe for refresh icon */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
    </div>
  );
}
