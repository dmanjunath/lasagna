import { Redirect, useLocation } from 'wouter';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { cn } from '../../lib/utils';

const TABS = [
  { label: 'Users', path: '/admin' },
  { label: 'Spend', path: '/admin/spend' },
];

/**
 * Shared chrome for the multi-page admin section: gate, header, tab nav.
 * Every admin page renders inside this shell.
 */
export function AdminShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  const { user } = useAuth();
  const [location, navigate] = useLocation();

  // Route gate: non-admins never see admin pages.
  if (!user?.isAdmin) return <Redirect to="/" />;

  return (
    <div className="mx-auto max-w-[1180px] px-[18px] sm:px-11 pt-5 sm:pt-9 pb-24 sm:pb-28 text-content">
      <header>
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[rgb(var(--ui-accent-ink))]">
          <ShieldCheck size={14} aria-hidden /> Admin
        </div>
        <h1 className="mt-1.5 font-editorial text-[30px] sm:text-[34px] font-bold tracking-[-0.02em]">Operator dashboard</h1>
        <p className="mt-1 text-[14px] font-medium text-content-muted">{subtitle}</p>
      </header>

      {/* Tab nav */}
      <nav className="mt-6 flex items-center gap-1 border-b border-line" aria-label="Admin sections">
        {TABS.map((t) => {
          // Tenant detail pages live under the Users tab.
          const active = t.path === '/admin' ? location === '/admin' || location.startsWith('/admin/users') : location === t.path;
          return (
            <button
              key={t.path}
              onClick={() => navigate(t.path)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'ui-focus touch-target px-4 h-10 text-[13.5px] font-semibold rounded-t-md transition-colors -mb-px border-b-2',
                active
                  ? 'text-content border-brand'
                  : 'text-content-muted border-transparent hover:text-content hover:bg-canvas-sunken',
              )}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
