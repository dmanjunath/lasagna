import { useLocation } from 'wouter';
import { useAuth } from '../../lib/auth';
import { useIsMobile } from '../../lib/hooks/use-mobile';

interface AppHeaderProps {
  /** Hamburger / back-arrow / etc. Mounted on the left. */
  leadingSlot?: React.ReactNode;
  /** Center title. Simple mode passes its page title; Advanced derives from path. */
  title?: string;
  /** Override mode-toggle visibility (defaults to true). */
  showModeToggle?: boolean;
  /** Title font size variant. Simple = larger serif, Advanced = compact sans. */
  variant?: 'simple' | 'advanced';
}

/**
 * Shared top bar for both Simple and Advanced modes. Lives `fixed top-0` and
 * mirrors the Coinbase pattern of a persistent Simple/Advanced segmented toggle
 * on every page so users can switch modes without hunting through menus.
 *
 * Both modes share the same layout (leading slot · title · toggle); only the
 * title typography differs by `variant` so each mode keeps its character.
 */
export function AppHeader({
  leadingSlot,
  title,
  showModeToggle = true,
  variant = 'simple',
}: AppHeaderProps) {
  const [location, setLocation] = useLocation();
  const { user, setUiMode } = useAuth();
  // Simple mode is mobile-only. On tablet/desktop the toggle disappears and
  // the user gets the Advanced view regardless of their saved preference —
  // matches Coinbase / Robinhood, which only expose "Simple" on phones.
  const isMobile = useIsMobile();

  const currentMode: 'simple' | 'advanced' = user?.uiMode === 'simple' ? 'simple' : 'advanced';
  // Resolve a title for Advanced pages from the path when one isn't passed in.
  const resolvedTitle = title ?? (variant === 'advanced' ? ADVANCED_TITLES[location] ?? '' : '');

  const handleSwitch = async (next: 'simple' | 'advanced') => {
    if (next === currentMode) return;
    try {
      await setUiMode(next);
    } catch {
      // If the API call fails we still flip the URL — UI hint stays in sync
      // because setUiMode also throws before updating local state, so we'd
      // be no-op'd. Silent catch is fine; user sees the toggle reset itself.
      return;
    }
    setLocation(next === 'simple' ? '/s' : '/');
  };

  // Title replaces the on-page H1 — needs to read as a true page heading.
  // Bumped to 24/22px Instrument Serif so it has the same visual register as
  // the body H1s it replaced (which were 28–36px in the content area). The
  // bar grows to h-14 (56px) to give the larger glyph breathing room.
  const titleClass =
    variant === 'simple'
      ? 'text-[24px] font-serif font-medium tracking-tight text-text leading-none'
      : 'text-[22px] font-serif font-medium tracking-tight text-text leading-none';

  return (
    <header className="fixed top-0 inset-x-0 z-30 bg-bg/95 backdrop-blur border-b border-rule/40 pt-safe-top">
      <div className="max-w-md md:max-w-none md:px-6 mx-auto px-4 h-14 flex items-center gap-2">
        <div className="w-11 -ml-2 shrink-0 flex items-center">{leadingSlot}</div>
        <div className={`flex-1 text-center truncate ${titleClass}`}>{resolvedTitle}</div>
        {showModeToggle && isMobile ? (
          <ModeToggle current={currentMode} onSwitch={handleSwitch} />
        ) : (
          <div className="w-11 -mr-2 shrink-0" aria-hidden="true" />
        )}
      </div>
    </header>
  );
}

/**
 * Segmented Simple/Advanced toggle. Coinbase-style — both segments visible at
 * all times, active segment filled, inactive dimmed. The whole control sits
 * inline in the header so the swap is one tap away from anywhere.
 */
function ModeToggle({
  current,
  onSwitch,
}: {
  current: 'simple' | 'advanced';
  onSwitch: (next: 'simple' | 'advanced') => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Switch app mode"
      className="inline-flex rounded-full bg-bg-elevated border border-rule p-[3px] text-[11px] shrink-0"
    >
      <button
        role="tab"
        aria-selected={current === 'simple'}
        onClick={() => onSwitch('simple')}
        className={`px-3 py-1.5 rounded-full transition ${
          current === 'simple' ? 'bg-text text-white font-medium' : 'text-text-muted'
        }`}
      >
        Simple
      </button>
      <button
        role="tab"
        aria-selected={current === 'advanced'}
        onClick={() => onSwitch('advanced')}
        className={`px-3 py-1.5 rounded-full transition ${
          current === 'advanced' ? 'bg-text text-white font-medium' : 'text-text-muted'
        }`}
      >
        Advanced
      </button>
    </div>
  );
}

// Path → title map for Advanced pages. Keeping this here instead of plumbing
// setPageContext into every page; it's a thin shim and easy to extend.
const ADVANCED_TITLES: Record<string, string> = {
  '/': 'Dashboard',
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
