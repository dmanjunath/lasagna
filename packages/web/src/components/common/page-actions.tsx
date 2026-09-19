import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useInsights } from '../../hooks/useInsights';
import { useActionLifecycle } from '../../hooks/useActionLifecycle';
import { actionArea, areaKey } from '../../lib/action-destination';
import { rankActions, savingsSentence, toActionRow } from '../../lib/action-rows';
import { MaskedText } from '../uikit';
import { ActionItem } from './action-item';
import { UndoToast } from './undo-toast';

interface PageActionsProps {
  /** Filter to specific insight type(s). Omit for all types (Home/Focus). */
  types?: string | string[];
  /** Show a "View all →" link (Home page only) */
  viewAllHref?: string;
  /**
   * Render the complete actions surface: the effort pill, the savings
   * sentence, the transactions behind each figure, and the three lifecycle
   * verbs.
   *
   * Off by default, and the default is load-bearing. Debt, goals and investing
   * embed this section as a short list of model-authored advice, and none of
   * those rows has a figure to sum or a receipt to open, so rolling the whole
   * surface out to them would add two verbs nobody asked for.
   */
  full?: boolean;
}

export function PageActions(props: PageActionsProps) {
  return props.full ? <FullActions {...props} /> : <EmbeddedActions {...props} />;
}

/**
 * Actions as a page embeds them: a short list, a refresh, nothing to add up.
 */
function EmbeddedActions({ types, viewAllHref }: PageActionsProps) {
  const { insights, isLoading, dismiss, refresh } = useInsights(types);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading || insights.length === 0) return null;

  return (
    <div className="mb-8">
      {/* Section header - heading + quiet controls (matches redesigned pages) */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-[18px] font-semibold text-content">Actions</h2>

        <div className="flex items-center gap-3">
          {viewAllHref && (
            <a
              href={viewAllHref}
              className="text-[12.5px] font-semibold text-content-muted hover:text-brand transition-colors"
            >
              View all →
            </a>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="touch-target-inline inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-content-muted hover:text-brand transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className="h-[13px] w-[13px]"
              style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }}
            />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Action cards — stacked, on-skin, matching /insights */}
      <div className="flex flex-col gap-2">
        {insights.map((insight) => (
          <ActionItem
            key={insight.id}
            title={insight.title}
            tag={(insight.type ?? insight.category ?? 'general').toUpperCase()}
            description={insight.description}
            impact={insight.impact ?? ''}
            impactColor={(insight.impactColor as 'green' | 'amber' | 'red') ?? 'amber'}
            chatPrompt={insight.chatPrompt ?? insight.title}
            onDismiss={() => dismiss(insight.id)}
          />
        ))}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/**
 * Every action for this part of someone's money, whichever workflow found it,
 * ranked by how much work it asks for and summed by the period it pays back in.
 *
 * Both producers land in one list on purpose. A detected saving is completed,
 * snoozed and dismissed exactly like a written one, so a second list with a
 * second table and a second dismiss would be the same feature built twice.
 *
 * There is no refresh here. The paid regeneration lives on /insights, which is
 * the one control for it, and a second button on this page would be a second
 * answer to "when were these worked out".
 */
function FullActions({ types }: PageActionsProps) {
  const { insights, isLoading } = useInsights(types);
  // Destructured rather than read off `lifecycle.x` in the markup: the
  // react-hooks/refs rule taints the whole object because it carries rootRef
  // and undoRef alongside plain state, and then flags `message`/`failure`/
  // `undo` as ref reads during render. They are not.
  const { hidden, everActed, act, undo, undoRef, rootRef, message, failure } =
    useActionLifecycle();

  const rows = useMemo(() => insights.map(toActionRow), [insights]);
  const live = useMemo(
    () => rows.filter((r) => !hidden.has(r.id)),
    [rows, hidden],
  );

  const shown = useMemo(() => rankActions(live), [live]);

  /**
   * The sum of exactly the rows on screen that hand money back, so a reader
   * adding those pills up lands on this line. `shown` already has the rows
   * waiting out an undo window removed.
   */
  const sentence = savingsSentence(shown);

  // Every row here belongs to the page it is embedded on, so naming the area
  // once per row would repeat the page's own title down the list. The tone
  // stays, because it is the row's one colour.
  const oneArea =
    new Set(shown.map((r) => areaKey(actionArea(r.type, r.category)))).size <= 1;

  // Nothing at all before the first row exists: the page owns its own loading,
  // its own failure and its own connect-an-account state, and each of those is
  // directly above this section.
  if (isLoading) return null;
  if (live.length === 0 && !everActed) return null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="mb-8 focus:outline-none"
    >
      <h2 className="text-[18px] font-semibold text-content">Actions</h2>

      {sentence && (
        <p className="mt-2 max-w-[70ch] text-[13.5px] leading-[1.5] text-content-secondary">
          <MaskedText text={sentence} />
        </p>
      )}

      {live.length === 0 ? (
        // Cleared by hand, which is NOT the same as finding nothing: saying we
        // found nothing while the undo pill for the row just handled is still on
        // screen is simply false.
        <p className="mt-4 text-[13.5px] leading-[1.5] text-content-muted">
          You've handled everything here. New suggestions appear as your spending changes.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {shown.map((row) => {
            const area = actionArea(row.type, row.category);
            return (
              <ActionItem
                key={row.id}
                full
                rowId={row.id}
                title={row.title}
                tag={(row.type ?? row.category ?? 'general').toUpperCase()}
                area={oneArea ? { tone: area.tone } : { label: area.label, tone: area.tone }}
                description={row.description}
                impact={row.impact ?? ''}
                impactColor={row.impactColor}
                chatPrompt={row.chatPrompt}
                evidence={row.evidence ?? undefined}
                amount={row.amount ?? undefined}
                // Which of these the sentence above is speaking for. A row it
                // leaves out prints its own words in the pill rather than a
                // money-shaped label that would read as one of the savings.
                handsMoneyBack={row.handsMoneyBack}
                effort={row.effort ?? undefined}
                transactions={row.transactions}
                txnCount={row.txnCount}
                txnScope={row.txnScope ?? undefined}
                // Only the server-built drill. The area link for these rows is
                // the page they are already on, so "Open Spending" would be a
                // button that navigates nowhere.
                destination={row.drill ?? undefined}
                onComplete={() => act(row.id, 'completed')}
                onSnooze={() => act(row.id, 'snoozed')}
                onDismiss={() => act(row.id, 'dismissed')}
              />
            );
          })}
        </div>
      )}

      <UndoToast
        ref={undoRef}
        message={message}
        failure={failure}
        onUndo={undo}
      />
    </div>
  );
}
