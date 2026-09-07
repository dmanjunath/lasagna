/**
 * Where an action goes when you open it, and what that page is called.
 *
 * One map, because three surfaces now offer the same action: the actions page,
 * a step's panel on the path, and home. An action opening the debt page from
 * one of them and the overview from another would read as two different
 * features, and the fork would drift the first time a page is renamed.
 */
/**
 * The one colour a row wears, on its edge, its page tag and its figure alike.
 *
 * It names the PART OF SOMEONE'S MONEY the action is about, and nothing else.
 * It deliberately does not encode gain or loss: an earlier pass tinted the row
 * by whether the figure was good or bad news, which painted the word
 * "Spending" red and the word "Taxes" green, so the colour contradicted the
 * label it sat on. Everyday areas therefore avoid red and green entirely, and
 * the figure carries its own good-or-bad news in its words.
 */
export type AreaTone = 'neutral' | 'brand' | 'positive' | 'negative' | 'caution' | 'info' | 'sky' | 'violet' | 'slate';

/**
 * `link` is null for the catch-all, and that is the point: an action that is
 * about no particular page has nowhere to open. It used to point at `/`, so
 * "Open Overview" on the home page navigated to the page you were already on
 * and the drill dead-ended. A null destination is offered as no button at all.
 */
const AREAS: Record<string, { label: string; link: string | null; tone: AreaTone }> = {
  tax: { label: 'Taxes', link: '/tax', tone: 'caution' },
  // Coral and green are kept for the two areas where the colour agrees with the
  // meaning rather than fighting it: a debt is a liability and savings are not.
  debt: { label: 'Debt', link: '/debt', tone: 'negative' },
  savings: { label: 'Savings', link: '/goals', tone: 'positive' },
  portfolio: { label: 'Investing', link: '/portfolio', tone: 'info' },
  retirement: { label: 'Retirement', link: '/retirement', tone: 'violet' },
  spending: { label: 'Spending', link: '/spending', tone: 'sky' },
  behavioral: { label: 'Spending', link: '/spending', tone: 'sky' },
  general: { label: 'Overview', link: null, tone: 'slate' },
};

/**
 * What each tone paints with: a soft fill and readable ink for the two pills,
 * and a solid for the row's edge. One map, because the edge and the pills have
 * to agree, and they sit in different files.
 */
export const TONE_STYLE: Record<AreaTone, { soft: string; ink: string; solid: string }> = {
  // `--ui-canvas-sunken` is stored as an rgb TRIPLE, so `var()` alone is not a
  // colour and the fill silently vanished. Every entry here resolves to a real
  // colour value.
  neutral:  { soft: 'rgb(var(--ui-canvas-sunken))', ink: 'rgb(var(--ui-content-secondary))', solid: 'rgb(var(--ui-content-muted))' },
  slate:    { soft: 'var(--ui-slate-soft)',    ink: 'rgb(var(--ui-slate))',              solid: 'rgb(var(--ui-slate))' },
  brand:    { soft: 'var(--ui-brand-soft)',    ink: 'rgb(var(--ui-brand-ink))',         solid: 'rgb(var(--ui-brand))' },
  positive: { soft: 'var(--ui-positive-soft)', ink: 'rgb(var(--ui-positive))',          solid: 'rgb(var(--ui-positive))' },
  negative: { soft: 'var(--ui-negative-soft)', ink: 'rgb(var(--ui-negative))',          solid: 'rgb(var(--ui-negative))' },
  caution:  { soft: 'var(--ui-caution-soft)',  ink: 'rgb(var(--ui-caution))',           solid: 'rgb(var(--ui-caution))' },
  info:     { soft: 'var(--ui-info-soft)',     ink: 'rgb(var(--ui-info))',              solid: 'rgb(var(--ui-info))' },
  sky:      { soft: 'var(--ui-sky-soft)',      ink: 'rgb(var(--ui-sky))',               solid: 'rgb(var(--ui-sky))' },
  violet:   { soft: 'var(--ui-violet-soft)',   ink: 'rgb(var(--ui-violet))',            solid: 'rgb(var(--ui-violet))' },
};

/** The page an action belongs to, from its type, or its category, or neither. */
export function actionArea(type: string | null, category: string | null) {
  return AREAS[type ?? ''] ?? AREAS[category ?? ''] ?? AREAS.general;
}

/**
 * The order action groups appear in, by the page each one opens, mirroring the
 * order those pages sit in the sidebar so the two readings agree.
 *
 * The catch-all is last on purpose. "Overview" names what did not belong to any
 * particular page, so leading with it would put the vaguest group above the
 * specific ones.
 */
const OVERVIEW_KEY = 'overview';
const AREA_ORDER = ['/goals', '/spending', '/retirement', '/portfolio', '/tax', '/debt', OVERVIEW_KEY];

/** A stable id for an area, since the catch-all has no link to key on. */
export function areaKey(area: { link: string | null }): string {
  return area.link ?? OVERVIEW_KEY;
}

export interface ActionAreaGroup<T> {
  label: string;
  /** Null for the catch-all, which opens nowhere. */
  link: string | null;
  actions: T[];
}

/**
 * Actions bucketed by the page they belong to, in the order above.
 *
 * Grouping is on the RESOLVED area rather than the raw type, because several
 * types share one page (`behavioral` and `spending` are both Spending). Keying
 * on the type would draw two groups under the same heading.
 */
export function groupByArea<T extends { type?: string | null; category?: string | null }>(
  actions: T[],
): ActionAreaGroup<T>[] {
  const byKey = new Map<string, ActionAreaGroup<T>>();
  for (const action of actions) {
    const area = actionArea(action.type ?? null, action.category ?? null);
    const key = areaKey(area);
    const group = byKey.get(key) ?? { label: area.label, link: area.link, actions: [] };
    group.actions.push(action);
    byKey.set(key, group);
  }
  const rank = (group: ActionAreaGroup<T>) => {
    const i = AREA_ORDER.indexOf(areaKey(group));
    return i === -1 ? AREA_ORDER.length : i;
  };
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b));
}
