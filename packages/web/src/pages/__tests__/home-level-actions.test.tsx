import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { ChatStoreProvider } from '../../lib/chat-store';
import type { Insight } from '../../hooks/useInsights';
import { ActionsSection, LevelSection } from '../simple-home';

/**
 * Actions on home stand apart from the path.
 *
 * They used to be drawn inside the level section, which filtered them to the
 * step being stood on. That put the list behind the path: somebody with no
 * profile yet, and somebody whose path request failed, both saw an empty panel
 * while ten actions sat open on their account, and somebody standing on a step
 * saw only the few that happened to name it.
 *
 * The two are separate sections now, so the independence is structural rather
 * than something a branch has to remember: `ActionsSection` is handed no path
 * input at all and has nothing to filter on. These tests hold that boundary in
 * place, and hold the ranking that decides which five of them home shows.
 *
 * Rendered to static markup rather than driven in a browser: the question is
 * what each component puts on the page for a given set of props, which is a
 * pure function of them, and no DOM is needed to read the answer.
 */

const noop = () => {};

function action(
  id: string,
  title: string,
  over: Partial<Insight> = {},
): Insight {
  return {
    id,
    category: 'savings',
    urgency: 'medium',
    type: 'savings',
    title,
    description: 'What to do and why.',
    impact: '+$120/yr',
    impactColor: 'green',
    chatPrompt: null,
    generatedBy: 'ai',
    createdAt: '2026-01-01T00:00:00.000Z',
    pathStepKey: null,
    effort: 'quick',
    ...over,
  };
}

const STEPS = [
  { id: 'stabilize', order: 1, title: 'Stabilize', status: 'complete', rateShaped: false },
  { id: 'emergency-fund', order: 2, title: 'Emergency fund', status: 'in_progress', rateShaped: false },
];

const CURRENT = {
  id: 'emergency-fund',
  order: 2,
  kind: 'emergency-fund',
  title: 'Emergency fund',
  subtitle: 'Three months of costs',
  description: 'Hold three months of spending in cash.',
  status: 'in_progress',
  progress: 40,
  action: 'Save',
  current: 4000,
  target: 10000,
};

function renderActions(actions: Insight[], over: { loading?: boolean; generating?: boolean } = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/">
      <ChatStoreProvider>
        <ActionsSection
          actions={actions}
          loading={over.loading ?? false}
          generating={over.generating ?? false}
          onGenerate={noop}
          onOpen={noop}
          onDismiss={noop}
        />
      </ChatStoreProvider>
    </Router>,
  );
}

function renderLevel(step: typeof CURRENT | null, steps: typeof STEPS) {
  return renderToStaticMarkup(
    <Router ssrPath="/">
      <ChatStoreProvider>
        <LevelSection
          step={step}
          steps={steps}
          currentStepId={step?.id ?? ''}
          loading={false}
          onHelp={noop}
          onDid={noop}
          onSetAside={noop}
          onSetupProfile={noop}
        />
      </ChatStoreProvider>
    </Router>,
  );
}

/** The rendered words, with the markup taken out. */
const words = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('actions are shown whatever the path is doing', () => {
  const open = [
    action('a1', 'Move idle cash to a high yield account'),
    action('a2', 'Raise your 401k contribution to the match'),
  ];

  it('shows open actions, none of which serves a step', () => {
    const html = renderActions(open);
    for (const a of open) expect(words(html)).toContain(a.title);
  });

  it('shows an action that does serve a step, without singling it out', () => {
    const html = renderActions([action('a1', 'Top up the buffer', { pathStepKey: 'emergency-fund' }), ...open]);
    // Every open action is shown. The step it names changes nothing here.
    expect(words(html)).toContain('Top up the buffer');
    for (const a of open) expect(words(html)).toContain(a.title);
  });

  it('offers to generate when there is no action at all', () => {
    expect(words(renderActions([]))).toContain('Generate actions');
  });

  it('names the page each action belongs to, since the list is not grouped by it', () => {
    const html = renderActions([action('t1', 'Max your HSA', { type: 'tax', category: 'tax' })]);
    expect(words(html)).toContain('Taxes');
  });
});

describe('home leads with what can actually be finished', () => {
  it('puts a quick action above an involved one that is more urgent', () => {
    // The case that prompted this: a critical backdoor Roth conversion runs for
    // months, and a payroll change takes ten minutes. Ranked on urgency alone
    // the ten-minute one never surfaced.
    const html = words(
      renderActions([
        action('slow', 'Convert your backdoor Roth contributions', { effort: 'involved', urgency: 'critical' }),
        action('fast', 'Raise your HSA payroll election', { effort: 'quick', urgency: 'low' }),
      ]),
    );
    expect(html.indexOf('Raise your HSA payroll election')).toBeLessThan(
      html.indexOf('Convert your backdoor Roth contributions'),
    );
  });

  it('sorts an unrated action as moderate, between quick and involved', () => {
    const html = words(
      renderActions([
        action('slow', 'Involved action', { effort: 'involved' }),
        action('none', 'Unrated action', { effort: null }),
        action('fast', 'Quick action', { effort: 'quick' }),
      ]),
    );
    expect(html.indexOf('Quick action')).toBeLessThan(html.indexOf('Unrated action'));
    expect(html.indexOf('Unrated action')).toBeLessThan(html.indexOf('Involved action'));
  });

  it('keeps every action written before effort existed on the list', () => {
    // All null, which is what an untouched database looks like. Ranking must
    // still produce five rows rather than treating them all as unshowable.
    const many = Array.from({ length: 8 }, (_, i) =>
      action(`a${i}`, `Legacy action ${i}`, { effort: null }),
    );
    const html = words(renderActions(many));
    expect(html).toContain('Legacy action 0');
    expect(html).toContain('View all');
  });

  it('puts the urgent ones above the rest at equal effort', () => {
    const html = words(
      renderActions([
        action('low', 'Review your subscriptions', { urgency: 'low' }),
        action('high', 'Cover the overdraft', { urgency: 'high' }),
      ]),
    );
    expect(html.indexOf('Cover the overdraft')).toBeLessThan(html.indexOf('Review your subscriptions'));
  });

  it('breaks a tie on the newer action', () => {
    const html = words(
      renderActions([
        action('older', 'Older action', { createdAt: '2026-01-01T00:00:00.000Z' }),
        action('newer', 'Newer action', { createdAt: '2026-02-01T00:00:00.000Z' }),
      ]),
    );
    expect(html.indexOf('Newer action')).toBeLessThan(html.indexOf('Older action'));
  });

  it('stops at five and offers the way to the others', () => {
    const many = Array.from({ length: 8 }, (_, i) => action(`a${i}`, `Action number ${i}`));
    const html = words(renderActions(many));
    for (const i of [0, 1, 2, 3, 4]) expect(html).toContain(`Action number ${i}`);
    for (const i of [5, 6, 7]) expect(html).not.toContain(`Action number ${i}`);
    expect(html).toContain('View all');
  });

  it('does not offer the way to others when it is showing all of them', () => {
    const html = words(renderActions([action('a1', 'The only action')]));
    expect(html).toContain('The only action');
    expect(html).not.toContain('View all');
  });
});

describe('the level section is the ladder, and nothing about actions', () => {
  it('says nothing about actions while standing on a step', () => {
    const html = words(renderLevel(CURRENT, STEPS));
    expect(html).toContain('Emergency fund');
    expect(html).not.toContain('Generate actions');
    expect(html).not.toContain('All actions');
    expect(html).not.toContain('for this step');
  });

  it('still asks for a profile when there is no path, and still says nothing about actions', () => {
    const html = words(renderLevel(null, []));
    expect(html).toContain('Set up your profile');
    expect(html).not.toContain('Generate actions');
  });
});
