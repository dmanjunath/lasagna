import { describe, it, expect, vi } from 'vitest';
import {
  focusPhrase,
  actionSentence,
  sinceLabel,
  netWorthChange,
  quickLinks,
  type QuickLinkFacts,
} from '../home-briefing';

const a = (type: string, urgency = 'medium') => ({ type, category: type, urgency });

describe('focusPhrase', () => {
  it('names the area with the most open actions', () => {
    expect(focusPhrase([a('tax'), a('tax'), a('debt')])).toBe('lowering your taxes');
  });
  it('breaks a tie with the most urgent action', () => {
    expect(focusPhrase([a('tax', 'low'), a('debt', 'critical')])).toBe('reducing debt');
  });
  it('folds behavioral into spending', () => {
    expect(focusPhrase([a('behavioral'), a('spending'), a('tax')])).toBe('managing spending');
  });
  it('never names the catch-all', () => {
    expect(focusPhrase([a('general'), a('general')])).toBeNull();
    expect(focusPhrase([a('general'), a('general'), a('tax')])).toBeNull();
    expect(focusPhrase([a('general'), a('tax'), a('tax')])).toBe('lowering your taxes');
  });
  it('is null with no actions', () => {
    expect(focusPhrase([])).toBeNull();
  });
  it('names savings, investing and retirement focuses', () => {
    expect(focusPhrase([a('savings')])).toBe('building savings');
    expect(focusPhrase([a('portfolio')])).toBe('managing investments');
    expect(focusPhrase([a('retirement')])).toBe('planning for retirement');
  });
});

describe('actionSentence', () => {
  it('counts every open action and names the focus', () => {
    expect(actionSentence([a('tax'), a('tax'), a('debt'), a('tax'), a('savings')])).toEqual({
      count: '5 open actions',
      lead: 'mostly about',
      focus: 'lowering your taxes',
    });
  });
  it('is singular for one, and one action is "about" its area, not "mostly"', () => {
    expect(actionSentence([a('savings')])).toEqual({ count: '1 open action', lead: 'about', focus: 'building savings' });
  });
  it('has no focus when only the catch-all is open', () => {
    expect(actionSentence([a('general')])).toEqual({ count: '1 open action', lead: 'about', focus: null });
  });
  it('is null with nothing open', () => {
    expect(actionSentence([])).toBeNull();
  });
});

// Tuesday 6 Oct 2026, 18:00 local. Week starts Monday 5 Oct.
const NOW = new Date(2026, 9, 6, 18, 0);
const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('sinceLabel', () => {
  it('says yesterday for today and yesterday', () => {
    expect(sinceLabel(day(2026, 10, 6, 9), NOW)).toBe('since yesterday');
    expect(sinceLabel(day(2026, 10, 5), NOW)).toBe('since yesterday');
  });
  it('names the weekday earlier this week', () => {
    const wed = new Date(2026, 9, 7, 18, 0); // Wednesday 7 Oct
    expect(sinceLabel(day(2026, 10, 5), wed)).toBe('since Monday');
  });
  it('says "of last week" for last week', () => {
    expect(sinceLabel(day(2026, 9, 28), NOW)).toBe('since Monday of last week');
    expect(sinceLabel(day(2026, 10, 3), NOW)).toBe('since Saturday of last week');
  });
  it('uses a date when older this year', () => {
    expect(sinceLabel(day(2026, 9, 14), NOW)).toBe('since Sep 14');
  });
  it('adds the year for a past year', () => {
    expect(sinceLabel(day(2025, 9, 14), NOW)).toBe('since Sep 14, 2025');
  });
  it('stays on "since yesterday" across the DST change (clocks fall back 1 Nov 2026)', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      const now = new Date(2026, 10, 2, 10, 0); // Mon 2 Nov, 10:00, after the change
      const lastVisit = new Date(2026, 10, 1, 12, 0); // Sun 1 Nov, 12:00, the day DST ends
      expect(sinceLabel(lastVisit, now)).toBe('since yesterday');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('netWorthChange', () => {
  const history = [
    { date: '2026-09-27', value: 900 },
    { date: '2026-09-29', value: 1000 },
    { date: '2026-10-05', value: 1100 },
    { date: '2026-10-06', value: 1150 },
  ];
  it('compares now with the value on the last-visit day', () => {
    expect(netWorthChange(history, 1250, day(2026, 9, 29), NOW)).toEqual({ delta: 250, since: 'since Tuesday of last week' });
  });
  it('uses the last value on or before that day when the day has none', () => {
    expect(netWorthChange(history, 1250, day(2026, 9, 28), NOW)?.delta).toBe(350);
  });
  it('uses the value before today when the last visit was today', () => {
    expect(netWorthChange(history, 1250, day(2026, 10, 6, 9), NOW)).toEqual({ delta: 150, since: 'since yesterday' });
  });
  it('is null without a last visit or a baseline', () => {
    expect(netWorthChange(history, 1250, null, NOW)).toBeNull();
    expect(netWorthChange(history, 1250, day(2026, 9, 1), NOW)).toBeNull();
    expect(netWorthChange([], 1250, day(2026, 9, 29), NOW)).toBeNull();
  });
  it('takes an evening visit\'s baseline from that local day, not the next UTC day', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      // History keyed by Los Angeles days: an 8pm snapshot on Oct 6 is Oct 6.
      const localHistory = [
        { date: '2026-10-05', value: 1000 },
        { date: '2026-10-06', value: 1100 },
        { date: '2026-10-07', value: 1300 },
      ];
      const lastVisit = new Date(2026, 9, 6, 21, 0); // Tue 6 Oct, 9pm (Oct 7 in UTC)
      const now = new Date(2026, 9, 8, 9, 0);
      expect(netWorthChange(localHistory, 1400, lastVisit, now)?.delta).toBe(300);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('picks the right side of the DST change for the baseline', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      const dstHistory = [
        { date: '2026-10-31', value: 2000 },
        { date: '2026-11-01', value: 2050 },
      ];
      const now = new Date(2026, 10, 2, 10, 0); // Mon 2 Nov, 10:00
      const lastVisit = new Date(2026, 10, 2, 7, 0); // earlier the same day
      expect(netWorthChange(dstHistory, 2200, lastVisit, now)).toEqual({ delta: 150, since: 'since yesterday' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('quickLinks', () => {
  const none: QuickLinkFacts = {
    goalCategories: [],
    hasRealEstate: false,
    canInvite: true,
    household: { size: 1, pending: 0 },
    now: new Date(2026, 9, 6, 18, 0),
  };
  const ids = (f: QuickLinkFacts) => quickLinks(f).map((l) => l.id);

  it('shows all six for a new user, in order', () => {
    expect(ids(none)).toEqual(['goal', 'invite', 'house', 'car', 'spending', 'retirement']);
  });
  it('asks to invite a partner', () => {
    expect(quickLinks(none).find((l) => l.id === 'invite')?.label).toBe('Invite your partner');
  });
  it('drops "create a goal" once any goal exists', () => {
    expect(ids({ ...none, goalCategories: ['savings'] })).not.toContain('goal');
  });
  it('drops invite once someone joined, an invite is pending, or the user cannot invite', () => {
    expect(ids({ ...none, household: { size: 2, pending: 0 } })).not.toContain('invite');
    expect(ids({ ...none, household: { size: 1, pending: 1 } })).not.toContain('invite');
    expect(ids({ ...none, canInvite: false })).not.toContain('invite');
  });
  it('drops house with a property or a home goal, car with a car goal', () => {
    expect(ids({ ...none, hasRealEstate: true })).not.toContain('house');
    expect(ids({ ...none, goalCategories: ['home_purchase'] })).not.toContain('house');
    expect(ids({ ...none, goalCategories: ['car'] })).not.toContain('car');
  });
  it('always keeps spending and retirement', () => {
    expect(ids({ ...none, goalCategories: ['home_purchase', 'car'], hasRealEstate: true, canInvite: false, household: { size: 2, pending: 0 } }))
      .toEqual(['spending', 'retirement']);
  });
  it('shows only the always-on links while every fact is unknown', () => {
    expect(ids({ ...none, goalCategories: null, hasRealEstate: null, household: null })).toEqual(['spending', 'retirement']);
  });
  it('treats unknown goals as "does not apply" for every goal-shaped link', () => {
    expect(ids({ ...none, goalCategories: null })).toEqual(['invite', 'spending', 'retirement']);
  });
  it('drops house while property is unknown, invite while the household is', () => {
    expect(ids({ ...none, hasRealEstate: null })).not.toContain('house');
    expect(ids({ ...none, household: null })).not.toContain('invite');
  });
  it('links "this month" to the current month, not the spending page default', () => {
    const spending = quickLinks(none).find((l) => l.id === 'spending');
    expect(spending).toMatchObject({ kind: 'page', href: '/spending?period=2026-10' });
    const jan = quickLinks({ ...none, now: new Date(2027, 0, 3) }).find((l) => l.id === 'spending');
    expect(jan).toMatchObject({ href: '/spending?period=2027-01' });
  });
});
