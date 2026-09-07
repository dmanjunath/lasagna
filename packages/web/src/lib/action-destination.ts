/**
 * Where an action goes when you open it, and what that page is called.
 *
 * One map, because three surfaces now offer the same action: the actions page,
 * a step's panel on the path, and home. An action opening the debt page from
 * one of them and the overview from another would read as two different
 * features, and the fork would drift the first time a page is renamed.
 */
/**
 * The Badge tone each area wears, so the pill on a row is filled and readable
 * rather than sitting at the card's own colour.
 *
 * Tones come from the Badge primitive, which pairs every tint with a foreground
 * that clears AA in both themes. Every area carries a hue of its own, including
 * the catch-all: a grey tag sat at the card's own colour and read as no tag at
 * all, which is the one thing a tag cannot do.
 */
export type AreaTone = 'neutral' | 'brand' | 'positive' | 'negative' | 'caution' | 'info' | 'sky' | 'violet';

const AREAS: Record<string, { label: string; link: string; tone: AreaTone }> = {
  tax: { label: 'Taxes', link: '/tax', tone: 'caution' },
  debt: { label: 'Debt', link: '/debt', tone: 'negative' },
  portfolio: { label: 'Investing', link: '/portfolio', tone: 'info' },
  retirement: { label: 'Retirement', link: '/retirement', tone: 'brand' },
  savings: { label: 'Savings', link: '/goals', tone: 'positive' },
  spending: { label: 'Spending', link: '/spending', tone: 'sky' },
  behavioral: { label: 'Spending', link: '/spending', tone: 'sky' },
  general: { label: 'Overview', link: '/', tone: 'violet' },
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
const AREA_ORDER = ['/goals', '/spending', '/retirement', '/portfolio', '/tax', '/debt', '/'];

export interface ActionAreaGroup<T> {
  label: string;
  link: string;
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
  const byLink = new Map<string, ActionAreaGroup<T>>();
  for (const action of actions) {
    const area = actionArea(action.type ?? null, action.category ?? null);
    const group = byLink.get(area.link) ?? { label: area.label, link: area.link, actions: [] };
    group.actions.push(action);
    byLink.set(area.link, group);
  }
  const rank = (link: string) => {
    const i = AREA_ORDER.indexOf(link);
    return i === -1 ? AREA_ORDER.length : i;
  };
  return [...byLink.values()].sort((a, b) => rank(a.link) - rank(b.link));
}
