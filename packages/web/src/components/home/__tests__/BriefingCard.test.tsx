import { afterEach, describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Router } from 'wouter';
import { BriefingCard } from '../BriefingCard';
import { setAmountsHidden } from '../../../lib/hide-amounts';
import type { QuickLink } from '../../../lib/home-briefing';

const noop = () => {};
const SENTENCE = { count: '5 open actions', lead: 'mostly about', focus: 'lowering your taxes' };

function render(over: Partial<Parameters<typeof BriefingCard>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/">
      <BriefingCard
        greeting="Good evening, Sam"
        actionSentence={SENTENCE}
        netWorth={{ delta: 18636, since: 'since Monday of last week' }}
        summaryLoading={false}
        actions={null}
        links={[]}
        linksLoading={false}
        onAsk={noop}
        {...over}
      />
    </Router>,
  );
}
const words = (html: string) => html.replace(/<[^>]+>/g, '');

afterEach(() => setAmountsHidden(false));

describe('BriefingCard', () => {
  it('reads as two sentences', () => {
    expect(words(render())).toContain(
      'You have 5 open actions, mostly about lowering your taxes. Your net worth is up $18,636 since Monday of last week.',
    );
  });
  it('hides the summary when both sentences are null', () => {
    const html = render({ actionSentence: null, netWorth: null });
    expect(html).toContain('Good evening, Sam');
    expect(html).not.toContain('<p');
  });
  it('says "unchanged" for a change under 50 cents, never "up $0" or "down $0"', () => {
    const text = words(render({ netWorth: { delta: -0.4, since: 'since yesterday' } }));
    expect(text).toContain('Your net worth is unchanged since yesterday.');
    expect(text).not.toContain('$0');
  });
  it('says "down" for a loss, with no sign on the figure', () => {
    expect(words(render({ netWorth: { delta: -1200, since: 'since yesterday' } }))).toContain('down $1,200 since yesterday');
  });
  it('masks the figure when amounts are hidden', () => {
    setAmountsHidden(true);
    const html = render();
    expect(html).toContain('aria-label="Amount hidden"');
    expect(html).not.toContain('18,636');
  });
  it('renders page links as links and chat links as buttons', () => {
    const links: QuickLink[] = [
      { id: 'spending', label: 'Where did my money go this month?', kind: 'page', href: '/spending?period=2026-10' },
      { id: 'car', label: 'What if I buy a car?', kind: 'chat', prompt: 'What if I buy a car?' },
    ];
    const html = render({ links });
    expect(html).toMatch(/<a [^>]*href="\/spending\?period=2026-10"[^>]*>.*Where did my money go this month\?<\/a>/);
    expect(html).toMatch(/<button [^>]*type="button"[^>]*>.*What if I buy a car\?<\/button>/);
  });
  it('holds the band with placeholders, and no links, while a fact is loading', () => {
    const links: QuickLink[] = [{ id: 'car', label: 'What if I buy a car?', kind: 'chat', prompt: 'x' }];
    const html = render({ links, linksLoading: true });
    expect(html).not.toContain('What if I buy a car?');
    expect(html).toContain('briefing-links');
  });
  it('drops the quick links band when there are none', () => {
    expect(render()).not.toContain('Quick links');
  });
});
