import { Moon, Sun } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useUiMode } from './mode';

/**
 * ThemeToggle — flips the `.dark` class on <html> (light is default). Persists
 * the choice via the useUiMode hook.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, toggle } = useUiMode();
  const isDark = mode === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'ui-focus inline-flex h-11 min-h-touch items-center gap-2 rounded-ui-md border border-line-strong bg-panel px-3.5 text-[13px] font-medium text-content shadow-ui-sm',
        'transition-colors duration-150 ease-ui hover:bg-canvas-sunken',
        className,
      )}
    >
      {isDark ? <Moon className="h-4 w-4 text-brand" /> : <Sun className="h-4 w-4 text-brand" />}
      {isDark ? 'Dark' : 'Light'}
    </button>
  );
}
