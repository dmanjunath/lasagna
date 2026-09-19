import { useEffect, useState } from 'react';
import { api, type FeatureFlag } from '../lib/api';
import { Skeleton } from '../components/uikit';
import { AdminShell } from '../components/admin/admin-shell';
import { cn, formatInstant } from '../lib/utils';

/**
 * Deployment-wide switches.
 *
 * Every row here changes the app for every user at once, so the page says that
 * plainly rather than looking like a preferences screen. A flag that has never
 * been flipped has no row in the database and reads as off.
 */
export function AdminFlags() {
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.adminGetFeatureFlags()
      .then((r) => setFlags(r.flags))
      .catch(() => setError('We could not load the flags.'));
  }, []);

  const toggle = async (flag: FeatureFlag) => {
    if (busy) return;
    setBusy(flag.key);
    setError('');
    try {
      const r = await api.adminSetFeatureFlag(flag.key, !flag.enabled);
      setFlags(r.flags);
    } catch {
      setError(`We could not change ${flag.label}. Try again.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminShell subtitle="Switches that apply to every user on this deployment">
      {error && (
        <p role="alert" className="mt-6 text-[13px] font-medium text-negative">{error}</p>
      )}

      <div className="mt-6 space-y-3">
        {flags === null && !error && (
          <>
            <Skeleton className="h-[104px] w-full rounded-ui-lg" />
            <Skeleton className="h-[104px] w-full rounded-ui-lg" />
          </>
        )}

        {flags?.length === 0 && (
          <p className="text-[13.5px] font-medium text-content-muted">
            This build has no feature flags.
          </p>
        )}

        {flags?.map((flag) => (
          <div
            key={flag.key}
            className="rounded-ui-xl border border-line bg-panel shadow-ui-sm p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h3 className="text-[15px] font-bold text-content">{flag.label}</h3>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.04em]',
                      flag.enabled
                        ? 'bg-brand-soft text-[rgb(var(--ui-brand-ink))]'
                        : 'bg-canvas-sunken text-content-muted',
                    )}
                  >
                    {flag.enabled ? 'On for everyone' : 'Off'}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] font-medium leading-[1.5] text-content-muted">
                  {flag.description}
                </p>
                <p className="mt-2 text-[12px] font-medium text-content-faint">
                  <code className="font-mono">{flag.key}</code>{' '}
                  {flag.updatedAt
                    ? ` changed ${formatInstant(flag.updatedAt, {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}`
                    : ' never changed'}
                </p>
              </div>

              <Switch
                checked={flag.enabled}
                onChange={() => void toggle(flag)}
                disabled={busy !== null}
                label={flag.label}
              />
            </div>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}

/** The brand toggle, matching the one Settings uses for Face ID. */
function Switch({
  checked, onChange, disabled, label,
}: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onChange}
      disabled={disabled}
      className="ui-focus shrink-0 min-h-touch grid place-items-center rounded-ui-md disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span
        className={cn(
          'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors duration-150 ease-ui',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'inline-block h-[18px] w-[18px] rounded-full bg-panel shadow-ui-sm transition-transform duration-150 ease-ui',
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
          )}
        />
      </span>
    </button>
  );
}
