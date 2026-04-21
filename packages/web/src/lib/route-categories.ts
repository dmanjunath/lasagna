const routeCategories: Record<string, string> = {
  '/': 'Dashboard',
  '/accounts': 'Accounts',
  '/spending': 'Spending',
  '/goals': 'Goals',
  '/debt': 'Debt',
  '/portfolio': 'Portfolio',
  '/tax': 'Tax',
  '/retirement': 'Retirement',
  '/priorities': 'Priorities',
  '/net-worth': 'Net Worth',
  '/probability': 'Retirement',
  '/plans': 'Plans',
  '/profile': 'Profile',
};

export function getCategoryFromRoute(pathname: string): string {
  // Exact match first
  if (routeCategories[pathname]) return routeCategories[pathname];
  // Prefix match for nested routes like /plans/:id
  for (const [route, category] of Object.entries(routeCategories)) {
    if (route !== '/' && pathname.startsWith(route)) return category;
  }
  return 'General';
}

export function getAllCategories(): string[] {
  return [...new Set(Object.values(routeCategories))];
}
