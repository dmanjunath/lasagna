import { useState, useEffect } from 'react';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/api';
import { getPreferredModel, setPreferredModel, type ChatModelOverride } from '../../lib/chat-store';
import { cn } from '../../lib/utils';
import { OptionMenu } from '../common/OptionMenu';

type Provider = { id: string; label: string; models: { id: string; label: string }[] };

const AUTO = 'auto';
const keyOf = (o: ChatModelOverride) => `${o.provider}::${o.model}`;

/**
 * Admin-only control to pin the exact inference provider + model the chat uses,
 * overriding the default provider/tier. The choice is persisted in localStorage;
 * the server re-validates it and gates it to admins on every request. Renders
 * nothing for non-admins (or if no provider catalog is available).
 *
 * The shared OptionMenu, one tinted band per provider. A pinned model takes the
 * brand tint, the same as a set toolbar filter.
 *
 * `variant="composer"` docks the trigger as a footer control inside the message
 * composer (the default chat placement), where the menu opens upward so it
 * stays on screen; `standalone` renders just it.
 */
export function AdminModelPicker({
  className,
  variant = 'standalone',
}: {
  className?: string;
  variant?: 'standalone' | 'composer';
}) {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const [catalog, setCatalog] = useState<Provider[]>([]);
  const [override, setOverride] = useState<ChatModelOverride | null>(() => getPreferredModel());

  useEffect(() => {
    if (!isAdmin) return;
    api.getChatModels().then(r => setCatalog(r.providers)).catch(() => { /* picker just won't show */ });
  }, [isAdmin]);

  if (!isAdmin || catalog.length === 0) return null;

  const choices = new Map<string, ChatModelOverride>();
  const options: Array<{ value: string; label: string; group?: string }> = [{ value: AUTO, label: 'Auto (default)' }];
  for (const p of catalog) {
    for (const m of p.models) {
      const o = { provider: p.id, model: m.id };
      choices.set(keyOf(o), o);
      options.push({ value: keyOf(o), label: m.label, group: p.label });
    }
  }
  const value = override ? keyOf(override) : AUTO;

  const choose = (key: string) => {
    const next = choices.get(key) ?? null;
    setOverride(next);
    setPreferredModel(next);
  };

  const trigger = (
    <div title="Admin: pin an exact provider + model for the chat (overrides the default). Sail models have no web search.">
      <OptionMenu
        ariaLabel="Chat model"
        value={value}
        // A pin that is no longer in the catalog still names itself.
        triggerLabel={override && !choices.has(value) ? override.model : undefined}
        options={options}
        onChange={choose}
        toolbar={{ count: override ? 1 : 0, badge: false }}
        className="max-w-[220px]"
        panelClassName={variant === 'composer' ? 'top-auto bottom-full mb-1.5 mt-0 origin-bottom' : undefined}
      />
    </div>
  );

  if (variant === 'composer') {
    return (
      <div className={cn('flex items-center border-t border-line px-2.5 py-1.5', className)}>
        {trigger}
      </div>
    );
  }

  return <div className={cn('w-fit', className)}>{trigger}</div>;
}
