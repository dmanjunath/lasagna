import { Moon, Sun } from 'lucide-react';
import { useLocation } from 'wouter';
import { useUiMode } from '../uikit/mode';
import { BrandMark } from '../common/BrandMark';

interface AppHeaderProps {
  /** Hamburger / back-arrow / etc. Mounted on the left. */
  leadingSlot?: React.ReactNode;
  /** @deprecated — kept for prop compatibility. Page titles now come from
   * the page's own `<PageHeader>` to avoid double-titling on mobile. */
  title?: string;
  /** @deprecated — kept for prop compatibility. */
  variant?: 'simple' | 'advanced';
}

/**
 * Shared top bar (mobile only). Lives `fixed top-0`. Renders the hamburger,
 * the brand mark + wordmark, and the global light/dark toggle on the right.
 */
export function AppHeader({ leadingSlot }: AppHeaderProps) {
  const { mode, toggle } = useUiMode();
  const [location] = useLocation();
  const isDark = mode === 'dark';
  // Home has no page H1 (just a greeting), so it carries the brand wordmark.
  // Inner pages already lead with their own large title, so the top bar drops
  // the redundant wordmark and shows a centered mark — a slim utility strip
  // instead of a second stacked header band.
  const isHome = location === '/';
  return (
    <header
      className="fixed top-0 inset-x-0 z-30 border-b border-line pt-safe-top backdrop-blur-md"
      style={{ background: 'rgb(var(--ui-canvas) / 0.86)' }}
    >
      <div className="mx-auto px-4 h-12 flex items-center gap-2">
        <div className="w-11 -ml-2 shrink-0 flex items-center">{leadingSlot}</div>
        {isHome ? (
          <div className="flex-1 flex items-center gap-2.5 min-w-0">
            <BrandMark size={32} />
            <span className="font-editorial text-[17px] font-semibold text-content leading-none tracking-[-0.01em]">
              LasagnaFi
            </span>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center min-w-0">
            <BrandMark size={28} />
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          role="switch"
          aria-checked={isDark}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-11 h-11 -mr-2 shrink-0 grid place-items-center rounded-[10px] text-content-secondary hover:bg-canvas-sunken hover:text-content transition-colors"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
