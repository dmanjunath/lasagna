import { actionArea } from './action-destination';
import { formatInstant } from './utils';

/**
 * The words on home's briefing card. Pure, so every rule in the spec is a test
 * rather than something read off a screenshot.
 */

type ActionLike = { type: string | null; category: string | null; urgency: string };

/** What each area is "about", keyed by the area's label from actionArea. */
const FOCUS: Record<string, string> = {
  Taxes: 'lowering your taxes',
  Debt: 'reducing debt',
  Savings: 'building savings',
  Investing: 'managing investments',
  Retirement: 'planning for retirement',
  Spending: 'managing spending',
};

const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * The area with the most open actions. A tie among named areas goes to the
 * most urgent action's area. The catch-all counts toward "most" but, winning
 * outright or on a tie, it still never names the focus.
 */
export function focusPhrase(actions: ActionLike[]): string | null {
  const byArea = new Map<string, { count: number; best: number }>();
  let overviewCount = 0;
  for (const a of actions) {
    const label = actionArea(a.type, a.category).label;
    if (!FOCUS[label]) {
      overviewCount += 1;
      continue;
    }
    const rank = URGENCY_RANK[a.urgency] ?? URGENCY_RANK.medium;
    const cur = byArea.get(label) ?? { count: 0, best: Infinity };
    byArea.set(label, { count: cur.count + 1, best: Math.min(cur.best, rank) });
  }
  let pick: [string, { count: number; best: number }] | null = null;
  for (const entry of byArea) {
    const hasMoreActions = pick !== null && entry[1].count > pick[1].count;
    const tiedButMoreUrgent = pick !== null && entry[1].count === pick[1].count && entry[1].best < pick[1].best;
    if (!pick || hasMoreActions || tiedButMoreUrgent) {
      pick = entry;
    }
  }
  if (!pick || overviewCount >= pick[1].count) return null;
  return FOCUS[pick[0]];
}

/**
 * `lead` goes before the focus phrase: one action is "about" its area, not
 * "mostly about" it.
 */
export function actionSentence(
  actions: ActionLike[],
): { count: string; lead: string; focus: string | null } | null {
  if (actions.length === 0) return null;
  const n = actions.length;
  return {
    count: `${n} open action${n === 1 ? '' : 's'}`,
    lead: n === 1 ? 'about' : 'mostly about',
    focus: focusPhrase(actions),
  };
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/**
 * `n` calendar days from `d`. Built from the calendar fields rather than a
 * millisecond offset, so it lands on the right day across a DST change
 * (a fixed 24h subtraction misses by an hour on the day clocks move).
 */
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday 00:00 of the week `d` is in. */
const startOfWeek = (d: Date) => {
  const s = startOfDay(d);
  return addDays(s, -((s.getDay() + 6) % 7));
};
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** When the last visit was, said relative to today. Never "your last visit". */
export function sinceLabel(lastVisit: Date, now: Date): string {
  const today = startOfDay(now);
  const visitDay = startOfDay(lastVisit);
  if (visitDay.getTime() >= addDays(today, -1).getTime()) return 'since yesterday';
  const weekday = formatInstant(lastVisit, { weekday: 'long' });
  const thisWeek = startOfWeek(now);
  if (visitDay.getTime() >= thisWeek.getTime()) return `since ${weekday}`;
  if (visitDay.getTime() >= addDays(thisWeek, -7).getTime()) return `since ${weekday} of last week`;
  const sameYear = lastVisit.getFullYear() === now.getFullYear();
  return `since ${formatInstant(lastVisit, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`;
}

/**
 * Net worth now against the daily history value for the last-visit day.
 * History is one value per day, keyed by the viewer's local day (the client
 * sends its zone), so it compares with `ymd`, which is local too. A visit
 * earlier today compares with the day before, and is said as "since yesterday".
 */
export function netWorthChange(
  history: { date: string; value: number }[],
  current: number,
  lastVisit: Date | null,
  now: Date,
): { delta: number; since: string } | null {
  if (!lastVisit) return null;
  const visitedToday = startOfDay(lastVisit).getTime() === startOfDay(now).getTime();
  const limit = ymd(visitedToday ? addDays(startOfDay(now), -1) : lastVisit);
  let baseline: number | null = null;
  for (const h of history) if (h.date <= limit) baseline = h.value; // history is sorted ascending
  if (baseline === null) return null;
  return { delta: current - baseline, since: sinceLabel(lastVisit, now) };
}

/**
 * A fact that is `null` is not known yet (still loading, or its request
 * failed). Unknown never shows a link: one that appears and then vanishes, or
 * offers to create a first goal to someone who has five, is worse than none.
 */
export interface QuickLinkFacts {
  goalCategories: string[] | null;
  hasRealEstate: boolean | null;
  /** Only the household owner can send invites. */
  canInvite: boolean;
  household: { size: number; pending: number } | null;
  /** Decides which month "this month" links to. */
  now: Date;
}

export type QuickLink =
  | { id: string; label: string; kind: 'page'; href: string }
  | { id: string; label: string; kind: 'chat'; prompt: string };

/** Each link drops out once it no longer applies. Spending and retirement always apply. */
export function quickLinks(f: QuickLinkFacts): QuickLink[] {
  const goals = f.goalCategories;
  const lacksGoal = (c: string) => goals !== null && !goals.includes(c);
  // /spending opens on the last full month, so "this month" has to say which.
  const thisMonth = `${f.now.getFullYear()}-${String(f.now.getMonth() + 1).padStart(2, '0')}`;
  const links: (QuickLink | false)[] = [
    goals !== null && goals.length === 0 && { id: 'goal', label: 'Create a new goal', kind: 'page', href: '/goals/new' },
    f.canInvite && f.household !== null && f.household.size < 2 && f.household.pending === 0 &&
      { id: 'invite', label: 'Invite your partner', kind: 'page', href: '/profile#household' },
    f.hasRealEstate === false && lacksGoal('home_purchase') &&
      { id: 'house', label: 'Can I afford a house?', kind: 'chat', prompt: 'Can I afford a house? Walk me through what I could buy.' },
    lacksGoal('car') && { id: 'car', label: 'What if I buy a car?', kind: 'chat', prompt: 'What if I buy a car? Show me how it would change my plan.' },
    { id: 'spending', label: 'Where did my money go this month?', kind: 'page', href: `/spending?period=${thisMonth}` },
    { id: 'retirement', label: 'Am I on track to retire?', kind: 'page', href: '/retirement' },
  ];
  return links.filter((l): l is QuickLink => Boolean(l));
}
