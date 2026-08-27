import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { ChatStoreProvider } from '../../lib/chat-store';
import type { Insight } from '../../hooks/useInsights';
import { LevelSection } from '../simple-home';

/**
 * The open actions on home do not depend on there being a path.
 *
 * The level section used to answer "no path" by returning the profile prompt
 * and nothing else, which put the actions block behind the path: somebody with
 * no profile yet, and somebody whose path request failed, both saw an empty
 * panel while ten actions sat open on their account. Both land in the same
 * branch — `loadPath` clears the step on a rejected request — so one state
 * covers both, and the test names both.
 *
 * Rendered to static markup rather than driven in a browser: the question is
 * what the component puts on the page for a given set of props, which is a
 * pure function of them, and no DOM is needed to read the answer.
 */

const noop = () => {};

function action(id: string, title: string, pathStepKey: string | null): Insight {
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
    pathStepKey,
  };
}

const STEPS = [
  { id: 'stabilize', order: 1, title: 'Stabilize', status: 'complete' },
  { id: 'emergency-fund', order: 2, title: 'Emergency fund', status: 'in_progress' },
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

function render(props: {
  step: typeof CURRENT | null;
  steps: typeof STEPS;
  currentStepId: string;
  allActions: Insight[];
}) {
  const { step, steps, currentStepId, allActions } = props;
  return renderToStaticMarkup(
    <Router ssrPath="/">
      <ChatStoreProvider>
      <LevelSection
        step={step}
        steps={steps}
        currentStepId={currentStepId}
        loading={false}
        actions={allActions.filter((a) => a.pathStepKey === currentStepId)}
        allActions={allActions}
        actionsLoading={false}
        hasAnyAction={allActions.length > 0}
        generating={false}
        onGenerate={noop}
        onOpenAction={noop}
        onDismissAction={noop}
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

describe('the actions on home do not depend on there being a path', () => {
  const open = [
    action('a1', 'Move idle cash to a high yield account', null),
    action('a2', 'Raise your 401k contribution to the match', null),
  ];

  it('shows every open action when there is no path to stand on', () => {
    const html = render({ step: null, steps: [], currentStepId: '', allActions: open });
    // The profile prompt still stands for the level half of the panel.
    expect(words(html)).toContain('Set up your profile');
    for (const a of open) expect(words(html)).toContain(a.title);
  });

  it('shows every open action when the path request failed', () => {
    // What `loadPath().catch()` leaves behind: no step, no steps, actions intact.
    const html = render({ step: null, steps: [], currentStepId: '', allActions: open });
    for (const a of open) expect(words(html)).toContain(a.title);
    expect(words(html)).toContain('Your actions');
  });

  it('shows the ones serving the step being stood on when there is a path', () => {
    const html = render({
      step: CURRENT,
      steps: STEPS,
      currentStepId: 'emergency-fund',
      allActions: [action('a1', 'Top up the buffer', 'emergency-fund'), ...open],
    });
    expect(words(html)).toContain('Action for this step');
    expect(words(html)).toContain('Top up the buffer');
    // The ones serving no step belong to /insights, not under this step.
    expect(words(html)).not.toContain('Move idle cash to a high yield account');
  });
});

describe('a heading is only drawn over something', () => {
  it('does not head the sentence saying nothing is under it', () => {
    const html = render({
      step: CURRENT,
      steps: STEPS,
      currentStepId: 'emergency-fund',
      allActions: [action('a1', 'Move idle cash to a high yield account', null)],
    });
    expect(words(html)).toContain('Nothing tied to this step. One other action is open.');
    expect(words(html)).not.toContain('Actions for this step');
    expect(words(html)).not.toContain('Action for this step');
    // The way to the actions it is counting survives the heading it lost.
    expect(words(html)).toContain('All actions');
  });

  it('counts the other open actions in the plural', () => {
    const html = render({
      step: CURRENT,
      steps: STEPS,
      currentStepId: 'emergency-fund',
      allActions: [
        action('a1', 'Move idle cash to a high yield account', null),
        action('a2', 'Raise your 401k contribution to the match', null),
      ],
    });
    expect(words(html)).toContain('Nothing tied to this step. 2 other actions are open.');
  });

  it('offers to generate when there is no action at all', () => {
    const html = render({ step: CURRENT, steps: STEPS, currentStepId: 'emergency-fund', allActions: [] });
    expect(words(html)).toContain('Generate actions');
    expect(words(html)).not.toContain('Nothing tied to this step');
  });
});
