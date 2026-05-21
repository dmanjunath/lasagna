import { useLocation } from 'wouter';

interface AppHeaderProps {
  /** Hamburger / back-arrow / etc. Mounted on the left. */
  leadingSlot?: React.ReactNode;
  /** Center title. Falls back to path-based lookup. */
  title?: string;
  /** Title font size variant. Simple = larger serif, Advanced = compact sans. */
  variant?: 'simple' | 'advanced';
}

/**
 * Shared top bar. Lives `fixed top-0`.
 */
export function AppHeader({
  leadingSlot,
  title,
  variant = 'simple',
}: AppHeaderProps) {
  const [location] = useLocation();

  const resolvedTitle = title ?? (TITLES[location] ?? '');

  const titleClass =
    variant === 'simple'
      ? 'text-[24px] font-serif font-medium tracking-tight text-text leading-none'
      : 'text-[22px] font-serif font-medium tracking-tight text-text leading-none';

  return (
    <header className="fixed top-0 inset-x-0 z-30 bg-bg/95 backdrop-blur border-b border-rule/40 pt-safe-top">
      <div className="max-w-md md:max-w-none md:px-6 mx-auto px-4 h-14 flex items-center gap-2">
        <div className="w-11 -ml-2 shrink-0 flex items-center">{leadingSlot}</div>
        <div className={`flex-1 text-center truncate ${titleClass}`}>{resolvedTitle}</div>
        <div className="w-11 -mr-2 shrink-0" aria-hidden="true" />
      </div>
    </header>
  );
}

// Path → title map. Keeping this here instead of plumbing
// setPageContext into every page; it's a thin shim and easy to extend.
const TITLES: Record<string, string> = {
  '/': 'Home',
  '/money': 'Money',
  '/chat': 'Chat',
  '/accounts': 'Accounts',
  '/spending': 'Spending',
  '/goals': 'Goals',
  '/debt': 'Debt',
  '/portfolio': 'Portfolio',
  '/tax': 'Tax',
  '/profile': 'Profile',
  '/plans': 'Plans',
  '/plans/new': 'New plan',
  '/plans/retirement': 'Retirement',
  '/financial-level': 'Financial level',
  '/insights': 'Actions',
  '/retirement': 'Retirement',
  '/probability': 'Probability of success',
  '/net-worth': 'Net worth',
  '/cash-flow': 'Cash flow',
};
