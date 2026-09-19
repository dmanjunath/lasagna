import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { ChatStoreProvider } from '../../../lib/chat-store';
import {
  savingsSentence,
  toActionRow,
  type ActionRow,
  type ApiActionRow,
} from '../../../lib/action-rows';
import { ActionItem } from '../action-item';

/**
 * The pill has to say which rows the sentence above the list is speaking for.
 *
 * That sentence counts only the rows that hand money back ("2 of these save
 * you about $73 a month"), but every pill was composed by `amountLabel`, so an
 * awareness row — whose figure is how far a category ran over its usual month,
 * money already spent — printed "about $367 a month" in the same shape as a
 * real saving. The sentence was then correct and unresolvable at once: a reader
 * told "2 of these" had no way to see which 2.
 *
 * So an awareness row prints the label the server already stores for it,
 * "$367 above usual", which promises nothing.
 *
 * Rendered to static markup rather than driven in a browser: what the row puts
 * on the page is a pure function of its props, and no DOM is needed to read it.
 */

function wire(over: Partial<ApiActionRow>): ApiActionRow {
  return {
    id: 'x',
    category: 'general',
    urgency: 'low',
    effort: 'quick',
    type: 'spending',
    title: 'An action',
    description: 'What to do and why.',
    impact: null,
    impactColor: 'green',
    chatPrompt: null,
    generatedBy: 'system',
    createdAt: '2026-09-01T00:00:00.000Z',
    pathStepKey: null,
    producer: 'spend-cuts',
    monthlyValue: null,
    oneTimeValue: null,
    evidence: 'Counted over the last six months.',
    ...over,
  };
}

/** The row exactly as the full surface passes it (page-actions.tsx, insights.tsx). */
function renderRow(row: ActionRow): string {
  return renderToStaticMarkup(
    <Router ssrPath="/">
      <ChatStoreProvider>
        <ActionItem
          full
          rowId={row.id}
          title={row.title}
          tag="SPENDING"
          description={row.description}
          impact={row.impact ?? ''}
          impactColor={row.impactColor}
          chatPrompt={row.chatPrompt}
          evidence={row.evidence ?? undefined}
          amount={row.amount ?? undefined}
          handsMoneyBack={row.handsMoneyBack}
          effort={row.effort ?? undefined}
        />
      </ChatStoreProvider>
    </Router>,
  );
}

/** A category that ran over its usual month. Nothing is handed back for it. */
const AWARENESS = toActionRow(
  wire({
    id: 'utilities',
    kind: 'category_above_trend',
    title: 'Check what drove Utilities up in August',
    monthlyValue: 366.76,
    impact: '$367 above usual',
    impactColor: 'amber',
  }),
);

/** A price rise worth $23 a month if it is handled. */
const PRICE_RISE = toActionRow(
  wire({
    id: 'price-rise',
    kind: 'price_increase',
    title: 'Handle the price rise at a streaming service',
    monthlyValue: 23.4,
    impact: 'Saves $23/mo',
  }),
);

/** A second saving, so the sentence has two rows to speak for. */
const DUPLICATE = toActionRow(
  wire({
    id: 'duplicate',
    kind: 'duplicate_service',
    title: 'Drop one of two overlapping subscriptions',
    monthlyValue: 49.6,
    impact: 'Saves $50/mo',
  }),
);

describe("a row's figure pill", () => {
  it("prints the awareness row's own words, and no money-shaped label", () => {
    const html = renderRow(AWARENESS);
    expect(html).toContain('$367 above usual');
    // Not in the pill, and not in the row's accessible name either, which is
    // composed from the same figure.
    expect(html).not.toContain('about $367');
  });

  it('still prints money on a row that hands money back', () => {
    expect(renderRow(PRICE_RISE)).toContain('about $23 a month');
    expect(renderRow(DUPLICATE)).toContain('about $50 a month');
  });

  it('makes "2 of these" resolvable: exactly the counted rows wear a money pill', () => {
    const shown = [AWARENESS, PRICE_RISE, DUPLICATE];
    expect(savingsSentence(shown)).toBe('2 of these save you about $73 a month.');

    const moneyShaped = shown.filter((r) => renderRow(r).includes('about $'));
    expect(moneyShaped.map((r) => r.id)).toEqual(['price-rise', 'duplicate']);
  });
});
