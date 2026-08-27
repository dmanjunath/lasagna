/**
 * Where an action goes when you open it, and what that page is called.
 *
 * One map, because three surfaces now offer the same action: the actions page,
 * a step's panel on the path, and home. An action opening the debt page from
 * one of them and the overview from another would read as two different
 * features, and the fork would drift the first time a page is renamed.
 */
const AREAS: Record<string, { label: string; link: string }> = {
  tax: { label: 'Taxes', link: '/tax' },
  debt: { label: 'Debt', link: '/debt' },
  portfolio: { label: 'Investing', link: '/portfolio' },
  retirement: { label: 'Retirement', link: '/retirement' },
  savings: { label: 'Savings', link: '/goals' },
  spending: { label: 'Spending', link: '/spending' },
  behavioral: { label: 'Spending', link: '/spending' },
  general: { label: 'Overview', link: '/' },
};

/** The page an action belongs to, from its type, or its category, or neither. */
export function actionArea(type: string | null, category: string | null) {
  return AREAS[type ?? ''] ?? AREAS[category ?? ''] ?? AREAS.general;
}
