/**
 * The page name the mobile top bar shows where the brand mark would sit.
 *
 * A pure matcher on the path rather than something each page declares: every
 * page is `React.lazy`, so a title handed up by the page itself would leave the
 * bar empty for the length of the chunk fetch on every navigation and then pop
 * in.
 *
 * Detail routes name the subject type, not the entity. An entity name does not
 * fit the bar, and a goal or plan title the user wrote themselves can carry an
 * amount, which would then sit in persistent chrome and defeat the hide-amounts
 * toggle the bar itself hosts. The entity name is still in the page's own
 * header, directly below.
 *
 * `null` means the bar keeps the brand mark.
 */
const EXACT: Record<string, string> = {
  '/money': 'Money',
  '/chat': 'Chat',
  '/spending': 'Spending',
  '/transactions': 'Transactions',
  '/goals': 'Goals',
  '/debt': 'Debt',
  '/portfolio': 'Portfolio',
  '/tax': 'Tax',
  '/plans': 'Plans',
  '/plans/new': 'New plan',
  '/financial-plans': 'Retirement plans',
  '/financial-level': 'Financial journey',
  '/insights': 'Actions',
  '/retirement': 'Retirement',
  '/probability': 'Probability of success',
  '/profile': 'Profile',
  '/accounts': 'Accounts',
  '/quick-import': 'Quick import',
  '/admin': 'Operator',
};

export function titleForPath(path: string): string | null {
  // Exact first, so `/plans/new` and `/accounts` are not eaten by the prefix
  // rules for `/plans/:id` and `/accounts/:id` below.
  const exact = EXACT[path];
  if (exact) return exact;

  if (path.startsWith('/admin/')) return 'Operator';
  if (path.startsWith('/plans/savings/')) return 'Goal';
  if (path.startsWith('/plans/')) return 'Plan';
  if (path.startsWith('/financial-plans/')) return 'Retirement plan';
  if (path.startsWith('/accounts/')) return 'Account';

  return null;
}
